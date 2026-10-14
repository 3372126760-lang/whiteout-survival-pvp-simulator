import type {
  BattleContext,
  DamageType,
  SideId,
  TroopType,
} from "../types/combat";
import type {
  EffectActivationTiming,
  EffectLifecycle,
  RuleStatus,
} from "../types/effect";
import type { GatotShieldCalculation } from "./gatotShield";

export type HeroPosition = "leader" | "member";

export type HeroSkillTrigger =
  | "passive"
  | "roundStart"
  | "beforeAttack"
  | "beforeDamage"
  | "onAttack"
  | "afterNormalAttack"
  | "afterDamage"
  | "roundEnd";

export interface HeroSkillAttackCountSchedule {
  /** Which completed normal main attacks feed this skill's private counter. */
  readonly source: "army" | TroopType;
  readonly interval: number;
  /** `onCompleted` fires on N/2N; `nextAttack` fires on N+1/2N+1. */
  readonly mode: "onCompleted" | "nextAttack";
}

export type HeroSkillActionMechanic =
  | {
      readonly kind: "skipMainAttack";
      readonly sourceTroop: TroopType;
      readonly afterCompletedAttacks: number;
    }
  | {
      readonly kind: "dodgeNormalAttack";
    }
  | {
      readonly kind: "attackCountTrigger";
      readonly schedule: HeroSkillAttackCountSchedule;
    }
  | {
      /** Uses absolute battle rounds while still requiring this troop to complete its main attack. */
      readonly kind: "naturalRoundTrigger";
      readonly source: TroopType;
    }
  | {
      readonly kind: "targetBoundMark";
      readonly schedule: HeroSkillAttackCountSchedule;
      readonly markId: string;
      readonly damageDelayRounds: number;
      readonly damageCoefficient: number;
      readonly markDurationRounds: number;
    };

export interface HeroSkillPositionRule {
  readonly kind: "expeditionSkillSlot" | "exclusiveWeapon";
  readonly expeditionSkillSlot: 1 | 2 | 3;
  /** A partial catalog can explicitly forbid a position rather than guessing. */
  readonly allowedPositions: readonly HeroPosition[];
}

export interface HeroSkillEffectScope {
  readonly source: "army" | TroopType;
  readonly target?: "all" | "currentTarget" | TroopType;
  readonly damageType?: "all" | DamageType;
  readonly incomingSourceTroop?: TroopType;
}

export type HeroSkillEffectRecipient = "selfArmy" | "enemyArmy";

interface HeroSkillEffectBase {
  readonly id: string;
  readonly name: string;
  readonly recipient: HeroSkillEffectRecipient;
  readonly scope: HeroSkillEffectScope;
  readonly lifecycle?: EffectLifecycle;
}

export interface HeroSkillAttributeModifierEffect
  extends HeroSkillEffectBase {
  readonly kind: "attributeModifier";
  readonly attribute: "attack" | "penetration" | "defense" | "life";
  readonly operation: "addToAttribute" | "multiplyAttributeFactor";
  readonly group: string;
  readonly value: number;
}

export interface HeroSkillAttributeReductionEffect extends HeroSkillEffectBase {
  readonly kind: "attributeReduction";
  readonly attribute: "attack" | "penetration" | "defense" | "life";
  readonly group: "enemyAttackReduction" | "enemyPenetrationReduction" | string;
  readonly value: number;
}

export interface HeroSkillDefenseModifierEffect extends HeroSkillEffectBase {
  readonly kind: "defenseModifier";
  readonly group: string;
  readonly value: number;
}

export interface HeroSkillDefenseReductionEffect extends HeroSkillEffectBase {
  readonly kind: "defenseReduction";
  readonly group: string;
  readonly value: number;
}

export interface HeroSkillDamageModifierEffect extends HeroSkillEffectBase {
  readonly kind:
    | "damageIncrease"
    | "damageReduction"
    | "outgoingDamageReduction"
    | "incomingDamageIncrease";
  readonly group: string;
  readonly value: number;
}

