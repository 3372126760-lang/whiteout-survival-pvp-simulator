import type { DamageSubtype, DamageType, TroopType } from "./combat";

export const RULE_UNKNOWN = "RULE_UNKNOWN" as const;
export const TENTATIVE = "TENTATIVE" as const;
export type RuleStatus = "supported" | typeof RULE_UNKNOWN | typeof TENTATIVE;

export interface EffectScope {
  /** Omit a dimension to match every value in that dimension. */
  readonly sourceTroops?: readonly TroopType[];
  readonly targetTroops?: readonly TroopType[];
  readonly damageTypes?: readonly DamageType[];
  readonly damageSubtypes?: readonly DamageSubtype[];
}

export type EffectRefreshMode = "refresh" | "replace" | "stack";
export type EffectActivationTiming =
  | "immediate"
  | "nextAction"
  | "roundEnd"
  | "nextRound";
export type StackLimitBehavior = "keep" | "refreshDuration";

export interface EffectLifecycle {
  readonly durationRounds?: number;
  readonly activationTiming?: EffectActivationTiming;
  readonly refreshMode?: EffectRefreshMode;
  readonly maxStacks?: number;
  readonly atMaxStacks?: StackLimitBehavior;
  /** Period is meaningful only together with an explicit first trigger round. */
  readonly periodRounds?: number;
  /** First absolute round of a repeating active window. */
  readonly firstActiveRound?: number;
  /** Number of consecutive active rounds inside each period. */
  readonly activeWindowRounds?: number;
  /** Explicit absolute rounds, used by confirmed fixed-window effects. */
  readonly activeRounds?: readonly number[];
}

interface EffectDefinitionBase {
  readonly id: string;
  readonly name: string;
  readonly ruleStatus: RuleStatus;
  readonly scope?: EffectScope;
  readonly lifecycle?: EffectLifecycle;
}

export interface DamageModifierEffectDefinition extends EffectDefinitionBase {
  readonly kind: "damageIncrease" | "damageReduction" | "outgoingDamageReduction";
  /** Same group adds; distinct groups multiply. 0.2 means +20% in the group. */
  readonly group: string;
  readonly value: number;
}

export interface AttributeModifierEffectDefinition extends EffectDefinitionBase {
  readonly kind: "attributeModifier";
  readonly attribute: "attack" | "penetration" | "defense" | "life";
  /** Explicit so real skill wording is not guessed by the engine. */
  /** addToAttribute is a legacy data label; both values resolve as skill multipliers. */
  readonly operation: "addToAttribute" | "multiplyAttributeFactor";
  readonly group: string;
  readonly value: number;
}

/**
 * Reduces an enemy attribute factor. Same-group values add first, then the
 * already-buffed attribute factor is divided by `1 + groupSum`.
 */
export interface AttributeReductionEffectDefinition extends EffectDefinitionBase {
  readonly kind: "attributeReduction";
  readonly attribute: "attack" | "penetration" | "defense" | "life";
  readonly group: "enemyAttackReduction" | "enemyPenetrationReduction" | string;
  readonly value: number;
}

/**
 * An increase read from the target side, such as vulnerability or defense
 * reduction. It shares multiplier aggregation with outgoing damage increases
 * while keeping ownership and audit semantics explicit.
 */
export interface IncomingDamageIncreaseEffectDefinition
  extends EffectDefinitionBase {
  readonly kind: "incomingDamageIncrease";
  readonly group: string;
  readonly value: number;
}

/** Stored marker consumed by the hero runtime on the next eligible hit. */
export interface OneUseIncomingDamageIncreaseEffectDefinition
  extends EffectDefinitionBase {
  readonly kind: "oneUseIncomingDamageIncrease";
  readonly group: string;
  readonly value: number;
}

export interface DefenseModifierEffectDefinition extends EffectDefinitionBase {
  readonly kind: "defenseModifier";
  /** Added to the shared defense skill-bonus pool before normalization. */
  readonly group: string;
  readonly value: number;
}

/** Multiplies the source's base damage B before ordinary damage groups. */
export interface BaseDamageMultiplierEffectDefinition extends EffectDefinitionBase {
  readonly kind: "baseDamageMultiplier";
  readonly group: string;
  readonly value: number;
}

