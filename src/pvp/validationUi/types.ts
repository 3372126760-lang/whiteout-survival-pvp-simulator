import type { ParsedBattleReportSide } from "../battleReportRecognition/types";
import type { ExpectedAttributeAudit } from "./expectedReportAttribute";
import type {
  BattleSimulationResult,
  BattleContext,
  BattleState,
  BattleTrace,
  HeroStatCorrection,
  PureTroopBattleScenario,
  SideId,
  TroopType,
} from "../index";
import type {
  ExpectedReportBonuses,
  ExternalBuffConfig,
  ReportAttribute,
  ReportAttributeValues,
  PetExternalBuffConfig,
  ExpertExternalBuffConfig,
} from "../externalBuffs";
import type { RallyDeploymentInput } from "./rallyDeployment";
import type { BattleScenarioType } from "../scenario/scenarioTypes";
import type { PostBattleCasualtyMode, PostBattleCasualtyResult } from "../postBattle";
import type { RallyTroopRatios } from "./rallyDeployment";
import type { ServerStageId } from "../progression";
import type { BodySkillConfig } from "./bodySkillConfig";
import type { HeroCategory } from "./heroCategory";
import type { ThreeQueueMode } from "../scenario/threeQueueScheduler";
import type { InnerEarthConfig } from "../innerEarth/types";

export type DebugOverrideMode = "AUTO" | "FORCE_TRIGGER" | "FORCE_NOT_TRIGGER";

export type ValidationTroopLevelMode = "single" | "mixed";

export interface ValidationLevelCompositionEntry {
  readonly level: string;
  readonly aliveCount: number;
}

export interface ValidationTroopInput {
  readonly count: number;
  /** Final report-panel percentage points before hero lineup correction (240.19 => 240.19%). */
  readonly attack: number;
  readonly defense: number;
  readonly penetration: number;
  readonly life: number;
  readonly troopLevel: string;
  /** Defaults to single for backwards compatibility. */
  readonly levelMode?: ValidationTroopLevelMode;
  readonly levelComposition?: readonly ValidationLevelCompositionEntry[];
  /** @deprecated UI ignores this value and derives C from troopLevel. */
  readonly troopConstant?: number;
  /** Final T12 level entered directly by the user (0-24). */
  readonly t12Level?: number;
  readonly resolutionSource?: "battleReportApproximation" | "userOverride";
}

