import { DEFAULT_CRITERION_SEARCH, resolveCriterionSearchOptions } from "../pvp/optimizer/criterion/searchTypes";
import { resolveJointRacingSchedule } from "../pvp/optimizer/criterion/racingSchedule";
import { resolveJointPipelineOptions } from "../pvp/optimizer/jointPipeline/types";
import { normalizeHistoricalTree } from "../pvp/validationUi/historicalBonuses";
import { resolveBasinSearchOptions } from "../pvp/optimizer/basinSearch";
import { DEFAULT_EXTERNAL_BUFF_CONFIG, STANDARD_PET_LEVELS, PET_DEFENSE_REDUCTION_LEVELS, PET_PENETRATION_REDUCTION_LEVELS, PET_LIFE_REDUCTION_LEVELS } from "../pvp/externalBuffs/data";
import { MAX_BATCH_SIMULATION_COUNT, MIN_BATCH_SIMULATION_COUNT } from "../pvp/validationUi/batchSimulation";
import { SERVER_STAGES, getServerStage, isHeroAvailableAtStage, type ServerStageId } from "../pvp/progression/serverStage";
import { SUPPORTED_TROOP_LEVELS } from "../pvp/data/troopConstants";
import { TROOP_TYPES, type TroopType } from "../pvp/types/combat";
import { createValidationPreviewState, getValidationThreeQueues, toValidationThreeQueueConfig } from "../pvp/validationUi/adapter";
import { defaultTheoryOptions, validateTheoryOptions, type TheoryOptions } from "../pvp/optimizer/theory";
import { defaultOptimizationConfig } from "../pvp/optimizer/index";
import { defaultSimpleScenarioOptimizationOptions, type SimpleScenarioOptimizationOptions } from "../pvp/optimizer/scenarioOptimizer";
import { defaultThreeQueueOptimizationOptions, type ThreeQueueOptimizationOptions } from "../pvp/optimizer/threeQueueOptimizer";
import { getValidationCatalog, getAvailableMemberSkills } from "../pvp/validationUi/catalog";
import { resolveBodySkillConfigs, validateBodySkillConfigs, type BodySkillConfig } from "../pvp/validationUi/bodySkillConfig";
import { sanitizeConfigForStage } from "../pvp/validationUi/stageConfig";
import { reconcileLegacyHeroOwnership } from "../pvp/optimizer/heroPools";
import { normalizeIceFireReportLineage } from "../pvp/validationUi/queueReportLineage";
import { toThreeQueueBasisPoints, type TroopRatioBasisPoints } from "../pvp/scenario/threeQueueRatios";
import { DEFAULT_THREE_QUEUE_MODE, THREE_QUEUE_MODES, resolveThreeQueueMode } from "../pvp/scenario/threeQueueScheduler";
import { isThreeQueueBattleInput } from "../pvp/scenario/scenePolicy";
import { assertInnerEarthInput, normalizeInnerEarthInput,
  type InnerEarthConfig } from "../pvp/innerEarth";
import type { OptimizationConfig, SearchConstraint, RallyCandidate } from "../pvp/optimizer/types";
import type { ValidationBattleInput, ValidationQueueConfig, ValidationQueueAttributes, ValidationSideInput, ValidationTroopInput, ValidationHistoricalBonuses, HistoricalBonusMigration } from "../pvp/validationUi/types";
import { migratePersistedConfig } from "./configMigration";
import {
  CURRENT_CONFIG_SCHEMA_VERSION,
  type PersistedBattleInput,
  type PersistedBattleSetup,
  type PersistedConfigEnvelope,
  type PersistedQueueConfig,
  type PersistedSideInput,
  type RestoredBattleSetup,
} from "./storageTypes";

type JsonObject = Record<string, unknown>;
const KNOWN_HERO_IDS = new Set(getValidationCatalog().reportHeroes.map((hero) => hero.heroId));
const HERO_TROOP = new Map(getValidationCatalog().reportHeroes.map((hero) =>
  [hero.heroId, hero.troopType]));
const KNOWN_MEMBER_SKILL_IDS = new Set(getValidationCatalog().memberSkills.flatMap(
  (group) => group.sourceSkillIds));
const TROOP_LEVELS = new Set<string>(SUPPORTED_TROOP_LEVELS);

function record(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`);
  }
  return value as JsonObject;
}

function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} 必须是 ${min}～${max} 的整数。`);
  }
  return value as number;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数值。`);
  }
  return value;
}

function probability(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result < 0 || result > 1) throw new Error(`${label} 必须在 0～1 之间。`);
  return result;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是文本。`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值。`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new Error(`${label} 无效。`);
  }
  return value as T;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`);
  return value;
}

function heroId(value: unknown, label: string): string {
  const id = string(value, label);
  if (!KNOWN_HERO_IDS.has(id)) throw new Error(`${label} 包含未知英雄：${id}。`);
  return id;
}

function nullableHero(value: unknown, label: string): string | null {
  return value === null ? null : heroId(value, label);
}

function heroMap(value: unknown, label: string): Partial<Record<TroopType, string | null>> {
  const raw = record(value, label);
  return Object.fromEntries(TROOP_TYPES.flatMap((troop) => {
    if (raw[troop] === undefined) return [];
    const id = nullableHero(raw[troop], `${label}.${troop}`);
    if (id !== null && HERO_TROOP.get(id) !== troop) {
      throw new Error(`${label}.${troop} 英雄兵种不匹配。`);
    }
    return [[troop, id]];
  })) as
      Partial<Record<TroopType, string | null>>;
}

function level(value: unknown, label: string): string {
  const id = string(value, label);
  if (!TROOP_LEVELS.has(id)) throw new Error(`${label} 包含未知兵种等级：${id}。`);
  return id;
}

function troop(value: unknown, label: string): ValidationTroopInput {
  const raw = record(value, label);
  const levelMode = raw.levelMode === undefined ? "single" :
    oneOf(raw.levelMode, ["single", "mixed"] as const, `${label}.levelMode`);
  const composition = raw.levelComposition === undefined ? undefined :
    array(raw.levelComposition, `${label}.levelComposition`).map((entry, index) => {
      const part = record(entry, `${label}.levelComposition[${index}]`);
      return { level: level(part.level, `${label}.levelComposition[${index}].level`),
        aliveCount: integer(part.aliveCount, `${label}.levelComposition[${index}].aliveCount`) };
    });
  return {
    count: integer(raw.count, `${label}.count`),
    attack: finite(raw.attack, `${label}.attack`),
    defense: finite(raw.defense, `${label}.defense`),
    penetration: finite(raw.penetration, `${label}.penetration`),
    life: finite(raw.life, `${label}.life`),
    troopLevel: level(raw.troopLevel, `${label}.troopLevel`),
    levelMode,
    ...(composition === undefined ? {} : { levelComposition: composition }),
    ...(raw.resolutionSource === undefined ? {} : {
      resolutionSource: oneOf(raw.resolutionSource, ["battleReportApproximation", "userOverride"] as const,
        `${label}.resolutionSource`) }),
    ...(raw.t12Level === undefined ? {} : {
      t12Level: integer(raw.t12Level, `${label}.t12Level`, 0, 24) }),
  };
}

function queueLevelCompositions(value: unknown, label: string):
  NonNullable<ValidationQueueConfig["troopLevelCompositions"]> {
  const raw = record(value, label);
  return Object.fromEntries(TROOP_TYPES.flatMap((troop) => {
    if (raw[troop] === undefined) return [];
    const parts = array(raw[troop], `${label}.${troop}`).map((value, index) => {
      const entry = record(value, `${label}.${troop}[${index}]`);
      return { level: level(entry.level, `${label}.${troop}[${index}].level`),
        aliveCount: integer(entry.aliveCount, `${label}.${troop}[${index}].aliveCount`) };
    });
    if (parts.length === 0 || new Set(parts.map((part) => part.level)).size !== parts.length)
      throw new Error(`${label}.${troop} 混兵等级不能为空或重复。`);
    return [[troop, parts]];
  }));
}

function ratiosBp(value: unknown, label: string): TroopRatioBasisPoints {
  const raw = record(value, label);
  const result = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    integer(raw[troop], `${label}.${troop}`, 0, 10_000)])) as
      unknown as TroopRatioBasisPoints;
  if (TROOP_TYPES.reduce((sum, troop) => sum + result[troop], 0) !== 10_000) {
    throw new Error(`${label} 比例总和必须为 10000 基点。`);
  }
  return result;
}

function ratiosPercent(value: unknown, label: string) {
  const raw = record(value, label);
  const ratios = Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, finite(raw[troop], `${label}.${troop}`)])) as
      Record<TroopType, number>;
  toThreeQueueBasisPoints(ratios);
  return ratios;
}

