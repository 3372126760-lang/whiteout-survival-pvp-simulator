import { DEFAULT_BATCH_SIMULATION_COUNT } from "../pvp/validationUi/batchSimulation";
import { getValidationCatalog } from "../pvp/validationUi/catalog";
import { highestConfiguredTroopLevel } from "../pvp/scenario/scenarioTypes";
import { toThreeQueueBasisPoints } from "../pvp/scenario/threeQueueRatios";
import { CURRENT_CONFIG_SCHEMA_VERSION } from "./storageTypes";
import { normalizeHistoricalTree } from "../pvp/validationUi/historicalBonuses";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject : null;
}

function legacyBodySkill(value: unknown): JsonObject {
  const old = object(value);
  if (old === null || typeof old.heroId !== "string") {
    throw new Error("旧车身配置缺少 heroId。");
  }
  const sources = getValidationCatalog().memberSkills.flatMap((group) =>
    group.sourceHeroIds.map((heroId, index) => ({ heroId,
      skillId: group.sourceSkillIds[index]! })));
  const source = sources.find((entry) => entry.heroId === old.heroId);
  if (source === undefined) throw new Error(`旧车身英雄 ${old.heroId} 没有可用远征一技能。`);
  const nested = object(old.expeditionSkillSlot1) ?? object(old.skill1);
  const level = old.skillLevel ?? nested?.level ?? 5;
  return { heroId: source.heroId, skillId: source.skillId,
    expeditionSkillSlot: 1, skillLevel: level };
}

function migrateSide(value: unknown): unknown {
  const side = object(value);
  if (side === null) return value;
  const highestTroopLevels = side.highestTroopLevels ??
    (typeof side.highestTroopLevel === "string" ? {
      shield: side.highestTroopLevel,
      lancer: side.highestTroopLevel,
      marksman: side.highestTroopLevel,
    } : undefined);
  const legacyBodies = Array.isArray(side.bodyHeroes)
    ? side.bodyHeroes : side.bodyHero === undefined ? [] : [side.bodyHero];
  const bodySkills = side.bodySkills ?? (legacyBodies.length > 0
    ? legacyBodies.map(legacyBodySkill)
    : Array.isArray(side.selectedMemberSkillIds)
      ? side.selectedMemberSkillIds.flatMap((skillId) => {
        const group = getValidationCatalog().memberSkills.find((entry) =>
          entry.sourceSkillIds.includes(skillId));
        const index = group?.sourceSkillIds.indexOf(skillId) ?? -1;
        return index < 0 ? [] : [{ heroId: group!.sourceHeroIds[index]!,
          skillId, expeditionSkillSlot: 1, skillLevel: 5 }];
      }) : []);
  const threeQueues = Array.isArray(side.threeQueues)
    ? side.threeQueues.map((queue) => {
      const entry = object(queue);
      if (entry === null || entry.ratiosBp !== undefined) return queue;
      const ratios = object(entry.ratios);
      if (ratios === null) return queue;
      return { ...entry,
        ratiosBp: toThreeQueueBasisPoints(ratios as never) };
    }) : side.threeQueues;
  return { ...side, highestTroopLevels, bodySkills, threeQueues };
}

function migrateQueueAttributes(value: unknown): unknown {
  const side = object(value);
  if (side === null || !Array.isArray(side.threeQueues)) return value;
  const troops = object(side.troops);
  if (troops === null) return value;
  const sharedAttributes = object(side.attributes);
  const highest = object(side.highestTroopLevels);
  const available = Array.isArray(side.availableTroopLevels)
    ? side.availableTroopLevels.filter((level): level is string =>
      typeof level === "string") : [];
  const legacyLevel = available.length === 0 ? null
    : highestConfiguredTroopLevel(available);
  const attributes = Object.fromEntries(["shield", "lancer", "marksman"].map(
    (troop) => {
      const values = object(troops[troop]);
      const nested = object(sharedAttributes?.[troop]);
      const field = (name: string): unknown => nested?.[name] ??
        sharedAttributes?.[`${troop}${name[0]!.toUpperCase()}${name.slice(1)}`] ??
        values?.[name];
      return [troop, { attack: field("attack"), defense: field("defense"),
        penetration: field("penetration"), life: field("life") }];
    }));
  const troopLevels = Object.fromEntries(["shield", "lancer", "marksman"].map(
    (troop) => [troop, highest?.[troop] ?? legacyLevel ??
      object(troops[troop])?.troopLevel]));
  return { ...side, threeQueues: side.threeQueues.map((queue) => {
    const entry = object(queue);
    return entry === null ? queue : { ...entry,
      attributes: entry.attributes ?? attributes,
      troopLevels: entry.troopLevels ?? troopLevels };
  }) };
}

