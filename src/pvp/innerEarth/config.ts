import { isSupportedTroopLevel } from "../data/troopConstants";
import { getServerStage, isHeroAvailableAtStage, isTroopLevelAvailableAtStage,
  clampTroopLevelToStage, type ServerStageId } from "../progression/serverStage";
import { requireExpeditionHeroData } from "../heroSkills/data/expeditionHeroes";
import { DEFAULT_EXTERNAL_BUFF_CONFIG, resolveExternalBuffs } from "../externalBuffs";
import { TROOP_TYPES, type TroopType } from "../types/combat";
import { allocateRallyTroopsByRatio } from "../validationUi/rallyDeployment";
import type { RallyTroopRatios } from "../validationUi/rallyDeployment";
import type { ValidationBattleInput, ValidationQueueAttributes, ValidationSideInput } from "../validationUi/types";
import { getInnerEarthRule, INNER_EARTH_LAB_CONSTANTS } from "./rules";
import { innerEarthAttributeSchema, normalizeAttributeSchema } from "../validationUi/attributeSchema";
import { INNER_EARTH_ENEMY_PRESETS, type InnerEarthAllyQueue, type InnerEarthConfig,
  type InnerEarthEnemyRatioPreset, type InnerEarthMode } from "./types";

const EMPTY_HEAD = { shield: null, lancer: null, marksman: null } as const;
const T10_TIERS = { shield: "T10", lancer: "T10", marksman: "T10" } as const;
const ZERO_LEVELS = { shield: 0, lancer: 0, marksman: 0 } as const;
export function innerEarthEnemyRatios(preset: InnerEarthEnemyRatioPreset): RallyTroopRatios {
  if (preset === "BALANCED") return { shield: 100 / 3, lancer: 100 / 3, marksman: 100 / 3 };
  if (preset === "SHIELD_HEAVY") return { shield: 800 / 15, lancer: 400 / 15, marksman: 300 / 15 };
  throw new RangeError(`地心敌方比例只允许两个预设，收到：${String(preset)}`);
}
export function innerEarthEnemyCounts(capacity: number, preset: InnerEarthEnemyRatioPreset):
  Readonly<Record<TroopType, number>> {
  // Exact integer weights avoid decimal rounding for thirds / fifteenths.
  innerEarthEnemyRatios(preset);
  const weights = preset === "BALANCED" ? [1, 1, 1] : [8, 4, 3];
  assertCapacity(capacity, "敌方容量");
  const denominator = BigInt(weights.reduce((sum, value) => sum + value, 0));
  const products = weights.map((weight) => BigInt(capacity) * BigInt(weight));
  const counts = products.map((product) => product / denominator);
  const order = [0, 1, 2].sort((a, b) => {
    const left = products[a]! % denominator, right = products[b]! % denominator;
    return left === right ? a - b : left > right ? -1 : 1;
  });
  const remainder = Number(BigInt(capacity) - counts.reduce((sum, value) => sum + value, 0n));
  for (let i = 0; i < remainder; i += 1) counts[order[i]!]! += 1n;
  return { shield: Number(counts[0]!), lancer: Number(counts[1]!), marksman: Number(counts[2]!) };
}
function statsFromSide(side: ValidationSideInput): ValidationQueueAttributes {
  return Object.fromEntries(TROOP_TYPES.map((troop) => {
    const { attack, defense, penetration, life } = side.troops[troop];
    return [troop, { attack, defense, penetration, life }];
  })) as ValidationQueueAttributes;
}
function countFromSide(side: ValidationSideInput): Readonly<Record<TroopType, number>> {
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop, side.troops[troop].count])) as Record<TroopType, number>;
}
function total(side: ValidationSideInput): number {
  return TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0);
}
function defaultAllyQueue(input: ValidationBattleInput, index: number): InnerEarthAllyQueue {
  const queue = input.sideA.threeQueues?.[index];
  const heroes = queue?.leaderHeroIds ?? input.sideA.leaderHeroIds ?? EMPTY_HEAD;
  const weaponLevels = Object.fromEntries(Object.entries(queue?.weaponLevels ??
    input.sideA.simulationWeaponLevels ?? {}).filter(([hero]) => Object.values(heroes).includes(hero)));
  return {
    heroes: { ...heroes }, reportHeroes: { ...heroes },
    ratio: { ...(queue?.ratios ?? { shield: 34, lancer: 33, marksman: 33 }) },
    expectedReportStats: structuredClone(queue?.attributes ?? statsFromSide(input.sideA)),
    skillLevels: { ...(queue?.heroSkillLevels ?? input.sideA.leaderSkillLevels ?? {}) },
    weaponLevels, reportWeaponLevels: { ...weaponLevels },
  };
}
export function createDefaultInnerEarthConfig(input: ValidationBattleInput,
  subMode: InnerEarthMode = "HEART_OF_EARTH"): InnerEarthConfig {
  const ally = input.sideA;
  const enemy = input.sideB;
  const config: InnerEarthConfig = {
    subMode,
    ally: { shared: { capacity: ally.deploymentCapacity ?? total(ally) },
      queues: [defaultAllyQueue(input, 0), defaultAllyQueue(input, 1), defaultAllyQueue(input, 2)],
      counts: countFromSide(ally), reportStats: statsFromSide(ally),
      troopTiers: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
        ally.highestTroopLevels?.[troop] ?? ally.troops[troop].troopLevel])) as Record<TroopType, string>,
      t12SkillLevels: subMode === "HEART_OF_EARTH" ? Object.fromEntries(TROOP_TYPES.map((troop) =>
        [troop, ally.troops[troop].t12Level ?? 0])) as Record<TroopType, number> : ZERO_LEVELS },
    enemy: { shared: { capacity: enemy.deploymentCapacity ?? total(enemy),
      troopRatioPreset: "BALANCED", expectedReportStats: statsFromSide(enemy) },
      queues: [0, 1, 2].map((i) => ({ heroes: { ...(enemy.threeQueues?.[i]?.leaderHeroIds ??
        enemy.leaderHeroIds ?? EMPTY_HEAD) } })) as unknown as InnerEarthConfig["enemy"]["queues"] },
    ...(subMode === "HEART_OF_EARTH" ? { petContext: { ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet } } : {}),
  };
  return bindConfigToRule(config);
}
/** Draft reads never run simulation/save validation, so ratio fields can be edited independently. */
export function getInnerEarthConfig(input: ValidationBattleInput): InnerEarthConfig {
  return input.innerEarth ?? createDefaultInnerEarthConfig(input);
}
function bindConfigToRule(config: InnerEarthConfig): InnerEarthConfig {
  config = expandInnerEarthAttributes(config);
  const rule = getInnerEarthRule(config.subMode);
  const noHeroes = rule.heroMode === "empty";
  const troopTiers = rule.troopTierMode === "fixedT10" ? T10_TIERS :
    rule.troopTierMode === "laboratory" ? Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      config.ally.troopTiers[troop] in INNER_EARTH_LAB_CONSTANTS ? config.ally.troopTiers[troop] : "T10"])) as
        Record<TroopType, string> : Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
          isSupportedTroopLevel(config.ally.troopTiers[troop]) ? config.ally.troopTiers[troop] : "T10"])) as
            Record<TroopType, string>;
  const { petContext: _pet, ...withoutPet } = config;
  void _pet;
  return { ...withoutPet,
    ally: { ...config.ally, shared: { capacity: rule.allyCapacity ?? config.ally.shared.capacity }, troopTiers,
      t12SkillLevels: !rule.allowT12Skill ? ZERO_LEVELS : rule.troopTierMode === "laboratory" ?
        Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
          troopTiers[troop] === "LAB_T12" ? config.ally.t12SkillLevels[troop] : 0])) as
            Record<TroopType, number> : config.ally.t12SkillLevels,
      queues: config.ally.queues.map((queue) => noHeroes ? { ...queue, heroes: EMPTY_HEAD,
        reportHeroes: EMPTY_HEAD, skillLevels: {}, weaponLevels: {}, reportWeaponLevels: {} } : queue) as unknown as InnerEarthConfig["ally"]["queues"] },
    enemy: { ...config.enemy, shared: { ...config.enemy.shared,
      capacity: rule.enemyCapacityMode === "fixed150000" ? 150000 : config.enemy.shared.capacity },
      queues: config.enemy.queues.map((queue) => noHeroes ? { heroes: EMPTY_HEAD } : queue) as
        unknown as InnerEarthConfig["enemy"]["queues"] },
    ...(rule.allowPet ? { petContext: config.petContext ?? { ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet } } : {}),
  };
}
/** Mode input constraints are expanded before any formal or numerical evaluator. */
export function expandInnerEarthAttributes(config: InnerEarthConfig): InnerEarthConfig {
  const allySchema = innerEarthAttributeSchema(config.subMode, "ally");
  return { ...config, ally: { ...config.ally,
    reportStats: normalizeAttributeSchema(allySchema, config.ally.reportStats),
    queues: config.ally.queues.map((queue) => ({ ...queue,
      expectedReportStats: normalizeAttributeSchema(allySchema, queue.expectedReportStats) })) as unknown as InnerEarthConfig["ally"]["queues"] },
    enemy: { ...config.enemy, shared: { ...config.enemy.shared,
      expectedReportStats: normalizeAttributeSchema(innerEarthAttributeSchema(config.subMode, "enemy"), config.enemy.shared.expectedReportStats) } } };
}
/** Explicit UI mode transition; unlike assert, it may bind fixed fields to a newly selected rule. */
export function normalizeInnerEarthInput(input: ValidationBattleInput,
  config = getInnerEarthConfig(input)): ValidationBattleInput {
  const bound = bindConfigToRule(config);
  return { ...input, scenarioType: "INNER_EARTH", innerEarth: bound,
    attributeInputMode: getInnerEarthRule(bound.subMode).inputMode, battleContext: "challenge",
    threeQueueMode: "EARTH_HEART_BRAVE_LAND" };
}
function assertCapacity(capacity: number, label: string): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError(`${label}必须为非负安全整数。`);
}
function assertStats(stats: ValidationQueueAttributes, label: string): void {
  for (const troop of TROOP_TYPES) for (const stat of ["attack", "defense", "penetration", "life"] as const) {
    if (!Number.isFinite(stats?.[troop]?.[stat]) || 1 + stats[troop][stat] / 100 <= 0) {
      throw new RangeError(`${label}.${troop}.${stat}战报属性因子无效。`);
    }
  }
}
export function assertInnerEarthInput(input: ValidationBattleInput): void {
  if (input.innerEarth === undefined) throw new RangeError("地心模式缺少专用配置。");
  const config = input.innerEarth;
  const rule = getInnerEarthRule(config.subMode);
  const stage = input.serverStage ?? "s16";
  getServerStage(stage);
  if (input.attributeInputMode !== rule.inputMode) throw new RangeError(`${rule.label}仅允许${rule.inputMode}属性模式。`);
  if (!INNER_EARTH_ENEMY_PRESETS.includes(config.enemy.shared.troopRatioPreset))
    throw new RangeError("地心敌方比例只允许两个预设。");
  assertCapacity(config.ally.shared.capacity, "我方容量");
  assertCapacity(config.enemy.shared.capacity, "敌方容量");
  if (rule.allyCapacity !== null && config.ally.shared.capacity !== rule.allyCapacity)
    throw new RangeError(`${rule.label}我方容量固定${rule.allyCapacity}。`);
  if (rule.enemyCapacityMode === "fixed150000" && config.enemy.shared.capacity !== 150000)
    throw new RangeError(`${rule.label}敌方容量固定150000。`);
  if (config.ally.queues.length !== 3 || config.enemy.queues.length !== 3)
    throw new RangeError("地心配置必须保留三个队列位置。");
  if (rule.heroMode === "threeQueues" && (config.ally.shared.capacity < 1 || config.enemy.shared.capacity < 1))
    throw new RangeError("地心三队列共享容量必须为正整数。");
  assertStats(config.enemy.shared.expectedReportStats, "enemy.shared.stats");
  if (rule.heroMode === "threeQueues") config.ally.queues.forEach((queue, i) => {
    assertStats(queue.expectedReportStats, `ally.queue${i + 1}.stats`);
    allocateRallyTroopsByRatio({ totalTroops: config.ally.shared.capacity, ratios: queue.ratio });
  });
  else {
    assertStats(config.ally.reportStats, "ally.stats");
    for (const troop of TROOP_TYPES) assertCapacity(config.ally.counts[troop], `ally.${troop}.count`);
    for (const queue of [...config.ally.queues, ...config.enemy.queues]) {
      if (Object.values(queue.heroes).some((hero) => !!hero)) throw new RangeError(`${rule.label}使用EMPTY_HEAD。`);
      const allyQueue = queue as InnerEarthAllyQueue;
      if (Object.values(allyQueue.reportHeroes ?? {}).some((hero) => !!hero) ||
        Object.keys(allyQueue.weaponLevels ?? {}).length > 0 || Object.keys(allyQueue.reportWeaponLevels ?? {}).length > 0 ||
        Object.keys(allyQueue.skillLevels ?? {}).length > 0)
        throw new RangeError(`${rule.label}不允许专武或英雄技能配置。`);
    }
  }
  for (const troop of TROOP_TYPES) {
    const tier = config.ally.troopTiers[troop];
    if (rule.troopTierMode === "fixedT10" && tier !== "T10") throw new RangeError(`${rule.label}双方固定T10。`);
    if (rule.troopTierMode === "laboratory" && !(tier in INNER_EARTH_LAB_CONSTANTS))
      throw new RangeError("地下研究所仅允许T10、T11无火晶、T12无火晶。");
    if (rule.troopTierMode === "player" && !isSupportedTroopLevel(tier)) throw new RangeError(`未知兵种等级：${tier}`);
    if (rule.troopTierMode === "player" && !isTroopLevelAvailableAtStage(tier, stage))
      throw new RangeError(`地心我方${troop}兵种等级${tier}超出服务器阶段${stage}。`);
    const level = config.ally.t12SkillLevels[troop];
    if (!Number.isSafeInteger(level) || level < 0 || level > rule.t12SkillMaxLevel)
      throw new RangeError(`${rule.label}T12技能等级只允许0-${rule.t12SkillMaxLevel}。`);
    if (rule.troopTierMode === "laboratory" && tier !== "LAB_T12" && level !== 0)
      throw new RangeError("地下研究所只有T12无火晶兵可启用T12技能。");
  }
  if (config.petContext !== undefined) {
    const keys = Object.keys(DEFAULT_EXTERNAL_BUFF_CONFIG.pet);
    if (Object.keys(config.petContext).some((key) => !keys.includes(key)))
      throw new RangeError("地心宠物仅允许已确认非容量战斗技能。");
    if (!rule.allowPet && Object.values(config.petContext).some((value) => value !== 0))
      throw new RangeError(`${rule.label}不允许宠物。`);
    resolveExternalBuffs({ ...DEFAULT_EXTERNAL_BUFF_CONFIG, pet: config.petContext });
  }
  for (const object of [config, config.ally, config.enemy, config.ally.shared, config.enemy.shared,
    ...config.ally.queues, ...config.enemy.queues]) {
    const hidden = object as unknown as Record<string, unknown>;
    for (const key of ["externalBuffs", "expert", "drug", "town", "petMarchCapacityLevel", "fireCrystalLevel"])
      if (hidden[key] !== undefined) throw new RangeError(`地心专用配置不接受${key}。`);
    if (object !== config && hidden.petContext !== undefined) throw new RangeError("敌方/队列不允许独立宠物。");
  }
  for (const queue of [...config.ally.queues, ...config.enemy.queues]) {
    if ((queue as unknown as Record<string, unknown>).capacity !== undefined)
      throw new RangeError("地心队列仅可使用shared.capacity，不能单独填写队列容量。");
  }
  for (const queue of config.enemy.queues) {
    if (Object.keys(queue).some((key) => key !== "heroes"))
      throw new RangeError("地心敌方队列仅允许不同heroes；容量、比例、属性必须共享。");
  }
  if (rule.heroMode === "threeQueues") for (const [side, queues] of [["ally", config.ally.queues],
    ["enemy", config.enemy.queues]] as const) {
    const seen = new Set<string>();
    for (const [i, queue] of queues.entries()) {
      for (const troop of TROOP_TYPES) {
        const hero = queue.heroes[troop];
        if (!hero) continue;
        if (!isHeroAvailableAtStage(hero, stage)) throw new RangeError(`${side}${i + 1}英雄${hero}超出服务器阶段${stage}。`);
        if (requireExpeditionHeroData(hero).stats.troopType !== troop) throw new RangeError(`${side}${i + 1}英雄${hero}兵种位置无效。`);
        if (seen.has(hero)) throw new RangeError(`${side}方三队列英雄不能重复：${hero}`);
        seen.add(hero);
      }
      const allyQueue = queue as InnerEarthAllyQueue;
      for (const troop of TROOP_TYPES) {
        const baseline = allyQueue.reportHeroes?.[troop];
        if (baseline && (!isHeroAvailableAtStage(baseline, stage) || requireExpeditionHeroData(baseline).stats.troopType !== troop))
          throw new RangeError(`${side}${i + 1}基础战报英雄${baseline}不符合服务器阶段或兵种位置。`);
      }
      for (const map of [allyQueue.weaponLevels, allyQueue.reportWeaponLevels]) for (const [hero, level] of Object.entries(map ?? {})) {
        if (!isHeroAvailableAtStage(hero, stage) || !Number.isSafeInteger(level) || level < 0 || level > 10)
          throw new RangeError(`${side}${i + 1}专武${hero}等级或服务器阶段无效。`);
      }
    }
  }
}

