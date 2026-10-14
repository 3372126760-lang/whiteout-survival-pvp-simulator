/**
 * Semantic skill-attribute groups. Defense is an attribute factor, not an
 * independent damage reduction.
 * All four buff groups multiply the immutable panel factor.
 */
export const SKILL_ATTRIBUTE_MULTIPLIER_GROUPS = {
  skillAttackMultiplier: "heroAttackBonus",
  skillPenetrationMultiplier: "heroPenetrationBonus",
  skillDefenseMultiplier: "heroDefenseBonus",
  skillLifeMultiplier: "heroLifeBonus",
} as const;

/** Reduction groups divide the already-buffed attribute factor. */
export const SKILL_ATTRIBUTE_REDUCTION_GROUPS = {
  skillAttackReduction: "enemyAttackReduction",
  skillPenetrationReduction: "enemyPenetrationReduction",
  skillDefenseReduction: "enemyDefenseReduction",
  skillLifeReduction: "skillLifeReduction",
} as const;
