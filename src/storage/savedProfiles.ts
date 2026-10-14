import type { OptimizationConfig, SimpleScenarioOptimizationOptions,
  ThreeQueueOptimizationOptions,
  ValidationBattleInput } from "../pvp";
import { createPersistedEnvelope } from "./configCodec";
import { CURRENT_CONFIG_SCHEMA_VERSION,
  type SavedBattleProfile } from "./storageTypes";

export function createSavedProfile(name: string,
  input: ValidationBattleInput, simulationCount: number,
  optimizationConfig: OptimizationConfig,
  id: string = crypto.randomUUID(), now = Date.now(),
  simpleOptimizerOptions?: SimpleScenarioOptimizationOptions,
  threeQueueOptimizerOptions?: ThreeQueueOptimizationOptions): SavedBattleProfile {
  const cleanName = name.trim();
  if (cleanName.length === 0 || cleanName.length > 80) {
    throw new Error("方案名称需要 1～80 个字符。");
  }
  const envelope = createPersistedEnvelope(input, simulationCount,
    optimizationConfig, now, simpleOptimizerOptions,
    threeQueueOptimizerOptions);
  return { id, name: cleanName, createdAt: now, updatedAt: now,
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION, data: envelope.data };
}

export function copySavedProfile(profile: SavedBattleProfile,
  id: string = crypto.randomUUID(), now = Date.now()): SavedBattleProfile {
  const timestamp = Math.max(now, profile.createdAt + 1);
  return { ...profile, id, name: `${profile.name} - 副本`,
    createdAt: timestamp, updatedAt: timestamp,
    data: structuredClone(profile.data) };
}

export function renameSavedProfile(profile: SavedBattleProfile,
  name: string, now = Date.now()): SavedBattleProfile {
  const cleanName = name.trim();
  if (cleanName.length === 0 || cleanName.length > 80) {
    throw new Error("方案名称需要 1～80 个字符。");
  }
  return { ...profile, name: cleanName, updatedAt: now };
}
