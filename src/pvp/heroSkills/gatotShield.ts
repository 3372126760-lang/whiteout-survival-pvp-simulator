/** Gatot's shield uses the report attack layer, before hero expedition skills. */
export interface GatotShieldCalculation {
  readonly skillLevel: 4 | 5;
  readonly troopConstant: number;
  readonly currentShieldCount: number;
  readonly sqrtCurrentShieldCount: number;
  readonly reportAttackBonus: number;
  readonly reportAttackFactor: number;
  readonly calculatedAttackX: number;
  readonly shieldRatio: number;
  readonly generatedShield: number;
  readonly previousShield: number;
  readonly refreshedShield: number;
}

export function calculateGatotShield(input: {
  readonly skillLevel: 4 | 5;
  readonly troopConstant: number;
  readonly currentShieldCount: number;
  readonly reportAttackBonus: number;
  readonly previousShield?: number;
}): GatotShieldCalculation {
  const { skillLevel, troopConstant, currentShieldCount, reportAttackBonus } = input;
  const previousShield = input.previousShield ?? 0;
  if (skillLevel !== 4 && skillLevel !== 5) throw new RangeError("Gatot shield requires skill level 4 or 5.");
  if (!Number.isFinite(troopConstant) || troopConstant <= 0 ||
      !Number.isSafeInteger(currentShieldCount) || currentShieldCount <= 0 ||
      !Number.isFinite(reportAttackBonus) || 1 + reportAttackBonus <= 0 ||
      !Number.isFinite(previousShield) || previousShield < 0) {
    throw new RangeError("Gatot shield inputs must be valid current report-layer values.");
  }
  const sqrtCurrentShieldCount = Math.sqrt(currentShieldCount);
  const reportAttackFactor = 1 + reportAttackBonus;
  const calculatedAttackX = 100 * troopConstant * sqrtCurrentShieldCount * reportAttackFactor;
  const shieldRatio = skillLevel === 5 ? .30 : .24;
  const generatedShield = calculatedAttackX * shieldRatio;
  return {
    skillLevel,
    troopConstant,
    currentShieldCount,
    sqrtCurrentShieldCount,
    reportAttackBonus,
    reportAttackFactor,
    calculatedAttackX,
    shieldRatio,
    generatedShield,
    previousShield,
    refreshedShield: generatedShield,
  };
}
