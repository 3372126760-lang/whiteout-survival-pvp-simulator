import type { PetExternalBuffConfig } from "../externalBuffs/types";
import type { TroopType } from "../types/combat";
import type { ValidationQueueAttributes, ValidationReportBonusMatrix } from "../validationUi/types";
import type { ParsedBattleReportSide } from "../battleReportRecognition/types";
import type { RallyTroopRatios } from "../validationUi/rallyDeployment";

export const INNER_EARTH_MODES = ["HEART_OF_EARTH", "HERO_LAND", "BEAST_CAVE",
  "GEM_MINE", "UNDERGROUND_LAB", "EQUIPMENT_FORGE"] as const;
export type InnerEarthMode = typeof INNER_EARTH_MODES[number];
export const INNER_EARTH_ENEMY_PRESETS = ["BALANCED", "SHIELD_HEAVY"] as const;
export type InnerEarthEnemyRatioPreset = typeof INNER_EARTH_ENEMY_PRESETS[number];
export type InnerEarthHeroMap = Readonly<Partial<Record<TroopType, string | null>>>;
export interface InnerEarthReportHistory {
  readonly reportAttributes: ValidationQueueAttributes;
  readonly bonuses: ValidationReportBonusMatrix;
  readonly recognizedSpecialBonuses?: ParsedBattleReportSide["specialBonuses"];
}
export interface InnerEarthAllyQueue {
  readonly reportHistory?: InnerEarthReportHistory;
  readonly heroes: InnerEarthHeroMap;
  /** The lineup already contained in base stats; candidate heroes can change independently. */
  readonly reportHeroes?: InnerEarthHeroMap;
  readonly ratio: RallyTroopRatios;
  readonly expectedReportStats: ValidationQueueAttributes;
  readonly skillLevels?: Readonly<Record<string, number>>;
  readonly weaponLevels?: Readonly<Record<string, number>>;
  /** Fixed weapon baseline represented in entered stats; search only replaces weaponLevels. */
  readonly reportWeaponLevels?: Readonly<Record<string, number>>;
}
export interface InnerEarthConfig {
  readonly subMode: InnerEarthMode;
  readonly ally: {
    readonly reportHistory?: InnerEarthReportHistory;
    readonly shared: { readonly capacity: number };
    readonly queues: readonly [InnerEarthAllyQueue, InnerEarthAllyQueue, InnerEarthAllyQueue];
    readonly counts: Readonly<Record<TroopType, number>>;
    readonly reportStats: ValidationQueueAttributes;
    /** Ordinary game level IDs in Heart; LAB_T11/LAB_T12 exist only in the laboratory. */
    readonly troopTiers: Readonly<Record<TroopType, string>>;
    readonly t12SkillLevels: Readonly<Record<TroopType, number>>;
  };
  readonly enemy: {
    readonly shared: {
      readonly reportHistory?: InnerEarthReportHistory;
      readonly capacity: number;
      readonly troopRatioPreset: InnerEarthEnemyRatioPreset;
      readonly expectedReportStats: ValidationQueueAttributes;
    };
    readonly queues: readonly [{ readonly heroes: InnerEarthHeroMap },
      { readonly heroes: InnerEarthHeroMap }, { readonly heroes: InnerEarthHeroMap }];
  };
  /** Combat skills only. March-capacity pets deliberately have no field in this schema. */
  readonly petContext?: PetExternalBuffConfig;
}
export interface InnerEarthModeRule {
  readonly mode: InnerEarthMode;
  readonly label: string;
  readonly inputMode: "prediction" | "finalReport";
  readonly heroMode: "threeQueues" | "empty";
  readonly troopTierMode: "player" | "fixedT10" | "laboratory";
  readonly allowPet: boolean;
  readonly allowExpert: false;
  readonly allowDrug: false;
  readonly allowFireCrystalSkill: boolean;
  readonly allowT12Skill: boolean;
  readonly t12SkillMaxLevel: number;
  readonly allyCapacity: number | null;
  readonly enemyCapacityMode: "userInput" | "fixed150000";
  readonly enemyRatioPresets: readonly InnerEarthEnemyRatioPreset[];
  readonly searchDimensions: readonly ("head" | "ratio")[];
  readonly battleScheduler: "RandomAliveQueueScheduler" | "SingleBattle";
}
