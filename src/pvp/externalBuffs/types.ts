import type { TroopType } from "../types/combat";

export type TownBuffSize = "none" | "small" | "large";
export type ReportAttribute = "attack" | "defense" | "penetration" | "life";

export interface TownExternalBuffConfig {
  readonly attack: TownBuffSize;
  readonly defense: TownBuffSize;
  readonly penetration: TownBuffSize;
  readonly life: TownBuffSize;
  readonly enemyAttackReduction: TownBuffSize;
  readonly enemyDefenseReduction: TownBuffSize;
}

export interface PetExternalBuffConfig {
  readonly attackLevel: number;
  readonly defenseLevel: number;
  readonly penetrationLevel: number;
  readonly lifeLevel: number;
  readonly enemyDefenseReductionLevel: number;
  readonly enemyPenetrationReductionLevel: number;
  readonly enemyLifeReductionLevel: number;
}

export interface ExpertExternalBuffConfig {
  readonly garethFourthSkillLevel: number;
}

export interface ExternalBuffConfig {
  readonly town: TownExternalBuffConfig;
  readonly pet: PetExternalBuffConfig;
  readonly expert: ExpertExternalBuffConfig;
}

export type ReportAttributeValues = Readonly<Record<ReportAttribute, number>>;

export interface ReportBonusSource {
  readonly id: string;
  readonly label: string;
  readonly attribute: ReportAttribute;
  /** Decimal bonus/reduction: .1 means 10%. */
  readonly value: number;
}

export interface ResolvedExternalBuffs {
  readonly selfBuffs: ReportAttributeValues;
  readonly enemyDebuffs: ReportAttributeValues;
  readonly selfBuffSources: readonly ReportBonusSource[];
  readonly enemyDebuffSources: readonly ReportBonusSource[];
}

export interface BattleReportAttributeModifiers {
  readonly selfBuffs: ReportAttributeValues;
  readonly receivedDebuffs: ReportAttributeValues;
}

export interface ResolvedReportAttributeBonus {
  readonly baseBonus: number;
  readonly additiveBonus: number;
  readonly specialBuff: number;
  readonly specialDebuff: number;
  readonly numeratorFactor: number;
  readonly divisionFactor: number;
  readonly finalBonus: number;
}

export type ExpectedReportBonuses = Readonly<
  Record<TroopType, ReportAttributeValues>
>;
