export interface ExpeditionGenerationStats {
  readonly expeditionAttackDefenseBonus: number;
  readonly exclusiveWeaponMaxPenetrationLifeBonus: number;
}

/** Expedition/weapon progression stored as decimal bonuses; S12+ catalog values are provisional predictions, not battle-report evidence. */
export const EXPEDITION_GENERATION_STATS = {
  1: { expeditionAttackDefenseBonus: 2.0016, exclusiveWeaponMaxPenetrationLifeBonus: .55 },
  2: { expeditionAttackDefenseBonus: 2.4019, exclusiveWeaponMaxPenetrationLifeBonus: .60 },
  3: { expeditionAttackDefenseBonus: 2.9023, exclusiveWeaponMaxPenetrationLifeBonus: .70 },
  4: { expeditionAttackDefenseBonus: 3.7029, exclusiveWeaponMaxPenetrationLifeBonus: .925 },
  5: { expeditionAttackDefenseBonus: 4.4435, exclusiveWeaponMaxPenetrationLifeBonus: 1.11 },
  6: { expeditionAttackDefenseBonus: 5.4043, exclusiveWeaponMaxPenetrationLifeBonus: 1.335 },
  7: { expeditionAttackDefenseBonus: 6.5052, exclusiveWeaponMaxPenetrationLifeBonus: 1.605 },
  8: { expeditionAttackDefenseBonus: 7.8062, exclusiveWeaponMaxPenetrationLifeBonus: 1.93 },
  9: { expeditionAttackDefenseBonus: 9.4075, exclusiveWeaponMaxPenetrationLifeBonus: 2.32 },
  10: { expeditionAttackDefenseBonus: 11.1088, exclusiveWeaponMaxPenetrationLifeBonus: 2.775 },
  11: { expeditionAttackDefenseBonus: 12.8102, exclusiveWeaponMaxPenetrationLifeBonus: 3.20 },
  12: { expeditionAttackDefenseBonus: 14.5116, exclusiveWeaponMaxPenetrationLifeBonus: 3.625 },
  13: { expeditionAttackDefenseBonus: 16.2129, exclusiveWeaponMaxPenetrationLifeBonus: 4.05 },
  14: { expeditionAttackDefenseBonus: 17.9143, exclusiveWeaponMaxPenetrationLifeBonus: 4.475 },
  15: { expeditionAttackDefenseBonus: 19.6151, exclusiveWeaponMaxPenetrationLifeBonus: 4.90 },
  16: { expeditionAttackDefenseBonus: 21.3170, exclusiveWeaponMaxPenetrationLifeBonus: 5.325 },
} as const satisfies Readonly<Record<number, ExpeditionGenerationStats>>;

export const S1_JERONIMO_EXPEDITION_ATTACK_DEFENSE_BONUS = 2.602;
export const S1_JERONIMO_WEAPON_MAX_PENETRATION_LIFE_BONUS = .625;

/** Shared expedition scene-skill tier table for exclusive weapons. */
export const EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES = {
  1: .05,
  2: .075,
  3: .10,
  4: .125,
  5: .15,
} as const;

/** Backwards-compatible export; the tier table is not generation-specific. */
export const S1_WEAPON_SCENE_SKILL_VALUES =
  EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES;
