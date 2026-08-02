/**
 * 特性（組み合わせバフ）。
 *
 * 盤に出したユニットの「種類数」で段階が決まり、条件を満たすと補正がかかる。
 * TFT のシナジーと同じく、同じユニットを何体並べても種類数は1として数える。
 *
 * 補正の宛先は2種類:
 *   self … その特性を持つユニットだけ
 *   team … 陣営全体
 *
 * 補正の項目:
 *   hp / hpPct        最大HP（実数 / 割合）
 *   atkPct            攻撃力（割合）
 *   armor / resist    防御 / 魔法防御（実数）
 *   asPct             攻撃速度（割合）
 *   range             射程（マス）
 *   mana              戦闘開始時のマナ（実数）
 *   spellPct          スキル威力（割合）
 *   shield            戦闘開始時のシールド（実数）
 */

/** シールドの持続時間（秒） */
const TRAIT_SHIELD_DURATION = 15;

export const TRAITS = {
  // ------------------------------------------------------------ 出自
  chess: {
    id: "chess",
    name: "チェス",
    kind: "origin",
    color: "#d9d3c4",
    desc: "盤上のルールを体現するコマたち。数が揃うほど堅くなる。",
    tiers: [
      { need: 2, text: "防御+15 / 魔法防御+15", mods: { self: { armor: 15, resist: 15 } } },
      {
        need: 4,
        text: "防御+30 / 魔法防御+30 / 攻撃力+15%",
        mods: { self: { armor: 30, resist: 30, atkPct: 0.15 } },
      },
      {
        need: 6,
        text: "防御+55 / 魔法防御+55 / 攻撃力+35% / 開始マナ+20",
        mods: { self: { armor: 55, resist: 55, atkPct: 0.35, mana: 20 } },
      },
    ],
  },

  adventurer: {
    id: "adventurer",
    name: "冒険者",
    kind: "origin",
    color: "#4ade80",
    desc: "旅慣れた者たち。打たれ強く、粘り強い。",
    tiers: [
      { need: 2, text: "最大HP+120 / 攻撃力+8%", mods: { self: { hp: 120, atkPct: 0.08 } } },
      { need: 4, text: "最大HP+270 / 攻撃力+18%", mods: { self: { hp: 270, atkPct: 0.18 } } },
    ],
  },

  arcane: {
    id: "arcane",
    name: "魔道",
    kind: "origin",
    color: "#c084fc",
    desc: "魔力の使い手。スキルの回転と威力が上がる。",
    tiers: [
      { need: 2, text: "開始マナ+15 / スキル威力+15%", mods: { self: { mana: 15, spellPct: 0.15 } } },
      { need: 3, text: "開始マナ+30 / スキル威力+35%", mods: { self: { mana: 30, spellPct: 0.35 } } },
    ],
  },

  shadow: {
    id: "shadow",
    name: "影",
    kind: "origin",
    color: "#46367a",
    desc: "闇に紛れて仕留める者たち。手数で押す。",
    tiers: [
      { need: 2, text: "攻撃速度+25%", mods: { self: { asPct: 0.25 } } },
      { need: 3, text: "攻撃速度+50% / 攻撃力+20%", mods: { self: { asPct: 0.5, atkPct: 0.2 } } },
    ],
  },

  royal: {
    id: "royal",
    name: "王家",
    kind: "origin",
    color: "#f2c14e",
    desc: "王に仕える精鋭。開幕からシールドを張る。",
    tiers: [
      { need: 2, text: "戦闘開始時にシールド200", mods: { self: { shield: 200 } } },
      {
        need: 3,
        text: "シールド340 / 味方全体の防御+10",
        mods: { self: { shield: 340 }, team: { armor: 10 } },
      },
    ],
  },

  // ------------------------------------------------------------ 職能
  heavy: {
    id: "heavy",
    name: "重装",
    kind: "class",
    color: "#c9b18a",
    desc: "前線を支える壁役。",
    tiers: [
      { need: 2, text: "防御+28 / 魔法防御+18", mods: { self: { armor: 28, resist: 18 } } },
      {
        need: 3,
        text: "防御+55 / 魔法防御+38 / 最大HP+10%",
        mods: { self: { armor: 55, resist: 38, hpPct: 0.1 } },
      },
    ],
  },

  blade: {
    id: "blade",
    name: "剣士",
    kind: "class",
    color: "#e2533f",
    desc: "刃で押し切る近接職。",
    tiers: [
      { need: 2, text: "攻撃力+20%", mods: { self: { atkPct: 0.2 } } },
      { need: 4, text: "攻撃力+50% / 最大HP+12%", mods: { self: { atkPct: 0.5, hpPct: 0.12 } } },
    ],
  },

  ranger: {
    id: "ranger",
    name: "射手",
    kind: "class",
    color: "#3f7d3a",
    desc: "遠くから撃ち抜く。2種そろえば射程が伸びる。",
    tiers: [
      { need: 2, text: "攻撃速度+35% / 射程+1", mods: { self: { asPct: 0.35, range: 1 } } },
    ],
  },

  mage: {
    id: "mage",
    name: "術士",
    kind: "class",
    color: "#38bdf8",
    desc: "呪文を撃ち込む後衛。マナが早く溜まる。",
    tiers: [
      { need: 2, text: "開始マナ+20", mods: { self: { mana: 20 } } },
      { need: 4, text: "開始マナ+35 / スキル威力+20%", mods: { self: { mana: 35, spellPct: 0.2 } } },
    ],
  },

  support: {
    id: "support",
    name: "支援",
    kind: "class",
    color: "#6ee7d0",
    desc: "味方を支える。効果は陣営全体に及ぶ。",
    tiers: [
      { need: 2, text: "味方全体の最大HP+100", mods: { team: { hp: 100 } } },
      {
        need: 4,
        text: "味方全体の最大HP+260 / 防御+16 / 魔法防御+16",
        mods: { team: { hp: 260, armor: 16, resist: 16 } },
      },
    ],
  },

  swift: {
    id: "swift",
    name: "速攻",
    kind: "class",
    color: "#8b5cf6",
    desc: "先手を取って崩す。動きが速い。",
    tiers: [
      { need: 2, text: "攻撃速度+20% / 移動が15%速い", mods: { self: { asPct: 0.2, movePct: 0.15 } } },
      {
        need: 3,
        text: "攻撃速度+40% / 移動が30%速い / 攻撃力+15%",
        mods: { self: { asPct: 0.4, movePct: 0.3, atkPct: 0.15 } },
      },
    ],
  },
};

