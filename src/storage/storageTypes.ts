import type {
  BodySkillConfig, OptimizationConfig, SimpleScenarioOptimizationOptions,
  ThreeQueueOptimizationOptions,
  TroopRatioBasisPoints,
  ValidationQueueAttributes,
  TroopType,
  ValidationBattleInput, ValidationQueueConfig, ValidationSideInput,
} from "../pvp";

export const CURRENT_CONFIG_SCHEMA_VERSION = 4;
export const AUTOSAVE_STORAGE_KEY = "wos-pvp.autosave";
export const PROFILES_STORAGE_KEY = "wos-pvp.profiles";

export interface PersistedQueueConfig extends Omit<ValidationQueueConfig,
  "ratios" | "attributes" | "troopLevels"> {
  readonly ratiosBp: TroopRatioBasisPoints;
  readonly attributes: ValidationQueueAttributes;
  readonly troopLevels: Readonly<Record<TroopType, string>>;
}

export interface PersistedSideInput extends Omit<ValidationSideInput,
  "threeQueues" | "selectedMemberSkillIds" | "bodySkills"> {
  readonly threeQueues?: readonly [PersistedQueueConfig, PersistedQueueConfig, PersistedQueueConfig];
  readonly bodySkills: readonly BodySkillConfig[];
}

export interface PersistedBattleInput extends Omit<ValidationBattleInput, "sideA" | "sideB" | "legacySceneMigration" | "rallyAttacks" | "rallySingleAttack"> {
  readonly rallyAttacks?: readonly PersistedSideInput[];
  readonly rallySingleAttack?: PersistedSideInput;
  readonly sideA: PersistedSideInput;
  readonly sideB: PersistedSideInput;
  readonly legacySceneMigration?: Omit<NonNullable<ValidationBattleInput["legacySceneMigration"]>,
    "originalSideA" | "originalSideB"> & {
      readonly originalSideA: PersistedSideInput;
      readonly originalSideB: PersistedSideInput;
    };
}

export interface PersistedBattleSetup {
  readonly input: PersistedBattleInput;
  readonly simulationCount: number;
  readonly optimizationConfig?: OptimizationConfig;
  readonly simpleOptimizerOptions?: SimpleScenarioOptimizationOptions;
  readonly threeQueueOptimizerOptions?: ThreeQueueOptimizationOptions;
}

export interface PersistedConfigEnvelope {
  readonly schemaVersion: typeof CURRENT_CONFIG_SCHEMA_VERSION;
  readonly savedAt: number;
  readonly appVersion?: string;
  readonly data: PersistedBattleSetup;
}

export interface SavedBattleProfile {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly schemaVersion: typeof CURRENT_CONFIG_SCHEMA_VERSION;
  readonly data: PersistedBattleSetup;
  /** In-memory notice when this profile was read from pre-v2 queue attributes. */
  readonly queueAttributesMigrated?: boolean;
  readonly optimizerRacingMigrated?: boolean;
  readonly headPoolOwnershipMigrated?: boolean;
  readonly sceneMigrationWarnings?: readonly string[];
}

export interface RestoredBattleSetup {
  readonly input: ValidationBattleInput;
  readonly simulationCount: number;
  readonly optimizationConfig: OptimizationConfig;
  readonly simpleOptimizerOptions: SimpleScenarioOptimizationOptions;
  readonly threeQueueOptimizerOptions: ThreeQueueOptimizationOptions;
  readonly adjusted: boolean;
  readonly migrated: boolean;
  readonly queueAttributesMigrated: boolean;
  /** Only legacy persisted Rally budgets are upgraded; direct API schedules are preserved. */
  readonly optimizerRacingMigrated?: boolean;
  readonly headPoolOwnershipMigrated?: boolean;
  readonly sceneMigrated?: boolean;
  readonly sceneMigrationWarnings?: readonly string[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ConfigStorage {
  loadAutosave(): RestoredBattleSetup | null;
  saveAutosave(input: ValidationBattleInput, simulationCount: number,
    optimizationConfig: OptimizationConfig,
    simpleOptimizerOptions?: SimpleScenarioOptimizationOptions,
    threeQueueOptimizerOptions?: ThreeQueueOptimizationOptions): void;
  clearAutosave(): void;
  listProfiles(): readonly SavedBattleProfile[];
  getProfile(id: string): SavedBattleProfile | null;
  saveProfile(profile: SavedBattleProfile): void;
  deleteProfile(id: string): void;
}
