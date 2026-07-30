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

/** レベルと同じだけ盤に出せる。ここは上限の保険 */
export const MAX_BOARD = 8;
export const START_LIFE = 3;

/** 経済まわりの定数 */
export const START_GOLD = 12;
/** ラウンド終了時の基本収入 */
const INCOME_BASE = 10;
/** 勝利ボーナス */
const INCOME_WIN = 4;
/** 連勝ボーナスの上限 */
const INCOME_STREAK_CAP = 5;

/** ------------------------------------------------------------ レベル */

export const START_LEVEL = 3;
export const MAX_LEVEL = 8;
/** ラウンド終了時に自動でもらえる経験値 */
export const XP_PER_ROUND = 2;
/** 経験値の購入（TFT と同じく 4G で 4exp） */
export const XP_BUY_COST = 4;
export const XP_BUY_AMOUNT = 4;
/** 次のレベルに必要な経験値 */
const XP_TO_NEXT = { 3: 6, 4: 10, 5: 20, 6: 36, 7: 56 };

/** ------------------------------------------------------------ ショップ */

export const SHOP_SLOTS = 5;
export const REROLL_COST = 2;
/**
 * レベルごとの、コスト帯の出現確率（%）。
 * 添字 0..4 がコスト1..5。高コストはレベルを上げないとほぼ出ない。
 */
const SHOP_ODDS = {
  3: [75, 25, 0, 0, 0],
  4: [55, 30, 15, 0, 0],
  5: [45, 33, 20, 2, 0],
  6: [25, 40, 30, 5, 0],
  7: [19, 30, 35, 15, 1],
  8: [15, 25, 32, 22, 6],
};
export const shopOddsFor = (level) => SHOP_ODDS[Math.min(MAX_LEVEL, level)] ?? SHOP_ODDS[3];

/** コスト帯ごとの購入候補 */
const BY_COST = {};
for (const id of UNIT_IDS) (BY_COST[UNIT_TYPES[id].cost] ??= []).push(id);

