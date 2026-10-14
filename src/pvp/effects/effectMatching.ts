import type { BattleReadState } from "../types/battle";
import { sideFromState } from "../types/battle";
import type { DamageEventContext } from "../types/damage";
import type {
  ActiveDamageModifierEffect,
  ActiveDefenseModifierEffect,
  ActiveBaseDefenseMultiplierEffect,
  ActiveDefenseReductionEffect,
  ActiveDirectDamageCancellationEffect,
  ActiveEffect,
  ActiveIncomingDamageIncreaseEffect,
  EffectScope,
} from "../types/effect";
import { isEffectActiveInRound } from "./activeEffects";

export interface ApplicableDamageEffects {
  readonly damageIncreases: readonly (
    | ActiveDamageModifierEffect
    | ActiveIncomingDamageIncreaseEffect
  )[];
  readonly damageReductions: readonly ActiveDamageModifierEffect[];
  readonly defenseModifiers: readonly ActiveDefenseModifierEffect[];
  readonly baseDefenseMultipliers: readonly ActiveBaseDefenseMultiplierEffect[];
  readonly defenseReductions: readonly ActiveDefenseReductionEffect[];
  readonly directDamageCancellations: readonly ActiveDirectDamageCancellationEffect[];
}

/**
 * Outgoing modifiers are read from the source side/current attacker. Incoming
 * reductions are read from the target side/current target.
 */
export function getApplicableEffects(
  event: DamageEventContext,
  battleState: BattleReadState,
  transientEffects: readonly ActiveEffect[] = [],
): ApplicableDamageEffects {
  const source = sideFromState(battleState, event.sourceSide);
  const target = sideFromState(battleState, event.targetSide);
  const sourceTroop = source.troops[event.sourceTroop];
  const targetTroop = target.troops[event.targetTroop];
  const outgoingCandidates = overlayTransientEffects([
    ...source.armyEffects,
    ...sourceTroop.buffs,
    ...sourceTroop.debuffs,
  ], transientEffects, event.round);
  const incomingCandidates = overlayTransientEffects([
    ...target.armyEffects,
    ...targetTroop.buffs,
    ...targetTroop.debuffs,
  ], transientEffects, event.round);
  const outgoingIncreases: ActiveDamageModifierEffect[] = [];
  const incomingIncreases: ActiveIncomingDamageIncreaseEffect[] = [];
  const incomingReductions: ActiveDamageModifierEffect[] = [];
  const outgoingReductions: ActiveDamageModifierEffect[] = [];
  const defenseModifiers: ActiveDefenseModifierEffect[] = [];
  const baseDefenseMultipliers: ActiveBaseDefenseMultiplierEffect[] = [];
  const defenseReductions: ActiveDefenseReductionEffect[] = [];
  const directDamageCancellations: ActiveDirectDamageCancellationEffect[] = [];
  for (const effect of outgoingCandidates) {
    if (!isEffectActiveInRound(effect, event.round) ||
      !matchesEffectScope(effect.definition.scope, event)) continue;
    if (effect.definition.kind === "damageIncrease") outgoingIncreases.push(effect as ActiveDamageModifierEffect);
    else if (effect.definition.kind === "outgoingDamageReduction") outgoingReductions.push(effect as ActiveDamageModifierEffect);
  }
  for (const effect of incomingCandidates) {
    if (!isEffectActiveInRound(effect, event.round) ||
      !matchesEffectScope(effect.definition.scope, event)) continue;
    switch (effect.definition.kind) {
      case "incomingDamageIncrease": incomingIncreases.push(effect as ActiveIncomingDamageIncreaseEffect); break;
      case "damageReduction": incomingReductions.push(effect as ActiveDamageModifierEffect); break;
      case "defenseModifier": defenseModifiers.push(effect as ActiveDefenseModifierEffect); break;
      case "baseDefenseMultiplier": baseDefenseMultipliers.push(effect as ActiveBaseDefenseMultiplierEffect); break;
      case "defenseReduction": defenseReductions.push(effect as ActiveDefenseReductionEffect); break;
      case "directDamageCancellation": directDamageCancellations.push(effect as ActiveDirectDamageCancellationEffect); break;
      default: break;
    }
  }
  return {
    damageIncreases: [...outgoingIncreases, ...incomingIncreases],
    damageReductions: [...incomingReductions, ...outgoingReductions],
    defenseModifiers,
    baseDefenseMultipliers,
    defenseReductions,
    directDamageCancellations,
  };
}

export function matchesEffectScope(
  scope: EffectScope | undefined,
  event: DamageEventContext,
): boolean {
  if (scope === undefined) return true;
  return (
    includesOrAll(scope.sourceTroops, event.sourceTroop) &&
    includesOrAll(scope.targetTroops, event.targetTroop) &&
    includesOrAll(scope.damageTypes, event.damageType) &&
    includesOrAll(scope.damageSubtypes, event.damageSubtype)
  );
}

function includesOrAll<T>(values: readonly T[] | undefined, value: T): boolean {
  return values === undefined || values.includes(value);
}

/**
 * A same-action reapplication has not yet been committed to BattleState. An
 * immediately active instance replaces the persisted copy for this event, or
 * one replace/refresh would be counted twice. A next-round instance coexists
 * until activation so it cannot erase the still-valid current-round status.
 */
function overlayTransientEffects(
  persisted: readonly ActiveEffect[],
  transient: readonly ActiveEffect[],
  round: number,
): readonly ActiveEffect[] {
  if (transient.length === 0) return persisted;
  const replacingIds = new Set(transient
    .filter((effect) => effect.activeFromRound <= round)
    .map((effect) => effect.instanceId));
  return [
    ...persisted.filter((effect) => !replacingIds.has(effect.instanceId)),
    ...transient,
  ];
}
