import { getTroopConstant } from "../data";
import { calculateEffectiveTroopConstant } from "../formulas";
import type {
  TroopLevelCompositionEntry,
  TroopState,
} from "../types/troop";

/** Original ratio determines C/HP; integer bookkeeping must not cause drift. */
export function rebaseTroopForLevelComposition(
  troop: TroopState,
  levelComposition: readonly TroopLevelCompositionEntry[],
): TroopState {
  if (troop.aliveCount === 0) {
    return { ...troop, levelComposition, frontUnitHp: 0 };
  }
  const effective = calculateEffectiveTroopConstant(
    troop.initialLevelComposition.filter((entry) => levelComposition.some(
      (current) => current.level === entry.level && current.aliveCount > 0)),
    (level) => {
      try {
        return getTroopConstant(level);
      } catch (error) {
        if (level === troop.troopLevel && levelComposition.length === 1) {
          return troop.troopConstant;
        }
        throw error;
      }
    },
  );
  const ratio = effective.effectiveTroopConstant / troop.troopConstant;
  return {
    ...troop,
    levelComposition,
    troopConstant: effective.effectiveTroopConstant,
    baseHpPerUnit: troop.baseHpPerUnit * ratio,
    maxHpPerUnit: troop.maxHpPerUnit * ratio,
    frontUnitHp: troop.frontUnitHp * ratio,
  };
}
