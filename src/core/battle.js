/**
 * オートバトルのシミュレーション本体。
 *
 * 描画からは完全に独立していて、`update(dt)` を回すだけで戦闘が進む。
 * 起きた出来事は `onEvent` で外へ流し、見た目（3D/UI）はそれを受けて演出する。
 */

import { buildStats, DamageType } from "./units.js";
import { chebyshev, key, stepToward } from "./board.js";
import { applyTraits } from "./traits.js";

/** 通常攻撃1回で得られるマナ */
const MANA_PER_ATTACK = 10;
/** 被弾で得られるマナの上限（1ヒットあたり） */
const MANA_ON_HIT_CAP = 20;
/** スキル詠唱で行動が止まる時間 */
const CAST_LOCK = 0.35;
/**
 * 詠唱直後にマナを得られない時間。
 * これがないと「味方にマナを与える」スキルが自分に還り、無限に連射できてしまう。
 */
const MANA_LOCK = 1.2;
/**
 * サドンデス開始時刻と、その後の毎秒割合ダメージ（最大HP比）。
 * ★3どうしの終盤戦でも時間切れ判定に流れ込まないよう、強めに効かせる。
 */
const SUDDEN_DEATH_AT = 40;
const SUDDEN_DEATH_DPS = 0.05;
const SUDDEN_DEATH_RAMP = 10; // 何秒ごとに初期値ぶん増えるか
/** 戦闘の強制終了時刻（保険） */
const HARD_TIMEOUT = 70;

let uidSeq = 1;

/**
 * 戦闘用のユニット実体を作る。
 * @param {{typeId:string, team:'player'|'enemy', tile:{c:number,r:number}, star?:number, power?:number}} spec
 */
export function createUnit(spec) {
  const s = buildStats(spec.typeId, { star: spec.star ?? 1, power: spec.power ?? 1 });
  return {
    uid: uidSeq++,
    team: spec.team,
    typeId: spec.typeId,
    def: s.type,
    star: s.star,
    tile: { ...spec.tile },
    homeTile: { ...spec.tile },

    maxHp: s.maxHp,
    hp: s.maxHp,
    shield: 0,
    shieldUntil: 0,
    baseAtk: s.atk,
    atkMulPerm: 0, // 昇格などの永続バフ
    armor: s.armor,
    armorBonus: 0,
    resist: s.resist,
    range: s.range,
    attackSpeed: s.attackSpeed,
    moveInterval: s.moveInterval,
    spellPower: s.spellPower,
    damageType: s.damageType,

    mana: s.manaStart,
    manaMax: s.manaMax,

    attackCd: 0.25 + Math.random() * 0.25, // 開幕の同時攻撃をばらす
    moveCd: 0,
    castLock: 0,
    manaLockUntil: 0,
    ownerUid: null, // 召喚元
    alive: true,

    targetUid: null,
    tauntUid: null,
    tauntUntil: 0,
    stunUntil: 0, // 行動不能が解けるまでの時刻
    decayDebt: 0, // サドンデスの割合ダメージの端数
    summoned: false, // 召喚で増えたユニットか
    buffs: [], // {stat:'atkMul'|'armor', value, until}

    // 集計用
    damageDealt: 0,
  };
}

export class BattleEngine {
  /**
   * @param {{units: object[], onEvent?: (type:string, payload:object)=>void}} opts
   */
  constructor({ units, onEvent = () => {}, useTraits = true }) {
    this.units = units;
    this.onEvent = onEvent;
    this.time = 0;
    this.finished = false;
    this.winner = null; // 'player' | 'enemy' | 'draw'
    this._suddenDeathAnnounced = false;
    /**
     * 特性（組み合わせバフ）を戦闘開始前に焼き込む。
     * ここでやっておけば、ゲーム本体も検証スクリプトも同じ結果になる。
     * @type {Map<string, object[]>}
     */
    this.traits = useTraits ? applyTraits(this.units) : new Map();
  }

  // ---------------------------------------------------------------- helpers

  get alive() {
    return this.units.filter((u) => u.alive);
  }

  aliveOf(team) {
    return this.units.filter((u) => u.alive && u.team === team);
  }

  byUid(uid) {
    return this.units.find((u) => u.uid === uid) ?? null;
  }

