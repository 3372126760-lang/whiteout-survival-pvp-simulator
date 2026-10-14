import type { ActiveEffect } from "./effect";
import type { RuleStatus } from "./effect";
import type { TroopType } from "./combat";
import type { TroopSkillRuntimeState } from "../troopSkills/types";
import type { GatotShieldCalculation } from "../heroSkills/gatotShield";
import type { ExpectedReportAttributeInput } from "../validationUi/expectedReportAttribute";

/** Reusable, event-ordered shield layer. It is separate from troop HP. */
export interface TemporaryShieldLayer {
  readonly id: string;
  readonly sourceSkillId: string;
  readonly sourceHeroId: string;
  readonly sourceRuntimeInstanceId?: string;
  readonly ruleStatus: RuleStatus;
  readonly rawDamageBasis?: number;
  readonly gatotShield?: GatotShieldCalculation;
  readonly generatedShieldHp: number;
  readonly remainingShieldHp: number;
  readonly generatedRound: number;
  readonly generatedActionOrder: number;
  readonly activeFromRound: number;
  readonly expiresAfterRound: number;
}

/** Level data has no independent report or hero attributes. */
export interface TroopLevelData {
  readonly id: string;
  readonly troopConstant: number;
}

export interface TroopTypeData {
  readonly damageCoefficient: number;
  readonly lifeCoefficient: number;
}

/** Report/hero attributes, independent of troop level data. */
export interface TroopAttributes {
  /** Decimal form: 0.25 means +25%. */
  readonly attack: number;
  readonly penetration: number;
  readonly defense: number;
  readonly life: number;
}

export interface TroopCombatData {
  readonly troopLevel: string;
  readonly damageCoefficient: number;
  readonly troopConstant: number;
  readonly troopHpCoefficient: number;
  /** troopConstant * troopHpCoefficient, before life stats. */
  readonly baseHpPerUnit: number;
  /** Effective HP from base HP and applicable life stats; defense affects damage instead. */
  readonly maxHpPerUnit: number;
}

/** One level's current population inside a single troop stack. */
export interface TroopLevelCompositionEntry {
  readonly level: string;
  readonly aliveCount: number;
}

export interface TroopState extends TroopAttributes, TroopCombatData {
  /** Immutable pre-weapon report construction inputs; permits one summed external group. */
  readonly reportAttributeContext?: Readonly<Record<keyof TroopAttributes, ExpectedReportAttributeInput>>;
  readonly type: TroopType;
  readonly initialCount: number;
  readonly aliveCount: number;
  /** Always sums to aliveCount. Levels do not act as separate stacks. */
  readonly levelComposition: readonly TroopLevelCompositionEntry[];
  /** Immutable original weights, retained across rounds and template clones. */
  readonly initialLevelComposition: readonly TroopLevelCompositionEntry[];
  readonly frontUnitHp: number;
  /** Sum of all currently stored reusable temporary-shield layers. */
  readonly temporaryShieldHp: number;
  readonly temporaryShields: readonly TemporaryShieldLayer[];
  readonly buffs: readonly ActiveEffect[];
  readonly debuffs: readonly ActiveEffect[];
  readonly skillStates: readonly TroopSkillRuntimeState[];
}

export interface TroopSetup extends TroopAttributes {
  readonly reportAttributeContext?: TroopState["reportAttributeContext"];
  readonly count: number;
  readonly troopLevel: string;
  readonly troopConstant: number;
  /** Optional mixed-level composition. Its sum must equal count. */
  readonly levelComposition?: readonly TroopLevelCompositionEntry[];
  /** Custom fixture override only; canonical game levels use the fixed type data. */
  readonly troopHpCoefficient?: number;
  /** Custom fixture override only; canonical game levels use the fixed type data. */
  readonly damageCoefficient?: number;
  readonly buffs?: readonly ActiveEffect[];
  readonly debuffs?: readonly ActiveEffect[];
  readonly skillStates?: readonly TroopSkillRuntimeState[];
}