function queueAttributes(value: unknown, label: string): ValidationQueueAttributes {
  const raw = record(value, label);
  return Object.fromEntries(TROOP_TYPES.map((troop) => {
    const fields = record(raw[troop], `${label}.${troop}`);
    return [troop, Object.fromEntries(["attack", "defense", "penetration",
      "life"].map((field) => [field, finite(fields[field],
      `${label}.${troop}.${field}`)]))];
  })) as unknown as ValidationQueueAttributes;
}

function bodySkills(value: unknown, label: string): readonly BodySkillConfig[] {
  const raw = array(value, label);
  if (raw.length > 4) throw new Error(`${label} 最多四项。`);
  return raw.map((item, index) => {
    const entry = record(item, `${label}[${index}]`);
    const id = string(entry.skillId, `${label}[${index}].skillId`);
    if (!KNOWN_MEMBER_SKILL_IDS.has(id)) {
      throw new Error(`${label} 包含未知或非一技能：${id}。`);
    }
    const definitionId = heroId(entry.heroDefinitionId ?? entry.heroId,
      `${label}[${index}].heroDefinitionId`);
    if (entry.heroId !== undefined && entry.heroId !== definitionId)
      throw new Error(`${label}[${index}] 英雄定义 ID 不一致。`);
    return { heroId: definitionId, heroDefinitionId: definitionId,
      ...(entry.runtimeInstanceId === undefined ? {} : {
        runtimeInstanceId: string(entry.runtimeInstanceId, `${label}[${index}].runtimeInstanceId`) }),
      skillId: id, expeditionSkillSlot: integer(entry.expeditionSkillSlot,
        `${label}[${index}].expeditionSkillSlot`, 1, 1) as 1,
      skillLevel: integer(entry.skillLevel, `${label}[${index}].skillLevel`, 1, 5) };
  });
}

function weaponLevels(value: unknown, label: string): Record<string, number> {
  const raw = record(value, label);
  return Object.fromEntries(Object.entries(raw).map(([id, amount]) =>
    [heroId(id, label), integer(amount, `${label}.${id}`, 0, 10)]));
}

function externalBuffs(value: unknown): NonNullable<ValidationSideInput["externalBuffs"]> {
  const raw = record(value, "externalBuffs");
  const town = record(raw.town, "externalBuffs.town");
  const pet = record(raw.pet, "externalBuffs.pet");
  const expert = record(raw.expert, "externalBuffs.expert");
  return {
    town: Object.fromEntries(Object.keys(DEFAULT_EXTERNAL_BUFF_CONFIG.town).map((key) =>
      [key, oneOf(town[key], ["none", "small", "large"] as const,
        `externalBuffs.town.${key}`)])) as unknown as
        NonNullable<ValidationSideInput["externalBuffs"]>["town"],
    pet: Object.fromEntries(Object.keys(DEFAULT_EXTERNAL_BUFF_CONFIG.pet).map((key) => {
      const max = key === "enemyPenetrationReductionLevel"
        ? PET_PENETRATION_REDUCTION_LEVELS.length - 1
        : key === "enemyLifeReductionLevel"
          ? PET_LIFE_REDUCTION_LEVELS.length - 1
          : key === "enemyDefenseReductionLevel"
            ? PET_DEFENSE_REDUCTION_LEVELS.length - 1
            : STANDARD_PET_LEVELS.length - 1;
      return [key, integer(pet[key], `externalBuffs.pet.${key}`, 0, max)];
    })) as unknown as
        NonNullable<ValidationSideInput["externalBuffs"]>["pet"],
    expert: { garethFourthSkillLevel: integer(expert.garethFourthSkillLevel,
      "externalBuffs.expert.garethFourthSkillLevel", 0, 20) },
  };
}

function importedModifiers(value: unknown, label: string):
  NonNullable<ValidationSideInput["importedReportModifiers"]> {
  const byTroop = record(value, label);
  return Object.fromEntries(TROOP_TYPES.map((type) => {
    const byAttribute = record(byTroop[type], `${label}.${type}`);
    return [type, Object.fromEntries((["attack", "defense", "penetration", "life"] as const)
      .map((attribute) => {
        const row = record(byAttribute[attribute], `${label}.${type}.${attribute}`);
        return [attribute, { additive: finite(row.additive, "additive"),
          buff: finite(row.buff, "buff"), debuff: finite(row.debuff, "debuff") }];
      }))];
  })) as NonNullable<ValidationSideInput["importedReportModifiers"]>;
}

function bonusContexts(raw: Record<string, unknown>, label: string) {
  return {
    ...(raw.sourceReportBonuses === undefined ? {} : { sourceReportBonuses:
      readHistoricalBonuses(raw.sourceReportBonuses, `${label}.sourceReportBonuses`) }),
    ...(raw.historicalBonusMigration === undefined ? {} : { historicalBonusMigration: readHistoricalBonusMigration(raw.historicalBonusMigration) }),
    ...(raw.sourceReportAttributes === undefined ? {} : { sourceReportAttributes:
      queueAttributes(raw.sourceReportAttributes, `${label}.sourceReportAttributes`) }),
    ...(raw.reportAttributeBasis === undefined ? {} : { reportAttributeBasis:
      oneOf(raw.reportAttributeBasis, ["raw", "historicalReport"] as const, `${label}.reportAttributeBasis`) }),
    ...(raw.targetBonusMode === undefined ? {} : { targetBonusMode:
      oneOf(raw.targetBonusMode, ["none", "reuseSource", "custom"] as const, `${label}.targetBonusMode`) }),
    ...(raw.targetBattleBonuses === undefined ? {} : { targetBattleBonuses:
      importedModifiers(raw.targetBattleBonuses, `${label}.targetBattleBonuses`) }),
  };
}
function readHistoricalBonuses(value: unknown, label: string) {
  const raw = record(value, label);
  return Object.fromEntries((["attack", "defense", "penetration", "life"] as const).map((stat) => {
    const row = record(raw[stat], `${label}.${stat}`);
    return [stat, { additive: finite(row.additive, "additive"), buff: finite(row.buff, "buff"), debuff: finite(row.debuff, "debuff") }];
  })) as ValidationHistoricalBonuses;
}
function readHistoricalBonusMigration(value: unknown): HistoricalBonusMigration {
  const raw = record(value, "historicalBonusMigration");
  return { strategy: oneOf(raw.strategy, ["preserveRawAttributes"] as const, "historicalBonusMigration.strategy"),
    conflicts: array(raw.conflicts, "historicalBonusMigration.conflicts").map((entry) => {
      const row = record(entry, "conflict"), values = record(row.values, "conflict.values");
      return { attribute: oneOf(row.attribute, ["attack", "defense", "penetration", "life"] as const, "conflict.attribute"),
        field: oneOf(row.field, ["additive", "buff", "debuff"] as const, "conflict.field"),
        values: Object.fromEntries(TROOP_TYPES.map((t) => [t, finite(values[t], `conflict.values.${t}`)])) as Record<TroopType, number> };
    }) };
}

function persistBonusContexts(side: ValidationSideInput | ValidationQueueConfig) {
  return Object.fromEntries(["sourceReportBonuses", "historicalBonusMigration", "sourceReportAttributes", "reportAttributeBasis",
    "targetBonusMode", "targetBattleBonuses"].flatMap((key) => {
      const value = side[key as keyof typeof side];
      return value === undefined ? [] : [[key, value]];
    }));
}

function readRecognizedSpecialBonuses(value: unknown): NonNullable<ValidationQueueConfig["recognizedSpecialBonuses"]> {
  const raw = record(value, "recognizedSpecialBonuses");
  for (const group of ["additive", "buffs", "debuffs"] as const) {
    for (const item of array(raw[group], "recognizedSpecialBonuses." + group)) {
      const bonus = record(item, "specialBonus");
      oneOf(bonus.attribute, ["attack", "defense", "penetration", "life"] as const, "specialBonus.attribute");
      const amount = record(bonus.amount, "specialBonus.amount");
      finite(amount.value, "specialBonus.amount.value");
    }
  }
  return structuredClone(raw) as unknown as NonNullable<ValidationQueueConfig["recognizedSpecialBonuses"]>;
}

