/**
 * ランの成果をポイントに換算する。
 *
 * 貯まったポイントはホーム画面に積み上がる（いまは貯めるだけ）。
 * 描画に依存しないので、バランス調整はここだけ見れば済む。
 */

import { UNIT_TYPES } from "./units.js";

export const POINT_RULES = {
  /** 突破したラウンド1つあたり */
  perRound: 12,
  /** 編成の価値1点あたり（価値＝コスト×★の重み） */
  perUnitValue: 3,
  /** 自己ベストを更新したランのボーナス */
  bestBonus: 50,
};

/**
 * ユニット1体の価値。
 * ★アップは同じユニット3体ぶんなので、そのまま3倍で数える。
 */
export function unitValue(entry) {
  const cost = UNIT_TYPES[entry.typeId]?.cost ?? 1;
  return cost * 3 ** ((entry.star ?? 1) - 1);
}

/**
 * @param {{round:number, roster?:object[], newBest?:boolean}} run
 *   round    … 力尽きたラウンド（突破数は round-1）
 *   roster   … 最後に持っていたユニット（控えも含む）
 *   newBest  … このランで自己ベストを更新したか
 * @returns {{rows:{label:string,value:number}[], total:number, cleared:number, squadValue:number}}
 */
export function scoreRun({ round, roster = [], newBest = false }) {
  const cleared = Math.max(0, round - 1);
  const squadValue = roster.reduce((sum, e) => sum + unitValue(e), 0);

  const rows = [
    {
      label: `突破ラウンド ${cleared}`,
      value: cleared * POINT_RULES.perRound,
    },
    {
      label: `編成の価値 ${squadValue}`,
      value: squadValue * POINT_RULES.perUnitValue,
    },
  ];
  if (newBest) rows.push({ label: "自己ベスト更新", value: POINT_RULES.bestBonus });

  return {
    rows,
    total: rows.reduce((sum, r) => sum + r.value, 0),
    cleared,
    squadValue,
  };
}
