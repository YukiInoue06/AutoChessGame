/**
 * ゲーム進行（ラウンド編成・敵の編成・配置・セーブ）を司る状態管理。
 * 描画には依存しない。
 */

import { UNIT_IDS, UNIT_TYPES } from "./units.js";
import { BENCH_ROW, BENCH_SIZE, ENEMY_ROWS, PLAYER_ROWS, SIZE } from "./board.js";

export const Phase = {
  SELECT: "select",
  PREP: "prep",
  BATTLE: "battle",
  RESULT: "result",
  GAMEOVER: "gameover",
};

/** 盤に出せる最大人数 */
export const SQUAD_SIZE = 5;
export const START_LIFE = 3;

/** 経済まわりの定数 */
export const START_GOLD = 16;
/** ラウンド終了時の基本収入 */
const INCOME_BASE = 10;
/** 勝利ボーナス */
const INCOME_WIN = 4;
/** 連勝ボーナスの上限 */
const INCOME_STREAK_CAP = 5;

/** 出撃コストの上限（ラウンドとともに増える） */
export function deployLimitFor(round) {
  return Math.min(22, 9 + Math.floor((round - 1) * 0.9));
}

/**
 * 雇えるようになるラウンド。
 * 序盤に高コストを買い込んでも出撃コスト上限のせいで2体しか出せず、
 * 立て直せないまま負ける — という罠を防ぐための解禁段階。
 */
const UNLOCK_ROUND = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 6 };
export const unlockRoundFor = (cost) => UNLOCK_ROUND[cost] ?? 1;

