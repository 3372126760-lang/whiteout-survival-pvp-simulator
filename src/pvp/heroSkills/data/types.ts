import type { TroopType } from "../../types/combat";

export type ExpeditionHeroRarity = "R" | "SR" | "SSR";

export interface ExclusiveWeaponData {
  readonly maxPenetrationBonus: number;
  readonly maxLifeBonus: number;
  /** Skill definition ids are resolved by the shared hero skill system. */
  readonly skillDefinitionIds: readonly string[];
  /** Missing tiers are deliberately unknown and must not be interpolated. */
  readonly knownSkillValues: Readonly<
    Record<string, Readonly<Partial<Record<1 | 2 | 3 | 4 | 5, number>>>>
  >;
}

export interface ExpeditionHeroStats {
  readonly troopType: TroopType;
  readonly attackBonus: number;
  readonly defenseBonus: number;
  readonly penetrationBonus: number;
  readonly lifeBonus: number;
}

export interface ExpeditionSkillRecord {
  readonly id: string;
  readonly name: string;
  readonly expeditionSkillSlot: 1 | 2 | 3;
  /** Only confirmed expedition levels are present; missing levels are not guessed. */
  readonly levelValues: Readonly<Partial<Record<1 | 2 | 3 | 4 | 5, number>>>;
  readonly combatRelevant: boolean;
  readonly combatSkillDefinitionId?: string;
  readonly description: string;
}

export interface ExpeditionHeroData {
  readonly id: string;
  readonly name: string;
  readonly rarity: ExpeditionHeroRarity;
  readonly stats: ExpeditionHeroStats;
  readonly generation?: number;
  readonly exclusiveWeapon?: ExclusiveWeaponData;
  /** Expedition-only data. Exploration stats and skills are intentionally absent. */
  readonly expeditionSkills: readonly ExpeditionSkillRecord[];
}
