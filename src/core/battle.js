/**
 * オートバトルのシミュレーション本体。
 *
 * 描画からは完全に独立していて、`update(dt)` を回すだけで戦闘が進む。
 * 起きた出来事は `onEvent` で外へ流し、見た目（3D/UI）はそれを受けて演出する。
 */

import { buildStats, DamageType, UNIT_TYPES } from "./units.js";
import { chebyshev, key, stepToward } from "./board.js";

/** 通常攻撃1回で得られるマナ */
const MANA_PER_ATTACK = 10;
/** 被弾で得られるマナの上限（1ヒットあたり） */
const MANA_ON_HIT_CAP = 20;
/** スキル詠唱で行動が止まる時間 */
const CAST_LOCK = 0.35;
/** サドンデス開始時刻と、その後の毎秒割合ダメージ */
const SUDDEN_DEATH_AT = 40;
const SUDDEN_DEATH_DPS = 0.03;
/** 戦闘の強制終了時刻（保険） */
const HARD_TIMEOUT = 75;

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
    alive: true,

    targetUid: null,
    tauntUid: null,
    tauntUntil: 0,
    buffs: [], // {stat:'atkMul'|'armor', value, until}

    // 集計用
    damageDealt: 0,
  };
}

export class BattleEngine {
  /**
   * @param {{units: object[], onEvent?: (type:string, payload:object)=>void}} opts
   */
  constructor({ units, onEvent = () => {} }) {
    this.units = units;
    this.onEvent = onEvent;
    this.time = 0;
    this.finished = false;
    this.winner = null; // 'player' | 'enemy' | 'draw'
    this._suddenDeathAnnounced = false;
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

  /** キングのオーラを含めた実効攻撃力 */
  effectiveAtk(u) {
    let mul = 1 + u.atkMulPerm;
    for (const b of u.buffs) if (b.stat === "atkMul") mul += b.value;

    const kingAlive = this.units.some(
      (o) => o.alive && o.team === u.team && o.typeId === "king",
    );
    if (kingAlive) mul += UNIT_TYPES.king.aura.atkMul;

    return u.baseAtk * mul;
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
      const ratio = SUDDEN_DEATH_DPS * (1 + (this.time - SUDDEN_DEATH_AT) / 12);
      for (const u of this.alive) {
        this._applyDamage(u, u.maxHp * ratio * dt, DamageType.TRUE, null, { silent: true });
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
      if (!u.buffs.length) continue;
      u.buffs = u.buffs.filter((b) => b.until > this.time);
      if (u.tauntUid && u.tauntUntil <= this.time) u.tauntUid = null;
    }
  }

  _tickUnit(u, dt) {
    u.attackCd = Math.max(0, u.attackCd - dt);
    u.moveCd = Math.max(0, u.moveCd - dt);
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
    u.attackCd = 1 / u.attackSpeed;
    const dmg = this.effectiveAtk(u);
    const ranged = u.range > 1;

    this.onEvent("attack", { unit: u, target, ranged, damageType: u.damageType });
    this._applyDamage(target, dmg, u.damageType, u, { delay: ranged ? 0.16 : 0.08 });
    this._gainMana(u, MANA_PER_ATTACK);
  }

  _gainMana(u, amount) {
    if (!u.alive) return;
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

  _addShield(u, amount) {
    u.shield += Math.round(amount);
    this.onEvent("shield", { unit: u, amount: Math.round(amount) });
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
    engine._addShield(u, 380 * u.spellPower);
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
};

export { nameTag };