  /** 現在の占有マップ（tileKey -> unit） */
  occupancy(exclude = null) {
    const map = new Map();
    for (const u of this.units) {
      if (!u.alive || u === exclude) continue;
      map.set(key(u.tile.c, u.tile.r), u);
    }
    return map;
  }

  /**
   * 生存している味方のオーラを合計する（キングの攻撃力、吟遊詩人の攻撃速度など）。
   */
  auraOf(team) {
    let atkMul = 0;
    let asMul = 0;
    for (const o of this.units) {
      if (!o.alive || o.team !== team || !o.def.aura) continue;
      atkMul += o.def.aura.atkMul ?? 0;
      asMul += o.def.aura.asMul ?? 0;
    }
    return { atkMul, asMul };
  }

  /** オーラ・バフ・パッシブを反映した実効攻撃力 */
  effectiveAtk(u) {
    let mul = 1 + u.atkMulPerm + this.auraOf(u.team).atkMul;
    for (const b of u.buffs) if (b.stat === "atkMul") mul += b.value;

    // 狂戦士: 失ったHPの割合ぶん攻撃力が上がる
    const rage = u.def.passive?.rageAtk;
    if (rage) mul += (1 - u.hp / u.maxHp) * rage;

    return u.baseAtk * mul;
  }

  /** バフ・デバフを反映した実効攻撃速度（回/秒） */
  effectiveAttackSpeed(u) {
    let mul = 1 + this.auraOf(u.team).asMul;
    for (const b of u.buffs) if (b.stat === "asMul") mul += b.value;
    return Math.max(0.15, u.attackSpeed * mul);
  }

  effectiveArmor(u) {
    let a = u.armor + u.armorBonus;
    for (const b of u.buffs) if (b.stat === "armor") a += b.value;
    return a;
  }

  // ---------------------------------------------------------------- 進行

  update(dt) {
    if (this.finished) return;
    this.time += dt;

    if (this.time >= SUDDEN_DEATH_AT) {
      if (!this._suddenDeathAnnounced) {
        this._suddenDeathAnnounced = true;
        this.onEvent("announce", { text: "サドンデス!", tone: "danger" });
        this.onEvent("log", { html: "<em>サドンデス突入 — 全ユニットが消耗し始めた</em>" });
      }
      const ratio =
        SUDDEN_DEATH_DPS * (1 + (this.time - SUDDEN_DEATH_AT) / SUDDEN_DEATH_RAMP);
      for (const u of this.alive) {
        // 1フレームぶんの割合ダメージは 1 未満になることが多く、
        // そのまま渡すと _applyDamage の丸めで潰れてしまう。端数を持ち越す。
        u.decayDebt += u.maxHp * ratio * dt;
        const tick = Math.floor(u.decayDebt);
        if (tick >= 1) {
          u.decayDebt -= tick;
          this._applyDamage(u, tick, DamageType.TRUE, null, { silent: true });
        }
      }
    }

    for (const u of this.units) {
      if (!u.alive) continue;
      this._tickUnit(u, dt);
      if (this.finished) return;
    }

    this._expireBuffs();
    this._checkEnd();
  }

  _expireBuffs() {
    for (const u of this.units) {
      if (!u.alive) continue;
      if (u.buffs.length) u.buffs = u.buffs.filter((b) => b.until > this.time);
      if (u.tauntUid && u.tauntUntil <= this.time) u.tauntUid = null;
      // シールドは時間で消える（残しておくと膠着したまま落ちなくなる）
      if (u.shield > 0 && u.shieldUntil <= this.time) u.shield = 0;
    }
  }

  _tickUnit(u, dt) {
    u.attackCd = Math.max(0, u.attackCd - dt);
    u.moveCd = Math.max(0, u.moveCd - dt);
    if (u.stunUntil > this.time) return; // 行動不能
    if (u.castLock > 0) {
      u.castLock = Math.max(0, u.castLock - dt);
      return;
    }

    const target = this._acquireTarget(u);
    if (!target) return;

    const dist = chebyshev(u.tile, target.tile);

    if (dist <= u.range) {
      if (u.mana >= u.manaMax) {
        this._castSkill(u, target);
        return;
      }
      if (u.attackCd <= 0) this._basicAttack(u, target);
      return;
    }

    // 射程外 → 近づく
    if (u.moveCd <= 0) this._moveStep(u, target);
  }