export interface ValidationSideInput {
  /** IceFire current environment; shared by all three queues, never a historical source. */
  readonly shared?: IceFireSideSharedContext;
  readonly queueOrder?: readonly [number, number, number];
  readonly troops: Readonly<Record<TroopType, ValidationTroopInput>>;
  /** Historical context only. Never implicitly applied to a new battle. */
  readonly sourceReportBonuses?: ValidationReportBonusMatrix;
  readonly sourceReportAttributes?: ValidationQueueAttributes;
  /** OCR imports are already reversed; manual history can be reversed at the boundary. */
  readonly reportAttributeBasis?: "raw" | "historicalReport";
  readonly targetBonusMode?: "none" | "reuseSource" | "custom";
  readonly targetBattleBonuses?: ValidationReportBonusMatrix;
  /** @deprecated Historical import alias, retained for old saved configurations. */
  readonly importedReportModifiers?: Readonly<Record<TroopType,
    Readonly<Record<"attack" | "defense" | "penetration" | "life",
      { readonly additive: number; readonly buff: number; readonly debuff: number }>>>>;
  /** Single-queue capacity for 333; independent of the other side. */
  readonly deploymentCapacity?: number;
  /** Player-unlocked levels; defaults to the currently configured troop levels. */
  readonly availableTroopLevels?: readonly string[];
  /** Three-queue player ceilings; supersedes the legacy shared availableTroopLevels. */
  readonly highestTroopLevels?: Readonly<Record<TroopType, string>>;
  readonly threeQueues?: readonly [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  readonly reportHeroIds: readonly string[];
  readonly reportHeroByTroop?: Readonly<Partial<Record<TroopType, string | null>>>;
  readonly reportWeaponLevels?: Readonly<Record<string, number>>;
  readonly leaderHeroId: string | null;
  readonly leaderHeroIds?: Readonly<Partial<Record<TroopType, string | null>>>;
  /** Explicit combat-relevant expedition skill-1 definition ids. */
  readonly selectedMemberSkillIds: readonly string[];
  /** Exact rally body sources and levels; takes precedence over legacy skill ids. */
  readonly bodySkills?: readonly BodySkillConfig[];
  readonly simulationWeaponLevels?: Readonly<Record<string, number>>;
  readonly externalBuffs?: ExternalBuffConfig;
  readonly rallyDeployment?: RallyDeploymentInput;
  /** Prediction mode only: scales entered pre-capacity troop counts before battle. */
  readonly marchCapacityBonus?: number;
  readonly rallyCapacityBonus?: number;
  /** Fixed rally capacity, applied before the percentage bonus. */
  readonly rallyFixedCapacityBonus?: number;
  /** Pet march capacity level: Lv1-Lv10 grants 1,500 troops per level. */
  readonly petMarchCapacityLevel?: number;
  /** Leader expedition skill levels for a single battle. */
  readonly leaderSkillLevels?: Readonly<Record<string, number>>;
}

export interface IceFireSideSharedContext {
  readonly petContext: PetExternalBuffConfig;
  readonly expertContext: ExpertExternalBuffConfig;
  readonly migrationWarnings?: readonly string[];
}

export interface ValidationQueueConfig {
  readonly t12Levels?: Readonly<Record<TroopType, number>>;
  /** Confirmed OCR source rows remain bound to this queue, separate from current buffs. */
  readonly recognizedSpecialBonuses?: ParsedBattleReportSide["specialBonuses"];
  readonly ratios: RallyTroopRatios;
  readonly leaderHeroIds: Readonly<Partial<Record<TroopType, string | null>>>;
  /** Queue-specific baseline lineup used when candidate heroes change. */
  readonly reportHeroByTroop?: ValidationSideInput["reportHeroByTroop"];
  readonly weaponLevels?: Readonly<Record<string, number>>;
  readonly reportWeaponLevels?: Readonly<Record<string, number>>;
  /** Provenance belongs to the attribute values, never to the containing side. */
  readonly attributeSource?: "manualInput" | "basePanel" | "importedReport";
  /** Explicit, value-bound baseline for an imported report or optimizer candidate. */
  readonly reportLineage?: {
    /** Explicitly bound by an import, historical editor, or optimizer baseline capture. */
    readonly historicalLineageConfirmed?: boolean;
    readonly source: "historicalReport" | "optimizerBaseline";
    readonly attributeSnapshot: ValidationQueueAttributes;
  };
  /** Final report percentages for this queue, independent of the other queues. */
  readonly attributes?: ValidationQueueAttributes;
  /** OCR-confirmed special bonuses for this queue only. */
  readonly importedReportModifiers?: ValidationSideInput["importedReportModifiers"];
  readonly sourceReportBonuses?: ValidationReportBonusMatrix;
  readonly sourceReportAttributes?: ValidationQueueAttributes;
  readonly reportAttributeBasis?: ValidationSideInput["reportAttributeBasis"];
  readonly targetBonusMode?: ValidationSideInput["targetBonusMode"];
  readonly targetBattleBonuses?: ValidationReportBonusMatrix;
  /** Per-queue selected troop levels; legacy inputs fall back to side ceilings. */
  readonly troopLevels?: Readonly<Record<TroopType, string>>;
  readonly troopLevelCompositions?: Readonly<Partial<Record<TroopType,
    readonly ValidationLevelCompositionEntry[]>>>;
  readonly troopResolutionSources?: Readonly<Partial<Record<TroopType,
    "battleReportApproximation" | "userOverride">>>;
  /** Independent town/pet/expert external report buffs and debuffs. */
  readonly externalBuffs?: ExternalBuffConfig;
  /** Expedition skill levels keyed by skill id for this queue's leaders. */
  readonly heroSkillLevels?: Readonly<Record<string, number>>;
}

export type ValidationQueueAttributes = Readonly<Record<TroopType,
  Pick<ValidationTroopInput, "attack" | "defense" | "penetration" | "life">>>;

/** All three values use percentage points (20 means 20%), not decimal factors. */
export type ValidationReportBonusMatrix = NonNullable<ValidationSideInput["importedReportModifiers"]>;

export interface ActualRoundDamageInput {
  readonly round: number;
  readonly AtoB?: number;
  readonly BtoA?: number;
}

export interface OptimizerHeroPoolEntry {
  readonly enabled: boolean;
  /** Optimizer-only level; null means the hero has no exclusive weapon. */
  readonly weaponLevel: number | null;
}

export interface ValidationBattleInput {
  readonly innerEarth?: InnerEarthConfig;
  readonly legacySceneMigration?: {
    readonly sourceScenario: "THREE_QUEUE";
    readonly sourceMode: ThreeQueueMode;
    readonly originalSideA: ValidationSideInput;
    readonly originalSideB: ValidationSideInput;
    readonly warnings: readonly string[];
  };
  readonly ownedHeroIds?: readonly string[];
  readonly optimizerHeroPool?: Readonly<Partial<Record<SideId, Readonly<Record<string, OptimizerHeroPoolEntry>>>>>;
  readonly rallyBodyPoolIds?: readonly string[];
  readonly serverStage?: ServerStageId;
  /** User-owned hero pool. Undefined means every stage-eligible hero. */
  readonly availableHeroIds?: readonly string[];
  readonly sideA: ValidationSideInput;
  readonly sideB: ValidationSideInput;
  readonly scenarioType?: BattleScenarioType;
  /** Missing in legacy configurations means the random challenge activity. */
  readonly threeQueueMode?: ThreeQueueMode;
  readonly postBattleCasualtyMode?: PostBattleCasualtyMode;
  readonly maxRounds: number;
  readonly randomSeed: number;
  readonly battleContext?: BattleContext;
  readonly simulationMode?: "fixedSeed" | "random";
  readonly attributeInputMode?: "finalReport" | "prediction";
  /** Engine trigger-override key -> debug mode. */
  readonly triggerOverrides: Readonly<Record<string, DebugOverrideMode>>;
  /** Skill definition ids disabled only for this validation run. */
  readonly disabledSkillIds: readonly string[];
  readonly actualRounds: readonly ActualRoundDamageInput[];
}

export interface ValidationExpectedReportBonus {
  readonly troops: ExpectedReportBonuses;
  readonly breakdown: Readonly<Record<
    TroopType,
    Readonly<Record<ReportAttribute, ValidationExpectedAttributeBreakdown>>
  >>;
  readonly inflictedEnemyDebuffs: ReportAttributeValues;
}

export interface ValidationExpectedAttributeBreakdown {
  readonly calculationAudit: ExpectedAttributeAudit;
  /** Raw report-panel input before lineup correction and special multipliers. */
  readonly inputReportBonus: number;
  /** Additive report-hero/weapon lineup correction, not a skill buff. */
  readonly lineupCorrection: number;
  /** Total external rate, including scene weapon attribute rates. */
  readonly ownBuffRate: number;
  /** Opponent external report debuffs only; hero skill reductions are excluded. */
  readonly enemyDebuffRate: number;
  /** Expected report bonus before ordinary hero combat-skill modifiers. */
  readonly finalBonus: number;
  readonly sourceReportAdditive: number;
  readonly sourceReportBuff: number;
  readonly sourceReportDebuff: number;
  readonly targetAdditive: number;
  readonly targetBuff: number;
  readonly targetDebuff: number;
  readonly bonusSources: Readonly<Record<string, string>>;
  readonly weaponScenarioContribution: number;
  readonly currentExternalBuffBase: number;
  readonly currentWeaponBuff: number;
  readonly currentExternalBuffTotal: number;
}

export interface ValidationSkillSummaryEntry {
  readonly side: SideId;
  readonly skillId: string;
  readonly skillName: string;
  readonly uiSummary: string;
  readonly source: "troop" | "hero";
  readonly probabilityCheckCount: number;
  readonly procSuccessCount: number;
  readonly actualActivationCount: number;
  readonly extraDamageEventCount: number;
  readonly criticalCount: number;
  readonly dodgeCount: number;
  readonly stunCount: number;
  readonly skippedActionCount: number;
  readonly activationBySourceTroop: Readonly<Partial<Record<TroopType, number>>>;
  readonly activationByTargetTroop: Readonly<Partial<Record<TroopType, number>>>;
}

export interface ValidationActiveSkillOption extends ValidationSkillOption {
  readonly side: SideId;
  readonly applicableTroops: readonly TroopType[];
  readonly position: "leader" | "member" | null;
}

export interface ValidationRoundDamage {
  readonly round: number;
  readonly AtoB: number;
  readonly BtoA: number;
}

export interface DamageComparisonRow {
  readonly round: number;
  readonly direction: "AtoB" | "BtoA";
  readonly model: number;
  readonly actual: number;
  readonly difference: number;
  readonly errorRate: number | null;
}

export interface ValidationEffectSnapshot {
  readonly round: number;
  readonly side: SideId;
  readonly holder: "army" | TroopType;
  readonly instanceId: string;
  readonly effectId: string;
  readonly sourceId: string;
  readonly sourceSkillId: string;
  readonly kind: string;
  readonly group: string | null;
  readonly value: number | null;
  readonly stacks: number;
  readonly remainingDuration: number | null;
  readonly activationTiming: string;
  readonly effectiveFromRound: number;
  readonly expiresAfterRound: number | null;
  readonly firstActiveRound: number | null;
  readonly periodRounds: number | null;
  readonly activeWindowRounds: number | null;
  readonly sourceScope: string;
  readonly targetScope: string;
}

export interface ValidationBattleSummary {
  readonly outcome: "A" | "B" | "draw" | "timeout";
  readonly rounds: number;
  readonly remaining: Readonly<Record<SideId, Readonly<Record<TroopType, number>>>>;
}

export interface ValidationBattleResult {
  readonly input: ValidationBattleInput;
  readonly scenario: PureTroopBattleScenario;
  readonly initialState: BattleState;
  readonly simulation: BattleSimulationResult;
  readonly trace: BattleTrace;
  readonly readableTrace: string;
  readonly summary: ValidationBattleSummary;
  readonly roundDamage: readonly ValidationRoundDamage[];
  readonly comparisons: readonly DamageComparisonRow[];
  readonly activeEffects: readonly ValidationEffectSnapshot[];
  readonly heroStatCorrections: Readonly<Partial<Record<SideId, HeroStatCorrection>>>;
  readonly expectedReportBonuses: Readonly<Record<SideId, ValidationExpectedReportBonus>>;
  readonly skillSummary: readonly ValidationSkillSummaryEntry[];
  readonly postBattleCasualties: Readonly<Record<SideId, PostBattleCasualtyResult>>;
}

export interface ValidationHeroOption {
  readonly heroId: string;
  readonly name: string;
  readonly troopType: TroopType;
  readonly rarity: string;
  readonly category: HeroCategory;
  readonly sGeneration?: number;
  /** Compatibility alias: null for R/SR, S generation for S heroes. */
  readonly generation: number | null;
  readonly weaponMaxStat: number | null;
}

export interface ValidationMemberSkillOption {
  readonly heroId: string;
  readonly heroName: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly troopType: TroopType;
  readonly effectKey: string;
  readonly effectLabel: string;
  readonly sourceHeroIds: readonly string[];
  readonly sourceSkillIds: readonly string[];
}

export interface ValidationSkillOption {
  readonly id: string;
  readonly name: string;
  readonly uiSummary: string;
  readonly source: "troop" | "hero";
  readonly category: string;
  readonly troopType: TroopType;
  readonly heroId: string | null;
  readonly expeditionSkillSlot: 1 | 2 | 3 | null;
  readonly definitionOrder: number;
  readonly probability: number | null;
  readonly perTroop: boolean;
}

export interface ValidationCatalog {
  readonly troopLevels: readonly string[];
  readonly reportHeroes: readonly ValidationHeroOption[];
  readonly leaderHeroes: readonly ValidationHeroOption[];
  readonly memberSkills: readonly ValidationMemberSkillOption[];
  readonly skills: readonly ValidationSkillOption[];
}
