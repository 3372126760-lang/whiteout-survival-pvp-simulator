import type { TroopType } from "../../types";
export type Triple = readonly [number, number, number];
export interface CriterionFlags { probabilityApproximation: boolean; roundSkillApproximation: boolean; targetRedirect: boolean; hardToStaticize: boolean; }
export interface AttackChannel {
  readonly source: number;
  readonly kind: "normalAttack" | "skillDamage" | "extraDamage" | "additionalAttack";
  readonly coefficient: number;
  readonly target: "priority" | "current" | "all" | "random" | number;
  readonly markAggregationKey?: string;
  readonly firstSourcePremium?: number;
  readonly priority?: readonly number[];
  /** Redirect only the main channel; extra channels never consume main probability. */
  readonly redirectProbability?: number;
  readonly redirectPriority?: readonly number[];
}
export interface CriterionSide {
  readonly counts: Triple;
  readonly hp: Triple;
  /** Unit normal/skill damage to each defender type, from official numeric functions. */
  readonly normal: readonly number[];
  readonly skill: readonly number[];
  readonly channels: readonly AttackChannel[];
  readonly priorities: readonly (readonly number[])[];
  readonly uncertainty: number;
  readonly flags: CriterionFlags;
  readonly omittedMechanisms: readonly string[];
}
export interface CriterionTemplate { readonly a: CriterionSide; readonly b: CriterionSide; }
export type CriterionCounts = Readonly<Record<TroopType, number>>;
export interface CriterionBattleResult {
  readonly predictedWinner: "A" | "B" | "draw" | "unresolved";
  readonly margin: number;
  readonly estimatedBattleTime: number;
  readonly aRemaining: CriterionCounts;
  readonly bRemaining: CriterionCounts;
  readonly lifetimeOutputPotentialA: number;
  readonly lifetimeOutputPotentialB: number;
  readonly frontlineProtectionValue: readonly [number, number];
  readonly rearExposureLoss: readonly [number, number];
  readonly crossTargetDamageShare: number;
  readonly uncertainty: number;
  readonly flags: CriterionFlags;
  readonly eventCount: number;
  readonly omittedMechanisms: readonly string[];
}