const migrations: Readonly<Record<number, (envelope: JsonObject) => JsonObject>> = {
  0: (envelope) => {
    const oldData = object(envelope.data);
    if (oldData === null) throw new Error("旧配置缺少 data。");
    const oldInput = object(oldData.input ?? oldData);
    if (oldInput === null) throw new Error("旧配置缺少 input。");
    return { ...envelope, schemaVersion: 1,
      data: { input: { ...oldInput,
        sideA: migrateSide(oldInput.sideA),
        sideB: migrateSide(oldInput.sideB) },
      simulationCount: oldData.simulationCount ?? oldData.batchCount ??
        DEFAULT_BATCH_SIMULATION_COUNT,
      optimizationConfig: oldData.optimizationConfig } };
  },
  1: (envelope) => {
    const data = object(envelope.data);
    const input = object(data?.input);
    if (data === null || input === null) throw new Error("旧配置缺少 input。");
    return { ...envelope, schemaVersion: 2,
      data: { ...data, input: { ...input,
        sideA: migrateQueueAttributes(input.sideA),
        sideB: migrateQueueAttributes(input.sideB) } } };
  },
  2: (envelope) => {
    const data = object(envelope.data);
    if (data === null) throw new Error("旧配置缺少 data。");
    const optimizer = object(data.optimizationConfig);
    const constraints = object(optimizer?.constraints);
    const unlocked = { ...constraints };
    // v2 rendering silently persisted locks; their user intent cannot be determined.
    delete unlocked.fixedLeaders;
    const simple = object(data.simpleOptimizerOptions);
    return { ...envelope, schemaVersion: 3, data: { ...data,
      ...(optimizer === null ? {} : { optimizationConfig: { ...optimizer, constraints: unlocked } }),
      ...(simple === null ? {} : { simpleOptimizerOptions: { ...simple, fixedHeroes: false } }),
    } };
  },
  3: (envelope) => ({ ...envelope, schemaVersion: 4 }),
};

/** Preserve the complete old inputs when consolidating the random activity's enemy inputs. */
function migrateLegacyScene(envelope: JsonObject): { envelope: JsonObject; sceneMigrated: boolean } {
  const data = object(envelope.data);
  const input = object(data?.input);
  if (data === null || input === null || input.scenarioType !== "THREE_QUEUE")
    return { envelope, sceneMigrated: false };
  const oldMode = input.threeQueueMode ?? "EARTH_HEART_BRAVE_LAND";
  if (oldMode !== "ICE_FIRE_LEAGUE" && oldMode !== "EARTH_HEART_BRAVE_LAND")
    throw new Error("threeQueueMode 无效。");
  const ice = oldMode === "ICE_FIRE_LEAGUE";
  const warnings = ice ? ["旧三队列冰火配置已迁移为冰火战歌模式，固定使用循环顺序。"] : [
    "旧随机三队列配置已迁移为地心模式 / 大地之心，沿用随机存活队列闯关规则。",
    "敌方三队改为共用容量、属性及两种比例预设；共享属性取旧 B1，旧 B1 比例不属于允许预设时改为均衡比例。",
    "敌方固定 T10、无宠物；原 A/B 完整配置已保存在迁移快照中，请在模拟前核对地心配置。",
  ];
  return { sceneMigrated: true, envelope: { ...envelope, data: { ...data, input: {
    ...input, scenarioType: ice ? "ICE_FIRE_LEAGUE" : "INNER_EARTH",
    ...(ice ? {} : { innerEarth: undefined }),
    legacySceneMigration: { sourceScenario: "THREE_QUEUE", sourceMode: oldMode,
      originalSideA: input.sideA, originalSideB: input.sideB, warnings },
  } } } };
}

export function migratePersistedConfig(raw: unknown): {
  readonly envelope: JsonObject;
  readonly migrated: boolean;
  readonly queueAttributesMigrated: boolean;
  readonly sceneMigrated: boolean;
} {
  let envelope = object(raw);
  if (envelope === null || !Number.isSafeInteger(envelope.schemaVersion)) {
    throw new Error("该配置版本无法读取，请重新配置或导入兼容版本。");
  }
  const version = envelope.schemaVersion as number;
  if (version < 0 || version > CURRENT_CONFIG_SCHEMA_VERSION) {
    throw new Error("该配置版本无法读取，请重新配置或导入兼容版本。");
  }
  let migrated = false;
  const originalInput = object(object(envelope.data)?.input);
  const queueAttributesMigrated = version < 2 &&
    originalInput?.scenarioType === "THREE_QUEUE" &&
    [originalInput.sideA, originalInput.sideB].some((sideValue) => {
      const side = object(sideValue);
      return Array.isArray(side?.threeQueues) && side.threeQueues.some((queue) =>
        object(queue)?.attributes === undefined);
    });
  let current = version;
  while (current < CURRENT_CONFIG_SCHEMA_VERSION) {
    const step = migrations[current];
    if (step === undefined) {
      throw new Error("该配置版本无法读取，请重新配置或导入兼容版本。");
    }
    envelope = step(envelope);
    current += 1;
    migrated = true;
  }
  const scene = migrateLegacyScene(envelope);
  const historical = normalizeHistoricalTree(scene.envelope);
  return { envelope: historical, migrated: migrated || scene.sceneMigrated || JSON.stringify(historical) !== JSON.stringify(scene.envelope),
    queueAttributesMigrated, sceneMigrated: scene.sceneMigrated };
}