/** Sourced base-defense special divisor, separate from target defense attributes. */
export interface BaseDefenseMultiplierEffectDefinition extends EffectDefinitionBase {
  readonly kind: "baseDefenseMultiplier";
  readonly group: string;
  readonly value: number;
}


/** Defense-system reduction; deliberately distinct from vulnerability. */
export interface DefenseReductionEffectDefinition extends EffectDefinitionBase {
  readonly kind: "defenseReduction";
  readonly group: string;
  readonly value: number;
}

export interface DirectDamageCancellationEffectDefinition
  extends EffectDefinitionBase {
  readonly kind: "directDamageCancellation";
  /** Same group adds as D × (1 - sum); distinct groups multiply. */
  readonly group: string;
  readonly value: number;
}

export interface TargetingOverrideEffectDefinition extends EffectDefinitionBase {
  readonly kind: "targetingOverride";
  readonly priority: readonly TroopType[];
}

export interface TargetBoundMarkEffectDefinition extends EffectDefinitionBase {
  readonly kind: "targetBoundMark";
  readonly markId: string;
  /** Payload provenance, not stacks of the boolean marked-target condition. */
  readonly damageContributors?: readonly { readonly runtimeInstanceId: string; readonly coefficient: number }[];
  readonly additionalSourceCoefficient?: number;
}

/** A troop-stack status that skips its complete main action while active. */
export interface SkipNextRoundActionEffectDefinition extends EffectDefinitionBase {
  readonly kind: "skipNextRoundAction";
}

export type EffectDefinition =
  | DamageModifierEffectDefinition
  | IncomingDamageIncreaseEffectDefinition
  | OneUseIncomingDamageIncreaseEffectDefinition
  | AttributeModifierEffectDefinition
  | AttributeReductionEffectDefinition
  | DefenseModifierEffectDefinition
  | BaseDamageMultiplierEffectDefinition
  | BaseDefenseMultiplierEffectDefinition
  | DefenseReductionEffectDefinition
  | DirectDamageCancellationEffectDefinition
  | TargetingOverrideEffectDefinition
  | TargetBoundMarkEffectDefinition
  | SkipNextRoundActionEffectDefinition;

export interface ActiveEffectIdentity {
  readonly sourceId: string;
  readonly sourceSkillId: string;
  readonly effectId: string;
}

export interface ActiveEffect {
  readonly instanceId: string;
  readonly identity: ActiveEffectIdentity;
  readonly definition: EffectDefinition;
  readonly stackCount: number;
  readonly applicationCount: number;
  readonly appliedRound: number;
  readonly activeFromRound: number;
  readonly remainingRounds?: number;
  /** Storage location; omitted for legacy effects whose scope implies it. */
  readonly holderScope?: "army" | TroopType;
}

export type ActiveDamageModifierEffect = ActiveEffect & {
  readonly definition: DamageModifierEffectDefinition;
};

export type ActiveIncomingDamageIncreaseEffect = ActiveEffect & {
  readonly definition: IncomingDamageIncreaseEffectDefinition;
};

export type ActiveTargetingOverrideEffect = ActiveEffect & {
  readonly definition: TargetingOverrideEffectDefinition;
};

export type ActiveAttributeModifierEffect = ActiveEffect & {
  readonly definition: AttributeModifierEffectDefinition;
};

export type ActiveAttributeReductionEffect = ActiveEffect & {
  readonly definition: AttributeReductionEffectDefinition;
};

export type ActiveDefenseModifierEffect = ActiveEffect & {
  readonly definition: DefenseModifierEffectDefinition;
};

export type ActiveBaseDamageMultiplierEffect = ActiveEffect & {
  readonly definition: BaseDamageMultiplierEffectDefinition;
};

export type ActiveBaseDefenseMultiplierEffect = ActiveEffect & {
  readonly definition: BaseDefenseMultiplierEffectDefinition;
};

export type ActiveDefenseReductionEffect = ActiveEffect & {
  readonly definition: DefenseReductionEffectDefinition;
};

export type ActiveDirectDamageCancellationEffect = ActiveEffect & {
  readonly definition: DirectDamageCancellationEffectDefinition;
};