function readSide(value: unknown, label: string): ValidationSideInput {
  const raw = record(value, label);
  const troopData = record(raw.troops, `${label}.troops`);
  const troops = Object.fromEntries(TROOP_TYPES.map((type) => [type,
    troop(troopData[type], `${label}.troops.${type}`)])) as
      Record<TroopType, ValidationTroopInput>;
  const body = validateBodySkillConfigs(bodySkills(raw.bodySkills, `${label}.bodySkills`), [],
    "s16", label.includes("sideB") ? "B" : "A");
  const queues = raw.threeQueues === undefined ? undefined :
    array(raw.threeQueues, `${label}.threeQueues`);
  if (queues !== undefined && queues.length !== 3) {
    throw new Error(`${label}.threeQueues 必须恰好包含三个队列。`);
  }
  const threeQueues = queues?.map((queue, index): ValidationQueueConfig => {
    const entry = record(queue, `${label}.threeQueues[${index}]`);
    const bp = ratiosBp(entry.ratiosBp,
      `${label}.threeQueues[${index}].ratiosBp`);
    return { ratios: { shield: bp.shield / 100,
      lancer: bp.lancer / 100, marksman: bp.marksman / 100 },
    leaderHeroIds: heroMap(entry.leaderHeroIds,
      `${label}.threeQueues[${index}].leaderHeroIds`),
    ...(entry.reportHeroByTroop === undefined ? {} : { reportHeroByTroop:
      heroMap(entry.reportHeroByTroop, `${label}.threeQueues[${index}].reportHeroByTroop`) }),
    ...(entry.weaponLevels === undefined ? {} : { weaponLevels:
      weaponLevels(entry.weaponLevels, `${label}.threeQueues[${index}].weaponLevels`) }),
    ...(entry.t12Levels === undefined ? {} : { t12Levels: Object.fromEntries(TROOP_TYPES.map((troop) =>
      [troop, integer(record(entry.t12Levels, "t12Levels")[troop], "t12Levels." + troop, 0, 24)])) as Record<typeof TROOP_TYPES[number], number> }),
    ...(entry.recognizedSpecialBonuses === undefined ? {} : { recognizedSpecialBonuses: readRecognizedSpecialBonuses(entry.recognizedSpecialBonuses) }),
    ...(entry.reportWeaponLevels === undefined ? {} : { reportWeaponLevels:
      weaponLevels(entry.reportWeaponLevels, `${label}.threeQueues[${index}].reportWeaponLevels`) }),
    ...(entry.attributeSource === undefined ? {} : { attributeSource: oneOf(entry.attributeSource,
      ["manualInput", "basePanel", "importedReport"] as const, `${label}.threeQueues[${index}].attributeSource`) }),
    ...(entry.reportLineage === undefined ? {} : { reportLineage: (() => {
      const lineage = record(entry.reportLineage, `${label}.threeQueues[${index}].reportLineage`);
      return { ...(lineage.historicalLineageConfirmed === undefined ? {} : { historicalLineageConfirmed: boolean(lineage.historicalLineageConfirmed, "historicalLineageConfirmed") }), source: oneOf(lineage.source, ["historicalReport", "optimizerBaseline"] as const,
        `${label}.threeQueues[${index}].reportLineage.source`),
      attributeSnapshot: queueAttributes(lineage.attributeSnapshot,
        `${label}.threeQueues[${index}].reportLineage.attributeSnapshot`) };
    })() }),
    ...bonusContexts(entry, `${label}.threeQueues[${index}]`),
    attributes: queueAttributes(entry.attributes,
      `${label}.threeQueues[${index}].attributes`),
    ...(entry.importedReportModifiers === undefined ? {} : {
      importedReportModifiers: importedModifiers(entry.importedReportModifiers,
        `${label}.threeQueues[${index}].importedReportModifiers`) }),
    ...(entry.troopLevelCompositions === undefined ? {} : {
      troopLevelCompositions: queueLevelCompositions(entry.troopLevelCompositions,
        `${label}.threeQueues[${index}].troopLevelCompositions`) }),
    ...(entry.troopResolutionSources === undefined ? {} : {
      troopResolutionSources: Object.fromEntries(Object.entries(record(entry.troopResolutionSources,
        `${label}.threeQueues[${index}].troopResolutionSources`)).map(([troop, value]) =>
        [oneOf(troop, TROOP_TYPES, "troopResolutionSources.troop"),
          oneOf(value, ["battleReportApproximation", "userOverride"] as const,
            `troopResolutionSources.${troop}`)])) }),
    ...(entry.externalBuffs === undefined ? {} : {
      externalBuffs: externalBuffs(entry.externalBuffs) }),
    ...(entry.heroSkillLevels === undefined ? {} : {
      heroSkillLevels: Object.fromEntries(Object.entries(record(entry.heroSkillLevels,
        `${label}.threeQueues[${index}].heroSkillLevels`)).map(([skillId, value]) =>
        [skillId, integer(value, `${label}.threeQueues[${index}].heroSkillLevels.${skillId}`, 1, 5)])) }),
    troopLevels: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      level(record(entry.troopLevels,
        `${label}.threeQueues[${index}].troopLevels`)[troop],
      `${label}.threeQueues[${index}].troopLevels.${troop}`)])) as
        Record<TroopType, string> };
  }) as ValidationSideInput["threeQueues"];
  const importedReportModifiers = raw.importedReportModifiers === undefined ? undefined :
    importedModifiers(raw.importedReportModifiers, `${label}.importedReportModifiers`);
  const levels = raw.highestTroopLevels === undefined ? undefined :
    record(raw.highestTroopLevels, `${label}.highestTroopLevels`);
  const available = raw.availableTroopLevels === undefined ? undefined :
    array(raw.availableTroopLevels, `${label}.availableTroopLevels`).map((item) =>
      level(item, `${label}.availableTroopLevels`));
  const reportIds = array(raw.reportHeroIds, `${label}.reportHeroIds`).map((item) =>
    heroId(item, `${label}.reportHeroIds`));
  if (new Set(reportIds).size !== reportIds.length) {
    throw new Error(`${label}.reportHeroIds 存在重复英雄。`);
  }
  const legacyLeader = nullableHero(raw.leaderHeroId, `${label}.leaderHeroId`);
  const leaderMap = raw.leaderHeroIds === undefined ? undefined :
    heroMap(raw.leaderHeroIds, `${label}.leaderHeroIds`);
  const leaderIds = leaderMap === undefined
    ? (legacyLeader === null ? [] : [legacyLeader])
    : Object.values(leaderMap).filter((id): id is string => !!id);
  validateBodySkillConfigs(body, leaderIds, "s16");
  return {
    troops,
    ...bonusContexts(raw, label),
    ...(importedReportModifiers === undefined ? {} : { importedReportModifiers }),
    reportHeroIds: reportIds,
    leaderHeroId: legacyLeader,
    selectedMemberSkillIds: body.map((entry) => entry.skillId),
    ...(body.length === 0 ? {} : { bodySkills: body }),
    ...(raw.deploymentCapacity === undefined ? {} : { deploymentCapacity:
      integer(raw.deploymentCapacity, `${label}.deploymentCapacity`) }),
    ...(available === undefined ? {} : { availableTroopLevels: available }),
    ...(levels === undefined ? {} : { highestTroopLevels:
      Object.fromEntries(TROOP_TYPES.map((type) => [type,
        level(levels[type], `${label}.highestTroopLevels.${type}`)])) as
          Record<TroopType, string> }),
    ...(threeQueues === undefined ? {} : { threeQueues }),
    ...(raw.reportHeroByTroop === undefined ? {} : { reportHeroByTroop:
      heroMap(raw.reportHeroByTroop, `${label}.reportHeroByTroop`) }),
    ...(leaderMap === undefined ? {} : { leaderHeroIds: leaderMap }),
    ...(raw.reportWeaponLevels === undefined ? {} : { reportWeaponLevels:
      weaponLevels(raw.reportWeaponLevels, `${label}.reportWeaponLevels`) }),
    ...(raw.simulationWeaponLevels === undefined ? {} : { simulationWeaponLevels:
      weaponLevels(raw.simulationWeaponLevels, `${label}.simulationWeaponLevels`) }),
    ...(raw.externalBuffs === undefined ? {} : { externalBuffs:
      externalBuffs(raw.externalBuffs) }),
    ...(raw.queueOrder === undefined ? {} : { queueOrder: (() => {
      const order = array(raw.queueOrder, label + ".queueOrder").map((value) => integer(value, "queueOrder", 0, 2));
      if (order.length !== 3 || new Set(order).size !== 3) throw new Error("queueOrder必须是三队的排列。");
      return order as [number, number, number];
    })() }),
    ...(raw.shared === undefined ? {} : { shared: (() => {
      const shared = record(raw.shared, label + ".shared");
      const parsed = externalBuffs({ town: DEFAULT_EXTERNAL_BUFF_CONFIG.town, pet: shared.petContext, expert: shared.expertContext });
      return { petContext: parsed.pet, expertContext: parsed.expert,
        ...(shared.migrationWarnings === undefined ? {} : { migrationWarnings: array(shared.migrationWarnings, "shared.migrationWarnings").map((value) => String(value)) }) };
    })() }),
    ...(raw.leaderSkillLevels === undefined ? {} : { leaderSkillLevels:
      Object.fromEntries(Object.entries(record(raw.leaderSkillLevels,
        `${label}.leaderSkillLevels`)).map(([skillId, value]) =>
        [skillId, integer(value, `${label}.leaderSkillLevels.${skillId}`, 1, 5)])) }),
    ...(raw.rallyDeployment === undefined ? {} : { rallyDeployment: (() => {
      const deployment = record(raw.rallyDeployment, `${label}.rallyDeployment`);
      return { totalTroops: integer(deployment.totalTroops,
        `${label}.rallyDeployment.totalTroops`),
      ratios: ratiosPercent(deployment.ratios, `${label}.rallyDeployment.ratios`) };
    })() }),
    ...(raw.marchCapacityBonus === undefined ? {} : { marchCapacityBonus:
      finite(raw.marchCapacityBonus, `${label}.marchCapacityBonus`) }),
    ...(raw.rallyCapacityBonus === undefined ? {} : { rallyCapacityBonus:
      finite(raw.rallyCapacityBonus, `${label}.rallyCapacityBonus`) }),
    ...(raw.rallyFixedCapacityBonus === undefined ? {} : { rallyFixedCapacityBonus:
      integer(raw.rallyFixedCapacityBonus, `${label}.rallyFixedCapacityBonus`) }),
    ...(raw.petMarchCapacityLevel === undefined ? {} : { petMarchCapacityLevel:
      integer(raw.petMarchCapacityLevel, `${label}.petMarchCapacityLevel`, 0, 10) }),
  };
}

