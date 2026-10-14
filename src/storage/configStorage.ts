import type { OptimizationConfig, SimpleScenarioOptimizationOptions,
  ThreeQueueOptimizationOptions,
  ValidationBattleInput } from "../pvp";
import { createPersistedEnvelope, parsePersistedJson,
  restorePersistedConfig } from "./configCodec";
import {
  AUTOSAVE_STORAGE_KEY,
  PROFILES_STORAGE_KEY,
  CURRENT_CONFIG_SCHEMA_VERSION,
  type ConfigStorage,
  type KeyValueStorage,
  type RestoredBattleSetup,
  type SavedBattleProfile,
} from "./storageTypes";

function rawProfileRecords(storage: KeyValueStorage): unknown[] {
  const json = storage.getItem(PROFILES_STORAGE_KEY);
  if (json === null) return [];
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("方案库 JSON 已损坏。"); }
  if (!Array.isArray(value)) throw new Error("方案库格式无效。");
  return value;
}

function readProfile(value: unknown): SavedBattleProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("方案记录格式无效。");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0 ||
    typeof raw.name !== "string" || raw.name.trim().length === 0 ||
    !Number.isSafeInteger(raw.createdAt) || !Number.isSafeInteger(raw.updatedAt)) {
    throw new Error("方案记录缺少必要字段。");
  }
  const restored = restorePersistedConfig({ schemaVersion: raw.schemaVersion,
    savedAt: raw.updatedAt, data: raw.data });
  const envelope = createPersistedEnvelope(restored.input, restored.simulationCount,
    restored.optimizationConfig, raw.updatedAt as number,
    restored.simpleOptimizerOptions, restored.threeQueueOptimizerOptions);
  return { id: raw.id, name: raw.name.trim(),
    createdAt: raw.createdAt as number, updatedAt: raw.updatedAt as number,
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION, data: envelope.data,
    ...(restored.queueAttributesMigrated ? { queueAttributesMigrated: true } : {}),
    ...(restored.optimizerRacingMigrated ? { optimizerRacingMigrated: true } : {}),
    ...(restored.sceneMigrationWarnings === undefined ? {} : {
      sceneMigrationWarnings: restored.sceneMigrationWarnings }) };
}

export class LocalStorageConfigStorage implements ConfigStorage {
  constructor(private readonly storage: KeyValueStorage) {}

  loadAutosave(options: { readonly validateBattleState?: boolean } = {}): RestoredBattleSetup | null {
    const json = this.storage.getItem(AUTOSAVE_STORAGE_KEY);
    return json === null ? null : parsePersistedJson(json, options);
  }

  saveAutosave(input: ValidationBattleInput, simulationCount: number,
    optimizationConfig: OptimizationConfig,
    simpleOptimizerOptions?: SimpleScenarioOptimizationOptions,
    threeQueueOptimizerOptions?: ThreeQueueOptimizationOptions): void {
    this.storage.setItem(AUTOSAVE_STORAGE_KEY,
      JSON.stringify(createPersistedEnvelope(input, simulationCount,
        optimizationConfig, Date.now(), simpleOptimizerOptions,
        threeQueueOptimizerOptions)));
  }

  clearAutosave(): void {
    this.storage.removeItem(AUTOSAVE_STORAGE_KEY);
  }

  listProfiles(): readonly SavedBattleProfile[] {
    return rawProfileRecords(this.storage).flatMap((item) => {
      try { return [readProfile(item)]; }
      catch { return []; }
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  countProfiles(): number { return rawProfileRecords(this.storage).length; }

  getProfile(id: string): SavedBattleProfile | null {
    const item = rawProfileRecords(this.storage).find((entry) =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
      (entry as Record<string, unknown>).id === id);
    return item === undefined ? null : readProfile(item);
  }

  saveProfile(profile: SavedBattleProfile): void {
    const validated = readProfile(profile);
    const profiles = rawProfileRecords(this.storage);
    const index = profiles.findIndex((entry) =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry) &&
      (entry as Record<string, unknown>).id === validated.id);
    if (index < 0) profiles.push(validated);
    else profiles[index] = validated;
    this.storage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  }

  deleteProfile(id: string): void {
    const profiles = rawProfileRecords(this.storage).filter((entry) =>
      entry === null || typeof entry !== "object" || Array.isArray(entry) ||
      (entry as Record<string, unknown>).id !== id);
    this.storage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  }
}
