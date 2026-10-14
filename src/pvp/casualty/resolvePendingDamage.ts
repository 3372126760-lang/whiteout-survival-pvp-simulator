import { replaceTroop } from "../battle/createBattleState";
import type { BattleState } from "../types/battle";
import type { DamageEvent } from "../types/damage";
import type { SideId, TroopType } from "../types/combat";
import type { RuleStatus } from "../types/effect";
import type { GatotShieldCalculation } from "../heroSkills/gatotShield";
import type { TroopState } from "../types/troop";
import {
  CONFIRMED_INTEGER_DAMAGE_ROUNDING,
  CONFIRMED_DISCARD_OVERFLOW,
  CONFIRMED_INITIAL_RATIO_CEILING,
  type CasualtyRoundingStrategy,
  type MixedLevelCasualtyAllocationResult,
  type MixedLevelCasualtyAllocationStrategy,
  type OverflowDamageStrategy,
} from "../strategies";
import { rebaseTroopForLevelComposition } from "./rebaseTroopForLevelComposition";
import type { TroopDamageApplication } from "./applyDamageToTroopStack";
import { applyDamageToTroopStack } from "./applyDamageToTroopStack";

export interface TemporaryShieldAbsorptionTrace {
  readonly shieldSourceSkill: string;
  readonly rawDamageBasis?: number;
  readonly gatotShield?: GatotShieldCalculation;
  readonly generatedShieldHp: number;
  readonly shieldHpBeforeHit: number;
  readonly absorbedDamage: number;
  readonly shieldHpAfterHit: number;
  readonly ruleStatus: RuleStatus;
}

export interface TargetCasualtyResolution extends TroopDamageApplication {
  readonly targetSide: SideId;
  readonly targetTroop: TroopType;
  readonly sourceEvents: readonly DamageEvent[];
  readonly discardedOverflowDamage: number;
  readonly temporaryShieldApplications: readonly TemporaryShieldAbsorptionTrace[];
}

export interface PendingDamageResolution {
  readonly state: BattleState;
  readonly targets: readonly TargetCasualtyResolution[];
  readonly mixedLevelCasualties: readonly MixedLevelTargetCasualtyResolution[];
}

export interface MixedLevelTargetCasualtyResolution
  extends MixedLevelCasualtyAllocationResult {
  readonly targetSide: SideId;
  readonly targetTroop: TroopType;
}

export interface PendingDamageResolutionOptions {
  readonly recordBattleLog?: boolean;
  readonly casualtyRoundingStrategy?: CasualtyRoundingStrategy;
  readonly overflowDamageStrategy?: OverflowDamageStrategy;
  readonly mixedLevelCasualtyAllocationStrategy?:
    MixedLevelCasualtyAllocationStrategy;
}

/**
 * Resolves queued events in stable event order, but mutates troop counts only
 * inside RoundEnd. Per-event resolution preserves rounded/applied/overflow
 * audit data and never retargets confirmed overflow damage.
 */