function readTheoryOptions(value: unknown): TheoryOptions {
  const fallback = defaultTheoryOptions();
  if (value === undefined) return fallback;
  const raw = record(value, "optimizer.theory");
  const positive = ["ratioStep", "localPeaksPerLineup", "minSurvivorsPerLineup", "deterministicRounds"] as const;
  const counts = ["randomExploration", "diversityExploration", "uncertaintyExploration"] as const;
  const result: TheoryOptions = { ...fallback,
    ...Object.fromEntries(positive.map((key) => [key, integer(raw[key] ?? fallback[key], `theory.${key}`, 1)])),
    ...Object.fromEntries(counts.map((key) => [key, integer(raw[key] ?? fallback[key], `theory.${key}`, 0)])),
    uncertaintyWeight: finite(raw.uncertaintyWeight ?? fallback.uncertaintyWeight, "theory.uncertaintyWeight"),
    probabilityEquivalentCoefficient: finite(raw.probabilityEquivalentCoefficient ?? fallback.probabilityEquivalentCoefficient,
      "theory.probabilityEquivalentCoefficient"),
    calibratedEquivalents: Object.fromEntries(Object.entries(record(raw.calibratedEquivalents ?? {}, "theory.calibratedEquivalents"))
      .map(([id, number]) => [id, finite(number, `theory.calibratedEquivalents.${id}`)])),
  };
  validateTheoryOptions(result);
  return result;
}
function readBasinSearch(value: unknown) {
  const raw = record(value, "basinSearch");
  const options = Object.fromEntries(Object.entries(raw).map(([key, value]) =>
    [key, integer(value, `basinSearch.${key}`, 1, 100)]));
  return resolveBasinSearchOptions(options);
}

function readMonteCarloStages(value: unknown): readonly { trials: number; keep: number }[] {
  const result = array(value, "optimizer.monteCarloStages").map((entry, i) => {
    const row = record(entry, `monteCarloStages[${i}]`);
    return { trials: integer(row.trials, `monteCarloStages[${i}].trials`, 1, 100_000),
      keep: integer(row.keep, `monteCarloStages[${i}].keep`, 1, 100_000) };
  });
  if (!result.length) throw new Error("monteCarloStages 不能为空。");
  return result;
}

function hasLegacyRallyRacing(value: unknown): boolean {
  if (value === undefined) return false;
  const raw = record(value, "optimizationConfig");
  if (raw.criterion === undefined) return true;
  const criterion = record(raw.criterion, "criterion");
  return criterion.racingVersion === undefined ||
    integer(criterion.racingVersion, "criterion.racingVersion", 0, 3) < 3;
}

function readRallyCriterion(value: unknown, migrateLegacyRacing: boolean) {
  const raw = value === undefined ? {} : record(value, "criterion");
  if (raw.racingVersion !== undefined) integer(raw.racingVersion, "criterion.racingVersion", 0, 3);
  // Saving a current API configuration marks it as current without changing its
  // explicit custom schedule. Only loading a legacy persisted configuration resets it.
  return resolveCriterionSearchOptions({ ...raw, racingVersion: 3,
    ...(migrateLegacyRacing ? {
      screeningTrials: DEFAULT_CRITERION_SEARCH.screeningTrials,
      screeningKeep: DEFAULT_CRITERION_SEARCH.screeningKeep,
    } : {}),
  });
}

