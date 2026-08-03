/**
 * ユニット定義。
 *
 * ユニットは4系統ある。
 *  - family "chess":  チェスのコマ。移動は本家チェスのルールを踏襲する
 *  - family "job":    RPGのジョブ。移動パターンは役割に合わせて自由に設定する
 *  - family "beast":  獣。素早いものと重いものに分かれる
 *  - family "demon":  魔族。魔法寄りで、コストの割に尖った性能
 *
 * 攻撃射程は Chebyshev 距離（キング距離）で判定する。
 */

/** 移動パターンの種類 */
export const MoveKind = {
  STEP: "step", // 決められたオフセットに1手で移動（他コマを飛び越えない）
  JUMP: "jump", // 決められたオフセットに1手で移動（飛び越える）
  SLIDE: "slide", // 方向に沿って最大 range マス滑る（途中に他コマがあると止まる）
};

const DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ORTHOGONALS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const ALL_DIRS = [...ORTHOGONALS, ...DIAGONALS];
const KNIGHT_OFFSETS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
/** 竜騎士の跳躍（2マス先へ飛び越える） */
const LEAP_2 = [
  [0, 2],
  [0, -2],
  [2, 0],
  [-2, 0],
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
];
/** 忍者の跳躍（ナイトの動き＋斜め2マス） */
const NINJA_OFFSETS = [
  ...KNIGHT_OFFSETS,
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
];

// よく使う移動パターン
const MOVE = {
  step1: { kind: MoveKind.STEP, dirs: ALL_DIRS, distance: 1 },
  ortho1: { kind: MoveKind.STEP, dirs: ORTHOGONALS, distance: 1 },
  ortho2: { kind: MoveKind.SLIDE, dirs: ORTHOGONALS, distance: 2 },
  diag2: { kind: MoveKind.SLIDE, dirs: DIAGONALS, distance: 2 },
  any2: { kind: MoveKind.SLIDE, dirs: ALL_DIRS, distance: 2 },
  leap2: { kind: MoveKind.JUMP, dirs: LEAP_2, distance: 1 },
  ninja: { kind: MoveKind.JUMP, dirs: NINJA_OFFSETS, distance: 1 },
};

/** ダメージ種別 */
export const DamageType = { PHYSICAL: "physical", MAGIC: "magic", TRUE: "true" };

/**
 * レアリティ。ショップの抽選確率はこれで決まる（1=コモン … 5=レジェンド）。
 * 雇用コストは既定でレアリティと同じだが、別々に指定することもできる。
 */
export const RARITY = [
  null,
  { tier: 1, id: "common", name: "コモン", color: "#9fb0c9" },
  { tier: 2, id: "uncommon", name: "アンコモン", color: "#5fd38a" },
  { tier: 3, id: "rare", name: "レア", color: "#4aa8ff" },
  { tier: 4, id: "epic", name: "エピック", color: "#c07bff" },
  { tier: 5, id: "legendary", name: "レジェンド", color: "#f5b83d" },
];
export const RARITY_MAX = RARITY.length - 1;
/** レアリティの表示情報。未定義なら コモン 扱い */
export const rarityInfo = (tier) => RARITY[tier] ?? RARITY[1];
/** ユニットのレアリティ表示情報 */
export const rarityOf = (typeId) => rarityInfo(UNIT_TYPES[typeId]?.rarity);

/**
 * ユニット定義テーブル。
 * hp/atk などは ★1 の値。★が上がるごとに STAR_SCALE 倍される。
 */
