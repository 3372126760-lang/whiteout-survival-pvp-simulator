import { TROOP_TYPES } from "../types/combat";
import type { SideId } from "../types/combat";
import { ATTRIBUTE_STATS, ATTRIBUTE_SCHEMA_FIELDS, attributeFieldKey, expandAttributeInput, innerEarthAttributeSchema,
  type AttributeSchema } from "../validationUi/attributeSchema";
import type { ValidationBattleInput, ValidationQueueAttributes, ValidationQueueConfig } from "../validationUi/types";
import { getValidationThreeQueues } from "../validationUi/adapter";
import { isThreeQueueBattleInput } from "../scenario/scenePolicy";
import { normalizeQueueReportLineage } from "../validationUi/queueReportLineage";
import { getInnerEarthConfig, normalizeInnerEarthInput } from "../innerEarth/config";
import type { ParsedBattleReport, ParsedBattleReportSide, RecognizedValue, ReportSourceSide, SpecialBonusCompleteness } from "./types";
import { specialTotals, deriveRawReportAttribute } from "./mapping";
import { normalizeHistoricalTree } from "../validationUi/historicalBonuses";

function withoutHistoricalModifiers<T extends { sourceReportAttributes?: unknown; sourceReportBonuses?: unknown; importedReportModifiers?: unknown }>(value: T) {
  const { sourceReportAttributes: _attributes, sourceReportBonuses: _bonuses, importedReportModifiers: _modifiers, ...rest } = value;
  void [_attributes, _bonuses, _modifiers]; return rest;
}