  _acquireTarget(u) {
    // 挑発中は強制的にその相手を狙う
    if (u.tauntUid) {
      const t = this.byUid(u.tauntUid);
      if (t?.alive) return t;
      u.tauntUid = null;
    }

    const current = u.targetUid ? this.byUid(u.targetUid) : null;
    if (current?.alive) {
      // 射程内に居るならターゲットを維持（無駄な切り替えを防ぐ）
      if (chebyshev(u.tile, current.tile) <= u.range) return current;
    }

    const enemies = this.units.filter((o) => o.alive && o.team !== u.team);
    if (!enemies.length) return null;

    let best = null;
    let bestScore = Infinity;
    for (const e of enemies) {
      // 距離優先、同距離ならHPが低い方
      const score = chebyshev(u.tile, e.tile) * 1000 + e.hp / e.maxHp * 100;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    u.targetUid = best?.uid ?? null;
    return best;
  }

  _moveStep(u, target) {
    const occ = this.occupancy(u);
    const occupied = (c, r) => occ.has(key(c, r));
    const forward = u.team === "player" ? 1 : -1;

    const step = stepToward(u.tile, target.tile, u.range, u.def.move, occupied, forward);
    if (!step) return;

    const from = { ...u.tile };
    u.tile = { c: step.c, r: step.r };
    u.moveCd = u.moveInterval;
    this.onEvent("move", { unit: u, from, to: { ...u.tile } });
  }

  _basicAttack(u, target) {
    u.attackCd = 1 / this.effectiveAttackSpeed(u);
    const dmg = this.effectiveAtk(u);
    const ranged = u.range > 1;

    this.onEvent("attack", { unit: u, target, ranged, damageType: u.damageType });
    this._applyDamage(target, dmg, u.damageType, u, { delay: ranged ? 0.16 : 0.08 });
    this._gainMana(u, MANA_PER_ATTACK);
  }

  _gainMana(u, amount) {
    if (!u.alive || u.manaLockUntil > this.time) return;
    const before = u.mana;
    u.mana = Math.min(u.manaMax, u.mana + amount);
    if (before < u.manaMax && u.mana >= u.manaMax) {
      this.onEvent("manaFull", { unit: u });
    }
  }

  /**
   * ダメージ適用。
   * @param {object} target
   * @param {number} raw
   * @param {string} type
   * @param {object|null} source
   * @param {{delay?:number, silent?:boolean}} opts delay は演出用（数値の表示タイミング）
   */
  _applyDamage(target, raw, type, source, opts = {}) {
    if (!target.alive || raw <= 0) return 0;

    let mitigated = raw;
    if (type === DamageType.PHYSICAL) {
      mitigated = raw * (100 / (100 + this.effectiveArmor(target)));
    } else if (type === DamageType.MAGIC) {
      mitigated = raw * (100 / (100 + target.resist));
    }

    const amount = Math.max(1, Math.round(mitigated));

    // シールドで肩代わり
    let remaining = amount;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    target.hp = Math.max(0, target.hp - remaining);

    if (source) source.damageDealt += amount;
    if (!opts.silent) {
      this.onEvent("damage", {
        unit: target,
        source,
        amount,
        type,
        delay: opts.delay ?? 0,
      });
      this._gainMana(target, Math.min(MANA_ON_HIT_CAP, amount / 12));
    }

    if (target.hp <= 0) this._kill(target, source);
    return amount;
  }

  _heal(u, amount) {
    if (!u.alive) return;
    const healed = Math.min(u.maxHp - u.hp, Math.round(amount));
    if (healed <= 0) return;
    u.hp += healed;
    this.onEvent("heal", { unit: u, amount: healed });
  }

  /** シールドは重ねずに上書き更新する（強い方を残す） */
  _addShield(u, amount, duration) {
    const value = Math.round(amount);
    u.shield = Math.max(u.shield, value);
    u.shieldUntil = this.time + duration;
    this.onEvent("shield", { unit: u, amount: value });
  }

  /** 行動不能にする */
  _stun(u, duration) {
    if (!u.alive) return;
    u.stunUntil = Math.max(u.stunUntil, this.time + duration);
    this.onEvent("stun", { unit: u, duration });
  }

  /**
   * 戦闘中にユニットを増やす（召喚）。
   * 見た目は "spawn" イベントを受けた側が作る。
   */
  summon(owner, typeId, tile) {
    const u = createUnit({
      typeId,
      team: owner.team,
      tile,
      star: owner.star,
    });
    u.summoned = true;
    u.ownerUid = owner.uid;
    this.units.push(u);
    this.onEvent("spawn", { unit: u, owner });
    return u;
  }

  /** 指定マスの周囲で空いているマスを探す */
  freeTileNear(tile, { maxRing = 2 } = {}) {
    const occ = this.occupancy();
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          const c = tile.c + dc;
          const r = tile.r + dr;
          if (c < 0 || c > 7 || r < 0 || r > 7) continue;
          if (!occ.has(key(c, r))) return { c, r };
        }
      }
    }
    return null;
  }

  /** HPの割合が低い順に並べたユニット */
  lowestHp(team, count = 1) {
    return this.units
      .filter((u) => u.alive && u.team === team)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, count);
  }

  _kill(u, source) {
    if (!u.alive) return;
    u.alive = false;
    u.hp = 0;
    u.shield = 0;
    u.buffs = [];
    this.onEvent("death", { unit: u, source });
    this.onEvent("log", {
      html: `${nameTag(u)} が倒された`,
    });
    this._checkEnd();
  }

  _checkEnd() {
    if (this.finished) return;
    const p = this.aliveOf("player").length;
    const e = this.aliveOf("enemy").length;
    if (p > 0 && e > 0 && this.time < HARD_TIMEOUT) return;

    this.finished = true;
    if (p > 0 && e === 0) this.winner = "player";
    else if (e > 0 && p === 0) this.winner = "enemy";
    else if (p === 0 && e === 0) this.winner = "draw";
    else this.winner = p >= e ? "player" : "enemy"; // タイムアウト時は残存数で判定
    this.onEvent("end", { winner: this.winner });
  }

  // ---------------------------------------------------------------- スキル

  _castSkill(u, target) {
    u.mana = 0;
    u.castLock = CAST_LOCK;
    u.manaLockUntil = this.time + MANA_LOCK;
    u.attackCd = Math.max(u.attackCd, CAST_LOCK);
    const skill = u.def.skill;
    this.onEvent("skill", { unit: u, name: skill.name, target });
    this.onEvent("log", {
      html: `${nameTag(u)} が <em>${skill.name}</em> を発動`,
    });

    const handler = SKILLS[u.typeId];
    if (handler) handler(this, u, target);
  }
}

