import { deriveRawReportAttribute } from "../battleReportRecognition/mapping";
import { resolveBattleReportModifiers } from "../externalBuffs";
import { TROOP_TYPES } from "../types";
import type { ValidationSideInput, ValidationReportBonusMatrix } from "./types";

export const REPORT_STATS = ["attack", "defense", "penetration", "life"] as const;
export function zeroReportBonuses(): ValidationReportBonusMatrix {
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(REPORT_STATS.map((stat) => [stat,
      { additive: 0, buff: 0, debuff: 0 }]))])) as ValidationReportBonusMatrix;
}

export function sourceReportBonuses(side: ValidationSideInput): ValidationReportBonusMatrix {
  return side.sourceReportBonuses ?? side.importedReportModifiers ?? zeroReportBonuses();
}

/** Existing explicitly configured external controls count as a custom target.
 * Historical metadata alone never opts into reusing its environment. */
export function targetBonusMode(side: ValidationSideInput): "none" | "reuseSource" | "custom" {
  if (side.targetBonusMode !== undefined) return side.targetBonusMode;
  if (side.sourceReportBonuses !== undefined || side.importedReportModifiers !== undefined ||
    side.reportAttributeBasis === "historicalReport") return "none";
  const external = resolveBattleReportModifiers(side.externalBuffs, undefined);
  return [...Object.values(external.selfBuffs), ...Object.values(
    resolveBattleReportModifiers(undefined, side.externalBuffs).receivedDebuffs)]
    .some((value) => value !== 0) || side.targetBattleBonuses !== undefined ? "custom" : "none";
}

export function currentExternalConfig(side: ValidationSideInput) {
  const mode = targetBonusMode(side);
  return mode === "none" || mode === "reuseSource" ? undefined : side.externalBuffs;
}

export function targetBattleBonuses(side: ValidationSideInput,
  opponent: ValidationSideInput): ValidationReportBonusMatrix {
  const mode = targetBonusMode(side);
  const custom = mode === "reuseSource" ? sourceReportBonuses(side) :
    mode === "none" ? zeroReportBonuses() : side.targetBattleBonuses ?? zeroReportBonuses();
  if (mode === "reuseSource") return structuredClone(custom);
  const external = resolveBattleReportModifiers(currentExternalConfig(side),
    currentExternalConfig(opponent));
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(REPORT_STATS.map((stat) => [stat, {
      additive: custom[troop][stat].additive,
      buff: custom[troop][stat].buff + external.selfBuffs[stat] * 100,
      debuff: custom[troop][stat].debuff + external.receivedDebuffs[stat] * 100,
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