export const UNIT_TYPES = {
  pawn: {
    id: "pawn",
    traits: ["chess", "blade"],
    color: 0x94a3b8, // スレート
    family: "chess",
    cost: 1,
    rarity: 1,
    name: "ポーン",
    role: "前衛 / ファイター",
    glyph: "♙",
    glyphDark: "♟",
    hp: 620,
    atk: 46,
    attackSpeed: 0.8, // 攻撃/秒
    range: 1,
    armor: 30,
    resist: 25,
    moveInterval: 0.62, // 1手あたりの秒数
    manaMax: 60,
    manaStart: 10,
    damageType: DamageType.PHYSICAL,
    move: {
      kind: MoveKind.STEP,
      dirs: [
        [0, 1],
        [1, 1],
        [-1, 1],
        [1, 0],
        [-1, 0],
      ],
      distance: 1,
      forwardBias: true,
    },
    moveText: "前方と左右に1マス（後退はできない）",
    skill: {
      name: "昇格",
      text: "クイーンの力に目覚め、攻撃力が永続的に +45% 上昇し最大HPの25%を回復する。",
    },
  },

  knight: {
    id: "knight",
    traits: ["chess", "swift"],
    color: 0x8b5cf6, // 紫
    family: "chess",
    cost: 3,
    rarity: 3,
    name: "ナイト",
    role: "強襲 / アサシン",
    glyph: "♘",
    glyphDark: "♞",
    hp: 700,
    atk: 74,
    attackSpeed: 0.75,
    range: 1,
    armor: 28,
    resist: 22,
    moveInterval: 0.78,
    manaMax: 80,
    manaStart: 20,
    damageType: DamageType.PHYSICAL,
    move: { kind: MoveKind.JUMP, dirs: KNIGHT_OFFSETS, distance: 1 },
    moveText: "L字に跳躍（他のコマを飛び越える）",
    skill: {
      name: "跳躍強襲",
      text: "最もHPの低い敵の隣へ跳躍し、攻撃力200%の物理ダメージを与える。",
    },
  },

  bishop: {
    id: "bishop",
    traits: ["chess", "mage"],
    color: 0x38bdf8, // 空色
    family: "chess",
    cost: 2,
    rarity: 2,
    name: "ビショップ",
    role: "後衛 / メイジ",
    glyph: "♗",
    glyphDark: "♝",
    hp: 500,
    atk: 52,
    attackSpeed: 0.72,
    range: 3,
    armor: 15,
    resist: 42,
    moveInterval: 0.9,
    manaMax: 100,
    manaStart: 25,
    damageType: DamageType.MAGIC,
    move: { kind: MoveKind.SLIDE, dirs: DIAGONALS, distance: 3 },
    moveText: "斜めに最大3マス滑走",
    skill: {
      name: "聖光十字",
      text: "対象と、その斜め4方向の直線上にいる敵全員に 260 の魔法ダメージ。",
    },
  },

  rook: {
    id: "rook",
    traits: ["chess", "heavy"],
    color: 0xa3722b, // 茶
    family: "chess",
    cost: 3,
    rarity: 3,
    name: "ルーク",
    role: "壁 / タンク",
    glyph: "♖",
    glyphDark: "♜",
    hp: 980,
    atk: 44,
    attackSpeed: 0.62,
    range: 1,
    armor: 60,
    resist: 40,
    moveInterval: 0.95,
    manaMax: 70,
    manaStart: 15,
    damageType: DamageType.PHYSICAL,
    move: { kind: MoveKind.SLIDE, dirs: ORTHOGONALS, distance: 3 },
    moveText: "縦横に最大3マス滑走",
    skill: {
      name: "城塞",
      text: "380 のシールドと防御力+35を8秒間得て、隣接する敵の狙いを自分に引きつける。",
    },
  },

  queen: {
    id: "queen",
    traits: ["chess", "mage"],
    color: 0xe0348a, // マゼンタ
    family: "chess",
    cost: 5,
    rarity: 5,
    name: "クイーン",
    role: "主砲 / キャリー",
    glyph: "♕",
    glyphDark: "♛",
    hp: 640,
    atk: 82,
    attackSpeed: 0.78,
    range: 3,
    armor: 22,
    resist: 24,
    moveInterval: 0.85,
    manaMax: 90,
    manaStart: 20,
    damageType: DamageType.MAGIC,
    move: { kind: MoveKind.SLIDE, dirs: ALL_DIRS, distance: 2 },
    moveText: "全方向に最大2マス滑走",
    skill: {
      name: "女王の号令",
      text: "対象を中心とした3×3の敵に攻撃力230%の魔法ダメージを与える。",
    },
  },

  king: {
    id: "king",
    traits: ["chess", "support"],
    color: 0xf2c14e, // 金
    family: "chess",
    cost: 4,
    rarity: 4,
    name: "キング",
    role: "支援 / バッファー",
    glyph: "♔",
    glyphDark: "♚",
    hp: 800,
    atk: 40,
    attackSpeed: 0.6,
    range: 1,
    armor: 38,
    resist: 38,
    moveInterval: 0.8,
    manaMax: 80,
    manaStart: 30,
    damageType: DamageType.PHYSICAL,
    move: { kind: MoveKind.STEP, dirs: ALL_DIRS, distance: 1 },
    moveText: "全方向に1マス",
    aura: { atkMul: 0.12 }, // 味方全体の攻撃力を常時+12%
    auraText: "オーラ: 味方全体の攻撃力 +12%",
    skill: {
      name: "鼓舞",
      text: "味方全員のHPを220回復し、8秒間 攻撃力を25%上昇させる。",
    },
  },

  // ---------------------------------------------------------------- RPGジョブ

  warrior: {
    id: "warrior",
    traits: ["adventurer", "blade"],
    color: 0xe2533f, // 朱
    family: "job",
    cost: 2,
    rarity: 2,
    name: "戦士",
    role: "前衛 / ファイター",
    glyph: "⚔️",
    glyphDark: "⚔️",
    hp: 780,
    atk: 62,
    attackSpeed: 0.75,
    range: 1,
    armor: 42,
    resist: 22,
    moveInterval: 0.68,
    manaMax: 70,
    manaStart: 15,
    damageType: DamageType.PHYSICAL,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    skill: {
      name: "なぎ払い",
      text: "隣接するすべての敵に攻撃力170%の物理ダメージを与える。",
    },
  },

  paladin: {
    id: "paladin",
    traits: ["royal", "heavy"],
    color: 0x3f74d8, // 青
    family: "job",
    cost: 5,
    rarity: 5,
    name: "聖騎士",
    role: "壁 / プロテクター",
    glyph: "🛡️",
    glyphDark: "🛡️",
    hp: 1060,
    atk: 44,
    attackSpeed: 0.6,
    range: 1,
    armor: 66,
    resist: 46,
    moveInterval: 0.95,
    manaMax: 80,
    manaStart: 20,
    damageType: DamageType.PHYSICAL,
    move: MOVE.ortho2,
    moveText: "縦横に最大2マス滑走",
    skill: {
      name: "聖なる誓い",
      text: "自分と隣接する味方に320のシールドを8秒間与え、自分の防御力を+40する。",
    },
  },

  archer: {
    id: "archer",
    traits: ["adventurer", "ranger"],
    color: 0x4ade80, // 若草
    family: "job",
    cost: 2,
    rarity: 2,
    name: "弓兵",
    role: "後衛 / アタッカー",
    glyph: "🏹",
    glyphDark: "🏹",
    hp: 480,
    atk: 58,
    attackSpeed: 0.85,
    range: 4,
    armor: 16,
    resist: 18,
    moveInterval: 0.8,
    manaMax: 60,
    manaStart: 15,
    damageType: DamageType.PHYSICAL,
    move: MOVE.ortho1,
    moveText: "縦横に1マス",
    skill: {
      name: "三連射",
      text: "対象に攻撃力85%の物理ダメージを3回続けて与える。",
    },
  },

  cleric: {
    id: "cleric",
    traits: ["adventurer", "support"],
    color: 0x6ee7d0, // ミント
    family: "job",
    cost: 3,
    rarity: 3,
    name: "僧侶",
    role: "支援 / ヒーラー",
    glyph: "✚",
    glyphDark: "✚",
    hp: 560,
    atk: 34,
    attackSpeed: 0.6,
    range: 2,
    armor: 22,
    resist: 42,
    moveInterval: 0.8,
    manaMax: 70,
    manaStart: 25,
    damageType: DamageType.MAGIC,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    skill: {
      name: "癒しの光",
      text: "HPの割合が最も低い味方2体を390回復し、6秒間 防御力を+20する。",
    },
  },

  wizard: {
    id: "wizard",
    traits: ["arcane", "mage"],
    color: 0xfb8c3c, // 橙
    family: "job",
    cost: 3,
    rarity: 3,
    name: "魔術師",
    role: "後衛 / 範囲メイジ",
    glyph: "🔥",
    glyphDark: "🔥",
    hp: 470,
    atk: 56,
    attackSpeed: 0.65,
    range: 3,
    armor: 12,
    resist: 46,
    moveInterval: 0.9,
    manaMax: 100,
    manaStart: 20,
    damageType: DamageType.MAGIC,
    move: MOVE.diag2,
    moveText: "斜めに最大2マス滑走",
    skill: {
      name: "メテオ",
      text: "対象を中心とした5×5の敵全員に320の魔法ダメージを落とす。",
    },
  },

  thief: {
    id: "thief",
    traits: ["shadow", "swift"],
    color: 0xa3e635, // ライム
    family: "job",
    cost: 2,
    rarity: 2,
    name: "盗賊",
    role: "遊撃 / 高速",
    glyph: "🗡️",
    glyphDark: "🗡️",
    hp: 520,
    atk: 46,
    attackSpeed: 1.15,
    range: 1,
    armor: 18,
    resist: 18,
    moveInterval: 0.5,
    manaMax: 50,
    manaStart: 10,
    damageType: DamageType.PHYSICAL,
    move: MOVE.any2,
    moveText: "全方向に最大2マス滑走（足が速い）",
    skill: {
      name: "急所突き",
      text: "攻撃力240%の物理ダメージを与え、4秒間 自分の攻撃速度を+70%する。",
    },
  },

  dragoon: {
    id: "dragoon",
    traits: ["royal", "blade"],
    color: 0x0f9b8e, // 碧
    family: "job",
    cost: 4,
    rarity: 4,
    name: "竜騎士",
    role: "強襲 / ジャンパー",
    glyph: "🐲",
    glyphDark: "🐲",
    hp: 730,
    atk: 72,
    attackSpeed: 0.68,
    range: 1,
    armor: 38,
    resist: 24,
    moveInterval: 0.8,
    manaMax: 80,
    manaStart: 15,
    damageType: DamageType.PHYSICAL,
    move: MOVE.leap2,
    moveText: "2マス先へ跳躍（飛び越える）",
    skill: {
      name: "ジャンプ",
      text: "最も遠い敵の隣に飛び降り、攻撃力230%＋周囲に110%の物理ダメージ。",
    },
  },

  ninja: {
    id: "ninja",
    traits: ["shadow", "swift"],
    color: 0x46367a, // 藍紫
    family: "job",
    cost: 3,
    rarity: 3,
    name: "忍者",
    role: "暗殺 / 妨害",
    glyph: "🥷",
    glyphDark: "🥷",
    hp: 540,
    atk: 64,
    attackSpeed: 0.95,
    range: 1,
    armor: 20,
    resist: 22,
    moveInterval: 0.6,
    manaMax: 70,
    manaStart: 15,
    damageType: DamageType.PHYSICAL,
    move: MOVE.ninja,
    moveText: "L字＋斜め2マスに跳躍（飛び越える）",
    skill: {
      name: "影縫い",
      text: "攻撃力200%の物理ダメージを与え、対象を2.5秒間 行動不能にする。",
    },
  },

  berserker: {
    id: "berserker",
    traits: ["adventurer", "blade"],
    color: 0xa01f2e, // 深紅
    family: "job",
    cost: 4,
    rarity: 4,
    name: "狂戦士",
    role: "前衛 / 火力",
    glyph: "🪓",
    glyphDark: "🪓",
    hp: 840,
    atk: 74,
    attackSpeed: 0.7,
    range: 1,
    armor: 26,
    resist: 16,
    moveInterval: 0.62,
    manaMax: 80,
    manaStart: 20,
    damageType: DamageType.PHYSICAL,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    passive: { rageAtk: 0.8 },
    auraText: "パッシブ: 失ったHPの割合に応じて攻撃力が最大+80%",
    skill: {
      name: "猛進",
      text: "8秒間 攻撃力+55%、攻撃速度+35%。",
    },
  },

  sniper: {
    id: "sniper",
    traits: ["shadow", "ranger"],
    color: 0x3f7d3a, // 深緑
    family: "job",
    cost: 4,
    rarity: 4,
    name: "狙撃手",
    role: "後衛 / 超長射程",
    glyph: "🎯",
    glyphDark: "🎯",
    hp: 430,
    atk: 90,
    attackSpeed: 0.45,
    range: 5,
    armor: 10,
    resist: 16,
    moveInterval: 1.0,
    manaMax: 90,
    manaStart: 20,
    damageType: DamageType.PHYSICAL,
    move: MOVE.ortho1,
    moveText: "縦横に1マス（遅い）",
    skill: {
      name: "ヘッドショット",
      text: "盤上でHPの割合が最も低い敵に、射程を無視して攻撃力360%の物理ダメージ。",
    },
  },

  summoner: {
    id: "summoner",
    traits: ["arcane", "support"],
    color: 0xc084fc, // 藤
    family: "job",
    cost: 4,
    rarity: 4,
    name: "召喚士",
    role: "後衛 / 召喚",
    glyph: "👻",
    glyphDark: "👻",
    hp: 580,
    atk: 40,
    attackSpeed: 0.6,
    range: 3,
    armor: 18,
    resist: 38,
    moveInterval: 0.85,
    manaMax: 80,
    manaStart: 25,
    damageType: DamageType.MAGIC,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    skill: {
      name: "魔物召喚",
      text: "隣のマスにゴーレムを呼び出す（同時に2体まで）。上限のときは既存のゴーレムを回復する。",
    },
  },

  bard: {
    id: "bard",
    traits: ["adventurer", "support"],
    color: 0xfb7185, // 桃
    family: "job",
    cost: 3,
    rarity: 3,
    name: "吟遊詩人",
    role: "支援 / バッファー",
    glyph: "🎵",
    glyphDark: "🎵",
    hp: 610,
    atk: 36,
    attackSpeed: 0.7,
    range: 2,
    armor: 24,
    resist: 36,
    moveInterval: 0.75,
    manaMax: 60,
    manaStart: 20,
    damageType: DamageType.MAGIC,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    aura: { asMul: 0.1 },
    auraText: "オーラ: 味方全体の攻撃速度 +10%",
    skill: {
      name: "戦いの歌",
      text: "味方全体の攻撃速度を8秒間+40%し、マナを20回復させる。",
    },
  },

  icemage: {
    id: "icemage",
    traits: ["arcane", "mage"],
    color: 0xa8e6ff, // 氷
    family: "job",
    cost: 3,
    rarity: 3,
    name: "氷術師",
    role: "後衛 / 制圧",
    glyph: "❄️",
    glyphDark: "❄️",
    hp: 500,
    atk: 50,
    attackSpeed: 0.65,
    range: 3,
    armor: 14,
    resist: 44,
    moveInterval: 0.9,
    manaMax: 90,
    manaStart: 20,
    damageType: DamageType.MAGIC,
    move: MOVE.diag2,
    moveText: "斜めに最大2マス滑走",
    skill: {
      name: "氷結",
      text: "対象中心3×3の敵に220の魔法ダメージ。さらに5秒間 攻撃速度を-45%する。",
    },
  },

  guardian: {
    id: "guardian",
    traits: ["royal", "heavy"],
    color: 0xc9b18a, // 砂
    family: "job",
    cost: 4,
    rarity: 4,
    name: "重装兵",
    role: "壁 / 長柄",
    glyph: "🔱",
    glyphDark: "🔱",
    hp: 920,
    atk: 52,
    attackSpeed: 0.62,
    range: 2,
    armor: 58,
    resist: 40,
    moveInterval: 1.0,
    manaMax: 75,
    manaStart: 15,
    damageType: DamageType.PHYSICAL,
    move: MOVE.ortho1,
    moveText: "縦横に1マス",
    skill: {
      name: "串刺し",
      text: "対象とその奥2マスまでの敵を貫き、攻撃力190%の物理ダメージ。",
    },
  },

  // ------------------------------------------------------------ 獣
  wolf: {
    id: "wolf",
    traits: ["beast", "swift"],
    color: 0x8fa3b8, // 銀灰
    family: "beast",
    rarity: 2,
    name: "狼",
    role: "遊撃 / ビースト",
    glyph: "🐺",
    glyphDark: "🐺",
    hp: 560,
    atk: 58,
    attackSpeed: 0.95,
    range: 1,
    armor: 30,
    resist: 20,
    moveInterval: 0.42,
    manaMax: 60,
    manaStart: 10,
    damageType: DamageType.PHYSICAL,
    move: MOVE.any2,
    moveText: "全方向に最大2マス滑走（速い）",
    skill: {
      name: "牙の連撃",
      text: "対象に攻撃力120%を2回。倒しきると自分の攻撃速度が永続的に+15%上がる。",
    },
  },

  bear: {
    id: "bear",
    traits: ["beast", "heavy"],
    color: 0x9a6b43, // 茶
    family: "beast",
    rarity: 3,
    name: "熊",
    role: "壁 / ビースト",
    glyph: "🐻",
    glyphDark: "🐻",
    hp: 1010,
    atk: 56,
    attackSpeed: 0.6,
    range: 1,
    armor: 52,
    resist: 26,
    moveInterval: 0.82,
    manaMax: 80,
    manaStart: 10,
    damageType: DamageType.PHYSICAL,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    skill: {
      name: "熊掌一撃",
      text: "正面3マスの敵に攻撃力200%＋1.2秒 行動不能。",
    },
  },

  griffon: {
    id: "griffon",
    traits: ["beast", "blade"],
    color: 0xd9b45c, // 金褐
    family: "beast",
    rarity: 4,
    name: "グリフォン",
    role: "強襲 / ビースト",
    glyph: "🦅",
    glyphDark: "🦅",
    hp: 720,
    atk: 76,
    attackSpeed: 0.8,
    range: 1,
    armor: 34,
    resist: 30,
    moveInterval: 0.5,
    manaMax: 75,
    manaStart: 15,
    damageType: DamageType.PHYSICAL,
    move: MOVE.leap2,
    moveText: "2マス先へ跳躍（飛び越える）",
    skill: {
      name: "急降下",
      text: "最もHPの低い敵の隣へ舞い降り、攻撃力250%＋周囲に100%。",
    },
  },

  // ------------------------------------------------------------ 魔族
  imp: {
    id: "imp",
    traits: ["demon", "mage"],
    color: 0xd4574f, // 赤
    family: "demon",
    rarity: 2,
    name: "インプ",
    role: "後衛 / デーモン",
    glyph: "👺",
    glyphDark: "👺",
    hp: 430,
    atk: 44,
    attackSpeed: 0.72,
    range: 3,
    armor: 20,
    resist: 26,
    moveInterval: 0.72,
    manaMax: 55,
    manaStart: 10,
    damageType: DamageType.MAGIC,
    move: MOVE.diag2,
    moveText: "斜めに最大2マス滑走",
    skill: {
      name: "業火の礫",
      text: "対象と隣接する敵に180の魔法ダメージ。",
    },
  },

  succubus: {
    id: "succubus",
    traits: ["demon", "support"],
    color: 0xb765c9, // 紫
    family: "demon",
    rarity: 3,
    name: "サキュバス",
    role: "支援 / デーモン",
    glyph: "🦇",
    glyphDark: "🦇",
    hp: 590,
    atk: 46,
    attackSpeed: 0.7,
    range: 2,
    armor: 26,
    resist: 34,
    moveInterval: 0.62,
    manaMax: 70,
    manaStart: 15,
    damageType: DamageType.MAGIC,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    skill: {
      name: "魅了",
      text: "対象に240の魔法ダメージ、与えたぶんHPの最も低い味方を回復。",
    },
  },

  demonlord: {
    id: "demonlord",
    traits: ["demon", "blade"],
    color: 0x7b2d3a, // 暗紅
    family: "demon",
    rarity: 5,
    name: "魔王",
    role: "主砲 / デーモン",
    glyph: "😈",
    glyphDark: "😈",
    hp: 980,
    atk: 88,
    attackSpeed: 0.68,
    range: 1,
    armor: 46,
    resist: 46,
    moveInterval: 0.7,
    manaMax: 95,
    manaStart: 20,
    damageType: DamageType.PHYSICAL,
    move: MOVE.any2,
    moveText: "全方向に最大2マス滑走",
    skill: {
      name: "冥府の裁き",
      text: "対象中心3×3に攻撃力210%の魔法。倒した敵1体につき自分を180回復。",
    },
  },

  // 召喚専用（編成では選べない）
  golem: {
    id: "golem",
    traits: [],
    color: 0x8b8178, // 岩
    family: "job",
    cost: 0,
    hidden: true,
    name: "ゴーレム",
    role: "召喚 / 壁",
    glyph: "🗿",
    glyphDark: "🗿",
    hp: 620,
    atk: 40,
    attackSpeed: 0.55,
    range: 1,
    armor: 45,
    resist: 30,
    moveInterval: 0.9,
    manaMax: 9999,
    manaStart: 0,
    damageType: DamageType.PHYSICAL,
    move: MOVE.step1,
    moveText: "全方向に1マス",
    skill: { name: "—", text: "スキルを持たない。" },
  },
};

