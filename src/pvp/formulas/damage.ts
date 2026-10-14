export interface BaseDamageFormulaInput {
  readonly fixedInitialMinTroops: number;
  readonly aliveCount: number;
  readonly damageCoefficient: number;
  readonly troopConstant: number;
  /** Decimal form: 0.25 means +25%. */
  readonly penetration: number;
  /** Decimal form: 0.25 means +25%. */
  readonly attack: number;
}

export interface BaseDamageFormulaResult {
  readonly damage: number;
  readonly factors: {
    readonly fixedInitialCountFactor: number;
    readonly aliveCountFactor: number;
    readonly damageCoefficient: number;
    readonly troopConstant: number;
    readonly penetrationMultiplier: number;
    readonly attackMultiplier: number;
  };
}

/**
 * Computes the formula before scoped effect multiplier M_i. The damage event
 * resolver supplies M_i through grouped outgoing effects.
 */
export function calculateBaseTroopDamage(
  input: BaseDamageFormulaInput,
): BaseDamageFormulaResult {
  assertNonNegativeSafeInteger(
    input.fixedInitialMinTroops,
    "fixedInitialMinTroops",
  );
  assertNonNegativeSafeInteger(input.aliveCount, "aliveCount");
  for (const [label, value] of [
    ["damageCoefficient", input.damageCoefficient],
    ["troopConstant", input.troopConstant],
    ["penetration", input.penetration],
    ["attack", input.attack],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`${label} must be finite.`);
    }
  }
  if (input.damageCoefficient < 0 || input.troopConstant < 0) {
    throw new RangeError("Damage coefficient and constant must be non-negative.");
  }
  const penetrationMultiplier = 1 + input.penetration;
  const attackMultiplier = 1 + input.attack;
  if (penetrationMultiplier < 0 || attackMultiplier < 0) {
    throw new RangeError("Attack and penetration multipliers cannot be negative.");
  }
  const fixedInitialCountFactor = Math.sqrt(input.fixedInitialMinTroops);
  const aliveCountFactor = Math.sqrt(input.aliveCount);
  const damage =
    fixedInitialCountFactor *
    aliveCountFactor *
    input.damageCoefficient *
    input.troopConstant *
    penetrationMultiplier *
    attackMultiplier;
  return {
    damage,
    factors: {
      fixedInitialCountFactor,
      aliveCountFactor,
      damageCoefficient: input.damageCoefficient,
      troopConstant: input.troopConstant,
      penetrationMultiplier,
      attackMultiplier,
    },
  };
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}