/** ログ用のカラー付き名前 */
function nameTag(u) {
  const cls = u.team === "player" ? "ally" : "enemy";
  const stars = u.star > 1 ? "★".repeat(u.star) : "";
  return `<b class="${cls}">${u.def.name}${stars}</b>`;
}

// -------------------------------------------------------------------- 技定義

const SKILLS = {
  /** 昇格: 攻撃力永続+45%、最大HPの25%回復 */
  pawn(engine, u) {
    u.atkMulPerm += 0.45;
    engine._heal(u, u.maxHp * 0.25);
    engine.onEvent("buffPulse", { unit: u, color: 0xffd76a, text: "昇格!" });
  },

  /** 跳躍強襲: 最もHPの低い敵の隣に跳び、攻撃力200%の物理ダメージ */
  knight(engine, u, fallbackTarget) {
    const enemies = engine.units.filter((o) => o.alive && o.team !== u.team);
    if (!enemies.length) return;
    const victim = enemies.reduce((a, b) => (b.hp < a.hp ? b : a));

    const occ = engine.occupancy(u);
    let bestTile = null;
    let bestD = Infinity;
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const c = victim.tile.c + dc;
        const r = victim.tile.r + dr;
        if (c < 0 || c > 7 || r < 0 || r > 7) continue;
        if (occ.has(key(c, r))) continue;
        const d = chebyshev({ c, r }, u.tile);
        if (d < bestD) {
          bestD = d;
          bestTile = { c, r };
        }
      }
    }
    if (bestTile) {
      const from = { ...u.tile };
      u.tile = bestTile;
      u.targetUid = victim.uid;
      u.moveCd = u.moveInterval;
      engine.onEvent("leap", { unit: u, from, to: { ...bestTile } });
    }
    const dmg = engine.effectiveAtk(u) * 2.0;
    engine._applyDamage(victim, dmg, DamageType.PHYSICAL, u, { delay: 0.22 });
    engine.onEvent("impact", { tile: victim.tile, color: 0xffe08a, radius: 1.1 });
    void fallbackTarget;
  },

  /** 聖光十字: 対象の斜め4方向の直線上の敵をまとめて焼く */
  bishop(engine, u, target) {
    const hit = new Set([target]);
    for (const [dc, dr] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      for (let s = 1; s < 8; s++) {
        const c = target.tile.c + dc * s;
        const r = target.tile.r + dr * s;
        if (c < 0 || c > 7 || r < 0 || r > 7) break;
        const o = engine.units.find(
          (x) => x.alive && x.tile.c === c && x.tile.r === r,
        );
        if (o && o.team !== u.team) hit.add(o);
      }
    }
    const dmg = 260 * u.spellPower;
    engine.onEvent("beamCross", { origin: u, center: target.tile, color: 0xffe9a8 });
    for (const o of hit) {
      engine._applyDamage(o, dmg, DamageType.MAGIC, u, { delay: 0.2 });
    }
  },

  /** 城塞: シールド + 防御バフ + 挑発 */
  rook(engine, u) {
    engine._addShield(u, 380 * u.spellPower, 8);
    u.buffs.push({ stat: "armor", value: 35, until: engine.time + 8 });
    engine.onEvent("buffPulse", { unit: u, color: 0x7ec8ff, text: "城塞" });

    let taunted = 0;
    for (const o of engine.units) {
      if (!o.alive || o.team === u.team) continue;
      if (chebyshev(o.tile, u.tile) <= 2) {
        o.tauntUid = u.uid;
        o.tauntUntil = engine.time + 4;
        o.targetUid = u.uid;
        taunted++;
      }
    }
    if (taunted) {
      engine.onEvent("impact", { tile: u.tile, color: 0x7ec8ff, radius: 2.4 });
    }
  },

  /** 女王の号令: 対象中心 3x3 に魔法ダメージ */
  queen(engine, u, target) {
    const dmg = engine.effectiveAtk(u) * 2.3;
    engine.onEvent("impact", { tile: target.tile, color: 0xc79bff, radius: 1.9 });
    for (const o of engine.units) {
      if (!o.alive || o.team === u.team) continue;
      if (chebyshev(o.tile, target.tile) <= 1) {
        engine._applyDamage(o, dmg, DamageType.MAGIC, u, { delay: 0.18 });
      }
    }
  },

  /** 鼓舞: 味方全体を回復し攻撃力バフ */
  king(engine, u) {
    engine.onEvent("impact", { tile: u.tile, color: 0xffd76a, radius: 3.0 });
    for (const o of engine.units) {
      if (!o.alive || o.team !== u.team) continue;
      engine._heal(o, 220 * u.spellPower);
      o.buffs.push({ stat: "atkMul", value: 0.25, until: engine.time + 8 });
      engine.onEvent("buffPulse", { unit: o, color: 0x8affc0, text: "鼓舞" });
    }
  },

  // ------------------------------------------------------------ RPGジョブ

  /** なぎ払い: 隣接する敵全員を薙ぐ */
  warrior(engine, u) {
    const dmg = engine.effectiveAtk(u) * 1.7;
    engine.onEvent("impact", { tile: u.tile, color: 0xffc073, radius: 2.0 });
    for (const o of engine.units) {
      if (!o.alive || o.team === u.team) continue;
      if (chebyshev(o.tile, u.tile) <= 1) {
        engine._applyDamage(o, dmg, DamageType.PHYSICAL, u, { delay: 0.12 });
      }
    }
  },

  /** 聖なる誓い: 自分と隣接味方にシールド、自分は防御アップ */
  paladin(engine, u) {
    const shield = 320 * u.spellPower;
    engine._addShield(u, shield, 8);
    u.buffs.push({ stat: "armor", value: 40, until: engine.time + 8 });
    engine.onEvent("buffPulse", { unit: u, color: 0xffe9a8, text: "誓い" });
    for (const o of engine.units) {
      if (!o.alive || o.team !== u.team || o === u) continue;
      if (chebyshev(o.tile, u.tile) <= 1) {
        engine._addShield(o, shield, 8);
        engine.onEvent("buffPulse", { unit: o, color: 0xffe9a8 });
      }
    }
    engine.onEvent("impact", { tile: u.tile, color: 0xffe9a8, radius: 2.2 });
  },

  /** 三連射: 同じ相手に3回 */
  archer(engine, u, target) {
    const dmg = engine.effectiveAtk(u) * 0.85;
    for (let i = 0; i < 3; i++) {
      engine._applyDamage(target, dmg, DamageType.PHYSICAL, u, {
        delay: 0.1 + i * 0.14,
      });
      engine.onEvent("arrow", { unit: u, target, delay: i * 0.14 });
    }
  },

  /** 癒しの光: HP割合が低い味方2体を回復 */
  cleric(engine, u) {
    const targets = engine.lowestHp(u.team, 2);
    for (const o of targets) {
      engine._heal(o, 390 * u.spellPower);
      o.buffs.push({ stat: "armor", value: 20, until: engine.time + 6 });
      engine.onEvent("buffPulse", { unit: o, color: 0x8affc0, text: "回復" });
    }
    engine.onEvent("impact", { tile: u.tile, color: 0x8affc0, radius: 1.6 });
  },

  /** メテオ: 対象中心 5x5 */
  wizard(engine, u, target) {
    const dmg = 320 * u.spellPower;
    engine.onEvent("impact", { tile: target.tile, color: 0xff8a5c, radius: 3.4 });
    for (const o of engine.units) {
      if (!o.alive || o.team === u.team) continue;
      if (chebyshev(o.tile, target.tile) <= 2) {
        engine._applyDamage(o, dmg, DamageType.MAGIC, u, { delay: 0.3 });
      }
    }
  },

  /** 急所突き: 単体大ダメージ＋自分の攻撃速度アップ */
  thief(engine, u, target) {
    engine._applyDamage(target, engine.effectiveAtk(u) * 2.4, DamageType.PHYSICAL, u, {
      delay: 0.1,
    });
    u.buffs.push({ stat: "asMul", value: 0.7, until: engine.time + 4 });
    engine.onEvent("buffPulse", { unit: u, color: 0xc0ffd0, text: "疾風" });
  },

  /** ジャンプ: 最も遠い敵の隣に落ちて周囲を巻き込む */
  dragoon(engine, u) {
    const enemies = engine.units.filter((o) => o.alive && o.team !== u.team);
    if (!enemies.length) return;
    const victim = enemies.reduce((a, b) =>
      chebyshev(b.tile, u.tile) > chebyshev(a.tile, u.tile) ? b : a,
    );

    const spot = engine.freeTileNear(victim.tile, { maxRing: 2 });
    if (spot) {
      const from = { ...u.tile };
      u.tile = spot;
      u.targetUid = victim.uid;
      u.moveCd = u.moveInterval;
      engine.onEvent("leap", { unit: u, from, to: { ...spot }, high: true });
    }

    const main = engine.effectiveAtk(u) * 2.3;
    const splash = engine.effectiveAtk(u) * 1.1;
    engine.onEvent("impact", { tile: victim.tile, color: 0x9ad8ff, radius: 2.2 });
    for (const o of engine.units) {
      if (!o.alive || o.team === u.team) continue;
      const d = chebyshev(o.tile, victim.tile);
      if (o === victim) {
        engine._applyDamage(o, main, DamageType.PHYSICAL, u, { delay: 0.34 });
      } else if (d <= 1) {
        engine._applyDamage(o, splash, DamageType.PHYSICAL, u, { delay: 0.34 });
      }
    }
  },

  /** 影縫い: 単体ダメージ＋行動不能 */
  ninja(engine, u, target) {
    engine._applyDamage(target, engine.effectiveAtk(u) * 2.0, DamageType.PHYSICAL, u, {
      delay: 0.1,
    });
    engine._stun(target, 2.5);
    engine.onEvent("impact", { tile: target.tile, color: 0xb08aff, radius: 1.2 });
  },

  /** 猛進: 攻撃力と攻撃速度を大幅強化 */
  berserker(engine, u) {
    u.buffs.push({ stat: "atkMul", value: 0.55, until: engine.time + 8 });
    u.buffs.push({ stat: "asMul", value: 0.35, until: engine.time + 8 });
    engine.onEvent("buffPulse", { unit: u, color: 0xff7a6a, text: "猛進!" });
    engine.onEvent("impact", { tile: u.tile, color: 0xff7a6a, radius: 1.8 });
  },

  /** ヘッドショット: 射程無視で瀕死の敵を撃つ */
  sniper(engine, u) {
    const enemies = engine.units.filter((o) => o.alive && o.team !== u.team);
    if (!enemies.length) return;
    const victim = enemies.reduce((a, b) =>
      b.hp / b.maxHp < a.hp / a.maxHp ? b : a,
    );
    engine.onEvent("snipe", { unit: u, target: victim });
    engine._applyDamage(victim, engine.effectiveAtk(u) * 3.6, DamageType.PHYSICAL, u, {
      delay: 0.26,
    });
  },

  /** 魔物召喚: ゴーレムを呼ぶ（同時に2体まで。上限なら回復して立て直す） */
  summoner(engine, u) {
    const mine = engine.units.filter(
      (o) => o.alive && o.summoned && o.ownerUid === u.uid,
    );
    if (mine.length >= 2) {
      for (const o of mine) {
        engine._heal(o, 300 * u.spellPower);
        engine.onEvent("buffPulse", { unit: o, color: 0xb98aff, text: "修復" });
      }
      return;
    }
    const spot = engine.freeTileNear(u.tile, { maxRing: 2 });
    if (!spot) return;
    engine.summon(u, "golem", spot);
    engine.onEvent("impact", { tile: spot, color: 0xb98aff, radius: 1.6 });
  },

  /** 戦いの歌: 味方全体の攻撃速度とマナ */
  bard(engine, u) {
    engine.onEvent("impact", { tile: u.tile, color: 0x9ad8ff, radius: 3.2 });
    for (const o of engine.units) {
      if (!o.alive || o.team !== u.team) continue;
      o.buffs.push({ stat: "asMul", value: 0.4, until: engine.time + 8 });
      if (o !== u) engine._gainMana(o, 20); // 自分に還すと連射できてしまう
      engine.onEvent("buffPulse", { unit: o, color: 0x9ad8ff, text: "♪" });
    }
  },

  /** 氷結: 範囲ダメージ＋攻撃速度低下 */
  icemage(engine, u, target) {
    const dmg = 220 * u.spellPower;
    engine.onEvent("impact", { tile: target.tile, color: 0x8ee8ff, radius: 2.0 });
    for (const o of engine.units) {
      if (!o.alive || o.team === u.team) continue;
      if (chebyshev(o.tile, target.tile) <= 1) {
        engine._applyDamage(o, dmg, DamageType.MAGIC, u, { delay: 0.2 });
        o.buffs.push({ stat: "asMul", value: -0.45, until: engine.time + 5 });
        engine.onEvent("buffPulse", { unit: o, color: 0x8ee8ff, text: "凍結" });
      }
    }
  },

  /** 串刺し: 対象とその奥の敵を貫く */
  guardian(engine, u, target) {
    const dc = Math.sign(target.tile.c - u.tile.c);
    const dr = Math.sign(target.tile.r - u.tile.r);
    const dmg = engine.effectiveAtk(u) * 1.9;

    const hit = [target];
    for (let i = 1; i <= 2; i++) {
      const c = target.tile.c + dc * i;
      const r = target.tile.r + dr * i;
      const o = engine.units.find(
        (x) => x.alive && x.team !== u.team && x.tile.c === c && x.tile.r === r,
      );
      if (o) hit.push(o);
    }
    engine.onEvent("thrust", { unit: u, target, dir: { dc, dr } });
    for (const o of hit) {
      engine._applyDamage(o, dmg, DamageType.PHYSICAL, u, { delay: 0.16 });
    }
  },
};

export { nameTag };