export interface HeroSkillTargetingOverrideEffect extends HeroSkillEffectBase {
  readonly kind: "targetingOverride";
  readonly priority: readonly TroopType[];
}

export interface HeroSkillExtraDamageEffect extends HeroSkillEffectBase {
  readonly kind: "extraDamage";
  readonly coefficient: number;
  readonly basis:
    | "parentBaseDamage"
    | "parentRawDamage"
    | "parentModifiedDamage"
    | "parentFinalDamage";
}

/** Target-bound marker converted to vulnerability for exactly one later hit. */
export interface HeroSkillOneUseIncomingDamageIncreaseEffect
  extends HeroSkillEffectBase {
  readonly kind: "oneUseIncomingDamageIncrease";
  readonly group: string;
  readonly value: number;
}

/** Runtime-only marker. It never participates in a damage multiplier group. */
export interface HeroSkillTargetBoundMarkEffect extends HeroSkillEffectBase {
  readonly kind: "targetBoundMark";
  readonly markId: string;
}

/** Generates a reusable temporary shield from its explicitly named basis. */
export interface HeroSkillTemporaryShieldEffect extends HeroSkillEffectBase {
  readonly kind: "temporaryShield";
  readonly coefficient: number;
  readonly basis: "parentRawDamage" | "gatotReportAttackPower";
}

/** Applied to the actually hit troop stack and skips its next active round. */
export interface HeroSkillSkipNextRoundActionEffect extends HeroSkillEffectBase {
  readonly kind: "skipNextRoundAction";
}

/** Compiled onto the concrete stack carrying `markId`. */
export interface HeroSkillMarkedTargetDamageEffect extends HeroSkillEffectBase {
  readonly kind: "markedTargetDamageIncrease";
  readonly markId: string;
  readonly group: string;
  readonly value: number;
}

/** Event-local normal-attack modifier whose value decays by completed attacks. */
export interface HeroSkillDecayingDamageEffect extends HeroSkillEffectBase {
  readonly kind: "decayingDamageIncrease";
  readonly group: string;
  readonly initialValues: Readonly<Partial<Record<TroopType, number>>>;
  readonly decayFactor: number;
  readonly maxMainAttacks: number;
}

export type HeroSkillEffect =
  | HeroSkillAttributeModifierEffect
  | HeroSkillAttributeReductionEffect
  | HeroSkillDefenseModifierEffect
  | HeroSkillDefenseReductionEffect
  | HeroSkillDamageModifierEffect
  | HeroSkillTargetingOverrideEffect
  | HeroSkillExtraDamageEffect
  | HeroSkillOneUseIncomingDamageIncreaseEffect
  | HeroSkillTargetBoundMarkEffect
  | HeroSkillTemporaryShieldEffect
  | HeroSkillSkipNextRoundActionEffect
  | HeroSkillMarkedTargetDamageEffect
  | HeroSkillDecayingDamageEffect;

export interface HeroSkillLevelValue {
  readonly versionLabel?: string;
  readonly probability?: number;
  readonly durationRounds?: number;
  readonly cooldownRounds?: number;
  readonly periodRounds?: number;
  /** Required together with periodRounds; uses absolute battle rounds. */
  readonly periodStartRound?: number;
  readonly effects: readonly HeroSkillEffect[];
}