/** 序盤6ラウンドの固定編成。以降は自動生成する */
const ENEMY_SCRIPT = [
  {
    comp: ["pawn", "pawn", "warrior", "rook", "archer"],
    power: 0.72,
    name: "農民兵団",
  },
  {
    comp: ["thief", "archer", "knight", "warrior", "cleric"],
    power: 0.86,
    name: "斥候隊",
  },
  {
    // 重装3+王家2 がそろう編成。特性ぶん強くなるので基礎値は抑えめ。
    comp: ["paladin", "guardian", "rook", "bishop", "cleric"],
    power: 0.8,
    name: "城塞守備隊",
  },
  {
    comp: ["knight", "dragoon", "warrior", "queen", "king"],
    power: 1.0,
    name: "王家の騎兵",
  },
  {
    comp: ["wizard", "icemage", "bishop", "sniper", "guardian"],
    power: 1.09,
    name: "魔導砲兵",
  },
  {
    comp: ["king", "paladin", "queen", "ninja", "berserker"],
    power: 1.12,
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
    this.level = START_LEVEL;
    this.xp = 0;
    this.phase = Phase.SELECT;
    this._nextId = 1;
    /** ショップの品揃え（typeId か、買われた跡の null） */
    this.shop = [];
    /**
     * 所持ユニット。盤の上とベンチの両方をここで持ち、
     * onBoard で区別する。tile は盤上/ベンチどちらのマスも入る。
     * @type {{id:number, typeId:string, star:number, onBoard:boolean, tile:{c:number,r:number}}[]}
     */
    this.roster = [];
    this.rollShop();
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

  /** 雇用コスト（ショップでの値段） */
  costOf(entry) {
    return UNIT_TYPES[entry.typeId].cost;
  }

  /**
   * 売却価格。
   * ★2 は3体ぶん、★3 は9体ぶんの雇用コストが戻る（コスト1以外は1G差し引き）。
   */
  refundOf(entry) {
    const base = this.costOf(entry) * Math.pow(3, entry.star - 1);
    return entry.star > 1 && this.costOf(entry) > 1 ? base - 1 : base;
  }

  // ---------------------------------------------------------------- レベル

  /** 盤に出せる人数 = レベル */
  get maxUnits() {
    return Math.min(MAX_BOARD, this.level);
  }

  /** 次のレベルまでに必要な経験値。最大レベルなら null */
  get xpToNext() {
    return XP_TO_NEXT[this.level] ?? null;
  }

  /** 経験値を得る。溜まったらレベルアップする */
  gainXp(amount) {
    if (this.level >= MAX_LEVEL) return 0;
    this.xp += amount;
    let ups = 0;
    while (this.level < MAX_LEVEL && this.xp >= (XP_TO_NEXT[this.level] ?? Infinity)) {
      this.xp -= XP_TO_NEXT[this.level];
      this.level += 1;
      ups += 1;
    }
    if (this.level >= MAX_LEVEL) this.xp = 0;
    return ups;
  }

  /** ゴールドで経験値を買う */
  buyXp() {
    if (this.level >= MAX_LEVEL) return { ok: false, reason: "すでに最大レベルです" };
    if (this.gold < XP_BUY_COST) return { ok: false, reason: "ゴールドが足りません" };
    this.gold -= XP_BUY_COST;
    const ups = this.gainXp(XP_BUY_AMOUNT);
    return { ok: true, levelUps: ups };
  }

  // ---------------------------------------------------------------- ショップ

  /** レベルに応じた確率でコスト帯を1つ引く */
  _rollCostTier() {
    const odds = shopOddsFor(this.level);
    let r = Math.random() * 100;
    for (let i = 0; i < odds.length; i++) {
      r -= odds[i];
      if (r < 0) return i + 1;
    }
    return 1;
  }

  /** ショップの品揃えを引き直す（無料） */
  rollShop() {
    this.shop = Array.from({ length: SHOP_SLOTS }, () => {
      const tier = this._rollCostTier();
      const pool = BY_COST[tier] ?? BY_COST[1];
      return pool[Math.floor(Math.random() * pool.length)];
    });
  }

  /** ゴールドを払って引き直す */
  reroll() {
    if (this.gold < REROLL_COST) return { ok: false, reason: "ゴールドが足りません" };
    this.gold -= REROLL_COST;
    this.rollShop();
    return { ok: true };
  }

  /**
   * 控えが埋まっているか。
   * 買ったユニットはまず控えに入るので、これが購入の可否そのものになる
   * （控えのマスは実際に盤の手前に BENCH_SIZE 個しかない）。
   */
  get isBenchFull() {
    return this.bench.length >= BENCH_SIZE;
  }

  /** UI 用の別名 */
  get isRosterFull() {
    return this.isBenchFull;
  }

  /**
   * ショップの1枠を買う。
   * 買ったユニットは控えに入り、同じユニットが★込みで3体そろうと合体する。
   */
  buySlot(index) {
    const typeId = this.shop[index];
    if (!typeId) return { ok: false, reason: "その枠はもう空です" };
    const t = UNIT_TYPES[typeId];
    if (this.gold < t.cost) return { ok: false, reason: "ゴールドが足りません" };
    if (this.isBenchFull) return { ok: false, reason: "控えがいっぱいです" };

    this.gold -= t.cost;
    this.shop[index] = null;

    const entry = {
      id: this._nextId++,
      typeId,
      star: 1,
      onBoard: false,
      tile: null,
    };
    this.roster.push(entry);
    this._placeOnBench(entry);

    const merge = this._resolveMerges(typeId);
    // 合体で消えている場合があるので、残っている方を対象にする
    const target = merge.entry ?? entry;

    // 盤に空きがあればそのまま出す（毎回ドラッグさせないための親切）
    if (this.roster.includes(target) && !target.onBoard && this.canField(target).ok) {
      this.field(target);
    }
    return { ok: true, entry: target, merged: merge.star };
  }

  /**
   * 同じユニット・同じ★が3体そろったら1体上の★に合体させる。
   * 合体後にさらに3体そろうこともあるので、変化がなくなるまで繰り返す。
   */
  _resolveMerges(typeId) {
    let mergedTo = 0;
    let kept = null;
    for (let star = 1; star < 3; star++) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const same = this.roster.filter(
          (u) => u.typeId === typeId && u.star === star,
        );
        if (same.length < 3) break;

        // 盤に出ていたものがあれば、その位置を引き継ぐ
        const onBoard = same.find((u) => u.onBoard);
        const keep = onBoard ?? same[0];
        const drop = same.filter((u) => u !== keep).slice(0, 2);
        for (const u of drop) this.roster.splice(this.roster.indexOf(u), 1);

        keep.star = star + 1;
        mergedTo = keep.star;
        kept = keep;
      }
    }
    return { star: mergedTo, entry: kept };
  }

  /** そのユニットを盤に出せるか。理由も返す */
  canField(entry) {
    if (entry.onBoard) return { ok: true };
    if (this.squad.length >= this.maxUnits) {
      return {
        ok: false,
        reason: `盤に出せるのはレベルと同じ${this.maxUnits}体までです`,
      };
    }
    return { ok: true };
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

  /** ベンチに戻す。空きが無ければ断る */
  unfield(entry, tile = null) {
    if (!tile && this.isBenchFull) {
      return { ok: false, reason: "控えがいっぱいです" };
    }
    entry.onBoard = false;
    if (tile) entry.tile = { ...tile };
    else if (!this._placeOnBench(entry)) {
      entry.onBoard = true;
      return { ok: false, reason: "控えがいっぱいです" };
    }
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

  /** ラウンド終了時の収入と経験値。ショップも無料で引き直す */
  grantIncome(win) {
    const streakBonus = Math.min(this.streak, INCOME_STREAK_CAP);
    const gain = INCOME_BASE + (win ? INCOME_WIN : 0) + streakBonus;
    this.gold += gain;
    const levelUps = this.gainXp(XP_PER_ROUND);
    this.rollShop();
    return {
      gain,
      base: INCOME_BASE,
      win: win ? INCOME_WIN : 0,
      streak: streakBonus,
      xp: XP_PER_ROUND,
      levelUps,
    };
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
      // 敵の人数はプレイヤーのレベルに合わせる（TFT の対戦相手と同じ考え方）
      comp = comp.slice(0, this.maxUnits);
      while (comp.length < this.maxUnits) comp.push(pick(UNIT_IDS));
    } else {
      const extra = this.round - ENEMY_SCRIPT.length;
      comp = Array.from({ length: this.maxUnits }, () => pick(UNIT_IDS));
      power = 1.12 + extra * 0.085;
      name = pick(LATE_NAMES);
    }

    // 後半は敵も★が上がる。
    // ★1つで1.7倍と跳ね上がるので、プレイヤーが全員を★アップし終える
    // ペース（1勝で1体）に合わせて遅らせておく。
    const star = this.round >= 22 ? 3 : this.round >= 13 ? 2 : 1;
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

  byId(id) {
    return this.roster.find((u) => u.id === id) ?? null;
  }
}
