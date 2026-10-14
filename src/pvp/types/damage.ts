import type {
  DamageSubtype,
  DamageType,
  SideId,
  TroopType,
} from "./combat";
import type { EffectScope } from "./effect";

export interface DamageEventContext {
  readonly sourceSide: SideId;
  readonly sourceTroop: TroopType;
  readonly targetSide: SideId;
  readonly targetTroop: TroopType;
  readonly damageType: DamageType;
  readonly damageSubtype: DamageSubtype;
  readonly round: number;
  readonly actionOrder: number;
}

export interface DamageEventInput extends DamageEventContext {
  readonly id: string;
  /** Damage before scoped increase and reduction groups. */
  readonly baseDamage: number;
  readonly sourceSkillId?: string;
  readonly parentEventId?: string;
  readonly rootEventId?: string;
  readonly depth?: number;
  /** Second segment of the same main attack; never an independent event/proc. */
  readonly sameMainAttackSegment?: boolean;
  /** Basis used by a derived event, for event-level auditing. */
  readonly damageBasis?: "parentBaseDamage" | "parentRawDamage" | "parentModifiedDamage" | "parentFinalDamage";
  /** Coefficient against the documented damage basis, before skill pooling. */
  readonly skillCoefficient?: number;
  readonly skillPoolComponents?: readonly {
    readonly id: string;
    readonly sourceSkillId: string;
    readonly coefficient: number;
    readonly baseDamage: number;
  }[];
  /** Attribute effects already included in this event's base-damage formula. */
  readonly baseDamageAttributeEffects?: readonly AppliedAttributeEffect[];
  /** Full attribute audit records used by the base-damage formula. */
  readonly attributeResolutions?: readonly AttributeResolutionTrace[];
  readonly baseDamageFormula?: BaseDamageFormulaTrace;
}

export interface BaseDamageFormulaTrace {
  readonly fixedInitialMinTroops: number;
  readonly aliveCount: number;
  readonly fixedInitialCountFactor: number;
  readonly aliveCountFactor: number;
  readonly damageCoefficient: number;
  readonly troopConstant: number;
  readonly penetrationMultiplier: number;
  readonly attackMultiplier: number;
  readonly baseDamageMultiplier?: number;
  readonly specialGroups?: readonly MultiplierGroupResult[];
}

export interface MultiplierGroupResult {
  readonly group: string;
  readonly summedValue: number;
  readonly multiplier: number;
  readonly effectInstanceIds: readonly string[];
}

export interface AppliedDamageEffect {
  readonly instanceId: string;
  readonly effectId: string;
  readonly effectName: string;
  readonly sourceId: string;
  readonly sourceSkillId: string;
  readonly effectKind:
    | "damageIncrease"
    | "damageReduction"
    | "outgoingDamageReduction"
    | "incomingDamageIncrease"
    | "defenseModifier"
    | "baseDefenseMultiplier"
    | "defenseReduction"
    | "directDamageCancellation";
  readonly group: string;
  readonly valuePerStack: number;
  readonly stackCount: number;
  readonly effectiveValue: number;
  readonly scope?: EffectScope;
}

export interface AppliedAttributeEffect {
  readonly instanceId: string;
  readonly effectId: string;
  readonly effectName: string;
  readonly sourceId: string;
  readonly sourceSkillId: string;
  readonly attribute: "attack" | "penetration" | "defense" | "life";
  readonly operation: "addToAttribute" | "multiplyAttributeFactor";
  readonly group: string;
  readonly valuePerStack: number;
  readonly stackCount: number;
  readonly effectiveValue: number;
}

export interface AttributeReductionGroupResult {
  readonly group: string;
  readonly summedValue: number;
  readonly divisionFactor: number;
  readonly effectInstanceIds: readonly string[];
}

export interface AttributeResolutionTrace {
  readonly attribute: "attack" | "penetration" | "defense";
  readonly baseAttribute: number;
  readonly buffedAttribute: number;
  readonly modifierGroups: readonly {
    readonly group: string;
    readonly operation: "addToAttribute" | "addToExternalBuff" | "multiplyAttributeFactor";
    readonly summedValue: number;
    readonly multiplier: number;
    readonly effectInstanceIds: readonly string[];
  }[];
  readonly reductionGroups: readonly AttributeReductionGroupResult[];
  readonly divisionFactor: number;
  readonly finalAttribute: number;
}

export interface DamageEvent extends DamageEventInput {
  /** Main normal-hit result before same-attack internal segments are merged. */
  readonly primaryRoundedDamage?: number;
  readonly mainHitCancelled?: boolean;
  readonly baseDamageAttributeEffects: readonly AppliedAttributeEffect[];
  readonly rootEventId: string;
  readonly depth: number;
  readonly increaseGroups: readonly MultiplierGroupResult[];
  readonly defenseReductionGroups: readonly MultiplierGroupResult[];
  readonly reductionGroups: readonly MultiplierGroupResult[];
  readonly directCancellationGroups: readonly MultiplierGroupResult[];
  readonly appliedIncreaseEffects: readonly AppliedDamageEffect[];
  readonly appliedReductionEffects: readonly AppliedDamageEffect[];
  readonly appliedDefenseReductionEffects: readonly AppliedDamageEffect[];
  readonly appliedDefenseEffects: readonly AppliedDamageEffect[];
  readonly appliedDirectCancellationEffects: readonly AppliedDamageEffect[];
  readonly increaseMultiplier: number;
  /** Target defense-system reduction, multiplied into outgoing damage. */
  readonly defenseReductionMultiplier: number;
  /** Incoming damage is divided by this value. */
  readonly reductionMultiplier: number;
  /** Applied target-side received-damage sources; already scope-filtered. */
  readonly receivedDamageReductionSources: readonly AppliedDamageEffect[];
  readonly receivedDamageReductionTotal: number;
  readonly receivedDamageReductionDenominator: number;
  readonly damageBeforeReceivedReduction: number;
  readonly damageAfterReceivedReduction: number;
  /** The actually hit target stack's resolved defense attribute factor. */
  readonly targetDefenseMultiplier: number;
  /** Damage is multiplied by this direct-cancellation factor. */
  readonly directCancellationMultiplier: number;
  /** Formula result before event-level damage effects. */
  readonly rawDamage: number;
  /** Damage after all event effects and before integer rounding. */
  readonly modifiedDamage: number;
  /** Confirmed per-segment integer damage entering the pending queue. */
  readonly roundedDamage: number;
  readonly damageRoundingStrategyId: string;
  /** Compatibility alias. Always equals roundedDamage. */
  readonly finalDamage: number;
  /** Internal segment audit; these are not separately queued DamageEvents. */
  readonly internalSegments?: readonly {
    readonly sourceSkillId: string;
    readonly basis: number;
    readonly rawDamage: number;
    readonly modifiedDamage: number;
    readonly roundedDamage: number;
  }[];
}