export const TRAIT_IDS = Object.keys(TRAITS);

/**
 * 盤上のユニットから、特性ごとの「種類数」を数える。
 * @param {{typeId:string, def?:object}[]} units
 * @returns {Map<string, Set<string>>} 特性 -> ユニット種類の集合
 */
function countTraits(units, bonus) {
  const counts = new Map();
  for (const u of units) {
    const traits = u.def?.traits ?? [];
    for (const t of traits) {
      if (!counts.has(t)) counts.set(t, new Set());
      counts.get(t).add(u.typeId);
    }
  }
  // オープニングの下駄は、その特性のユニットが1体もいなくても表に出す
  for (const [id, n] of Object.entries(bonus ?? {})) {
    if (n > 0 && !counts.has(id)) counts.set(id, new Set());
  }
  return counts;
}

/**
 * 表示用に、いま効いている特性の一覧を返す。
 * 段階に届いていないものも「あと何種類か」を見せたいので含める。
 *
 * @param {{typeId:string, def?:object}[]} units 盤に出ているユニット
 * @param {Record<string, number>|null} bonus 特性ごとの種類数の下駄（オープニング）
 * @returns {{trait:object, count:number, tier:object|null, tierIndex:number,
 *            next:object|null, ids:string[], bonus:number}[]}
 */
