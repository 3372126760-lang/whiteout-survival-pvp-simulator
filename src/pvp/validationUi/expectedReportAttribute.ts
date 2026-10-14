/** Raw/formation/additive are percentage points; buff/debuff are decimal rates.
 * targetBuff is the total external group, including scene weapon attribute buffs.
 */
export interface ExpectedReportAttributeInput {
  readonly raw: number;
  readonly formationDelta: number;
  readonly targetAdditive: number;
  readonly targetBuff: number;
  readonly targetDebuff: number;
}

export const EXPECTED_REPORT_FORMULA =
  "(100 + raw + formationDelta + targetAdditive) * (1 + currentExternalBuffTotal) / (1 + targetDebuff) - 100; currentExternalBuffTotal = currentExternalBuffBase + currentWeaponBuff";

export function deriveExpectedReportAttribute(input: ExpectedReportAttributeInput): number {
  const rawFactor = 1 + (input.raw + input.formationDelta + input.targetAdditive) / 100;
  if (![input.raw, input.formationDelta, input.targetAdditive, input.targetBuff,
    input.targetDebuff].every(Number.isFinite) || rawFactor <= 0 ||
    input.targetBuff < 0 || input.targetDebuff < 0) throw new RangeError("战报属性或特殊加成因子无效。");
  return 100 * (rawFactor * (1 + input.targetBuff) / (1 + input.targetDebuff) - 1);
}

export interface ExpectedAttributeAudit {
  readonly side: string;
  readonly troop: string;
  readonly stat: string;
  readonly displayedRaw: number;
  readonly actualRawUsed: number;
  readonly displayedFormationDelta: number;
  readonly actualFormationDeltaUsed: number;
  readonly displayedTargetAdditive: number;
  readonly actualTargetAdditiveUsed: number;
  readonly displayedTargetBuff: number;
  readonly actualTargetBuffUsed: number;
  readonly displayedTargetDebuff: number;
  readonly actualTargetDebuffUsed: number;
  readonly displayedWeaponModifier: number;
  readonly actualWeaponModifierUsed: number;
  readonly sourceReportBonuses: unknown;
  readonly targetBattleBonuses: unknown;
  readonly formula: string;
  readonly weaponSemantics: "sameExternalBuffGroup";
  readonly currentExternalBuffBase: number;
  readonly currentWeaponBuff: number;
  readonly currentExternalBuffTotal: number;
  readonly calculatedExpected: number;
  readonly displayedExpected: number;
  readonly actualEnginePanel: number;
}

/** Recompute using precisely the values presented by the table, independently of its result. */
export function expectedAttributeAuditIsConsistent(audit: ExpectedAttributeAudit,
  tolerance = .1): boolean {
  let calculated: number;
  try { calculated = deriveExpectedReportAttribute({ raw: audit.displayedRaw,
    formationDelta: audit.displayedFormationDelta, targetAdditive: audit.displayedTargetAdditive,
    targetBuff: audit.displayedTargetBuff + audit.displayedWeaponModifier / 100,
    targetDebuff: audit.displayedTargetDebuff }); }
  catch { return false; }
  return Math.abs(calculated - audit.displayedExpected) <= tolerance &&
    Math.abs(audit.calculatedExpected - audit.actualEnginePanel) <= tolerance &&
    Math.abs((audit.currentExternalBuffBase + audit.currentWeaponBuff -
      audit.currentExternalBuffTotal) * 100) <= tolerance &&
    Math.abs((audit.currentExternalBuffTotal - audit.actualTargetBuffUsed) * 100) <= tolerance &&
    Math.abs(audit.currentExternalBuffBase * 100 - audit.displayedTargetBuff * 100) <= tolerance &&
    Math.abs(audit.currentWeaponBuff * 100 - audit.displayedWeaponModifier) <= tolerance;
}