export function attributeImportSchema(input: ValidationBattleInput, side: SideId): AttributeSchema {
  return input.scenarioType === "INNER_EARTH" ? innerEarthAttributeSchema(getInnerEarthConfig(input).subMode,
    side === "A" ? "ally" : "enemy") : "FULL_12";
}
export function attributePreviewGroups(parsed: ParsedBattleReportSide | undefined, schema: AttributeSchema) {
  const keys = schema === "FULL_12" ? TROOP_TYPES.flatMap((troop) => ATTRIBUTE_STATS.map((stat) => `${troop}.${stat}`))
    : ATTRIBUTE_SCHEMA_FIELDS[schema];
  return keys.map((key) => {
    const cells = TROOP_TYPES.flatMap((troop) => ATTRIBUTE_STATS.flatMap((stat) => {
      const belongs = key === attributeFieldKey(schema, troop, stat);
      const value = parsed?.attributes[troop]?.[stat];
      return belongs && value !== undefined ? [{ troop, stat, value }] : [];
    }));
    const item = cells[0]?.value;
    const conflict = cells.some((cell) => item !== undefined && Math.abs(cell.value.value - item.value) > 1e-6);
    const needsConfirmation = conflict || !cells.length || cells.some(({ value }) => !value.confirmed &&
      (value.needsConfirmation || (value.finalConfidence ?? value.confidence) < .85));
    return { key, cells, item, conflict, needsConfirmation };
  });
}
/** Manual review of one compact group confirms all its members together. */
export function confirmAttributeGroup(parsed: ParsedBattleReportSide, schema: AttributeSchema, key: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= -100 || amount > 100000) throw new Error("属性值须为 -100% 至 100000% 之间的有效百分数（不含 -100%）。");
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new Error("属性最多保留两位小数。");
  const attributes = structuredClone(parsed.attributes) as Record<string, Record<string, RecognizedValue<number>>>;
  if (!attributePreviewGroups(parsed, schema).some((group) => group.key === key)) throw new Error("属性核对项无效。");
  for (const troop of TROOP_TYPES) for (const stat of ATTRIBUTE_STATS) {
    const belongs = key === attributeFieldKey(schema, troop, stat);
    if (belongs) {
      attributes[troop] ??= {};
      attributes[troop]![stat] = { ...attributes[troop]![stat], value: amount, confidence: 1,
        finalConfidence: 1, needsConfirmation: false, confirmed: true, alternatives: [],
        box: attributes[troop]![stat]?.box ?? [[0, 0], [0, 0], [0, 0], [0, 0]] };
    }
  }
  return { ...parsed, attributes };
}
export function reviewedAttributeValues(parsed: ParsedBattleReportSide, schema: AttributeSchema): ValidationQueueAttributes {
  const groups = attributePreviewGroups(parsed, schema);
  if (groups.some((group) => group.needsConfirmation)) throw new Error("请补齐属性并确认低置信度或冲突数值后再应用。");
  const compact = Object.fromEntries(groups.map((group) => [group.key, group.item!.value]));
  const full = schema === "FULL_12" ? Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(ATTRIBUTE_STATS.map((stat) => [stat, compact[`${troop}.${stat}`]]))])) as ValidationQueueAttributes : compact;
  return expandAttributeInput(schema, full);
}
/** Atomic commit; counts, tiers, heroes, pets and the other side are untouched. */
export function applyRecognizedAttributes(input: ValidationBattleInput, parsed: ParsedBattleReportSide,
  side: SideId, queueIndex: 0 | 1 | 2 = 0): ValidationBattleInput {
  const attributes = reviewedAttributeValues(parsed, attributeImportSchema(input, side));
  if (input.scenarioType === "INNER_EARTH") {
    const config = getInnerEarthConfig(input);
    const threeQueue = config.subMode === "HEART_OF_EARTH" || config.subMode === "HERO_LAND";
    const ally = side !== "A" ? config.ally : !threeQueue ? { ...config.ally, reportStats: attributes } : { ...config.ally,
      queues: config.ally.queues.map((queue, index) => index !== queueIndex ? queue :
        { ...queue, expectedReportStats: attributes, reportHeroes: queue.heroes, reportWeaponLevels: queue.weaponLevels ?? {} }) as unknown as typeof config.ally.queues };
    return normalizeInnerEarthInput({ ...input, innerEarth: { ...config, ally,
      enemy: side === "B" ? { ...config.enemy, shared: { ...config.enemy.shared, expectedReportStats: attributes } } : config.enemy } });
  }
  const key = side === "A" ? "sideA" : "sideB", current = input[key];
  if (isThreeQueueBattleInput(input)) {
    const queues = getValidationThreeQueues(current).map((queue, index) => index !== queueIndex ? queue :
      normalizeQueueReportLineage({ ...withoutHistoricalModifiers(queue), attributes, attributeSource: "importedReport",
        reportHeroByTroop: queue.leaderHeroIds, reportWeaponLevels: queue.weaponLevels ?? {},
        reportLineage: { source: "historicalReport", historicalLineageConfirmed: true, attributeSnapshot: attributes }, reportAttributeBasis: "raw" }, true)) as
        unknown as readonly [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
    return { ...input, [key]: { ...current, threeQueues: queues } };
  }
  return { ...input, [key]: { ...withoutHistoricalModifiers(current), troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    { ...current.troops[troop], ...attributes[troop] }])), reportHeroIds: TROOP_TYPES.flatMap((troop) => current.leaderHeroIds?.[troop] ?? []),
    reportHeroByTroop: current.leaderHeroIds ?? {}, reportWeaponLevels: current.simulationWeaponLevels ?? {},
    reportAttributeBasis: "raw" } };
}

