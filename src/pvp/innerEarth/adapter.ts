import { DEFAULT_EXTERNAL_BUFF_CONFIG, resolveExternalBuffs } from "../externalBuffs";
import type { ExternalBuffConfig } from "../externalBuffs";
import { TROOP_TYPES, type TroopType } from "../types/combat";
import type { BattleState } from "../types/battle";
import { createConfirmedTroopSkillLoadout } from "../troopSkills/loadout";
import { allocateRallyTroopsByRatio } from "../validationUi/rallyDeployment";
import type { ValidationBattleInput, ValidationQueueAttributes, ValidationQueueConfig,
  ValidationSideInput } from "../validationUi/types";
import { assertInnerEarthInput, getInnerEarthConfig, innerEarthEnemyCounts, expandInnerEarthAttributes } from "./config";
import { getInnerEarthRule, INNER_EARTH_LAB_CONSTANTS, innerEarthLabEngineLevel } from "./rules";
import type { InnerEarthConfig, InnerEarthHeroMap, InnerEarthReportHistory } from "./types";
import { rawReportSide } from "../validationUi/reportBonusContexts";

const EMPTY_HEAD = { shield: null, lancer: null, marksman: null } as const;
const T10_LEVELS = { shield: "T10", lancer: "T10", marksman: "T10" } as const;
const ZERO_LEVELS = { shield: 0, lancer: 0, marksman: 0 } as const;
const FC_SKILL_FRAGMENTS = ["crystal", "lightforged", "crimson", "flame-impact"];

/** Historical modifiers only survive while their twelve report values still match. */
function historicalContext(stats: ValidationQueueAttributes, history?: InnerEarthReportHistory) {
  if (!history || !TROOP_TYPES.every((troop) => ["attack", "defense", "penetration", "life"].every((stat) =>
    stats[troop][stat as keyof typeof stats[typeof troop]] === history.reportAttributes[troop][stat as keyof typeof stats[typeof troop]]))) return {};
  return { sourceReportAttributes: history.reportAttributes, sourceReportBonuses: history.bonuses,
    reportAttributeBasis: "historicalReport" as const,
    ...(history.recognizedSpecialBonuses === undefined ? {} : { recognizedSpecialBonuses: history.recognizedSpecialBonuses }) };
}