function readOptimizerCandidates(value: unknown, label: string): RallyCandidate[] {
  return array(value, label).map((entry, i) => {
    const row = record(entry, `${label}[${i}]`), leaderHeroIds = heroMap(row.leaderHeroIds, `${label}.leaderHeroIds`);
    const memberSkillIds = array(row.memberSkillIds, `${label}.memberSkillIds`).map((id) => {
      const skill = string(id, "memberSkillId");
      if (!KNOWN_MEMBER_SKILL_IDS.has(skill)) throw new Error(`未知车身技能：${skill}。`);
      return skill;
    });
    if (memberSkillIds.length > 4) throw new Error("优化候选最多四个车身技能。");
    const bodySkillLevels = row.bodySkillLevels === undefined ? undefined : array(row.bodySkillLevels, "bodySkillLevels").map((n) => integer(n, "bodySkillLevel", 1, 5));
    if (bodySkillLevels && bodySkillLevels.length !== memberSkillIds.length) throw new Error("车身技能等级数量不一致。");
    return { leaderHeroIds, memberSkillIds, ratios: ratiosPercent(row.ratios, `${label}.ratios`),
      ...(row.headWeaponLevels === undefined ? {} : { headWeaponLevels: weaponLevels(row.headWeaponLevels, "headWeaponLevels") }),
      ...(bodySkillLevels === undefined ? {} : { bodySkillLevels }),
      ...(row.troopLevels === undefined ? {} : { troopLevels: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, level(record(row.troopLevels, "troopLevels")[troop], "troopLevel")])) as NonNullable<RallyCandidate["troopLevels"]> }) };
  });
}
function readOptimizationConfig(value: unknown, seed: number,
  stageId: ServerStageId, migrateLegacyRacing = false): OptimizationConfig {
  const fallback = defaultOptimizationConfig(seed);
  if (value === undefined) return fallback;
  const raw = record(value, "optimizationConfig");
  const racingMigrated = migrateLegacyRacing && hasLegacyRallyRacing(value);
  const stages = array(raw.stages, "optimizationConfig.stages");
  if (stages.length !== 3) throw new Error("optimizationConfig.stages 必须包含三段。");
  const numericKeys = ["verificationTrials", "verificationTop", "topN", "firstSeed",
    "maxWaves", "beamWidth", "branchWidth", "beamTrials"] as const;
  const maxByKey: Partial<Record<typeof numericKeys[number], number>> = {
    verificationTrials: 100_000, verificationTop: 1_000, topN: 1_000,
    maxWaves: 10, beamWidth: 20, branchWidth: 20, beamTrials: 100_000,
  };
  const numeric = Object.fromEntries(numericKeys.map((key) => [key,
    integer(raw[key], `optimizationConfig.${key}`, key === "firstSeed"
      ? Number.MIN_SAFE_INTEGER : 1, maxByKey[key] ?? Number.MAX_SAFE_INTEGER)])) as unknown as
        Pick<OptimizationConfig, typeof numericKeys[number]>;
  const constraintsRaw = record(raw.constraints, "optimizationConfig.constraints");
  const heroList = (key: "requiredHeroIds" | "forbiddenHeroIds" | "heroPoolIds") =>
    constraintsRaw[key] === undefined ? undefined :
      array(constraintsRaw[key], `optimizationConfig.constraints.${key}`)
        .map((id) => heroId(id, `optimizationConfig.constraints.${key}`))
        .filter((id) => isHeroAvailableAtStage(id, stageId));
  const memberIds = new Set(getAvailableMemberSkills(stageId).flatMap((group) =>
    group.sourceSkillIds));
  const fixedMemberSkillIds = constraintsRaw.fixedMemberSkillIds === undefined
    ? undefined : array(constraintsRaw.fixedMemberSkillIds,
      "optimizationConfig.constraints.fixedMemberSkillIds")
      .map((id) => {
        const skillId = string(id, "optimizationConfig.constraints.fixedMemberSkillIds");
        if (!KNOWN_MEMBER_SKILL_IDS.has(skillId)) {
          throw new Error(`未知车身技能：${skillId}。`);
        }
        return skillId;
      }).filter((id) => memberIds.has(id));
  const fixedLeadersRaw = constraintsRaw.fixedLeaders === undefined ? undefined :
    heroMap(constraintsRaw.fixedLeaders, "optimizationConfig.constraints.fixedLeaders");
  const allowedPositionsRaw = constraintsRaw.allowedPositions === undefined ? undefined :
    record(constraintsRaw.allowedPositions,
      "optimizationConfig.constraints.allowedPositions");
  const constraints: SearchConstraint = {
    ...(constraintsRaw.minGeneration === undefined ? {} : { minGeneration: Math.min(
      integer(constraintsRaw.minGeneration, "minGeneration", 1, 16),
      getServerStage(stageId).maxHeroGeneration) }),
    ...(heroList("requiredHeroIds") === undefined ? {} : {
      requiredHeroIds: heroList("requiredHeroIds")! }),
    ...(heroList("forbiddenHeroIds") === undefined ? {} : {
      forbiddenHeroIds: heroList("forbiddenHeroIds")! }),
    ...(heroList("heroPoolIds") === undefined ? {} : {
      heroPoolIds: heroList("heroPoolIds")! }),
    ...(fixedMemberSkillIds === undefined ? {} : { fixedMemberSkillIds }),
    ...(constraintsRaw.fixedBodyExact === undefined ? {} : {
      fixedBodyExact: boolean(constraintsRaw.fixedBodyExact,
        "optimizationConfig.constraints.fixedBodyExact") }),
    ...(fixedLeadersRaw === undefined ? {} : { fixedLeaders:
      Object.fromEntries(Object.entries(fixedLeadersRaw).filter(([, id]) =>
        id === null || isHeroAvailableAtStage(id, stageId))) }),
    ...(allowedPositionsRaw === undefined ? {} : { allowedPositions:
      Object.fromEntries(Object.entries(allowedPositionsRaw).flatMap(([id, positions]) => {
        heroId(id, "optimizationConfig.constraints.allowedPositions");
        if (!isHeroAvailableAtStage(id, stageId)) return [];
        return [[id, array(positions, `allowedPositions.${id}`).map((position) =>
          oneOf(position, ["leader", "member"] as const, `allowedPositions.${id}`))]];
      })) }),
    ...(constraintsRaw.allowDuplicateMembers === undefined ? {} : {
      allowDuplicateMembers: boolean(constraintsRaw.allowDuplicateMembers,
        "allowDuplicateMembers") }),
    ...(constraintsRaw.equivalentMemberPositions === undefined ? {} : {
      equivalentMemberPositions: boolean(constraintsRaw.equivalentMemberPositions,
        "equivalentMemberPositions") }),
  };
  const normalizedStages = stages.map((entry, index) => {
    const stage = record(entry, `optimizationConfig.stages[${index}]`);
    return { ratioStep: integer(stage.ratioStep, `stages[${index}].ratioStep`, 1, 100),
      trials: integer(stage.trials, `stages[${index}].trials`, 1, 100_000),
      keep: integer(stage.keep, `stages[${index}].keep`, 1, 100_000),
      maxCandidates: integer(stage.maxCandidates, `stages[${index}].maxCandidates`,
        1, 100_000) };
  }) as unknown as OptimizationConfig["stages"];
  const thresholdLow = probability(raw.singleFightThresholdLow,
    "optimizationConfig.singleFightThresholdLow");
  const thresholdHigh = probability(raw.singleFightThresholdHigh,
    "optimizationConfig.singleFightThresholdHigh");
  if (thresholdLow > thresholdHigh) {
    throw new Error("optimizationConfig 自动切换阈值顺序无效。");
  }
  let criterion = readRallyCriterion(raw.criterion, racingMigrated);
  let monteCarloStages = racingMigrated || raw.monteCarloStages === undefined ? undefined : readMonteCarloStages(raw.monteCarloStages);
  const sourceCriterion = raw.criterion === undefined ? {} : record(raw.criterion, "criterion");
  if (!racingMigrated && monteCarloStages === undefined && sourceCriterion.screeningTrials === undefined &&
    normalizedStages.some((stage, index) => stage.trials !== [20,50,100][index])) {
    // Materialize an explicit API legacy-stage override before adding complete v3
    // options; otherwise those complete options would silently suppress the override.
    const effective = resolveJointRacingSchedule({ stages: normalizedStages,
      criterion: { ...sourceCriterion, racingVersion: 3 },
      initialBattleTrials: integer(raw.initialBattleTrials ?? 5, "optimizationConfig.initialBattleTrials", 1, 100_000),
      verificationTop: numeric.verificationTop, verificationTrials: numeric.verificationTrials });
    if (effective.every((stage, index) => index === 0 || stage.trials > effective[index - 1]!.trials)) {
      criterion = resolveCriterionSearchOptions({ ...criterion, screeningTrials: effective.map((stage) => stage.trials),
        screeningKeep: effective.map((stage) => stage.keep) });
    } else {
      // Older APIs permitted repeated cumulative budgets. Preserve their sequential
      // budget cuts as an explicit schedule rather than flattening those stages.
      monteCarloStages = effective;
    }
  }
  return {
    ...fallback,
    ...numeric,
    candidateSide: oneOf(raw.candidateSide ?? "A", ["A", "B"] as const, "optimizationConfig.candidateSide"),
    ...(raw.jointPipeline === undefined ? {} : { jointPipeline: resolveJointPipelineOptions(record(raw.jointPipeline, "optimizationConfig.jointPipeline")) }),
    ...(racingMigrated ? { verificationTop: fallback.verificationTop } : {}),
    objectiveMode: oneOf(raw.objectiveMode, ["singleWin", "minRallies", "auto"] as const,
      "optimizationConfig.objectiveMode"),
    constraints,
    stages: normalizedStages,
    theory: readTheoryOptions(raw.theory),
    criterion,
    ...(raw.basinSearch === undefined ? {} : { basinSearch: readBasinSearch(raw.basinSearch) }),
    initialBattleTrials: racingMigrated ? DEFAULT_CRITERION_SEARCH.screeningTrials[0]! :
      integer(raw.initialBattleTrials ?? 5, "optimizationConfig.initialBattleTrials", 1, 100_000),
    ...(monteCarloStages === undefined ? {} : { monteCarloStages }),
    ...(raw.protectedCandidates === undefined ? {} : { protectedCandidates: readOptimizerCandidates(raw.protectedCandidates, "protectedCandidates")
      .filter((row) => Object.values(row.leaderHeroIds).every((id) => id === null || isHeroAvailableAtStage(id, stageId)) && row.memberSkillIds.every((id) => memberIds.has(id))) }),
    ...(raw.jointDebugCandidates === undefined ? {} : { jointDebugCandidates: readOptimizerCandidates(raw.jointDebugCandidates, "jointDebugCandidates") }),
    targetDefeatProbability: probability(raw.targetDefeatProbability,
      "optimizationConfig.targetDefeatProbability"),
    singleFightThresholdLow: thresholdLow,
    singleFightThresholdHigh: thresholdHigh,
  };
}

function readSimpleOptimizerOptions(value: unknown, seed: number):
  SimpleScenarioOptimizationOptions {
  if (value === undefined) return defaultSimpleScenarioOptimizationOptions(seed);
  const raw = record(value, "simpleOptimizerOptions");
  return {
    theory: readTheoryOptions(raw.theory),
    ...(raw.criterion === undefined ? {} : {criterion: resolveCriterionSearchOptions(record(raw.criterion,"criterion"))}),
    ...(raw.basinSearch === undefined ? {} : { basinSearch: readBasinSearch(raw.basinSearch) }),
    initialBattleTrials: integer(raw.initialBattleTrials ?? 10, "simpleOptimizerOptions.initialBattleTrials", 1, 100_000),
    intermediateTrials: integer(raw.intermediateTrials ?? 50, "simpleOptimizerOptions.intermediateTrials", 1, 100_000),
    ...(raw.monteCarloStages === undefined ? {} : { monteCarloStages: readMonteCarloStages(raw.monteCarloStages) }),
    side: oneOf(raw.side, ["A", "B"] as const, "simpleOptimizerOptions.side"),
    coarseTrials: integer(raw.coarseTrials, "simpleOptimizerOptions.coarseTrials", 1, 100_000),
    middleTrials: integer(raw.middleTrials, "simpleOptimizerOptions.middleTrials", 1, 100_000),
    verificationTrials: integer(raw.verificationTrials,
      "simpleOptimizerOptions.verificationTrials", 1, 100_000),
    topN: integer(raw.topN, "simpleOptimizerOptions.topN", 1, 10),
    seed: integer(raw.seed, "simpleOptimizerOptions.seed", Number.MIN_SAFE_INTEGER),
    fixedHeroes: boolean(raw.fixedHeroes, "simpleOptimizerOptions.fixedHeroes"),
    fixedRatio: boolean(raw.fixedRatio, "simpleOptimizerOptions.fixedRatio"),
  };
}

