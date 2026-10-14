export interface TroopHpFormulaInput {
  readonly troopConstant: number;
  readonly troopHpCoefficient: number;
  /** Decimal form: 0.25 means +25%. */
  /** Legacy input, ignored: defense now reduces incoming damage. */
  readonly defense?: number;
  /** Decimal form: 0.25 means +25%. */
  readonly life: number;
}

export interface TroopHpFormulaResult {
  /** Static single-unit HP before defense/life attributes. */
  readonly baseHpPerUnit: number;
  /** Static single-unit HP used by the casualty resolver. */
  readonly effectiveHpPerUnit: number;
  readonly factors: {
    readonly troopConstant: number;
    readonly troopHpCoefficient: number;
    /** Legacy trace field, always 1. Defense belongs to the damage divisor. */
    readonly defenseMultiplier: number;
    readonly lifeMultiplier: number;
  };
}

/**
 * Static HP calculation only. DamageEvent reductions are intentionally absent:
 * baseHp = troopConstant * troopHpCoefficient
 * effectiveHp = baseHp * (1 + life)
 */
export function calculateTroopHp(
  input: TroopHpFormulaInput,
): TroopHpFormulaResult {
  for (const [label, value] of [
    ["troopConstant", input.troopConstant],
    ["troopHpCoefficient", input.troopHpCoefficient],
    ["life", input.life],
  ] as const) {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  }
  if (input.troopConstant <= 0 || input.troopHpCoefficient <= 0) {
    throw new RangeError(
      "troopConstant and troopHpCoefficient must be positive.",
    );
  }
  const defenseMultiplier = 1;
  const lifeMultiplier = 1 + input.life;
  if (defenseMultiplier <= 0 || lifeMultiplier <= 0) {
    throw new RangeError("Defense and life multipliers must be positive.");
  }
  const baseHpPerUnit = input.troopConstant * input.troopHpCoefficient;
  const effectiveHpPerUnit = baseHpPerUnit * lifeMultiplier;
  if (!Number.isFinite(effectiveHpPerUnit)) {
    throw new RangeError("Effective HP must be finite.");
  }
  return {
    baseHpPerUnit,
    effectiveHpPerUnit,
    factors: {
      troopConstant: input.troopConstant,
      troopHpCoefficient: input.troopHpCoefficient,
      defenseMultiplier,
      lifeMultiplier,
    },
  };
}
