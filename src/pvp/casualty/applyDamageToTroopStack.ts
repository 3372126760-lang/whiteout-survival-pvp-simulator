import type { TroopState } from "../types/troop";
import {
  CONFIRMED_INTEGER_DAMAGE_ROUNDING,
  type CasualtyRoundingStrategy,
} from "../strategies/casualtyRounding";
import {
  CONFIRMED_INITIAL_RATIO_CEILING,
  type MixedLevelCasualtyAllocationStrategy,
} from "../strategies/mixedLevelCasualtyAllocation";
import { rebaseTroopForLevelComposition } from "./rebaseTroopForLevelComposition";

export interface TroopDamageApplication {
  readonly troop: TroopState;
  readonly incomingDamage: number;
  readonly resolvedDamage: number;
  readonly absorbedDamage: number;
  readonly unabsorbedDamage: number;
  readonly casualties: number;
}

export interface TroopDamageApplicationOptions {
  /** RoundEnd batches all events before allocating; standalone calls do not. */
  readonly deferMixedLevelAllocation?: boolean;
  readonly mixedLevelCasualtyAllocationStrategy?:
    MixedLevelCasualtyAllocationStrategy;
  /** The pending queue already contains confirmed rounded event damage. */
  readonly incomingDamageAlreadyNormalized?: boolean;
}

/** Pure residual-HP casualty resolver. It never mutates the input troop stack. */
export function applyDamageToTroopStack(
  troop: TroopState,
  incomingDamage: number,
  roundingStrategy: CasualtyRoundingStrategy =
    CONFIRMED_INTEGER_DAMAGE_ROUNDING,
  options: TroopDamageApplicationOptions = {},
): TroopDamageApplication {
  validateTroopHpState(troop);
  if (!Number.isFinite(incomingDamage) || incomingDamage < 0) {
    throw new RangeError("incomingDamage must be a non-negative finite number.");
  }
  const resolvedDamage = options.incomingDamageAlreadyNormalized === true
    ? incomingDamage
    : roundingStrategy.normalizeIncomingDamage(
        incomingDamage,
        {
          aliveCount: troop.aliveCount,
          frontUnitHp: troop.frontUnitHp,
          maxHpPerUnit: troop.maxHpPerUnit,
        },
      );
  if (!Number.isFinite(resolvedDamage) || resolvedDamage < 0) {
    throw new RangeError(
      `Casualty rounding strategy ${roundingStrategy.id} returned invalid damage.`,
    );
  }
  if (troop.aliveCount === 0 || resolvedDamage === 0) {
    return {
      troop: { ...troop },
      incomingDamage,
      resolvedDamage,
      absorbedDamage: 0,
      unabsorbedDamage: resolvedDamage,
      casualties: 0,
    };
  }

  let remainingDamage = resolvedDamage;
  let aliveCount = troop.aliveCount;
  let casualties = 0;
  let frontUnitHp = troop.frontUnitHp;

  if (remainingDamage < frontUnitHp) {
    frontUnitHp -= remainingDamage;
    remainingDamage = 0;
  } else {
    remainingDamage -= frontUnitHp;
    aliveCount -= 1;
    casualties += 1;
    frontUnitHp = aliveCount > 0 ? troop.maxHpPerUnit : 0;

    if (aliveCount > 0 && remainingDamage > 0) {
      const fullUnitCasualties = roundingStrategy.resolveFullUnitCasualties({
        aliveCount: troop.aliveCount,
        frontUnitHp: troop.frontUnitHp,
        maxHpPerUnit: troop.maxHpPerUnit,
        remainingAliveCount: aliveCount,
        remainingDamageAfterFrontUnit: remainingDamage,
        exactFullUnitCasualties: remainingDamage / troop.maxHpPerUnit,
      });
      if (
        !Number.isSafeInteger(fullUnitCasualties) ||
        fullUnitCasualties < 0 ||
        fullUnitCasualties > aliveCount
      ) {
        throw new RangeError(
          `Casualty rounding strategy ${roundingStrategy.id} returned an invalid casualty count.`,
        );
      }
      remainingDamage = Math.max(
        0,
        remainingDamage - fullUnitCasualties * troop.maxHpPerUnit,
      );
      aliveCount -= fullUnitCasualties;
      casualties += fullUnitCasualties;
      if (aliveCount === 0) {
        frontUnitHp = 0;
      } else if (remainingDamage > 0) {
        frontUnitHp = troop.maxHpPerUnit - remainingDamage;
        remainingDamage = 0;
      } else {
        frontUnitHp = troop.maxHpPerUnit;
      }
    }
  }

  const absorbedDamage = resolvedDamage - remainingDamage;
  const damagedTroop = { ...troop, aliveCount, frontUnitHp };
  const nextTroop = options.deferMixedLevelAllocation === true
    ? damagedTroop
    : rebaseTroopForLevelComposition(
        damagedTroop,
        (
          options.mixedLevelCasualtyAllocationStrategy ??
          CONFIRMED_INITIAL_RATIO_CEILING
        ).allocate(troop.levelComposition, casualties, troop.initialLevelComposition).levelCompositionAfter,
      );
  return {
    troop: nextTroop,
    incomingDamage,
    resolvedDamage,
    absorbedDamage,
    unabsorbedDamage: remainingDamage,
    casualties,
  };
}

export function validateTroopHpState(troop: TroopState): void {
  if (!Number.isSafeInteger(troop.aliveCount) || troop.aliveCount < 0) {
    throw new RangeError("aliveCount must be a non-negative safe integer.");
  }
  if (!Number.isFinite(troop.maxHpPerUnit) || troop.maxHpPerUnit <= 0) {
    throw new RangeError("maxHpPerUnit must be positive and finite.");
  }
  if (
    troop.aliveCount === 0
      ? troop.frontUnitHp !== 0
      : !Number.isFinite(troop.frontUnitHp) ||
        troop.frontUnitHp <= 0 ||
        troop.frontUnitHp > troop.maxHpPerUnit
  ) {
    throw new RangeError("frontUnitHp is inconsistent with the troop stack.");
  }
}
