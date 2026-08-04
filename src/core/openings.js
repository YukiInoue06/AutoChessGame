/**
 * 定跡。
 *
 * ラン開始時と、決められたラウンドの区切りでひとつずつ選ぶ。
 * 選んだものは積み上がり、そのラン中ずっと効き続ける。
 *
 * mods の項目（省略したものは0扱い）:
 *   一度きり（選んだ瞬間に反映）
 *     gold        ゴールド
 *     life        ライフ
 *     level       レベル
 *   ずっと効く（選んだぶんを合算して読む）
 *     income      毎ラウンドの基本収入
 *     winIncome   勝利ボーナス
 *     xpPerRound  ラウンドごとに自動でもらえる経験値
 *     rerollCost  ショップのリロール代（1G未満にはならない）
 *     shopSlots   ショップの枠数
 *     enemyPower  相手の強さの倍率に足す値（-0.06 なら 6% 弱くなる）
 *
 * icon       … 一覧に出す絵柄
 * color      … 絵柄と枠の色
 * units      … 選んだ時点でもらえるユニット
 * traitBonus … 特性の種類数に下駄をはかせる（{ mage: 1 } なら術士を1種多く数える）
 */

/** 定跡を選べるラウンド。1 はラン開始時 */
export const OPENING_ROUNDS = [1, 6, 12, 18];
/** 1回に提示する候補の数 */
export const OPENING_CHOICES = 3;
/** ラン全体で使える引き直しの回数 */
export const OPENING_REROLLS = 2;

export const OPENINGS = [
  {
    id: "sicilian",
    icon: "🛡️",
    color: "#6ee7d0",
    name: "シチリア防御",
    en: "Sicilian Defence",
    desc: "受けて勝つ。粘れるぶん、実入りは細い。",
    mods: { life: 2, income: -1 },
    effects: ["ライフ +2", "毎ラウンドの収入 -1G"],
  },
  {
    id: "queensGambit",
    icon: "🎲",
    color: "#f5c451",
    name: "クイーンズ・ギャンビット",
    en: "Queen's Gambit",
    desc: "駒を捨てて先手を取る。目先に賭ける定跡。",
    mods: { gold: 16, income: -1 },
    effects: ["ゴールド +16", "毎ラウンドの収入 -1G"],
  },
  {
    id: "ruyLopez",
    icon: "♗",
    color: "#38bdf8",
    name: "ルイ・ロペス",
    en: "Ruy López",
    desc: "ビショップを軸に組み立てる、最古の定跡のひとつ。",
    mods: {},
    units: ["bishop"],
    traitBonus: { mage: 1 },
    effects: ["ビショップ1体", "「術士」を1種多く数える"],
  },
  {
    id: "kingsIndian",
    icon: "♔",
    color: "#f2c14e",
    name: "キングズ・インディアン",
    en: "King's Indian Defence",
    desc: "陣を敷いてから反撃する。人数で押す。",
    mods: { level: 1, gold: -3 },
    effects: ["レベル +1（出せる人数 +1）", "ゴールド -3"],
  },
  {
    id: "italian",
    icon: "⚡",
    color: "#a78bfa",
    name: "イタリアン・ゲーム",
    en: "Italian Game",
    desc: "素早く駒を展開する。引き直しが軽い。",
    mods: { rerollCost: -1, winIncome: 2 },
    effects: ["リロール -1G", "勝利ボーナス +2G"],
  },
  {
    id: "alekhine",
    icon: "♘",
    color: "#8b5cf6",
    name: "アレヒン防御",
    en: "Alekhine's Defence",
    desc: "ナイトを突き出して誘い込む。速さで撹乱する。",
    mods: { xpPerRound: 1, gold: 2 },
    units: ["knight"],
    traitBonus: { swift: 1 },
    effects: ["ナイト1体", "「速攻」を1種多く数える", "毎ラウンドの経験値 +1"],
  },

  // ------------------------------------------------ 中盤以降でも噛み合うもの
  {
    id: "pawnStorm",
    icon: "♙",
    color: "#94a3b8",
    name: "ポーンストーム",
    en: "Pawn Storm",
    desc: "歩兵の波で押し潰す。数がそろうほど硬くなる。",
    mods: {},
    units: ["pawn"],
    traitBonus: { chess: 1 },
    effects: ["ポーン1体", "「チェス」を1種多く数える"],
  },
  {
    id: "fianchetto",
    icon: "✚",
    color: "#6ee7a0",
    name: "フィアンケット",
    en: "Fianchetto",
    desc: "長い斜めに睨みを利かせ、後ろから支える。",
    mods: { income: 1 },
    traitBonus: { support: 1 },
    effects: ["「支援」を1種多く数える", "毎ラウンドの収入 +1G"],
  },
  {
    id: "rookLift",
    icon: "♖",
    color: "#c9b18a",
    name: "ルーク・リフト",
    en: "Rook Lift",
    desc: "重い駒を前線へ持ち上げる。壁を厚くする。",
    mods: {},
    units: ["rook"],
    traitBonus: { heavy: 1 },
    effects: ["ルーク1体", "「重装」を1種多く数える"],
  },
  {
    id: "openFile",
    icon: "🏹",
    color: "#4ade80",
    name: "オープンファイル",
    en: "Open File",
    desc: "空いた筋を通す。遠くから撃ち抜く布陣。",
    mods: { winIncome: 2 },
    traitBonus: { ranger: 1 },
    effects: ["「射手」を1種多く数える", "勝利ボーナス +2G"],
  },
  {
    id: "zugzwang",
    icon: "⛓️",
    color: "#e0457b",
    name: "ツークツワンク",
    en: "Zugzwang",
    desc: "動くほど不利になる形へ追い込む。相手の力を削ぐ。",
    mods: { enemyPower: -0.06 },
    effects: ["相手の強さ -6%"],
  },
  {
    id: "promotion",
    icon: "♕",
    color: "#e0348a",
    name: "プロモーション",
    en: "Promotion",
    desc: "成る手を狙い続ける。選択肢そのものを増やす。",
    mods: { shopSlots: 1 },
    effects: ["ショップの枠 +1（6枠）"],
  },
];

export const OPENING_BY_ID = Object.fromEntries(OPENINGS.map((o) => [o.id, o]));

/**
 * 候補をランダムに引く。すでに選んだものは出さない。
 * @param {number} n
 * @param {{id:string}[]} taken すでに選んだ定跡
 */
export function drawOpenings(n = OPENING_CHOICES, taken = []) {
  const used = new Set(taken.map((o) => o.id));
  const pool = OPENINGS.filter((o) => !used.has(o.id));
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/** そのラウンドが定跡を選べる区切りか */
export const isOpeningRound = (round) => OPENING_ROUNDS.includes(round);