export function activeTraits(units, bonus = null) {
  const counts = countTraits(units, bonus);
  const out = [];
  for (const [id, set] of counts) {
    const trait = TRAITS[id];
    if (!trait) continue;
    const extra = bonus?.[id] ?? 0;
    const count = set.size + extra;
    let tierIndex = -1;
    for (let i = 0; i < trait.tiers.length; i++) {
      if (count >= trait.tiers[i].need) tierIndex = i;
    }
    out.push({
      trait,
      count,
      tierIndex,
      tier: tierIndex >= 0 ? trait.tiers[tierIndex] : null,
      next: trait.tiers[tierIndex + 1] ?? null,
      // いま数に入っているユニット（UI で「持っている」印を出すのに使う）
      ids: [...set],
      bonus: extra,
    });
  }
  // 発動しているものを上に、そのなかでは段階が高い順
  out.sort(
    (a, b) =>
      (b.tierIndex >= 0) - (a.tierIndex >= 0) ||
      b.tierIndex - a.tierIndex ||
      b.count - a.count ||
      a.trait.name.localeCompare(b.trait.name),
  );
  return out;
}

const EMPTY_MOD = () => ({
  hp: 0,
  hpPct: 0,
  atkPct: 0,
  armor: 0,
  resist: 0,
  asPct: 0,
  range: 0,
  mana: 0,
  spellPct: 0,
  movePct: 0,
  shield: 0,
});

function addMod(target, mods) {
  for (const [k, v] of Object.entries(mods)) target[k] = (target[k] ?? 0) + v;
}

/**
 * 戦闘開始前に、特性の補正をユニットへ焼き込む。
 * 陣営ごとに独立して計算する（敵にも同じルールで乗る）。
 *
 * 召喚で増えたユニットは種類数に数えないし、補正も受けない
 * （戦闘中に特性が変わってしまうのを避けるため）。
 *
 * @param {object[]} units battle.js のユニット実体
 * @param {Record<string, Record<string, number>>} bonuses 陣営ごとの種類数の下駄
 * @returns {Map<string, ReturnType<typeof activeTraits>>} 陣営 -> 発動中の特性（UI用）
 */
export function applyTraits(units, bonuses = {}) {
  const result = new Map();

  for (const team of ["player", "enemy"]) {
    const mine = units.filter((u) => u.team === team && !u.summoned);
    const list = activeTraits(mine, bonuses[team] ?? null);
    result.set(team, list);

    // まず全員ぶんの補正を足し合わせてから、一度だけ反映する
    const acc = new Map(mine.map((u) => [u, EMPTY_MOD()]));

    for (const { trait, tier } of list) {
      if (!tier) continue;
      if (tier.mods.self) {
        for (const u of mine) {
          if (u.def.traits?.includes(trait.id)) addMod(acc.get(u), tier.mods.self);
        }
      }
      if (tier.mods.team) {
        for (const u of mine) addMod(acc.get(u), tier.mods.team);
      }
    }

    for (const [u, m] of acc) {
      if (m.hpPct || m.hp) {
        u.maxHp = Math.round(u.maxHp * (1 + m.hpPct) + m.hp);
        u.hp = u.maxHp;
      }
      if (m.atkPct) u.baseAtk = u.baseAtk * (1 + m.atkPct);
      if (m.armor) u.armor += m.armor;
      if (m.resist) u.resist += m.resist;
      if (m.asPct) u.attackSpeed = u.attackSpeed * (1 + m.asPct);
      if (m.range) u.range += m.range;
      if (m.mana) u.mana = Math.min(u.manaMax, u.mana + m.mana);
      if (m.spellPct) u.spellPower = u.spellPower * (1 + m.spellPct);
      if (m.movePct) u.moveInterval = u.moveInterval / (1 + m.movePct);
      if (m.shield) {
        u.shield = Math.max(u.shield, Math.round(m.shield));
        u.shieldUntil = TRAIT_SHIELD_DURATION;
      }
    }
  }

  return result;
}