// レアリティと雇用コストは、片方だけ書けばもう片方も揃うようにしておく
for (const t of Object.values(UNIT_TYPES)) {
  t.rarity ??= t.cost;
  t.cost ??= t.rarity;
}

/** 編成で選べるユニット（召喚専用は除く） */
export const UNIT_IDS = Object.keys(UNIT_TYPES).filter(
  (id) => !UNIT_TYPES[id].hidden,
);
export const CHESS_IDS = UNIT_IDS.filter((id) => UNIT_TYPES[id].family === "chess");
export const JOB_IDS = UNIT_IDS.filter((id) => UNIT_TYPES[id].family === "job");
export const BEAST_IDS = UNIT_IDS.filter((id) => UNIT_TYPES[id].family === "beast");
export const DEMON_IDS = UNIT_IDS.filter((id) => UNIT_TYPES[id].family === "demon");

/** ★が1つ上がるごとの倍率 */
export const STAR_SCALE = 1.7;

/**
 * ユニットの識別色。
 * 3Dモデルの差し色と、UIカードの色見本に使う。
 * 陣営の区別（明るい/暗い）は保ったまま、種類を色で見分けられるようにするためのもの。
 */
export const colorOf = (typeId) => UNIT_TYPES[typeId]?.color ?? 0xffffff;

