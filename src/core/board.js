/**
 * 8x8 のチェス盤ロジック。
 *
 * 座標系: col = 0..7 (左→右 / +X), row = 0..7 (手前→奥 / +Z)
 *  - プレイヤー陣地: row 0,1,2  （カメラ手前）
 *  - 敵陣地:         row 5,6,7
 *  - プレイヤーの「前方」は +row、敵の「前方」は -row
 */

import { MoveKind } from "./units.js";

export const SIZE = 8;
export const PLAYER_ROWS = [0, 1, 2];
export const ENEMY_ROWS = [5, 6, 7];

/**
 * ベンチ（控え）の行。盤の外側（手前）にぶら下がる仮想の1列で、
 * ここに居るユニットは戦闘に参加しない。
 * 盤内判定 inBounds は r >= 0 なので、経路探索がここへ入ってくることはない。
 */
export const BENCH_ROW = -1;
export const BENCH_SIZE = SIZE;
export const BENCH_TILES = Array.from({ length: BENCH_SIZE }, (_, c) => ({
  c,
  r: BENCH_ROW,
}));

export const isBenchTile = (tile) => tile?.r === BENCH_ROW;

export const inBounds = (c, r) => c >= 0 && c < SIZE && r >= 0 && r < SIZE;
export const key = (c, r) => r * SIZE + c;
export const fromKey = (k) => ({ c: k % SIZE, r: Math.floor(k / SIZE) });

/** キング距離（斜めも1として数える）。射程判定に使う */
export const chebyshev = (a, b) =>
  Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));

/** マス名（a1 〜 h8）。ログ表示用 */
export const tileName = (t) =>
  isBenchTile(t) ? `控え${t.c + 1}` : "abcdefgh"[t.c] + (t.r + 1);

/** 自陣（配置可能エリア）判定 */
export const isDeployZone = (team, r) =>
  team === "player" ? PLAYER_ROWS.includes(r) : ENEMY_ROWS.includes(r);

/**
 * 1手で到達できるマスを列挙する。
 * @param {{c:number,r:number}} from
 * @param {object} move ユニット定義の move
 * @param {(c:number,r:number)=>boolean} isBlocked 他コマが居るか
 * @param {number} forward +1 / -1
 * @returns {{c:number,r:number}[]}
 */
export function movesFrom(from, move, isBlocked, forward = 1) {
  const out = [];

  if (move.kind === MoveKind.SLIDE) {
    for (const [dc, dr] of move.dirs) {
      for (let step = 1; step <= move.distance; step++) {
        const c = from.c + dc * step;
        const r = from.r + dr * step;
        if (!inBounds(c, r)) break;
        if (isBlocked(c, r)) break; // 味方・敵どちらでも滑走は止まる
        out.push({ c, r });
      }
    }
    return out;
  }

  // STEP / JUMP は 1 オフセットぶん
  for (const [dc, drRaw] of move.dirs) {
    // forwardBias が有効なコマ（ポーン）は自陣の向きに合わせて前後を反転する
    const dr = move.forwardBias ? drRaw * forward : drRaw;
    const c = from.c + dc;
    const r = from.r + dr;
    if (!inBounds(c, r)) continue;
    if (isBlocked(c, r)) continue;
    if (move.kind === MoveKind.STEP && !isStraightPathClear(from, { c, r }, isBlocked)) continue;
    out.push({ c, r });
  }
  return out;
}

/** STEP は距離1なので実質チェック不要だが、将来 distance>1 の STEP に備える */
function isStraightPathClear(from, to, isBlocked) {
  const dc = Math.sign(to.c - from.c);
  const dr = Math.sign(to.r - from.r);
  const steps = Math.max(Math.abs(to.c - from.c), Math.abs(to.r - from.r));
  for (let i = 1; i < steps; i++) {
    if (isBlocked(from.c + dc * i, from.r + dr * i)) return false;
  }
  return true;
}

/**
 * 目標マスの「射程内」に入れる最短経路を幅優先探索し、最初の1手を返す。
 * 到達不能なら、目標に最も近づける1手を返す（それも無ければ null）。
 *
 * @param {{c:number,r:number}} start
 * @param {{c:number,r:number}} goal 敵ユニットのいるマス
 * @param {number} range 攻撃射程（Chebyshev）
 * @param {object} move ユニット定義の move
 * @param {(c:number,r:number)=>boolean} occupied 盤面の占有判定（start は false 扱いで渡すこと）
 * @param {number} forward
 * @returns {{c:number,r:number}|null}
 */
export function stepToward(start, goal, range, move, occupied, forward = 1) {
  const isBlocked = (c, r) => (c === goal.c && r === goal.r) || occupied(c, r);

  const startK = key(start.c, start.r);
  const prevMove = new Map(); // 到達マス -> 最初の1手
  const queue = [start];
  const seen = new Set([startK]);

  let best = null;
  let bestDist = chebyshev(start, goal);

  while (queue.length) {
    const cur = queue.shift();
    const curK = key(cur.c, cur.r);
    const firstMove = curK === startK ? null : prevMove.get(curK);

    for (const next of movesFrom(cur, move, isBlocked, forward)) {
      const k = key(next.c, next.r);
      if (seen.has(k)) continue;
      seen.add(k);

      const step = firstMove ?? next; // 経路の最初の1手を引き継ぐ
      prevMove.set(k, step);

      const d = chebyshev(next, goal);
      if (d <= range) return step; // 射程内に入れた

      if (d < bestDist) {
        bestDist = d;
        best = step;
      }
      queue.push(next);
    }
  }
  return best;
}

/** 盤面のマス一覧 */
export function allTiles() {
  const tiles = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) tiles.push({ c, r });
  return tiles;
}

/** 盤の色（true = 明るいマス）。チェス標準では a1 が暗いマス */
export const isLightTile = (c, r) => (c + r) % 2 === 1;