export interface HeroSkillDefinition {
  readonly id: string;
  /** Explicitly confirmed identical proc/target/timing/value/refresh semantics. */
  readonly procEffectFamilyId?: string;
  readonly heroId: string;
  readonly name: string;
  /** One concise, user-facing description shared by UI and BattleTrace. */
  readonly uiSummary?: string;
  readonly positionRule: HeroSkillPositionRule;
  readonly levelValues: Readonly<Record<number, HeroSkillLevelValue>>;
  readonly trigger: HeroSkillTrigger;
  /** A main attack attempt survives normal-attack dodge; a successful hit does not. */
  readonly triggerTiming?: "mainAttackAttempt" | "successfulNormalAttackHit";
  readonly probability?: number;
  readonly durationRounds?: number;
  readonly cooldownRounds?: number;
  readonly activationTiming?: EffectActivationTiming;
  readonly actionMechanic?: HeroSkillActionMechanic;
  /** Omitted for effects valid in every supported PVP context. */
  readonly battleContexts?: readonly BattleContext[];
  readonly metadata: {
    readonly ruleStatus: RuleStatus;
    readonly verificationStatus?: "inferredFromPriorGenerations";
    readonly generation?: number;
    readonly templateSource?: string;
    readonly source: string;
    readonly description?: string;
    readonly tags?: readonly string[];
  };
}

export interface HeroSkillRuntimeState {
  readonly ownerRuntimeInstanceId?: string;
  readonly skillId: string;
  readonly level: number;
  readonly enabled: boolean;
  readonly stacks: number;
  readonly remainingDuration: number;
  readonly cooldown: number;
  readonly lastTriggeredRound: number | null;
  readonly triggerCount: number;
  /** Per-skill main-attack counters. Most count completed mains; an explicit
   * pre-dodge mechanic (S5 Demolition Squad) counts attempts instead. Child,
   * rapid-fire and extra-damage events never advance either counter. */
  readonly mainAttackCounts: Readonly<Record<TroopType, number>>;
}

export interface HeroState {
  /** Legacy definition alias, retained for saved configurations and catalog APIs. */
  readonly heroId: string;
  readonly heroDefinitionId?: string;
  /** Unique within a battle side; normalized at battle initialization. */
  readonly runtimeInstanceId?: string;
  readonly position: HeroPosition;
  readonly weaponLevel: number;
  readonly skillStates: readonly HeroSkillRuntimeState[];
}

export interface HeroPositionActivationPolicy {
  readonly leaderSkillSlots: readonly (1 | 2 | 3)[];
  readonly memberSkillSlots: readonly (1 | 2 | 3)[];
}

