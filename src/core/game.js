/**
 * ゲーム進行（ラウンド編成・敵の編成・配置・セーブ）を司る状態管理。
 * 描画には依存しない。
 */

import { UNIT_IDS, UNIT_TYPES } from "./units.js";
import { ENEMY_ROWS, PLAYER_ROWS, SIZE } from "./board.js";

export const Phase = {
  SELECT: "select",
  PREP: "prep",
  BATTLE: "battle",
  RESULT: "result",
  GAMEOVER: "gameover",
};

/** 1チームの人数 */
export const SQUAD_SIZE = 5;
export const START_LIFE = 3;

/** 序盤6ラウンドの固定編成。以降は自動生成する */
const ENEMY_SCRIPT = [
  {
    comp: ["pawn", "pawn", "pawn", "rook", "bishop"],
    power: 0.78,
    name: "農民兵団",
  },
  {
    comp: ["pawn", "pawn", "knight", "knight", "bishop"],
    power: 0.9,
    name: "斥候隊",
  },
  {
    comp: ["rook", "rook", "pawn", "bishop", "knight"],
    power: 1.0,
    name: "城塞守備隊",
  },
  {
    comp: ["knight", "knight", "pawn", "queen", "king"],
    power: 1.1,
    name: "王家の騎兵",
  },
  {
    comp: ["bishop", "bishop", "rook", "queen", "pawn"],
    power: 1.2,
    name: "魔導砲兵",
  },
  {
    comp: ["king", "rook", "queen", "bishop", "knight"],
    power: 1.32,
    name: "黒王の親衛隊",
  },
];

const LATE_NAMES = [
  "深淵の遠征軍",
  "銀嶺の異端者",
  "紅の簒奪者",
  "無窮の残響",
  "終焉の盤上",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * localStorage はプライベートブラウジングや iframe 内で例外を投げることがあるので、
 * 失敗してもゲームが止まらないように包んでおく。
 */
const storage = {
  get(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 保存できない環境では諦める */
    }
  },
};

export class Game {
  constructor() {
    this.reset();
    this.best = Number(storage.get("autochess.best", 0));
  }

  reset() {
    this.round = 1;
    this.life = START_LIFE;
    this.streak = 0;
    this.phase = Phase.SELECT;
    /** @type {{typeId:string, star:number, tile:{c:number,r:number}}[]} */
    this.squad = [];
  }

  get isOver() {
    return this.life <= 0;
  }

  /** 選んだコマで編成を作り、初期配置を割り当てる */
  setSquad(typeIds) {
    this.squad = typeIds.map((typeId) => ({ typeId, star: 1, tile: null }));
    this.autoPlaceSquad();
  }

  /**
   * 前衛（近接）を前列、後衛（射程持ち）を後列に自動配置する。
   * プレイヤーの前方は +row なので row2 が最前線。
   */
  autoPlaceSquad() {
    const melee = [];
    const ranged = [];
    for (const s of this.squad) {
      (UNIT_TYPES[s.typeId].range > 1 ? ranged : melee).push(s);
    }
    // 盤の中央から外側へ広がるように並べる
    const cols = [3, 4, 2, 5, 1, 6, 0, 7];

    melee.forEach((s, i) => {
      s.tile = { c: cols[i % cols.length], r: PLAYER_ROWS[2] };
    });
    ranged.forEach((s, i) => {
      s.tile = { c: cols[i % cols.length], r: PLAYER_ROWS[0] };
    });

    this._resolveOverlaps(this.squad, PLAYER_ROWS);
  }

  /** 同じマスに重ならないように押し出す */
  _resolveOverlaps(list, rows) {
    const used = new Set();
    for (const s of list) {
      let k = `${s.tile.c},${s.tile.r}`;
      if (!used.has(k)) {
        used.add(k);
        continue;
      }
      outer: for (const r of rows) {
        for (let c = 0; c < SIZE; c++) {
          k = `${c},${r}`;
          if (!used.has(k)) {
            s.tile = { c, r };
            used.add(k);
            break outer;
          }
        }
      }
    }
  }

  /** このラウンドの敵編成を作る */
  buildEnemyWave() {
    const idx = this.round - 1;
    let comp;
    let power;
    let name;

    if (idx < ENEMY_SCRIPT.length) {
      ({ comp, power, name } = ENEMY_SCRIPT[idx]);
    } else {
      const extra = this.round - ENEMY_SCRIPT.length;
      comp = Array.from({ length: SQUAD_SIZE }, () => pick(UNIT_IDS));
      power = 1.32 + extra * 0.09;
      name = pick(LATE_NAMES);
    }

    // 後半は敵も★が上がる。
    // ★1つで1.7倍と跳ね上がるので、プレイヤーが全員を★アップし終える
    // ペース（1勝で1体）に合わせて遅らせておく。
    const star = this.round >= 20 ? 3 : this.round >= 11 ? 2 : 1;
    if (star > 1) power /= Math.pow(1.35, star - 1); // ★の跳ね上がりを一部相殺

    const cols = [3, 4, 2, 5, 1, 6, 0, 7];
    let rangedI = 0;
    let meleeI = 0;

    const units = comp.map((typeId) => {
      const isRanged = UNIT_TYPES[typeId].range > 1;
      // 敵の前方は -row なので row5 が最前線
      const tile = isRanged
        ? { c: cols[rangedI++ % cols.length], r: ENEMY_ROWS[2] }
        : { c: cols[meleeI++ % cols.length], r: ENEMY_ROWS[0] };
      return { typeId, star, tile };
    });

    this._resolveOverlaps(units, [...ENEMY_ROWS].reverse());

    return { name, power, star, units };
  }

  /** 勝敗を反映して次のフェーズを決める */
  applyResult(winner) {
    if (winner === "player") {
      this.streak += 1;
      this.round += 1;
      if (this.round - 1 > this.best) {
        this.best = this.round - 1;
        storage.set("autochess.best", String(this.best));
      }
      return "win";
    }
    this.streak = 0;
    this.life -= 1;
    if (this.life <= 0) {
      this.phase = Phase.GAMEOVER;
      return "gameover";
    }
    return "lose";
  }

  /** ★アップ可能なユニット（★3が上限） */
  upgradableUnits() {
    return this.squad.filter((s) => s.star < 3);
  }

  upgrade(squadEntry) {
    if (squadEntry.star < 3) squadEntry.star += 1;
  }

  /** 編成の1体を別のコマに入れ替える */
  replaceUnit(index, typeId) {
    const prev = this.squad[index];
    this.squad[index] = { typeId, star: prev.star, tile: prev.tile };
  }
}
