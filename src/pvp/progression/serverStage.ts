import { EXPEDITION_HERO_DATA } from "../heroSkills";
import { SUPPORTED_TROOP_LEVELS } from "../troopSkills";
import type { TroopType } from "../types/combat";
import { TROOP_TYPES } from "../types/combat";

export const SERVER_STAGES = [
  { id: "s1_t10", label: "一代 T10", maxHeroGeneration: 1, maxTroopLevel: "T10" },
  { id: "s2_t10", label: "二代 T10", maxHeroGeneration: 2, maxTroopLevel: "T10" },
  { id: "s2_fc3", label: "二代 火3", maxHeroGeneration: 2, maxTroopLevel: "T10-FC3" },
  { id: "s3_fc3", label: "三代 火3", maxHeroGeneration: 3, maxTroopLevel: "T10-FC3" },
  { id: "s3_fc5", label: "三代 火5", maxHeroGeneration: 3, maxTroopLevel: "T10-FC5" },
  { id: "s4_fc5", label: "四代 火5", maxHeroGeneration: 4, maxTroopLevel: "T10-FC5" },
  { id: "s4_t11", label: "四代 T11-FC5", maxHeroGeneration: 4, maxTroopLevel: "T11-FC5" },
  { id: "s5_t11", label: "五代 T11-FC5", maxHeroGeneration: 5, maxTroopLevel: "T11-FC5" },
  { id: "s5_fc8", label: "五代 火8", maxHeroGeneration: 5, maxTroopLevel: "T11-FC8" },
  { id: "s6_fc8", label: "六代 火8", maxHeroGeneration: 6, maxTroopLevel: "T11-FC8" },
  { id: "s7_fc8", label: "七代 火8", maxHeroGeneration: 7, maxTroopLevel: "T11-FC8" },
  { id: "s7_fc10", label: "七代 火10", maxHeroGeneration: 7, maxTroopLevel: "T11-FC10" },
  { id: "s8_fc10", label: "八代 火10", maxHeroGeneration: 8, maxTroopLevel: "T11-FC10" },
  { id: "s9_fc10", label: "九代 火10", maxHeroGeneration: 9, maxTroopLevel: "T11-FC10" },
  { id: "s10_t12", label: "十代 T12", maxHeroGeneration: 10, maxTroopLevel: "T12-FC10" },
  { id: "s11", label: "十一代", maxHeroGeneration: 11, maxTroopLevel: "T12-FC10" },
  { id: "s12", label: "十二代", maxHeroGeneration: 12, maxTroopLevel: "T12-FC10" },
  { id: "s13", label: "十三代", maxHeroGeneration: 13, maxTroopLevel: "T12-FC10" },
  { id: "s14", label: "十四代", maxHeroGeneration: 14, maxTroopLevel: "T12-FC10" },
  { id: "s15", label: "十五代", maxHeroGeneration: 15, maxTroopLevel: "T12-FC10" },
  { id: "s16", label: "十六代", maxHeroGeneration: 16, maxTroopLevel: "T12-FC10" },
] as const;

export type ServerStageId = typeof SERVER_STAGES[number]["id"];
export type ServerStageDefinition = typeof SERVER_STAGES[number];
export const DEFAULT_SERVER_STAGE_ID: ServerStageId = "s11";

// Explicit availability profiles retain both tier and server crystal unlocks.
// A T11 stage with FC5 does not make T10-FC6 available.
const BASE_LEVELS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"];
const FC3_LEVELS = [...BASE_LEVELS, "T10-FC1", "T10-FC2", "T10-FC3"];
const FC5_LEVELS = [...FC3_LEVELS, "T10-FC4", "T10-FC5"];
const T11_LEVELS = [...FC5_LEVELS, "T11-FC3", "T11-FC4", "T11-FC5"];
const FC8_LEVELS = [...T11_LEVELS, "T10-FC6", "T10-FC7", "T10-FC8",
  "T11-FC6", "T11-FC7", "T11-FC8"];
const FC10_LEVELS = [...FC8_LEVELS, "T10-FC9", "T10-FC10", "T11-FC9", "T11-FC10"];
const T12_LEVELS = [...FC10_LEVELS, "T12-FC7", "T12-FC8", "T12-FC9", "T12-FC10"];
const TROOP_LEVELS_BY_CAP: Readonly<Record<ServerStageDefinition["maxTroopLevel"], readonly string[]>> = {
  T10: BASE_LEVELS,
  "T10-FC3": FC3_LEVELS,
  "T10-FC5": FC5_LEVELS,
  "T11-FC5": T11_LEVELS,
  "T11-FC8": FC8_LEVELS,
  "T11-FC10": FC10_LEVELS,
  "T12-FC10": T12_LEVELS,
};

export function getServerStage(id: ServerStageId): ServerStageDefinition {
  const stage = SERVER_STAGES.find((entry) => entry.id === id);
  if (stage === undefined) throw new RangeError(`Unknown server stage: ${id}.`);
  return stage;
}

export function isHeroAvailableAtStage(
  hero: string | { readonly generation?: number | null },
  stageId: ServerStageId,
): boolean {
  const candidate = typeof hero === "string"
    ? EXPEDITION_HERO_DATA.find((entry) => entry.id === hero) : hero;
  return candidate !== undefined && (candidate.generation ?? 1) <=
    getServerStage(stageId).maxHeroGeneration;
}

export function getAvailableHeroes(stageId: ServerStageId) {
  return EXPEDITION_HERO_DATA.filter((hero) => isHeroAvailableAtStage(hero, stageId));
}

export function isTroopLevelAvailableAtStage(level: string,
  stageId: ServerStageId): boolean {
  return TROOP_LEVELS_BY_CAP[getServerStage(stageId).maxTroopLevel].includes(level);
}

export function getAvailableTroopLevels(stageId: ServerStageId,
  troopType?: TroopType): readonly string[] {
  if (troopType !== undefined && !TROOP_TYPES.includes(troopType)) {
    throw new RangeError(`Unknown troop type: ${troopType}.`);
  }
  return SUPPORTED_TROOP_LEVELS.filter((level) =>
    isTroopLevelAvailableAtStage(level, stageId));
}

export function clampTroopLevelToStage(level: string,
  stageId: ServerStageId): string {
  return isTroopLevelAvailableAtStage(level, stageId)
    ? level : getServerStage(stageId).maxTroopLevel;
}