/** CSS で使えるかたちの識別色 */
export const cssColorOf = (typeId) =>
  `#${colorOf(typeId).toString(16).padStart(6, "0")}`;

/** コストの上限（表示用） */
export const MAX_COST = 5;

/** 表示バー用の正規化基準（カードのゲージ） */
export const STAT_MAX = { hp: 1100, atk: 92, range: 5 };

/**
 * ★とラウンド補正を反映した実ステータスを返す。
 * @param {string} typeId
 * @param {{star?: number, power?: number}} opts power は敵のラウンド強化倍率
 */
export function buildStats(typeId, { star = 1, power = 1 } = {}) {
  const t = UNIT_TYPES[typeId];
  if (!t) throw new Error(`unknown unit type: ${typeId}`);
  const s = Math.pow(STAR_SCALE, star - 1) * power;
  return {
    type: t,
    star,
    maxHp: Math.round(t.hp * s),
    atk: Math.round(t.atk * s),
    attackSpeed: t.attackSpeed,
    range: t.range,
    armor: t.armor,
    resist: t.resist,
    moveInterval: t.moveInterval,
    manaMax: t.manaMax,
    manaStart: t.manaStart,
    spellPower: s, // スキルの固定ダメージにも同じ倍率をかける
    damageType: t.damageType,
  };
}

/** チェスの移動オフセット定義をエクスポート（盤面ロジックから参照） */
export const MOVE_DIRS = { DIAGONALS, ORTHOGONALS, ALL_DIRS, KNIGHT_OFFSETS };