/** Explicit stage transition, reusing the ordinary catalog's stage policies. */
export function sanitizeInnerEarthForStage(input: ValidationBattleInput,
  stage: ServerStageId): ValidationBattleInput {
  getServerStage(stage);
  const config = getInnerEarthConfig(input), rule = getInnerEarthRule(config.subMode);
  const cleanHeroes = (heroes: InnerEarthAllyQueue["heroes"]) => Object.fromEntries(Object.entries(heroes)
    .map(([troop, hero]) => [troop, hero && isHeroAvailableAtStage(hero, stage) ? hero : null]));
  const cleanWeapons = (map: Readonly<Record<string, number>> | undefined) => map === undefined ? {} :
    Object.fromEntries(Object.entries(map).filter(([hero]) => isHeroAvailableAtStage(hero, stage)));
  return normalizeInnerEarthInput({ ...input, serverStage: stage }, { ...config,
    ally: { ...config.ally, queues: config.ally.queues.map((queue) => ({ ...queue,
      heroes: cleanHeroes(queue.heroes), reportHeroes: cleanHeroes(queue.reportHeroes ?? queue.heroes),
      weaponLevels: cleanWeapons(queue.weaponLevels), reportWeaponLevels: cleanWeapons(queue.reportWeaponLevels) })) as
        unknown as InnerEarthConfig["ally"]["queues"],
      troopTiers: rule.troopTierMode === "player" ? Object.fromEntries(TROOP_TYPES.map((troop) =>
        [troop, clampTroopLevelToStage(config.ally.troopTiers[troop], stage)])) as Record<TroopType, string> : config.ally.troopTiers },
    enemy: { ...config.enemy, queues: config.enemy.queues.map((queue) => ({ heroes: cleanHeroes(queue.heroes) })) as
      unknown as InnerEarthConfig["enemy"]["queues"] },
  });
}