/** 序盤6ラウンドの固定編成。以降は自動生成する */
const ENEMY_SCRIPT = [
  {
    comp: ["pawn", "pawn", "warrior", "rook", "archer"],
    power: 0.78,
    name: "農民兵団",
  },
  {
    comp: ["thief", "archer", "knight", "warrior", "cleric"],
    power: 0.9,
    name: "斥候隊",
  },
  {
    comp: ["paladin", "guardian", "rook", "bishop", "cleric"],
    power: 1.0,
    name: "城塞守備隊",
  },
  {
    comp: ["knight", "dragoon", "warrior", "queen", "king"],
    power: 1.1,
    name: "王家の騎兵",
  },
  {
    comp: ["wizard", "icemage", "bishop", "sniper", "guardian"],
    power: 1.2,
    name: "魔導砲兵",
  },
  {
    comp: ["king", "paladin", "queen", "ninja", "berserker"],
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
    this.gold = START_GOLD;
    this.phase = Phase.SELECT;
    this._nextId = 1;
    /**
     * 所持ユニット。盤の上とベンチの両方をここで持ち、
     * onBoard で区別する。tile は盤上/ベンチどちらのマスも入る。
     * @type {{id:number, typeId:string, star:number, onBoard:boolean, tile:{c:number,r:number}}[]}
     */
    this.roster = [];
  }

  // ------------------------------------------------------------------ 編成

  /** 盤に出ているユニット（戦闘に参加する） */
  get squad() {
    return this.roster.filter((u) => u.onBoard);
  }

  /** ベンチのユニット */
  get bench() {
    return this.roster.filter((u) => !u.onBoard);
  }

  /** 現在の出撃コスト合計 */
  get deployCost() {
    return this.squad.reduce((n, u) => n + this.deployCostOf(u), 0);
  }

  get deployLimit() {
    return deployLimitFor(this.round);
  }

  /** 雇用コスト（兵舎での値段） */
  costOf(entry) {
    return UNIT_TYPES[entry.typeId].cost;
  }

  /**
   * 出撃コスト。★が上がると盤の枠をより多く食う。
   * こうしないと「安いユニットを★3にして並べる」が一方的に有利になる。
   */
  deployCostOf(entry) {
    return this.costOf(entry) + entry.star - 1;
  }

  /** ★アップに必要なゴールド（★3が上限） */
  upgradeCostOf(entry) {
    if (entry.star >= 3) return null;
    return this.costOf(entry) * 6 * entry.star;
  }

  /**
   * ゴールドで★アップする。
   * ★が上がると出撃コストも1増えるので、盤に出したままだと
   * 上限を超えてしまうことがある。その場合は断る
   * （控えに戻せば強化できる）。
   */
  buyUpgrade(entry) {
    const price = this.upgradeCostOf(entry);
    if (price == null) return { ok: false, reason: "すでに★3です" };
    if (this.gold < price) return { ok: false, reason: "ゴールドが足りません" };
    if (entry.onBoard && this.deployCost + 1 > this.deployLimit) {
      return {
        ok: false,
        reason: `★アップで出撃コストが上限（${this.deployLimit}）を超えます。控えに戻すか他を外してください`,
      };
    }
    this.gold -= price;
    entry.star += 1;
    return { ok: true };
  }

  /** 売却価格（雇用ぶん＋★アップに払ったぶんの半分が戻る） */
  refundOf(entry) {
    let refund = this.costOf(entry);
    for (let star = 1; star < entry.star; star++) {
      refund += Math.round((this.costOf(entry) * 6 * star) / 2);
    }
    return refund;
  }

  /** そのユニットを盤に出せるか。理由も返す */
  canField(entry) {
    if (entry.onBoard) return { ok: true };
    if (this.squad.length >= SQUAD_SIZE) {
      return { ok: false, reason: `盤に出せるのは${SQUAD_SIZE}体までです` };
    }
    const cost = this.deployCostOf(entry);
    if (this.deployCost + cost > this.deployLimit) {
      return {
        ok: false,
        reason: `出撃コストが上限（${this.deployLimit}）を超えます`,
      };
    }
    return { ok: true };
  }

  /** そのユニットがこのラウンドで雇えるか */
  isUnlocked(typeId) {
    const t = UNIT_TYPES[typeId];
    return !!t && this.round >= unlockRoundFor(t.cost);
  }

  /** 購入。成功したら追加されたエントリを返す */
  buy(typeId) {
    const t = UNIT_TYPES[typeId];
    if (!t || t.hidden) return null;
    if (!this.isUnlocked(typeId)) return null;
    if (this.gold < t.cost) return null;
    if (this.roster.length >= SQUAD_SIZE + BENCH_SIZE) return null;

    this.gold -= t.cost;
    const entry = {
      id: this._nextId++,
      typeId,
      star: 1,
      onBoard: false,
      tile: null,
    };
    this.roster.push(entry);

    // 空きがあれば盤へ、無ければベンチへ
    if (this.canField(entry).ok && this._placeOnBoard(entry)) {
      entry.onBoard = true;
    } else {
      this._placeOnBench(entry);
    }
    return entry;
  }

  /** 売却 */
  sell(entry) {
    const i = this.roster.indexOf(entry);
    if (i < 0) return false;
    this.gold += this.refundOf(entry);
    this.roster.splice(i, 1);
    return true;
  }

  /** 盤に出す */
  field(entry, tile = null) {
    const check = this.canField(entry);
    if (!check.ok) return check;
    entry.onBoard = true;
    if (tile) entry.tile = { ...tile };
    else if (!this._placeOnBoard(entry)) {
      entry.onBoard = false;
      return { ok: false, reason: "置ける空きマスがありません" };
    }
    return { ok: true };
  }

  /** ベンチに戻す */
  unfield(entry, tile = null) {
    entry.onBoard = false;
    if (tile) entry.tile = { ...tile };
    else this._placeOnBench(entry);
    return { ok: true };
  }

  /** 盤の空きマスに置く（前衛は前列、射程持ちは後列） */
  _placeOnBoard(entry) {
    const used = new Set(
      this.squad
        .filter((u) => u !== entry && u.tile)
        .map((u) => `${u.tile.c},${u.tile.r}`),
    );
    const cols = [3, 4, 2, 5, 1, 6, 0, 7];
    const rows =
      UNIT_TYPES[entry.typeId].range > 1
        ? [PLAYER_ROWS[0], PLAYER_ROWS[1], PLAYER_ROWS[2]]
        : [PLAYER_ROWS[2], PLAYER_ROWS[1], PLAYER_ROWS[0]];
    for (const r of rows) {
      for (const c of cols) {
        if (!used.has(`${c},${r}`)) {
          entry.tile = { c, r };
          return true;
        }
      }
    }
    return false;
  }

  /**
   * ベンチの空きスロットに置く。
   * カメラは -Z 側から見ているので列は左右反転して映る。
   * 画面の左から埋まって見えるように、列番号の大きい方から使う。
   */
  _placeOnBench(entry) {
    const used = new Set(
      this.bench.filter((u) => u !== entry && u.tile).map((u) => u.tile.c),
    );
    for (let c = BENCH_SIZE - 1; c >= 0; c--) {
      if (!used.has(c)) {
        entry.tile = { c, r: BENCH_ROW };
        return true;
      }
    }
    return false;
  }

  /** ラウンド終了時の収入 */
  grantIncome(win) {
    const streakBonus = Math.min(this.streak, INCOME_STREAK_CAP);
    const gain = INCOME_BASE + (win ? INCOME_WIN : 0) + streakBonus;
    this.gold += gain;
    return { gain, base: INCOME_BASE, win: win ? INCOME_WIN : 0, streak: streakBonus };
  }

  get isOver() {
    return this.life <= 0;
  }

  /**
   * コストを無視して編成を作る。
   * ゲーム本体では使わず、バランス検証スクリプトから利用する。
   */
  setSquad(typeIds) {
    this.roster = typeIds.map((typeId) => ({
      id: this._nextId++,
      typeId,
      star: 1,
      onBoard: true,
      tile: null,
    }));
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

  /** ★アップ可能なユニット（★3が上限）。ベンチも対象 */
  upgradableUnits() {
    return this.roster.filter((u) => u.star < 3);
  }

  upgrade(entry) {
    if (entry && entry.star < 3) entry.star += 1;
  }

  byId(id) {
    return this.roster.find((u) => u.id === id) ?? null;
  }
}