function readThreeQueueOptimizerOptions(value: unknown, seed: number):
  ThreeQueueOptimizationOptions {
  if (value === undefined) return defaultThreeQueueOptimizationOptions(seed);
  const raw = record(value, "threeQueueOptimizerOptions");
  const numbers = {
    initialCandidateCount: [1, 500], coarseSimulationCount: [1, 100_000],
    beamWidth: [1, 50], beamRounds: [1, 20],
    expansionsPerState: [1, 100], refinementCandidateCount: [1, 500],
    refinementSimulationCount: [1, 100_000], finalCandidateCount: [1, 20],
    finalValidationCount: [1, 100_000],
  } as const;
  const numeric = Object.fromEntries(Object.entries(numbers).map(([key, bounds]) =>
    [key, integer(raw[key], `threeQueueOptimizerOptions.${key}`,
      bounds[0], bounds[1])])) as unknown as Pick<ThreeQueueOptimizationOptions,
        keyof typeof numbers>;
  const locks = (key: "lockHeroes" | "lockRatios") => {
    const values = array(raw[key], `threeQueueOptimizerOptions.${key}`);
    if (values.length !== 3) throw new Error(`${key} 必须包含三个队列。`);
    return values.map((value, index) => boolean(value,
      `threeQueueOptimizerOptions.${key}[${index}]`)) as unknown as
        ThreeQueueOptimizationOptions[typeof key];
  };
  return { side: oneOf(raw.side, ["A", "B"] as const,
    "threeQueueOptimizerOptions.side"), ...numeric,
  rootSeed: integer(raw.rootSeed, "threeQueueOptimizerOptions.rootSeed",
    Number.MIN_SAFE_INTEGER), lockHeroes: locks("lockHeroes"),
  lockRatios: locks("lockRatios"),
    ...(raw.criterionEnabled===undefined?{}:{criterionEnabled:boolean(raw.criterionEnabled,"criterionEnabled")}),
    ...Object.fromEntries((["criterionCandidatesPerQueue", "criterionPairLimit", "criterionTripleLimit", "criterionTheoryLimit"] as const)
      .filter((key) => raw[key] !== undefined).map((key) => [key, integer(raw[key], key, 1, key === "criterionCandidatesPerQueue" ? 300 : 10000)])),
    enemyPermutationMode: raw.enemyPermutationMode === undefined ? "allPermutations" : oneOf(raw.enemyPermutationMode,
      ["fixedCurrent", "allPermutations", "worstCase"] as const, "enemyPermutationMode"),
    fixedOwnQueueOrder: raw.fixedOwnQueueOrder === undefined ? false : boolean(raw.fixedOwnQueueOrder, "fixedOwnQueueOrder"),
    ...Object.fromEntries((["formalStageTrials", "formalStageKeeps"] as const).filter((key) => raw[key] !== undefined)
      .map((key) => [key, array(raw[key], key).map((value) => integer(value, key, 1, key === "formalStageTrials" ? 100000 : 1000))])),
    ...(raw.criterionSchedulerTrials===undefined?{}:{criterionSchedulerTrials:integer(raw.criterionSchedulerTrials,"criterionSchedulerTrials",1,1000)}) };
}

function readInnerEarthReportHistory(value: unknown) {
  const raw = record(value, "innerEarth.reportHistory");
  return { reportAttributes: queueAttributes(raw.reportAttributes, "innerEarth.reportHistory.reportAttributes"),
    bonuses: readHistoricalBonuses(raw.bonuses, "innerEarth.reportHistory.bonuses"),
    ...(raw.historicalBonusMigration === undefined ? {} : { historicalBonusMigration: readHistoricalBonusMigration(raw.historicalBonusMigration) }),
    ...(raw.recognizedSpecialBonuses === undefined ? {} : { recognizedSpecialBonuses: readRecognizedSpecialBonuses(raw.recognizedSpecialBonuses) }) };
}
function readInnerEarth(value: unknown): InnerEarthConfig {
  const raw = record(value, "innerEarth");
  const ally = record(raw.ally, "innerEarth.ally");
  const enemy = record(raw.enemy, "innerEarth.enemy");
  const allyShared = record(ally.shared, "innerEarth.ally.shared");
  const enemyShared = record(enemy.shared, "innerEarth.enemy.shared");
  const three = (value: unknown, label: string): readonly unknown[] => {
    const result = array(value, label);
    if (result.length !== 3) throw new Error(`${label} 必须有三支队伍。`);
    return result;
  };
  const stats = (value: unknown, label: string) => queueAttributes(value, label);
  const troopRecord = <T>(value: unknown, label: string,
    read: (value: unknown, label: string) => T): Readonly<Record<TroopType, T>> => {
    const source = record(value, label);
    return Object.fromEntries(TROOP_TYPES.map((troop) =>
      [troop, read(source[troop], `${label}.${troop}`)])) as Record<TroopType, T>;
  };
  const queues = three(ally.queues, "innerEarth.ally.queues").map((value, index) => {
    const label = `innerEarth.ally.queues[${index}]`;
    const entry = record(value, label);
    return { heroes: heroMap(entry.heroes, `${label}.heroes`),
      ...(entry.reportHistory === undefined ? {} : { reportHistory: readInnerEarthReportHistory(entry.reportHistory) }),
      ...(entry.reportHeroes === undefined ? {} : {
        reportHeroes: heroMap(entry.reportHeroes, `${label}.reportHeroes`) }),
      ratio: ratiosPercent(entry.ratio, `${label}.ratio`),
      expectedReportStats: stats(entry.expectedReportStats, `${label}.expectedReportStats`),
      ...(entry.skillLevels === undefined ? {} : { skillLevels:
        Object.fromEntries(Object.entries(record(entry.skillLevels, `${label}.skillLevels`))
          .map(([id, level]) => [id, integer(level, `${label}.skillLevels.${id}`, 1, 5)])) }),
      ...(entry.weaponLevels === undefined ? {} : {
        weaponLevels: weaponLevels(entry.weaponLevels, `${label}.weaponLevels`) }),
      ...(entry.reportWeaponLevels === undefined ? {} : {
        reportWeaponLevels: weaponLevels(entry.reportWeaponLevels, `${label}.reportWeaponLevels`) }),
    };
  }) as unknown as InnerEarthConfig["ally"]["queues"];
  const enemyQueues = three(enemy.queues, "innerEarth.enemy.queues").map((value, index) => {
    const label = `innerEarth.enemy.queues[${index}]`;
    return { heroes: heroMap(record(value, label).heroes, `${label}.heroes`) };
  }) as unknown as InnerEarthConfig["enemy"]["queues"];
  return {
    subMode: oneOf(raw.subMode, ["HEART_OF_EARTH", "HERO_LAND", "BEAST_CAVE", "GEM_MINE",
      "UNDERGROUND_LAB", "EQUIPMENT_FORGE"] as const, "innerEarth.subMode"),
    ally: { shared: { capacity: integer(allyShared.capacity, "innerEarth.ally.shared.capacity", 1) },
      ...(ally.reportHistory === undefined ? {} : { reportHistory: readInnerEarthReportHistory(ally.reportHistory) }),
      queues, counts: troopRecord(ally.counts, "innerEarth.ally.counts", integer),
      reportStats: stats(ally.reportStats, "innerEarth.ally.reportStats"),
      troopTiers: troopRecord(ally.troopTiers, "innerEarth.ally.troopTiers", (value, label) =>
        oneOf(value, [...SUPPORTED_TROOP_LEVELS, "LAB_T11", "LAB_T12"] as const, label)),
      t12SkillLevels: troopRecord(ally.t12SkillLevels, "innerEarth.ally.t12SkillLevels", (value, label) =>
        integer(value, label, 0, raw.subMode === "UNDERGROUND_LAB" ? 3 : 24)),
    },
    enemy: { shared: {
      ...(enemyShared.reportHistory === undefined ? {} : { reportHistory: readInnerEarthReportHistory(enemyShared.reportHistory) }),
      capacity: integer(enemyShared.capacity, "innerEarth.enemy.shared.capacity", 1),
      troopRatioPreset: oneOf(enemyShared.troopRatioPreset, ["BALANCED", "SHIELD_HEAVY"] as const,
        "innerEarth.enemy.shared.troopRatioPreset"),
      expectedReportStats: stats(enemyShared.expectedReportStats,
        "innerEarth.enemy.shared.expectedReportStats"),
    }, queues: enemyQueues },
    ...(raw.petContext === undefined ? {} : { petContext: externalBuffs({
      ...DEFAULT_EXTERNAL_BUFF_CONFIG, pet: raw.petContext,
    }).pet }),
  };
}

