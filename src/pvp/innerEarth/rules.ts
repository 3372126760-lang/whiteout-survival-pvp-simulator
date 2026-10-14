import { INNER_EARTH_ENEMY_PRESETS, type InnerEarthMode, type InnerEarthModeRule } from "./types";

const fixedRatio = {
  inputMode: "finalReport", heroMode: "empty", troopTierMode: "fixedT10",
  allowPet: false, allowExpert: false, allowDrug: false,
  allowFireCrystalSkill: false, allowT12Skill: false, t12SkillMaxLevel: 0,
  allyCapacity: null, enemyCapacityMode: "userInput",
  enemyRatioPresets: INNER_EARTH_ENEMY_PRESETS, searchDimensions: ["ratio"],
  battleScheduler: "SingleBattle",
} as const;
const threeQueue = {
  ...fixedRatio, inputMode: "prediction", heroMode: "threeQueues",
  searchDimensions: ["head", "ratio"], battleScheduler: "RandomAliveQueueScheduler",
} as const;
export const INNER_EARTH_MODE_RULES: Readonly<Record<InnerEarthMode, InnerEarthModeRule>> = {
  HEART_OF_EARTH: { ...threeQueue, mode: "HEART_OF_EARTH", label: "大地之心",
    troopTierMode: "player", allowPet: true, allowFireCrystalSkill: true,
    allowT12Skill: true, t12SkillMaxLevel: 24 },
  HERO_LAND: { ...threeQueue, mode: "HERO_LAND", label: "英雄之地", allyCapacity: 190410 },
  BEAST_CAVE: { ...fixedRatio, mode: "BEAST_CAVE", label: "群兽洞窟" },
  GEM_MINE: { ...fixedRatio, mode: "GEM_MINE", label: "宝石矿洞", enemyCapacityMode: "fixed150000" },
  UNDERGROUND_LAB: { ...fixedRatio, mode: "UNDERGROUND_LAB", label: "地下研究所",
    troopTierMode: "laboratory", allowT12Skill: true, t12SkillMaxLevel: 3 },
  EQUIPMENT_FORGE: { ...fixedRatio, mode: "EQUIPMENT_FORGE", label: "装备锻炉", enemyCapacityMode: "fixed150000" },
};
export function getInnerEarthRule(mode: InnerEarthMode): InnerEarthModeRule {
  const rule = INNER_EARTH_MODE_RULES[mode];
  if (rule === undefined) throw new RangeError(`未知地心玩法：${String(mode)}`);
  return rule;
}
export function innerEarthIsThreeQueue(mode: InnerEarthMode): boolean {
  return getInnerEarthRule(mode).heroMode === "threeQueues";
}
export const INNER_EARTH_LAB_CONSTANTS = Object.freeze({ T10: 7.4947, LAB_T11: 8.8437, LAB_T12: 10.4356 });
/** Avoids registering fictional normal-game T11/T12 levels. */
export function innerEarthLabEngineLevel(tier: string): string {
  if (!(tier in INNER_EARTH_LAB_CONSTANTS)) throw new RangeError(`地下研究所兵种等级无效：${tier}`);
  return tier === "T10" ? "T10" : `INNER_EARTH_${tier}`;
}