/** Confirmed attributes + historical special page are committed as one transaction. Troop OCR stays disabled. */
export function applyRecognizedAttributeReport(...args: Parameters<typeof applyHistoricalAttributeReport>): ValidationBattleInput {
  return normalizeHistoricalTree(applyHistoricalAttributeReport(...args));
}
function applyHistoricalAttributeReport(input: ValidationBattleInput, report: ParsedBattleReport,
  source: ReportSourceSide, side: SideId, completeness: SpecialBonusCompleteness, queueIndex: 0 | 1 | 2 = 0): ValidationBattleInput {
  const parsed = report[source];
  if (!parsed) throw new Error("所选侧没有识别结果。");
  if (completeness === "incomplete") throw new Error("请确认特殊加成完整，或明确确认历史战报无特殊加成。");
  const opposing = report[source === "left" ? "right" : "left"];
  const columns = [parsed, opposing].flatMap((column) => column ?? []);
  if (completeness === "explicitZero" && columns.some((column) => column.unmatchedBonuses?.length ||
    Object.values(column.specialBonuses ?? {}).flat().some((bonus) => bonus.amount.value !== 0 || bonus.conflict)))
    throw new Error("识别结果含非零或未确认特殊加成，不能声明为零。");
  const reportAttributes = reviewedAttributeValues(parsed, attributeImportSchema(input, side));
  const totals = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(ATTRIBUTE_STATS.map((stat) => [stat, specialTotals(parsed, troop, stat, opposing)]))])) as
      Record<typeof TROOP_TYPES[number], Record<typeof ATTRIBUTE_STATS[number], ReturnType<typeof specialTotals>>>;
  const raw = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, Object.fromEntries(ATTRIBUTE_STATS.map((stat) =>
    [stat, deriveRawReportAttribute({ reportPercent: reportAttributes[troop][stat], ...totals[troop][stat] })]))])) as ValidationQueueAttributes;
  // Reverse each of the twelve cells independently; special troop scopes can make paired report cells diverge in raw space.
  const bonuses = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, Object.fromEntries(ATTRIBUTE_STATS.map((stat) => {
    const value = totals[troop][stat];
    return [stat, { additive: value.additivePercent, buff: value.buffDecimal * 100, debuff: value.debuffDecimal * 100 }];
  }))])) as NonNullable<ValidationQueueConfig["sourceReportBonuses"]>;
  if (isThreeQueueBattleInput(input)) {
    const key = side === "A" ? "sideA" : "sideB", current = input[key];
    const queues = getValidationThreeQueues(current).map((queue, index) => index !== queueIndex ? queue : {
      ...queue, attributes: raw, sourceReportAttributes: reportAttributes, sourceReportBonuses: bonuses,
      importedReportModifiers: bonuses, reportAttributeBasis: "raw" as const, attributeSource: "importedReport" as const,
      recognizedSpecialBonuses: parsed.specialBonuses,
      reportHeroByTroop: queue.reportHeroByTroop ?? queue.leaderHeroIds,
      reportWeaponLevels: queue.reportWeaponLevels ?? queue.weaponLevels ?? {},
      reportLineage: { source: "historicalReport" as const, historicalLineageConfirmed: true as const, attributeSnapshot: structuredClone(raw) },
    }) as unknown as NonNullable<typeof current.threeQueues>;
    return { ...input, [key]: { ...current, threeQueues: queues } };
  }
  const key = side === "A" ? "sideA" : "sideB";
  if (input.scenarioType === "INNER_EARTH") {
    const applied = applyRecognizedAttributes(input, parsed, side, queueIndex);
    const config = getInnerEarthConfig(applied), reportHistory = { reportAttributes, bonuses,
      ...(parsed.specialBonuses === undefined ? {} : { recognizedSpecialBonuses: parsed.specialBonuses }) };
    const queued = config.subMode === "HEART_OF_EARTH" || config.subMode === "HERO_LAND";
    return { ...applied, innerEarth: { ...config,
      ally: side !== "A" ? config.ally : queued ? { ...config.ally, queues: config.ally.queues.map((queue, index) =>
        index === queueIndex ? { ...queue, reportHistory } : queue) as unknown as typeof config.ally.queues } : { ...config.ally, reportHistory },
      enemy: side !== "B" ? config.enemy : { ...config.enemy, shared: { ...config.enemy.shared, reportHistory } } } };
  }
  const prediction = input.attributeInputMode === "prediction";
  return { ...input, [key]: { ...input[key], troops: Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, { ...input[key].troops[troop], ...(prediction ? raw[troop] : reportAttributes[troop]) }])), sourceReportAttributes: reportAttributes,
    sourceReportBonuses: bonuses, importedReportModifiers: bonuses, reportAttributeBasis: prediction ? "raw" : "historicalReport" } };
}