function readInput(value: unknown): ValidationBattleInput {
  const raw = record(value, "data.input");
  const serverStage = oneOf(raw.serverStage, SERVER_STAGES.map((stage) => stage.id),
    "serverStage") as ServerStageId;
  const scenarioType = oneOf(raw.scenarioType,
    ["SINGLE", "THREE_THREE_THREE", "THREE_QUEUE", "ICE_FIRE_LEAGUE", "INNER_EARTH", "RALLY"] as const,
    "scenarioType");
  const simulationMode = oneOf(raw.simulationMode,
    ["fixedSeed", "random"] as const, "simulationMode");
  const attributeInputMode = oneOf(raw.attributeInputMode,
    ["finalReport", "prediction"] as const, "attributeInputMode");
  const postBattleCasualtyMode = oneOf(raw.postBattleCasualtyMode,
    ["NORMAL", "FURNACE"] as const, "postBattleCasualtyMode");
  const overrides = record(raw.triggerOverrides, "triggerOverrides");
  const triggerOverrides = Object.fromEntries(Object.entries(overrides).map(([key, mode]) =>
    [key, oneOf(mode, ["AUTO", "FORCE_TRIGGER", "FORCE_NOT_TRIGGER"] as const,
      `triggerOverrides.${key}`)]));
  const disabledSkillIds = array(raw.disabledSkillIds, "disabledSkillIds").map((id) =>
    string(id, "disabledSkillIds"));
  const actualRounds = array(raw.actualRounds, "actualRounds").map((entry, index) => {
    const row = record(entry, `actualRounds[${index}]`);
    return { round: integer(row.round, `actualRounds[${index}].round`, 1),
      ...(row.AtoB === undefined ? {} : { AtoB: finite(row.AtoB, "actualRounds.AtoB") }),
      ...(row.BtoA === undefined ? {} : { BtoA: finite(row.BtoA, "actualRounds.BtoA") }) };
  });
  const parsed: ValidationBattleInput = { serverStage, scenarioType,
    ...(raw.innerEarth === undefined ? {} : { innerEarth: readInnerEarth(raw.innerEarth) }),
    ...(raw.legacySceneMigration === undefined ? {} : { legacySceneMigration: (() => {
      const legacy = record(raw.legacySceneMigration, "legacySceneMigration");
      return { sourceScenario: oneOf(legacy.sourceScenario, ["THREE_QUEUE"] as const,
        "legacySceneMigration.sourceScenario"),
      sourceMode: oneOf(legacy.sourceMode, THREE_QUEUE_MODES, "legacySceneMigration.sourceMode"),
      originalSideA: readSide(legacy.originalSideA, "legacySceneMigration.originalSideA"),
      originalSideB: readSide(legacy.originalSideB, "legacySceneMigration.originalSideB"),
      warnings: array(legacy.warnings, "legacySceneMigration.warnings")
        .map((warning) => string(warning, "legacySceneMigration.warnings")) };
    })() }),
    ...(raw.threeQueueMode === undefined && scenarioType !== "THREE_QUEUE" ? {} : {
      threeQueueMode: oneOf(raw.threeQueueMode ?? DEFAULT_THREE_QUEUE_MODE,
        THREE_QUEUE_MODES, "threeQueueMode") }),
    ...(raw.availableHeroIds === undefined ? {} : { availableHeroIds:
      array(raw.availableHeroIds, "availableHeroIds").map((id) =>
        heroId(id, "availableHeroIds")) }),
    ...(raw.ownedHeroIds === undefined ? {} : { ownedHeroIds: array(raw.ownedHeroIds, "ownedHeroIds").map((id) => heroId(id, "ownedHeroIds")) }),
    ...(raw.rallyBodyPoolIds === undefined ? {} : { rallyBodyPoolIds: array(raw.rallyBodyPoolIds, "rallyBodyPoolIds").map((id) => heroId(id, "rallyBodyPoolIds")) }),
    ...(raw.optimizerHeroPool === undefined ? {} : { optimizerHeroPool: Object.fromEntries(Object.entries(record(raw.optimizerHeroPool, "optimizerHeroPool")).map(([side, entries]) => {
      oneOf(side, ["A", "B"] as const, "optimizerHeroPool.side");
      return [side, Object.fromEntries(Object.entries(record(entries, "optimizerHeroPool.entries")).map(([id, value]) => {
        heroId(id, "optimizerHeroPool.heroId"); const entry = record(value, "optimizerHeroPool.entry");
        return [id, { enabled: boolean(entry.enabled, "optimizerHeroPool.enabled"),
          weaponLevel: entry.weaponLevel === null ? null : integer(entry.weaponLevel, "optimizerHeroPool.weaponLevel", 0, 10) }];
      }))];
    })) }),
    battleContext: scenarioType === "RALLY" ? "rally" : "challenge",
    simulationMode, attributeInputMode: scenarioType === "THREE_QUEUE"
      ? "prediction" : attributeInputMode, postBattleCasualtyMode,
    sideA: readSide(raw.sideA, "sideA"),
    sideB: readSide(raw.sideB, "sideB"),
    maxRounds: integer(raw.maxRounds, "maxRounds", 1, 1500),
    randomSeed: integer(raw.randomSeed, "randomSeed", Number.MIN_SAFE_INTEGER),
    triggerOverrides, disabledSkillIds, actualRounds };
  if (scenarioType !== "INNER_EARTH") return scenarioType === "ICE_FIRE_LEAGUE"
    ? normalizeIceFireReportLineage({ ...parsed, threeQueueMode: "ICE_FIRE_LEAGUE" }) : parsed;
  // Missing data is only supported for the explicitly marked legacy scene migration.
  if (raw.innerEarth === undefined && parsed.legacySceneMigration !== undefined) {
    const normalized = normalizeInnerEarthInput(parsed);
    const earth = normalized.innerEarth!;
    const queueB1 = getValidationThreeQueues(parsed.sideB)[0];
    const heavy = { shield: 800 / 15, lancer: 400 / 15, marksman: 300 / 15 };
    const isHeavy = TROOP_TYPES.every((troop) => Math.abs(queueB1.ratios[troop] - heavy[troop]) <= .02);
    return { ...normalized, innerEarth: { ...earth, enemy: { ...earth.enemy,
      shared: { ...earth.enemy.shared,
        expectedReportStats: queueB1.attributes!,
        troopRatioPreset: isHeavy ? "SHIELD_HEAVY" : "BALANCED" } } } };
  }
  assertInnerEarthInput(parsed);
  return parsed;
}

function validateScenario(input: ValidationBattleInput): void {
  if (input.scenarioType === "INNER_EARTH") assertInnerEarthInput(input);
  if (isThreeQueueBattleInput(input)) {
    toValidationThreeQueueConfig(input);
  } else {
    createValidationPreviewState(input);
  }
}

