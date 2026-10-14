import type { HeroSkillDefinition } from "./types";

/** Membership is explicit in definitions. This registry verifies its semantics;
 * being in the vulnerability group or reusing a template never grants membership. */
export const PROC_EFFECT_FAMILIES = {
  "miya-doom-entanglement-family": {
    value: .5, durationRounds: 1, activationTiming: "nextRound", refreshMode: "replace",
  },
} as const;

export function validateProcEffectFamily(definition: HeroSkillDefinition): void {
  const familyId = definition.procEffectFamilyId;
  if (familyId === undefined) return;
  const family = PROC_EFFECT_FAMILIES[familyId as keyof typeof PROC_EFFECT_FAMILIES];
  if (!family || definition.metadata.ruleStatus !== "supported" ||
    definition.trigger !== "beforeAttack" || definition.triggerTiming !== undefined ||
    definition.actionMechanic !== undefined ||
    !definition.metadata.tags?.includes("hitTargetTroop")) {
    throw new Error(`Unconfirmed or incompatible procEffectFamilyId: ${familyId}`);
  }
  for (const level of Object.values(definition.levelValues)) {
    const effect = level.effects[0];
    if (level.effects.length !== 1 || effect?.kind !== "incomingDamageIncrease" ||
      effect.recipient !== "enemyArmy" || effect.group !== "vulnerability" ||
      effect.value !== family.value || effect.scope.source !== "army" ||
      effect.scope.target !== "currentTarget" || effect.scope.damageType !== "all" ||
      effect.lifecycle?.activationTiming !== family.activationTiming ||
      effect.lifecycle.durationRounds !== family.durationRounds ||
      effect.lifecycle.refreshMode !== family.refreshMode) {
      throw new Error(`Effect does not match confirmed procEffectFamilyId: ${familyId}`);
    }
  }
}
