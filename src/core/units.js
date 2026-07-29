/**
 * ユニット定義。
 *
 * このゲームのユニットはチェスのコマそのものであり、
 * 「移動パターン」も本家チェスのルールを踏襲する（スライド系は最大距離のみ制限）。
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

/** ダメージ種別 */
export const DamageType = { PHYSICAL: "physical", MAGIC: "magic", TRUE: "true" };

/**
 * ユニット定義テーブル。
 * hp/atk などは ★1 の値。★が上がるごとに STAR_SCALE 倍される。
 */
export const UNIT_TYPES = {
  pawn: {
    id: "pawn",
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
};

export const UNIT_IDS = Object.keys(UNIT_TYPES);

/** ★が1つ上がるごとの倍率 */
export const STAR_SCALE = 1.7;

/** 表示バー用の正規化基準（カードのゲージ） */
export const STAT_MAX = { hp: 1000, atk: 90, range: 3 };

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
