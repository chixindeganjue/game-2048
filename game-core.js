/*!
 * 2048 规则引擎（纯逻辑，无 DOM、无网络）
 * 浏览器：window.Game2048Core；Node：require('./game-core.js')
 *
 * 棋盘单元格存放方块对象 { id, value }，id 在整局内唯一，
 * 便于界面按 id 做位移动画与合并动画。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Game2048Core = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRECTIONS = ['up', 'down', 'left', 'right'];
  var BEST_KEY = 'dsh-2048-best';
  var HISTORY_LIMIT = 20;
  var WIN_VALUE = 2048;
  var DEFAULT_SIZE = 4;
  var nextTileId = 1;

  function makeId() {
    return nextTileId++;
  }

  function makeTile(value) {
    return { id: makeId(), value: value };
  }

  function emptyGrid(size) {
    var grid = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) {
        row.push(null);
      }
      grid.push(row);
    }
    return grid;
  }

  function cloneGrid(grid) {
    return grid.map(function (row) {
      return row.map(function (cell) {
        return cell ? { id: cell.id, value: cell.value } : null;
      });
    });
  }

  /** 把内部棋盘转成纯数值棋盘，空格为 0。 */
  function valuesOf(grid) {
    return grid.map(function (row) {
      return row.map(function (cell) {
        return cell ? cell.value : 0;
      });
    });
  }

  /** 用纯数值棋盘建盘（测试与演示用），每个非零值分配新的方块 id。 */
  function gridFromValues(values) {
    return values.map(function (row) {
      return row.map(function (value) {
        return value ? makeTile(Number(value)) : null;
      });
    });
  }

  function emptyCells(grid) {
    var cells = [];
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        if (!grid[r][c]) {
          cells.push({ r: r, c: c });
        }
      }
    }
    return cells;
  }

  function hasWinningTile(grid) {
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        if (grid[r][c] && grid[r][c].value >= WIN_VALUE) {
          return true;
        }
      }
    }
    return false;
  }

  /** 还有空位、或存在相邻同值，就能继续走。 */
  function canMove(grid) {
    if (emptyCells(grid).length > 0) {
      return true;
    }
    var size = grid.length;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var value = grid[r][c] ? grid[r][c].value : 0;
        if (!value) {
          return true;
        }
        if (c + 1 < size && grid[r][c + 1] && grid[r][c + 1].value === value) {
          return true;
        }
        if (r + 1 < size && grid[r + 1][c] && grid[r + 1][c].value === value) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 按移动方向取出一条线上的格子，顺序为“打包顺序”：
   * 下标 0 就是该方向上的最远端（最该被推到的位置）。
   */
  function lineEntries(grid, dir, lineIndex) {
    var size = grid.length;
    var entries = [];
    for (var j = 0; j < size; j++) {
      var r;
      var c;
      if (dir === 'left') {
        r = lineIndex;
        c = j;
      } else if (dir === 'right') {
        r = lineIndex;
        c = size - 1 - j;
      } else if (dir === 'up') {
        r = j;
        c = lineIndex;
      } else {
        r = size - 1 - j;
        c = lineIndex;
      }
      entries.push({ r: r, c: c, tile: grid[r][c] });
    }
    return entries;
  }

  function readBest(storage) {
    if (!storage || typeof storage.get !== 'function') {
      return 0;
    }
    var parsed = Number(storage.get(BEST_KEY));
    return isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  function writeBest(storage, value) {
    if (!storage || typeof storage.set !== 'function') {
      return;
    }
    try {
      storage.set(BEST_KEY, String(value));
    } catch (error) {
      /* 存储不可用时静默降级，不影响玩法 */
    }
  }

  /** 随机放一个方块，返回它落在哪里、值是多少。 */
  function spawnRandom(state) {
    var cells = emptyCells(state.grid);
    if (!cells.length) {
      return null;
    }
    var randomIndex = state.rng();
    var index = Math.min(cells.length - 1, Math.max(0, Math.floor(randomIndex * cells.length)));
    var value = state.rng() < 0.9 ? 2 : 4;
    var tile = makeTile(value);
    var cell = cells[index];
    state.grid[cell.r][cell.c] = tile;
    return { id: tile.id, value: value, r: cell.r, c: cell.c };
  }

  function createGame(options) {
    options = options || {};
    var size = Math.max(2, Math.floor(options.size || DEFAULT_SIZE));
    var state = {
      size: size,
      grid: emptyGrid(size),
      score: 0,
      best: readBest(options.storage),
      status: 'playing',
      won: false,
      moves: 0,
      history: [],
      rng: typeof options.rng === 'function' ? options.rng : Math.random,
      storage: options.storage || null
    };
    spawnRandom(state);
    spawnRandom(state);
    return state;
  }

  /** 新开一局：清空棋盘、分数、历史，但保留最高分。 */
  function resetGame(state) {
    state.grid = emptyGrid(state.size);
    state.score = 0;
    state.status = 'playing';
    state.won = false;
    state.moves = 0;
    state.history = [];
    spawnRandom(state);
    spawnRandom(state);
    return state;
  }

  function pushHistory(state) {
    state.history.push({
      grid: cloneGrid(state.grid),
      score: state.score,
      moves: state.moves,
      status: state.status
    });
    while (state.history.length > HISTORY_LIMIT) {
      state.history.shift();
    }
  }

  /**
   * 朝某个方向移动一步。
   * 返回 { moved, gained, placements, absorbed, spawned }。
   * placements 描述存活方块的新位置；absorbed 描述被吞掉的方块（先滑过去再从界面移除）。
   */
  function move(state, dir) {
    var nothing = { moved: false, gained: 0, placements: [], absorbed: [], spawned: null };
    if (!state || DIRECTIONS.indexOf(dir) === -1 || state.status !== 'playing') {
      return nothing;
    }

    var size = state.size;
    var nextGrid = emptyGrid(size);
    var placements = [];
    var absorbed = [];
    var gained = 0;
    var moved = false;

    for (var line = 0; line < size; line++) {
      var entries = lineEntries(state.grid, dir, line);
      var movers = [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].tile) {
          movers.push({ tile: entries[i].tile, from: { r: entries[i].r, c: entries[i].c } });
        }
      }

      var cursor = 0;
      var target = 0;
      while (cursor < movers.length) {
        var current = movers[cursor];
        var next = movers[cursor + 1];
        var destination = entries[target];
        var merged = false;
        var swallowed = null;
        var value = current.tile.value;

        if (next && next.tile.value === current.tile.value) {
          value = current.tile.value * 2;
          gained += value;
          merged = true;
          swallowed = next;
          cursor += 2;
        } else {
          cursor += 1;
        }

        if (merged || current.from.r !== destination.r || current.from.c !== destination.c) {
          moved = true;
        }

        var keptTile = { id: current.tile.id, value: value };
        nextGrid[destination.r][destination.c] = keptTile;
        placements.push({
          id: keptTile.id,
          value: value,
          from: current.from,
          to: { r: destination.r, c: destination.c },
          merged: merged
        });

        if (swallowed) {
          absorbed.push({
            id: swallowed.tile.id,
            value: swallowed.tile.value,
            from: swallowed.from,
            to: { r: destination.r, c: destination.c }
          });
        }
        target += 1;
      }
    }

    if (!moved) {
      return nothing;
    }

    pushHistory(state);
    state.grid = nextGrid;
    state.score += gained;
    state.moves += 1;

    var spawned = spawnRandom(state);

    if (!state.won && hasWinningTile(state.grid)) {
      state.won = true;
      state.status = 'won';
    } else if (!canMove(state.grid)) {
      state.status = 'over';
    }

    if (state.score > state.best) {
      state.best = state.score;
      writeBest(state.storage, state.best);
    }

    return { moved: true, gained: gained, placements: placements, absorbed: absorbed, spawned: spawned };
  }

  /** 撤销一步，返回是否成功。 */
  function undo(state) {
    if (!state || !state.history.length) {
      return false;
    }
    var snapshot = state.history.pop();
    state.grid = cloneGrid(snapshot.grid);
    state.score = snapshot.score;
    state.moves = snapshot.moves;
    state.status = snapshot.status;
    return true;
  }

  /** 达成 2048 后点“继续挑战”：回到可玩状态（若已无路可走则直接结束）。 */
  function continueGame(state) {
    if (!state || state.status !== 'won') {
      return state ? state.status : 'playing';
    }
    state.status = canMove(state.grid) ? 'playing' : 'over';
    return state.status;
  }

  /** 用给定数值棋盘构造一个状态（演示 / 测试用）。 */
  function fromValues(values, options) {
    options = options || {};
    var size = values.length;
    var grid = gridFromValues(values);
    var best = options.best !== undefined ? Math.max(0, Math.floor(options.best || 0)) : readBest(options.storage);
    var state = {
      size: size,
      grid: grid,
      score: Math.max(0, Math.floor(options.score || 0)),
      best: best,
      status: options.status || 'playing',
      won: options.status === 'won' || hasWinningTile(grid),
      moves: Math.max(0, Math.floor(options.moves || 0)),
      history: [],
      rng: typeof options.rng === 'function' ? options.rng : Math.random,
      storage: options.storage || null
    };
    if (state.status === 'playing' && !canMove(grid)) {
      state.status = 'over';
    }
    return state;
  }

  return {
    DIRECTIONS: DIRECTIONS,
    BEST_KEY: BEST_KEY,
    HISTORY_LIMIT: HISTORY_LIMIT,
    WIN_VALUE: WIN_VALUE,
    DEFAULT_SIZE: DEFAULT_SIZE,
    createGame: createGame,
    resetGame: resetGame,
    fromValues: fromValues,
    move: move,
    undo: undo,
    continueGame: continueGame,
    canMove: canMove,
    valuesOf: valuesOf,
    gridFromValues: gridFromValues,
    emptyGrid: emptyGrid,
    cloneGrid: cloneGrid,
    emptyCells: emptyCells,
    hasWinningTile: hasWinningTile,
    spawnRandom: spawnRandom
  };
});
