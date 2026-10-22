import { deriveRawReportAttribute } from "../battleReportRecognition/mapping";
import { resolveBattleReportModifiers } from "../externalBuffs";
import { TROOP_TYPES } from "../types";
import type { ValidationSideInput, ValidationReportBonusMatrix } from "./types";
import { expandHistoricalBonuses, type HistoricalBonusSource } from "./historicalBonuses";

export const REPORT_STATS = ["attack", "defense", "penetration", "life"] as const;
export function zeroReportBonuses(): ValidationReportBonusMatrix {
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(REPORT_STATS.map((stat) => [stat,
      { additive: 0, buff: 0, debuff: 0 }]))])) as ValidationReportBonusMatrix;
}

export function sourceReportBonuses(side: HistoricalBonusSource): ValidationReportBonusMatrix {
  return expandHistoricalBonuses(side.sourceReportBonuses ?? side.importedReportModifiers ?? zeroReportBonuses());
}

export function currentExternalConfig(side: ValidationSideInput) {
  return side.externalBuffs;
}

export function targetBattleBonuses(side: ValidationSideInput,
  opponent: ValidationSideInput, inTerritory = false): ValidationReportBonusMatrix {
  const external = resolveBattleReportModifiers(currentExternalConfig(side),
    currentExternalConfig(opponent));
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(REPORT_STATS.map((stat) => [stat, {
      additive: 0,
      buff: external.selfBuffs[stat] * 100 + (inTerritory && (stat === "attack" || stat === "defense") ? 10 : 0),
      debuff: external.receivedDebuffs[stat] * 100,
    }]))])) as ValidationReportBonusMatrix;
}

/** Pure conversion: source history never mutates the stored inputs or target context. */
export function rawReportSide(side: ValidationSideInput): ValidationSideInput {
  if (side.reportAttributeBasis !== "historicalReport") return side;
  const source = sourceReportBonuses(side);
  return { ...side, troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
    ...side.troops[troop], ...Object.fromEntries(REPORT_STATS.map((stat) => {
      const row = source[troop][stat];
      return [stat, deriveRawReportAttribute({ reportPercent: side.troops[troop][stat],
        additivePercent: row.additive, buffDecimal: row.buff / 100,
        debuffDecimal: row.debuff / 100 })];
    })),
  }])) as ValidationSideInput["troops"] };
}