export function resolvePendingDamage(
  state: BattleState,
  options: PendingDamageResolutionOptions = {},
): PendingDamageResolution {
  const casualtyRoundingStrategy =
    options.casualtyRoundingStrategy ?? CONFIRMED_INTEGER_DAMAGE_ROUNDING;
  const overflowDamageStrategy =
    options.overflowDamageStrategy ?? CONFIRMED_DISCARD_OVERFLOW;
  const mixedLevelStrategy =
    options.mixedLevelCasualtyAllocationStrategy ??
    CONFIRMED_INITIAL_RATIO_CEILING;

  let sideA = state.sideA;
  let sideB = state.sideB;
  const targets: TargetCasualtyResolution[] = [];
  const queue = state.pendingDamageEvents.map((event) => ({
    targetSide: event.targetSide,
    targetTroop: event.targetTroop,
    damage: event.roundedDamage,
    sourceEvents: [event],
  }));
  const maximumResolutionSteps = 64;
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    if (queueIndex >= maximumResolutionSteps) {
      throw new Error("Overflow damage strategy exceeded 64 resolution steps.");
    }
    const total = queue[queueIndex]!;
    const side = total.targetSide === "A" ? sideA : sideB;
    const targetBefore = side.troops[total.targetTroop];
    const shield = applyTemporaryShields(
      targetBefore,
      total.damage,
      total.sourceEvents[0],
    );
    const hpApplication = applyDamageToTroopStack(
      shield.troop,
      shield.remainingDamage,
      casualtyRoundingStrategy,
      {
        deferMixedLevelAllocation: true,
        incomingDamageAlreadyNormalized: true,
      },
    );
    const application: TroopDamageApplication = {
      ...hpApplication,
      incomingDamage: total.damage,
      resolvedDamage: total.damage,
      absorbedDamage:
        shield.absorbedDamage + hpApplication.absorbedDamage,
    };
    const updatedSide = replaceTroop(
      side,
      total.targetTroop,
      application.troop,
    );
    if (total.targetSide === "A") sideA = updatedSide;
    else sideB = updatedSide;
    const allocations =
      application.unabsorbedDamage === 0
        ? []
        : overflowDamageStrategy.allocate({
            battleState: { ...state, sideA, sideB },
            sourceEvents: total.sourceEvents,
            originalTargetSide: total.targetSide,
            originalTargetTroop: total.targetTroop,
            unabsorbedDamage: application.unabsorbedDamage,
          });
    let allocatedDamage = 0;
    for (const allocation of allocations) {
      if (
        allocation.targetSide !== total.targetSide ||
        !Number.isFinite(allocation.damage) ||
        allocation.damage <= 0
      ) {
        throw new Error(
          `Overflow strategy ${overflowDamageStrategy.id} returned an invalid allocation.`,
        );
      }
      allocatedDamage += allocation.damage;
      queue.push({
        ...allocation,
        sourceEvents: total.sourceEvents,
      });
    }
    if (allocatedDamage > application.unabsorbedDamage + Number.EPSILON) {
      throw new Error(
        `Overflow strategy ${overflowDamageStrategy.id} allocated too much damage.`,
      );
    }
    targets.push({
      ...application,
      targetSide: total.targetSide,
      targetTroop: total.targetTroop,
      sourceEvents: total.sourceEvents,
      discardedOverflowDamage:
        application.unabsorbedDamage - allocatedDamage,
      temporaryShieldApplications: shield.applications,
    });
  }

  const finalized = finalizeMixedLevelCompositions(
    state,
    { ...state, sideA, sideB },
    mixedLevelStrategy,
  );
  sideA = finalized.state.sideA;
  sideB = finalized.state.sideB;
  const casualtyLogs = options.recordBattleLog === false ? [] : targets.map((target) => ({
    type: "casualtyResolved" as const,
    round: state.round,
    targetSide: target.targetSide,
    targetTroop: target.targetTroop,
    incomingDamage: target.incomingDamage,
    resolvedDamage: target.resolvedDamage,
    casualties: target.casualties,
    aliveCountAfter: target.troop.aliveCount,
    frontUnitHpAfter: target.troop.frontUnitHp,
    unabsorbedDamage: target.unabsorbedDamage,
  }));
  return {
    state: {
      ...state,
      sideA,
      sideB,
      pendingDamageEvents: [],
      battleLog: options.recordBattleLog === false
        ? state.battleLog : [...state.battleLog, ...casualtyLogs],
    },
    targets,
    mixedLevelCasualties: finalized.allocations,
  };
}