export interface HeroSkillTraceEntry {
  readonly round: number;
  readonly procEffectFamilyId?: string;
  readonly familyEffectValue?: number;
  readonly side: SideId;
  /** Present for per-action triggers such as Bahiti's Unstable Field. */
  readonly sourceTroop?: TroopType;
  readonly heroId: string;
  readonly heroDefinitionId?: string;
  readonly runtimeInstanceId?: string;
  readonly generation?: number;
  readonly ruleStatus?: RuleStatus;
  readonly verificationStatus?: "inferredFromPriorGenerations";
  readonly templateSource?: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly uiSummary: string;
  readonly skillLevel: number;
  readonly skillVersion: string;
  readonly position: HeroPosition;
  readonly weaponLevel: number;
  readonly trigger: HeroSkillTrigger;
  readonly checked: true;
  readonly eligible: boolean;
  readonly triggered: boolean;
  readonly probability: number | null;
  readonly rngRoll: number | null;
  /** Audit aliases used by the validation UI and exported BattleTrace. */
  readonly procRoll: number | null;
  readonly procResult: boolean;
  readonly producedActiveEffectIds: readonly string[];
  readonly producedDamageEventIds: readonly string[];
  readonly activationTiming: EffectActivationTiming | "RULE_UNKNOWN";
  readonly groups: readonly string[];
  readonly appliedGroupValues?: readonly { readonly group: string; readonly value: number }[];
  readonly damageIncrease?: number;
  readonly damageReduction?: number;
  readonly reason: string;
  readonly parentEventId?: string;
  readonly targetTroop?: TroopType;
  readonly appliedDebuffTargetTroop?: TroopType;
  readonly effectiveFromRound?: number;
  readonly expiresAfterRound?: number;
  readonly attackCountBefore?: number;
  readonly attackCountAfter?: number;
  readonly attackCount?: number;
  readonly skippedMainAttack?: boolean;
  readonly dodgeResult?: boolean;
  readonly dreamMarkTarget?: TroopType;
  readonly vulnerabilityActivationRound?: number;
  readonly durationRemaining?: number;
  readonly extraDamageEvents?: readonly string[];
  readonly criticalResult?: boolean;
  readonly criticalMultiplier?: number;
  readonly poisonTarget?: TroopType;
  readonly poisonActivationRound?: number;
  readonly stunTarget?: TroopType;
  readonly skippedRound?: number;
  readonly temporaryShieldGenerated?: boolean;
  readonly rawDamageBasis?: number;
  readonly generatedShieldHp?: number;
  readonly temporaryShieldRuleStatus?: RuleStatus;
  readonly gatotShield?: GatotShieldCalculation;
  readonly triggerRound?: number;
  readonly activationRound?: number;
  readonly lancerCompletedAttackCount?: number;
  readonly bountyExtraDamageCoefficient?: number;
  readonly bountyAttackBuffActivationRound?: number;
  readonly torrentTriggerRound?: number;
  readonly stunActivationRound?: number;
  readonly heirOfForestTriggerRound?: number;
  readonly heirOfForestTargets?: readonly TroopType[];
  readonly perTargetExtraDamageCoefficient?: number;
  readonly defenseBuffActivation?: "immediateCurrentRound";
  readonly multiTargetExtraDamageEvents?: readonly string[];
  readonly mainAttackAttempted?: boolean;
  readonly successfulNormalAttackHit?: boolean;
  readonly normalAttackDodged?: boolean;
  readonly mainAttackAttemptCount?: number;
  readonly steelPhalanxEligible?: boolean;
  readonly steelPhalanxRoll?: number | null;
  readonly steelPhalanxTriggered?: boolean;
  readonly defenseBuffActivationRound?: number;
  readonly defenseBuffCurrentRoundOnly?: boolean;
  readonly lancerAttackAttemptCount?: number;
  readonly tidalOffensiveTriggered?: boolean;
  readonly nextRoundOutgoingReductionScheduled?: boolean;
  readonly marksmanAttackAttemptCount?: number;
  readonly piercingArrowTriggered?: boolean;
  readonly vulnerabilityTarget?: TroopType;
  readonly lancerMainAttackAttempted?: boolean;
  readonly lancerNormalAttackHit?: boolean;
  readonly crescentScytheEligible?: boolean;
  readonly crescentScytheRoll?: number | null;
  readonly crescentScytheTriggered?: boolean;
  readonly crimsonBurstNaturalRoundTrigger?: boolean;
  readonly currentTarget?: TroopType;
  readonly dawnSniperAttackCount?: number;
  readonly lancerEventCoefficient?: number;
  readonly marksmanEventCoefficient?: number;
  readonly shieldMainAttackAttempted?: boolean;
  readonly shieldNormalAttackDodged?: boolean;
  readonly shieldMainAttackAttemptCount?: number;
  readonly soaringFlameTriggered?: boolean;
  readonly activeRounds?: readonly number[];
  readonly marksmanMainAttackAttempted?: boolean;
  readonly armorBreakingStrikeEligible?: boolean;
  readonly extraDamageCoefficient?: number;
  readonly violentBlastEligible?: boolean;
  readonly violentBlastRoll?: number | null;
  readonly violentBlastTriggered?: boolean;
  readonly debuffTarget?: TroopType;
  readonly penetrationReduction?: number;
  readonly refreshedExistingState?: boolean;
  readonly remainingDuration?: number;
}

export type HeroSkillTriggerOverrideKey =
  | string
  | `${number}:${SideId}:${TroopType}:${string}`
  | `${SideId}:${string}`
  | `${SideId}:${TroopType}:${string}`;
export type HeroSkillTriggerOverrides = Readonly<
  Record<HeroSkillTriggerOverrideKey, boolean>
>;
