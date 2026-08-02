/**
 * オープニング（開幕定跡）。
 *
 * ラン開始時にひとつ選ぶと、そのラン中ずっと効く修正がかかる。
 * 毎回まったく同じ立ち上がりになるのを避けるための仕掛け。
 *
 * mods の項目（省略したものは0扱い）:
 *   gold        開始ゴールド
 *   life        開始ライフ
 *   level       開始レベル
 *   income      毎ラウンドの基本収入
 *   winIncome   勝利ボーナス
 *   xpPerRound  ラウンドごとに自動でもらえる経験値
 *   rerollCost  リロールの値段（1G未満にはならない）
 *   shopSlots   ショップの枠数
 *
 * units      … 開幕から持っているユニット
 * traitBonus … 特性の種類数に下駄をはかせる（{ mage: 1 } なら術士を1種多く数える）
 */

export const OPENINGS = [
  {
    id: "sicilian",
    name: "シチリア防御",
    en: "Sicilian Defence",
    desc: "受けて勝つ。粘れるぶん、実入りは細い。",
    mods: { life: 2, income: -1 },
    effects: ["ライフ +2", "毎ラウンドの収入 -1G"],
  },
  {
    id: "queensGambit",
    name: "クイーンズ・ギャンビット",
    en: "Queen's Gambit",
    desc: "駒を捨てて先手を取る。序盤に賭ける定跡。",
    mods: { gold: 16, income: -1 },
    effects: ["開始ゴールド +16", "毎ラウンドの収入 -1G"],
  },
  {
    id: "ruyLopez",
    name: "ルイ・ロペス",
    en: "Ruy López",
    desc: "ビショップを軸に組み立てる、最古の定跡のひとつ。",
    mods: {},
    units: ["bishop"],
    traitBonus: { mage: 1 },
    effects: ["開幕にビショップ1体", "「術士」を1種多く数える"],
  },
  {
    id: "kingsIndian",
    name: "キングズ・インディアン",
    en: "King's Indian Defence",
    desc: "陣を敷いてから反撃する。人数で押す立ち上がり。",
    mods: { level: 1, gold: -3 },
    effects: ["開始レベル +1（4体出せる）", "開始ゴールド -3"],
  },
  {
    id: "italian",
    name: "イタリアン・ゲーム",
    en: "Italian Game",
    desc: "素早く駒を展開する。引き直しが軽い。",
    mods: { rerollCost: -1, winIncome: 2 },
    effects: ["リロールが 1G", "勝利ボーナス +2G"],
  },
  {
    id: "alekhine",
    name: "アレヒン防御",
    en: "Alekhine's Defence",
    desc: "ナイトを突き出して誘い込む。速さで撹乱する。",
    mods: { xpPerRound: 1, gold: 2 },
    units: ["knight"],
    traitBonus: { swift: 1 },
    effects: ["開幕にナイト1体", "「速攻」を1種多く数える", "毎ラウンドの経験値 +1"],
  },
];

export const OPENING_BY_ID = Object.fromEntries(OPENINGS.map((o) => [o.id, o]));

/** 選択肢として出す数 */
export const OPENING_CHOICES = 3;

/** ランのはじめに提示する候補をランダムに選ぶ */
export function drawOpenings(n = OPENING_CHOICES) {
  const pool = [...OPENINGS];
  const out = [];
  while (out.length < n && pool.length) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}