function applyTemporaryShields(
  troop: TroopState,
  incomingDamage: number,
  sourceEvent: DamageEvent | undefined,
): {
  readonly troop: TroopState;
  readonly remainingDamage: number;
  readonly absorbedDamage: number;
  readonly applications: readonly TemporaryShieldAbsorptionTrace[];
} {
  if (
    sourceEvent === undefined || troop.aliveCount === 0 ||
    incomingDamage === 0 || troop.temporaryShieldHp === 0
  ) {
    return {
      troop,
      remainingDamage: incomingDamage,
      absorbedDamage: 0,
      applications: [],
    };
  }
  let remainingDamage = incomingDamage;
  let absorbedDamage = 0;
  const applications: TemporaryShieldAbsorptionTrace[] = [];
  const temporaryShields = troop.temporaryShields.map((layer) => {
    const generatedBeforeEvent =
      layer.generatedRound < sourceEvent.round ||
      (layer.generatedRound === sourceEvent.round &&
        layer.generatedActionOrder < sourceEvent.actionOrder);
    const active = generatedBeforeEvent &&
      sourceEvent.round >= layer.activeFromRound &&
      sourceEvent.round <= layer.expiresAfterRound;
    if (!active || remainingDamage === 0 || layer.remainingShieldHp === 0) {
      return layer;
    }
    const shieldHpBeforeHit = layer.remainingShieldHp;
    const absorbed = Math.min(shieldHpBeforeHit, remainingDamage);
    const shieldHpAfterHit = shieldHpBeforeHit - absorbed;
    remainingDamage -= absorbed;
    absorbedDamage += absorbed;
    applications.push({
      shieldSourceSkill: layer.sourceSkillId,
      ...(layer.rawDamageBasis === undefined ? {} : { rawDamageBasis: layer.rawDamageBasis }),
      ...(layer.gatotShield === undefined ? {} : { gatotShield: layer.gatotShield }),
      generatedShieldHp: layer.generatedShieldHp,
      shieldHpBeforeHit,
      absorbedDamage: absorbed,
      shieldHpAfterHit,
      ruleStatus: layer.ruleStatus,
    });
    return { ...layer, remainingShieldHp: shieldHpAfterHit };
  });
  return {
    troop: {
      ...troop,
      temporaryShields,
      temporaryShieldHp: temporaryShields.reduce(
        (sum, layer) => sum +
          (layer.activeFromRound <= sourceEvent.round &&
            sourceEvent.round <= layer.expiresAfterRound ? layer.remainingShieldHp : 0),
        0,
      ),
    },
    remainingDamage,
    absorbedDamage,
    applications,
  };
}

function finalizeMixedLevelCompositions(
  stateBefore: BattleState,
  stateAfterDamage: BattleState,
  strategy: MixedLevelCasualtyAllocationStrategy,
): {
  readonly state: BattleState;
  readonly allocations: readonly MixedLevelTargetCasualtyResolution[];
} {
  let sideA = stateAfterDamage.sideA;
  let sideB = stateAfterDamage.sideB;
  const allocations: MixedLevelTargetCasualtyResolution[] = [];
  for (const targetSide of ["A", "B"] as const) {
    const beforeSide = targetSide === "A" ? stateBefore.sideA : stateBefore.sideB;
    let afterSide = targetSide === "A" ? sideA : sideB;
    for (const targetTroop of ["shield", "lancer", "marksman"] as const) {
      const beforeTroop = beforeSide.troops[targetTroop];
      const afterTroop = afterSide.troops[targetTroop];
      const totalDeaths = beforeTroop.aliveCount - afterTroop.aliveCount;
      const allocation = strategy.allocate(
        beforeTroop.levelComposition,
        totalDeaths,
        beforeTroop.initialLevelComposition,
      );
      const rebasedTroop = rebaseTroopForLevelComposition(
        afterTroop,
        allocation.levelCompositionAfter,
      );
      afterSide = replaceTroop(afterSide, targetTroop, rebasedTroop);
      allocations.push({
        ...allocation,
        targetSide,
        targetTroop,
      });
    }
    if (targetSide === "A") sideA = afterSide;
    else sideB = afterSide;
  }
  return {
    state: { ...stateAfterDamage, sideA, sideB },
    allocations,
  };
}
