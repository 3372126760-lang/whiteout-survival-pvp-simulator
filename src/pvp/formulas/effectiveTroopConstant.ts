import { getTroopConstant } from "../data";
import type { TroopLevelCompositionEntry } from "../types/troop";

export interface EffectiveTroopConstantResult {
  readonly totalAliveCount: number;
  readonly weightedConstantNumerator: number;
  readonly effectiveTroopConstant: number;
}

/**
 * Computes C_eff for one troop stack. The stack still attacks exactly once.
 * A resolver is injectable only so existing custom-level formula fixtures keep
 * working; production mixed-level inputs use getTroopConstant directly.
 */
export function calculateEffectiveTroopConstant(
  composition: readonly TroopLevelCompositionEntry[],
  resolveConstant: (level: string) => number = getTroopConstant,
): EffectiveTroopConstantResult {
  if (composition.length === 0) {
    throw new Error("levelComposition must contain at least one level.");
  }
  const seen = new Set<string>();
  let totalAliveCount = 0;
  let weightedConstantNumerator = 0;
  for (const entry of composition) {
    if (!entry.level.trim() || seen.has(entry.level)) {
      throw new Error("levelComposition levels must be non-empty and unique.");
    }
    seen.add(entry.level);
    if (!Number.isSafeInteger(entry.aliveCount) || entry.aliveCount < 0) {
      throw new RangeError(
        "levelComposition aliveCount must be a non-negative safe integer.",
      );
    }
    const constant = resolveConstant(entry.level);
    if (!Number.isFinite(constant) || constant <= 0) {
      throw new RangeError(`Invalid troop constant for level ${entry.level}.`);
    }
    totalAliveCount += entry.aliveCount;
    weightedConstantNumerator += entry.aliveCount * constant;
  }
  if (!Number.isSafeInteger(totalAliveCount)) {
    throw new RangeError("levelComposition total exceeds safe integer range.");
  }
  if (totalAliveCount === 0) {
    throw new RangeError("Cannot calculate effective C for an empty composition.");
  }
  return {
    totalAliveCount,
    weightedConstantNumerator,
    effectiveTroopConstant: weightedConstantNumerator / totalAliveCount,
  };
}