function toPersistedSide(side: ValidationSideInput,
  stageId: ServerStageId, sideId: "A" | "B"): PersistedSideInput {
  const leaders = side.leaderHeroIds === undefined
    ? (side.leaderHeroId === null ? [] : [side.leaderHeroId])
    : Object.values(side.leaderHeroIds).filter((id): id is string => !!id);
  const body = side.bodySkills === undefined
    ? resolveBodySkillConfigs(side.selectedMemberSkillIds, leaders, stageId, sideId)
    : validateBodySkillConfigs(side.bodySkills, leaders, stageId, sideId);
  const queues = (side.threeQueues === undefined ? undefined :
    getValidationThreeQueues(side))?.map((queue): PersistedQueueConfig => ({
    leaderHeroIds: queue.leaderHeroIds,
    ...(queue.reportHeroByTroop === undefined ? {} : { reportHeroByTroop: queue.reportHeroByTroop }),
    ...(queue.weaponLevels === undefined ? {} : { weaponLevels: queue.weaponLevels }),
    ...(queue.reportWeaponLevels === undefined ? {} : { reportWeaponLevels: queue.reportWeaponLevels }),
    ...(queue.t12Levels === undefined ? {} : { t12Levels: queue.t12Levels }),
    ...(queue.recognizedSpecialBonuses === undefined ? {} : { recognizedSpecialBonuses: queue.recognizedSpecialBonuses }),
    ...(queue.attributeSource === undefined ? {} : { attributeSource: queue.attributeSource }),
    ...(queue.reportLineage === undefined ? {} : { reportLineage: queue.reportLineage }),
    ratiosBp: toThreeQueueBasisPoints(queue.ratios),
    attributes: queue.attributes!,
    ...persistBonusContexts(queue),
    ...(queue.importedReportModifiers === undefined ? {} : {
      importedReportModifiers: queue.importedReportModifiers }),
    troopLevels: queue.troopLevels!,
    ...(queue.troopLevelCompositions === undefined ? {} : { troopLevelCompositions: queue.troopLevelCompositions }),
    ...(queue.troopResolutionSources === undefined ? {} : { troopResolutionSources: queue.troopResolutionSources }),
    ...(queue.externalBuffs === undefined ? {} : { externalBuffs: queue.externalBuffs }),
    ...(queue.heroSkillLevels === undefined ? {} : { heroSkillLevels: queue.heroSkillLevels }),
  })) as PersistedSideInput["threeQueues"];
  return {
    troops: side.troops,
    ...persistBonusContexts(side),
    ...(side.importedReportModifiers === undefined ? {} : {
      importedReportModifiers: side.importedReportModifiers }),
    reportHeroIds: side.reportHeroIds,
    leaderHeroId: side.leaderHeroId,
    bodySkills: body,
    ...(side.deploymentCapacity === undefined ? {} : {
      deploymentCapacity: side.deploymentCapacity }),
    ...(side.availableTroopLevels === undefined ? {} : {
      availableTroopLevels: side.availableTroopLevels }),
    ...(side.highestTroopLevels === undefined ? {} : {
      highestTroopLevels: side.highestTroopLevels }),
    ...(queues === undefined ? {} : { threeQueues: queues }),
    ...(side.reportHeroByTroop === undefined ? {} : {
      reportHeroByTroop: side.reportHeroByTroop }),
    ...(side.leaderHeroIds === undefined ? {} : { leaderHeroIds: side.leaderHeroIds }),
    ...(side.reportWeaponLevels === undefined ? {} : {
      reportWeaponLevels: side.reportWeaponLevels }),
    ...(side.simulationWeaponLevels === undefined ? {} : {
      simulationWeaponLevels: side.simulationWeaponLevels }),
    ...(side.queueOrder === undefined ? {} : { queueOrder: side.queueOrder }),
    ...(side.shared === undefined ? {} : { shared: side.shared }),
    ...(side.externalBuffs === undefined ? {} : { externalBuffs: side.externalBuffs }),
    ...(side.leaderSkillLevels === undefined ? {} : { leaderSkillLevels: side.leaderSkillLevels }),
    ...(side.rallyDeployment === undefined ? {} : { rallyDeployment: side.rallyDeployment }),
    ...(side.marchCapacityBonus === undefined ? {} : {
      marchCapacityBonus: side.marchCapacityBonus }),
    ...(side.rallyCapacityBonus === undefined ? {} : {
      rallyCapacityBonus: side.rallyCapacityBonus }),
    ...(side.rallyFixedCapacityBonus === undefined ? {} : {
      rallyFixedCapacityBonus: side.rallyFixedCapacityBonus }),
    ...(side.petMarchCapacityLevel === undefined ? {} : {
      petMarchCapacityLevel: side.petMarchCapacityLevel }),
  };
}

export function createPersistedEnvelope(
  input: ValidationBattleInput,
  simulationCount: number,
  optimizationConfig?: OptimizationConfig,
  now = Date.now(),
  simpleOptimizerOptions?: SimpleScenarioOptimizationOptions,
  threeQueueOptimizerOptions?: ThreeQueueOptimizationOptions,
): PersistedConfigEnvelope {
  integer(simulationCount, "simulationCount", MIN_BATCH_SIMULATION_COUNT,
    MAX_BATCH_SIMULATION_COUNT);
  if (input.scenarioType === "INNER_EARTH") assertInnerEarthInput(input);
  const stageId = input.serverStage ?? "s16";
  const sanitized = sanitizeConfigForStage(normalizeIceFireReportLineage(normalizeHistoricalTree(input)), stageId);
  const scenarioType = sanitized.input.scenarioType ??
    (sanitized.input.battleContext === "rally" ? "RALLY" : "SINGLE");
  const normalized: ValidationBattleInput = normalizeIceFireReportLineage({ ...sanitized.input, scenarioType,
    ...(scenarioType === "THREE_QUEUE" ? {
      threeQueueMode: resolveThreeQueueMode(sanitized.input.threeQueueMode) } : {}),
    ...(scenarioType === "ICE_FIRE_LEAGUE" ? {
      threeQueueMode: "ICE_FIRE_LEAGUE" as const } : {}),
    battleContext: scenarioType === "RALLY" ? "rally" : "challenge",
    simulationMode: sanitized.input.simulationMode ?? "fixedSeed",
    attributeInputMode: sanitized.input.attributeInputMode ?? "finalReport",
    postBattleCasualtyMode: sanitized.input.postBattleCasualtyMode ?? "NORMAL" });
  validateScenario(normalized);
  const { legacySceneMigration, ...withoutLegacySnapshot } = normalized;
  const persistedInput: PersistedBattleInput = {
    ...withoutLegacySnapshot,
    ...(legacySceneMigration === undefined ? {} : { legacySceneMigration: {
      ...legacySceneMigration,
      originalSideA: toPersistedSide(legacySceneMigration.originalSideA, "s16", "A"),
      originalSideB: toPersistedSide(legacySceneMigration.originalSideB, "s16", "B"),
    } }),
    sideA: toPersistedSide(normalized.sideA, stageId, "A"),
    sideB: toPersistedSide(normalized.sideB, stageId, "B"),
  };
  const data: PersistedBattleSetup = { input: persistedInput,
    simulationCount,
    ...(optimizationConfig === undefined ? {} : { optimizationConfig:
      readOptimizationConfig(optimizationConfig, normalized.randomSeed, stageId) }),
    ...(simpleOptimizerOptions === undefined ? {} : { simpleOptimizerOptions:
      readSimpleOptimizerOptions(simpleOptimizerOptions, normalized.randomSeed) }),
    ...(threeQueueOptimizerOptions === undefined ? {} : { threeQueueOptimizerOptions:
      readThreeQueueOptimizerOptions(threeQueueOptimizerOptions,
        normalized.randomSeed) }) };
  return { schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    savedAt: integer(now, "savedAt"), data };
}

export function restorePersistedConfig(raw: unknown,
  options: { readonly validateBattleState?: boolean } = {}): RestoredBattleSetup {
  const migrated = migratePersistedConfig(raw);
  const envelope = record(migrated.envelope, "envelope");
  integer(envelope.savedAt, "savedAt");
  const data = record(envelope.data, "data");
  const input = readInput(record(data.input, "data.input"));
  const stageSanitized = sanitizeConfigForStage(input, input.serverStage!);
  const normalized = normalizeIceFireReportLineage(stageSanitized.input);
  const reconciled = reconcileLegacyHeroOwnership(normalized);
  const sanitized = { input: reconciled, changed: stageSanitized.changed || reconciled !== normalized };
  if (options.validateBattleState !== false) validateScenario(sanitized.input);
  const optimizationConfig = readOptimizationConfig(data.optimizationConfig,
    sanitized.input.randomSeed, sanitized.input.serverStage!, true);
  const optimizerAdjusted = data.optimizationConfig !== undefined &&
    JSON.stringify(optimizationConfig) !== JSON.stringify(readOptimizationConfig(
      data.optimizationConfig, sanitized.input.randomSeed, "s16", true));
  return { input: sanitized.input,
    simulationCount: integer(data.simulationCount, "simulationCount",
      MIN_BATCH_SIMULATION_COUNT, MAX_BATCH_SIMULATION_COUNT),
    optimizationConfig,
    simpleOptimizerOptions: readSimpleOptimizerOptions(data.simpleOptimizerOptions,
      sanitized.input.randomSeed),
    threeQueueOptimizerOptions: readThreeQueueOptimizerOptions(
      data.threeQueueOptimizerOptions, sanitized.input.randomSeed),
    adjusted: sanitized.changed || optimizerAdjusted,
    migrated: migrated.migrated,
    sceneMigrated: migrated.sceneMigrated,
    ...(input.legacySceneMigration === undefined ? {} : {
      sceneMigrationWarnings: input.legacySceneMigration.warnings }),
    ...(hasLegacyRallyRacing(data.optimizationConfig) ? { optimizerRacingMigrated: true } : {}),
    ...(reconciled !== normalized ? { headPoolOwnershipMigrated: true } : {}),
    queueAttributesMigrated: migrated.queueAttributesMigrated };
}

export function parsePersistedJson(json: string,
  options: { readonly validateBattleState?: boolean } = {}): RestoredBattleSetup {
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch { throw new Error("JSON 格式损坏，无法读取配置。"); }
  return restorePersistedConfig(raw, options);
}

export function exportPersistedJson(input: ValidationBattleInput,
  simulationCount: number, optimizationConfig?: OptimizationConfig,
  simpleOptimizerOptions?: SimpleScenarioOptimizationOptions,
  threeQueueOptimizerOptions?: ThreeQueueOptimizationOptions): string {
  return JSON.stringify(createPersistedEnvelope(input, simulationCount,
    optimizationConfig, Date.now(), simpleOptimizerOptions,
    threeQueueOptimizerOptions), null, 2);
}
