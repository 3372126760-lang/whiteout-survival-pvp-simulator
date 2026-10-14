import type { DamageType, SideId, TroopType } from "../types/combat";
import type { EffectLifecycle, RuleStatus } from "../types/effect";

export type TroopSkillTrigger =
  | "passive"
  | "roundStart"
  | "beforeAttack"
  | "beforeDamage"
  | "onAttack"
  | "afterNormalAttack"
  | "afterDamage"
  | "roundEnd";

export type TroopSkillSourceScope = "army" | "self" | TroopType;
export type TroopSkillTargetScope = "all" | "currentTarget" | TroopType;
export type TroopSkillDamageScope = "all" | DamageType;

export interface TroopSkillEffectScope {
  readonly source: TroopSkillSourceScope;
  readonly target?: TroopSkillTargetScope;
  readonly damageType?: TroopSkillDamageScope;
  /** For defensive effects: the enemy troop producing the incoming event. */
  readonly incomingSourceTroop?: TroopType;
}

export type TroopSkillUnlockCondition =
  | { readonly kind: "always" }
  | {
      readonly kind: "troopLevel";
      /** Kept as data: troop-level ordering is not inferred by the engine. */
      readonly requiredLevel: string;
      readonly ruleStatus: RuleStatus;
    };

interface TroopSkillEffectBase {
  readonly id: string;
  readonly name: string;
  readonly scope: TroopSkillEffectScope;
  readonly lifecycle?: EffectLifecycle;
}

export interface TroopSkillDamageModifierEffect
  extends TroopSkillEffectBase {
  readonly kind: "damageIncrease" | "damageReduction" | "baseDamageMultiplier" | "baseDefenseMultiplier";
  readonly group: string;
  readonly value: number;
  /** A passive contribution applied only when the linked skill triggers. */
  readonly linkedToSkillId?: string;
}

export interface TroopSkillAttributeModifierEffect
  extends TroopSkillEffectBase {
  readonly kind: "attributeModifier";
  readonly attribute: "attack" | "penetration" | "defense" | "life";
  readonly operation: "addToAttribute" | "multiplyAttributeFactor";
  readonly group: string;
  readonly value: number;
}

export interface TroopSkillDefenseModifierEffect extends TroopSkillEffectBase {
  readonly kind: "defenseModifier";
  readonly group: string;
  readonly value: number;
}

export interface TroopSkillDirectCancellationEffect
  extends TroopSkillEffectBase {
  readonly kind: "directDamageCancellation";
  readonly group: string;
  readonly value: number;
  readonly linkedToSkillId?: string;
}

export interface TroopSkillSameAttackSegmentEffect extends TroopSkillEffectBase {
  readonly kind: "sameMainAttackSegment";
  readonly segmentCount: 1;
  readonly damageScale: number;
  readonly inheritTarget: true;
  readonly suppressTriggerChain: true;
}

export interface TroopSkillTargetingOverrideEffect
  extends TroopSkillEffectBase {
  readonly kind: "targetingOverride";
  readonly priority: readonly TroopType[];
}

export interface TroopSkillExtraDamageEffect extends TroopSkillEffectBase {
  readonly kind: "extraDamage";
  readonly coefficient: number;
  readonly basis:
    | "parentBaseDamage"
    | "parentRawDamage"
    | "parentModifiedDamage"
    | "parentFinalDamage";
}

/** Adds to one linked skill event before that event is rounded or attributed. */
export interface TroopSkillExtraDamageContribution extends TroopSkillEffectBase {
  readonly kind: "extraDamageContribution";
  readonly linkedToSkillId: string;
  readonly coefficient: number;
}

export type TroopSkillEffect =
  | TroopSkillDamageModifierEffect
  | TroopSkillAttributeModifierEffect
  | TroopSkillDefenseModifierEffect
  | TroopSkillDirectCancellationEffect
  | TroopSkillTargetingOverrideEffect
  | TroopSkillExtraDamageEffect
  | TroopSkillExtraDamageContribution
  | TroopSkillSameAttackSegmentEffect;

export interface TroopSkillLevelValue {
  readonly versionLabel?: string;
  readonly unlockCondition?: TroopSkillUnlockCondition;
  /** Overrides the definition-level probability when present. */
  readonly probability?: number;
  readonly durationRounds?: number;
  readonly cooldownRounds?: number;
  readonly periodRounds?: number;
  /** Required with periodRounds so the periodic phase is explicit. */
  readonly periodStartRound?: number;
  readonly effects: readonly TroopSkillEffect[];
}

export interface TroopSkillDefinition {
  readonly id: string;
  readonly name: string;
  /** One concise, user-facing description shared by UI and BattleTrace. */
  readonly uiSummary?: string;
  readonly troopType: TroopType;
  readonly unlockCondition: TroopSkillUnlockCondition;
  readonly trigger: TroopSkillTrigger;
  readonly probability?: number;
  readonly durationRounds?: number;
  readonly cooldownRounds?: number;
  readonly levelValues: Readonly<Record<number, TroopSkillLevelValue>>;
  readonly metadata: {
    readonly ruleStatus: RuleStatus;
    readonly description?: string;
    /** Missing probability never silently calls RNG when this is true. */
    readonly requiresExplicitTriggerOverride?: boolean;
    readonly tags?: readonly string[];
  };
}

export interface TroopSkillRuntimeState {
  readonly skillId: string;
  readonly level: number;
  readonly enabled: boolean;
  readonly stacks: number;
  readonly remainingDuration: number;
  readonly cooldown: number;
  readonly lastTriggeredRound: number | null;
  readonly triggerCount: number;
}

export interface TroopSkillLifecycleChange {
  readonly effectId: string;
  readonly mode: "create" | "stack" | "refresh" | "replace" | "expire";
  readonly previousStacks: number;
  readonly nextStacks: number;
  readonly previousRemainingRounds?: number;
  readonly nextRemainingRounds?: number;
}

export interface TroopSkillTraceEntry {
  readonly round: number;
  readonly side: SideId;
  readonly troop: TroopType;
  readonly skillId: string;
  readonly skillName: string;
  readonly uiSummary: string;
  readonly level: number;
  readonly skillVersion: string;
  readonly trigger: TroopSkillTrigger;
  readonly checked: true;
  readonly eligible: boolean;
  readonly triggered: boolean;
  readonly probability: number | null;
  readonly rngRoll: number | null;
  readonly reason: string;
  readonly producedActiveEffectIds: readonly string[];
  readonly producedDamageEventIds: readonly string[];
  readonly targetingChanged: boolean;
  readonly lifecycleChanges: readonly TroopSkillLifecycleChange[];
  readonly parentEventId?: string;
  /** Permanent T12 stacks currently active in this round, if applicable. */
  readonly currentStacks?: number;
  readonly currentBonus?: number;
  /** Defensive trigger inheritance is not a new probability check. */
  readonly inheritedFromRootEventId?: string;
  /** Reported effect-use segments for this decision; not RNG/combat triggerCount. */
  readonly reportActivationCount?: number;
}

/** Additional report usage inherited from a cached proc, without a new check. */
export interface TroopSkillReportActivation {
  readonly side: SideId;
  readonly troop: TroopType;
  readonly skillId: string;
  readonly count: number;
  readonly inheritedFromRootEventId: string;
  readonly damageEventId: string;
}

export type TroopSkillTriggerOverrideKey =
  | string
  | `${SideId}:${string}`
  | `${SideId}:${TroopType}:${string}`;

export type TroopSkillTriggerOverrides = Readonly<
  Record<TroopSkillTriggerOverrideKey, boolean>
>;
