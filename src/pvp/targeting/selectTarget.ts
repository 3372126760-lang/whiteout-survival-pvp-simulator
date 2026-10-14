import {
  DEFAULT_TARGET_PRIORITY,
} from "../constants/targeting";
import { createActiveEffect, isEffectActiveInRound } from "../effects";
import { LANCER_AMBUSH_SKILL_DEFINITION } from "../troopSkills/definitions/lancer";
import { TROOP_TYPES, type SideId, type TroopType } from "../types/combat";
import { sideFromState, type BattleReadState } from "../types/battle";
import type {
  ActiveEffect,
  ActiveTargetingOverrideEffect,
  RuleStatus,
} from "../types/effect";

export const LANCER_SURPRISE_TRIGGER_RULE_STATUS: RuleStatus = "supported";

export interface SelectTargetResult {
  readonly targetTroop: TroopType | null;
  readonly priority: readonly TroopType[];
  readonly targetingEffectInstanceId: string | null;
}

/**
 * Selects the first living target. Conflicting overrides fail loudly because
 * precedence between future targeting skills is not yet a confirmed rule.
 */
export function selectTarget(
  attackerType: TroopType,
  battleState: BattleReadState,
  targetSide: SideId,
  targetingEffects: readonly ActiveEffect[] = [],
): SelectTargetResult {
  const applicable = targetingEffects.filter(
    (effect): effect is ActiveTargetingOverrideEffect =>
      effect.definition.kind === "targetingOverride" &&
      isEffectActiveInRound(effect, battleState.round) &&
      (effect.definition.scope?.sourceTroops === undefined ||
        effect.definition.scope.sourceTroops.includes(attackerType)),
  );
  const uniquePriorities = new Map<string, ActiveTargetingOverrideEffect>();
  for (const effect of applicable) {
    validatePriority(effect.definition.priority);
    uniquePriorities.set(effect.definition.priority.join("|"), effect);
  }
  if (uniquePriorities.size > 1) {
    throw new Error(
      "Conflicting targeting overrides require an explicit precedence rule (RULE_UNKNOWN).",
    );
  }
  const selectedOverride = [...uniquePriorities.values()][0];
  const priority = selectedOverride?.definition.priority ?? DEFAULT_TARGET_PRIORITY;
  const defender = sideFromState(battleState, targetSide);
  return {
    targetTroop:
      priority.find((troop) => defender.troops[troop].aliveCount > 0) ?? null,
    priority,
    targetingEffectInstanceId: selectedOverride?.instanceId ?? null,
  };
}

/**
 * Creates the already-triggered lancer surprise override for the legacy
 * debug switch. Production skill mode rolls the confirmed T7/20% rule.
 */
export function createActivatedLancerSurpriseEffect(
  sourceId: string,
  sourceSkillId: string,
  appliedRound: number,
): ActiveEffect {
  const template = LANCER_AMBUSH_SKILL_DEFINITION.levelValues[1]?.effects.find(
    (effect) => effect.kind === "targetingOverride",
  );
  if (template?.kind !== "targetingOverride") {
    throw new Error("Lancer ambush targeting definition is missing.");
  }
  return createActiveEffect({
    identity: {
      sourceId,
      sourceSkillId,
      effectId: template.id,
    },
    definition: {
      id: template.id,
      name: template.name,
      kind: "targetingOverride",
      ruleStatus: "supported",
      scope: { sourceTroops: ["lancer"] },
      priority: template.priority,
      ...(template.lifecycle === undefined
        ? {}
        : { lifecycle: template.lifecycle }),
    },
    appliedRound,
  });
}

function validatePriority(priority: readonly TroopType[]): void {
  if (
    priority.length !== TROOP_TYPES.length ||
    new Set(priority).size !== TROOP_TYPES.length ||
    TROOP_TYPES.some((troop) => !priority.includes(troop))
  ) {
    throw new Error("Targeting priority must be a permutation of all troop types.");
  }
}