function baseSide(source: ValidationSideInput, stats: ValidationQueueAttributes,
  counts: Readonly<Record<TroopType, number>>, tiers: Readonly<Record<TroopType, string>>,
  levels: Readonly<Record<TroopType, number>>, heroes: InnerEarthHeroMap,
  reportHeroes: InnerEarthHeroMap = heroes, externalBuffs: ExternalBuffConfig = DEFAULT_EXTERNAL_BUFF_CONFIG,
): ValidationSideInput {
  return {
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
      ...stats[troop], count: counts[troop], troopLevel: tiers[troop],
      levelMode: "single", t12Level: levels[troop],
    }])) as ValidationSideInput["troops"],
    reportHeroIds: Object.values(reportHeroes).filter((id): id is string => !!id),
    reportHeroByTroop: { ...reportHeroes },
    reportWeaponLevels: Object.fromEntries(Object.entries(source.reportWeaponLevels ?? {}).filter(
      ([hero]) => Object.values(reportHeroes).includes(hero))),
    leaderHeroId: null, leaderHeroIds: { ...heroes }, selectedMemberSkillIds: [], bodySkills: [],
    simulationWeaponLevels: {}, externalBuffs,
    reportAttributeBasis: "raw", targetBonusMode: "custom",
    marchCapacityBonus: 0, rallyCapacityBonus: 0, rallyFixedCapacityBonus: 0, petMarchCapacityLevel: 0,
  };
}
/** Independent combat modifier: neither this function nor its consumers mutate saved base stats. */
export function innerEarthPetModifier(input: ValidationBattleInput): ExternalBuffConfig {
  const config = expandInnerEarthAttributes(getInnerEarthConfig(input));
  const rule = getInnerEarthRule(config.subMode);
  if (!rule.allowPet || config.petContext === undefined) return structuredClone(DEFAULT_EXTERNAL_BUFF_CONFIG);
  const modifier = { ...structuredClone(DEFAULT_EXTERNAL_BUFF_CONFIG), pet: { ...config.petContext } };
  resolveExternalBuffs(modifier);
  return modifier;
}
/** Shared canonical boundary for formal simulation, Criterion, and DeterministicTheory. */
export function materializeInnerEarthInput(input: ValidationBattleInput,
  options: { readonly applyPetModifier?: boolean } = {}): ValidationBattleInput {
  assertInnerEarthInput(input);
  const config = expandInnerEarthAttributes(getInnerEarthConfig(input));
  const rule = getInnerEarthRule(config.subMode);
  const countsB = innerEarthEnemyCounts(config.enemy.shared.capacity, config.enemy.shared.troopRatioPreset);
  const pet = options.applyPetModifier === false ? structuredClone(DEFAULT_EXTERNAL_BUFF_CONFIG) : innerEarthPetModifier(input);
  let sideA: ValidationSideInput;
  let sideB: ValidationSideInput;
  if (rule.heroMode === "threeQueues") {
    const levels = config.ally.troopTiers;
    const allyQueues = config.ally.queues.map((queue): ValidationQueueConfig => ({
      ratios: { ...queue.ratio }, leaderHeroIds: { ...queue.heroes },
      reportHeroByTroop: { ...(queue.reportHeroes ?? queue.heroes) },
      reportWeaponLevels: { ...(queue.reportWeaponLevels ?? queue.weaponLevels ?? {}) },
      attributes: structuredClone(queue.expectedReportStats), troopLevels: { ...levels },
      externalBuffs: structuredClone(pet), heroSkillLevels: { ...(queue.skillLevels ?? {}) },
      weaponLevels: { ...(queue.weaponLevels ?? {}) },
      ...historicalContext(queue.expectedReportStats, queue.reportHistory),
    })) as unknown as NonNullable<ValidationSideInput["threeQueues"]>;
    // Display bridge uses basis-point ratios. Exact enemy counts are carried separately to ScenarioRunner.
    const enemyRatio = config.enemy.shared.troopRatioPreset === "BALANCED"
      ? { shield: 33.34, lancer: 33.33, marksman: 33.33 }
      : { shield: 53.33, lancer: 26.67, marksman: 20 };
    const enemyQueues = config.enemy.queues.map((queue): ValidationQueueConfig => ({
      ratios: { ...enemyRatio }, leaderHeroIds: { ...queue.heroes }, reportHeroByTroop: { ...queue.heroes },
      attributes: structuredClone(config.enemy.shared.expectedReportStats), troopLevels: T10_LEVELS,
      externalBuffs: structuredClone(DEFAULT_EXTERNAL_BUFF_CONFIG), heroSkillLevels: {}, weaponLevels: {},
      ...historicalContext(config.enemy.shared.expectedReportStats, config.enemy.shared.reportHistory),
    })) as unknown as NonNullable<ValidationSideInput["threeQueues"]>;
    const a0 = config.ally.queues[0];
    sideA = { ...baseSide(input.sideA, a0.expectedReportStats,
      allocateRallyTroopsByRatio({ totalTroops: config.ally.shared.capacity, ratios: a0.ratio }),
      levels, config.ally.t12SkillLevels, a0.heroes, a0.reportHeroes ?? a0.heroes, pet),
      deploymentCapacity: config.ally.shared.capacity, highestTroopLevels: { ...levels }, threeQueues: allyQueues };
    sideB = { ...baseSide(input.sideB, config.enemy.shared.expectedReportStats, countsB,
      T10_LEVELS, ZERO_LEVELS, config.enemy.queues[0].heroes),
      deploymentCapacity: config.enemy.shared.capacity, highestTroopLevels: T10_LEVELS, threeQueues: enemyQueues };
  } else {
    sideA = baseSide(input.sideA, config.ally.reportStats, config.ally.counts,
      rule.troopTierMode === "laboratory" ? T10_LEVELS : config.ally.troopTiers,
      config.ally.t12SkillLevels, EMPTY_HEAD);
    sideB = baseSide(input.sideB, config.enemy.shared.expectedReportStats, countsB, T10_LEVELS, ZERO_LEVELS, EMPTY_HEAD);
    sideA = { ...sideA, ...historicalContext(config.ally.reportStats, config.ally.reportHistory) };
    sideB = { ...sideB, ...historicalContext(config.enemy.shared.expectedReportStats, config.enemy.shared.reportHistory) };
    if (rule.inputMode === "finalReport") {
      sideA = { ...rawReportSide(sideA), reportAttributeBasis: "raw" };
      sideB = { ...rawReportSide(sideB), reportAttributeBasis: "raw" };
    }
  }
  return { ...input, scenarioType: "INNER_EARTH", attributeInputMode: rule.inputMode,
    battleContext: "challenge", threeQueueMode: "EARTH_HEART_BRAVE_LAND", sideA, sideB };
}
export function innerEarthLaboratoryConstant(input: ValidationBattleInput, troop: TroopType):
  { readonly level: string; readonly constant: number } | null {
  if (input.innerEarth?.subMode !== "UNDERGROUND_LAB") return null;
  assertInnerEarthInput(input);
  const tier = input.innerEarth.ally.troopTiers[troop];
  return { level: innerEarthLabEngineLevel(tier),
    constant: INNER_EARTH_LAB_CONSTANTS[tier as keyof typeof INNER_EARTH_LAB_CONSTANTS] };
}
/** Installs existing verified troop skill runtimes for the lab custom constants. No new skill rules. */
export function applyInnerEarthLaboratorySkills(state: BattleState, input: ValidationBattleInput): BattleState {
  if (input.innerEarth?.subMode !== "UNDERGROUND_LAB") return state;
  const config = input.innerEarth;
  return { ...state, sideA: { ...state.sideA, troops: Object.fromEntries(TROOP_TYPES.map((troop) => {
    const tier = config.ally.troopTiers[troop];
    const level = config.ally.t12SkillLevels[troop];
    const runtimes = tier === "LAB_T12" ? createConfirmedTroopSkillLoadout(troop, "T12-FC7", level)
      .filter((runtime) => !FC_SKILL_FRAGMENTS.some((fragment) => runtime.skillId.includes(fragment)))
      : createConfirmedTroopSkillLoadout(troop, "T10", 0);
    return [troop, { ...state.sideA.troops[troop], skillStates: runtimes }];
  })) as BattleState["sideA"]["troops"] } };
}
export interface InnerEarthAudit {
  readonly battleScenario: "INNER_EARTH";
  readonly innerEarthMode: InnerEarthConfig["subMode"];
  readonly schedulerType: string;
  readonly attributeInputMode: "prediction" | "finalReport";
  readonly heroSearchEnabled: boolean;
  readonly ratioSearchEnabled: true;
  readonly searchDimensions: readonly ("head" | "ratio")[];
  readonly fixedTroopTier: string | null;
  readonly enemyCapacityMode: string;
  readonly enemyCapacity: number;
  readonly enemyRatioPreset: InnerEarthConfig["enemy"]["shared"]["troopRatioPreset"];
  readonly petEnabled: boolean;
  readonly petAppliedToBaseStats: false;
  readonly petAppliedToOptimization: boolean;
  readonly t12SkillEnabled: boolean;
  readonly t12SkillMaxLevel: number;
}
export function auditInnerEarthInput(input: ValidationBattleInput): InnerEarthAudit {
  const config = getInnerEarthConfig(input);
  const rule = getInnerEarthRule(config.subMode);
  const petEnabled = rule.allowPet && Object.values(config.petContext ?? {}).some((level) => level > 0);
  return { battleScenario: "INNER_EARTH", innerEarthMode: config.subMode,
    schedulerType: rule.battleScheduler, attributeInputMode: rule.inputMode,
    heroSearchEnabled: rule.searchDimensions.includes("head"), ratioSearchEnabled: true,
    searchDimensions: rule.searchDimensions, fixedTroopTier: rule.troopTierMode === "fixedT10" ? "T10" : null,
    enemyCapacityMode: rule.enemyCapacityMode, enemyCapacity: config.enemy.shared.capacity,
    enemyRatioPreset: config.enemy.shared.troopRatioPreset,
    petEnabled, petAppliedToBaseStats: false, petAppliedToOptimization: petEnabled,
    t12SkillEnabled: rule.allowT12Skill, t12SkillMaxLevel: rule.t12SkillMaxLevel };
}
export const createInnerEarthAudit = auditInnerEarthInput;
