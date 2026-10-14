import { TROOP_TYPES, type TroopType } from "../types/combat";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills/definitions/simpleHeroes";
import { calculateHeroStatCorrection } from "../heroSkills/heroStatCorrection";
import { deriveRawReportAttribute } from "../battleReportRecognition/mapping";
import type { ValidationBattleInput, ValidationQueueAttributes, ValidationQueueConfig } from "./types";
import { normalizeIceFireShared } from "./iceFireContext";

type HeroMap = ValidationQueueConfig["leaderHeroIds"];
const stats = ["attack", "defense", "penetration", "life"] as const;
export const queueHeroIds = (heroes: HeroMap): readonly string[] =>
  TROOP_TYPES.flatMap((troop) => heroes[troop] ?? []);
const onlyHeroes = (values: Readonly<Record<string, number>> | undefined, ids: readonly string[]) =>
  Object.fromEntries(Object.entries(values ?? {}).filter(([id]) => ids.includes(id)));

function sameAttributes(a: ValidationQueueAttributes | undefined, b: ValidationQueueAttributes): boolean {
  return a !== undefined && TROOP_TYPES.every((troop) =>
    stats.every((stat) => a[troop][stat] === b[troop][stat]));
}

/** Resolve queue-local provenance. A side's historical lineup is never a fallback. */
export function normalizeQueueReportLineage(queue: ValidationQueueConfig,
  requireExplicitLineage = false): ValidationQueueConfig {
  const ids = queueHeroIds(queue.leaderHeroIds);
  const validLineage = queue.reportLineage !== undefined && queue.reportHeroByTroop !== undefined &&
    sameAttributes(queue.attributes, queue.reportLineage.attributeSnapshot);
  const useBaseline = validLineage || !requireExplicitLineage && queue.reportLineage === undefined;
  const explicitHistory = validLineage && queue.reportLineage!.historicalLineageConfirmed === true;
  const hold = ids.length === 0 && !explicitHistory ? {} : useBaseline
    ? queue.reportHeroByTroop ?? queue.leaderHeroIds : queue.leaderHeroIds;
  const reportIds = queueHeroIds(hold);
  const weaponLevels = onlyHeroes(queue.weaponLevels, ids);
  const { reportLineage: _lineage, ...rest } = queue;
  void _lineage;
  return { ...rest, reportHeroByTroop: hold,
    reportWeaponLevels: onlyHeroes(useBaseline
      ? queue.reportWeaponLevels ?? weaponLevels : weaponLevels, reportIds),
    ...(queue.weaponLevels === undefined && ids.length > 0 ? {} : { weaponLevels }),
    ...(queue.heroSkillLevels === undefined ? {} : { heroSkillLevels:
      Object.fromEntries(Object.entries(queue.heroSkillLevels).filter(([skillId]) =>
        CONFIRMED_HERO_SKILL_DEFINITIONS.some((skill) => skill.id === skillId && ids.includes(skill.heroId)))) }),
    attributeSource: queue.reportLineage !== undefined && !validLineage ? "manualInput"
      : queue.attributeSource ?? (queue.attributes === undefined ? "basePanel" : "manualInput"),
    ...((ids.length > 0 || explicitHistory) && validLineage ? { reportLineage: queue.reportLineage! } : {}) };
}

/** Called at IceFire entry, restore, save, copy, and both evaluation boundaries. */
export function normalizeIceFireReportLineage(input: ValidationBattleInput): ValidationBattleInput {
  if (input.scenarioType !== "ICE_FIRE_LEAGUE" &&
    !(input.scenarioType === "THREE_QUEUE" && input.threeQueueMode === "ICE_FIRE_LEAGUE")) return input;
  const side = (key: "sideA" | "sideB") => {
    const value = input[key];
    return { ...value, reportHeroIds: [], reportHeroByTroop: {}, reportWeaponLevels: {},
      ...(value.threeQueues === undefined ? {} : { threeQueues: value.threeQueues.map((queue) =>
        normalizeQueueReportLineage(queue, true)) as unknown as NonNullable<typeof value.threeQueues> }) };
  };
  return normalizeIceFireShared({ ...input, sideA: side("sideA"), sideB: side("sideB") });
}

/** Keep a known current baseline fixed while the optimizer changes the lineup. */
export function captureQueueReportBaseline(queue: ValidationQueueConfig): ValidationQueueConfig {
  if (queue.attributes === undefined) throw new Error("队列基础属性缺失。");
  return { ...queue, reportHeroByTroop: queue.reportHeroByTroop ?? queue.leaderHeroIds,
    reportWeaponLevels: queue.reportWeaponLevels ?? queue.weaponLevels ?? {},
    reportLineage: { ...(queue.reportLineage ?? { source: "optimizerBaseline",
      attributeSnapshot: structuredClone(queue.attributes) }), historicalLineageConfirmed: true } };
}

/** After a manual edit the displayed numbers describe the current lineup. */
function currentQueueBaseline(queue: ValidationQueueConfig): ValidationQueueConfig {
  const { reportLineage: _lineage, ...rest } = queue;
  void _lineage;
  return normalizeQueueReportLineage({ ...rest,
    reportHeroByTroop: queue.leaderHeroIds, reportWeaponLevels: queue.weaponLevels ?? {},
    attributeSource: "manualInput" }, true);
}

export function changeQueueHero(queue: ValidationQueueConfig, troop: TroopType,
  heroId: string | null): ValidationQueueConfig {
  return currentQueueBaseline({ ...queue, leaderHeroIds: { ...queue.leaderHeroIds, [troop]: heroId } });
}

/** Explicit history is immutable when the expected lineup changes, including EMPTY_HEAD. */
function hasBoundOrPlausibleQueueHistory(queue: ValidationQueueConfig): boolean {
  if (queue.reportLineage && sameAttributes(queue.attributes, queue.reportLineage.attributeSnapshot)) return true;
  if (!queue.attributes) return false;
  const heroes = queueHeroIds(queue.reportHeroByTroop ?? queue.leaderHeroIds);
  const correction = calculateHeroStatCorrection(heroes.map((heroId) => ({ heroId,
    weaponLevel: queue.reportWeaponLevels?.[heroId] ?? queue.weaponLevels?.[heroId] ?? 0 })), []);
  // Legacy low base-panel numbers cannot be a report containing a later hero's
  // larger static contribution. Never turn that unbound metadata into history.
  return TROOP_TYPES.every((troop) => stats.every((stat) => {
    const bonus = queue.sourceReportBonuses?.[troop][stat];
    const raw = queue.reportAttributeBasis !== "historicalReport" ? queue.attributes![troop][stat] :
      deriveRawReportAttribute({ reportPercent: queue.attributes![troop][stat], additivePercent: bonus?.additive ?? 0,
        buffDecimal: (bonus?.buff ?? 0) / 100, debuffDecimal: (bonus?.debuff ?? 0) / 100 });
    return 1 + raw / 100 - correction.reportTotalContribution[troop][stat] > 0;
  }));
}
export function changeIceFireExpectedHero(queue: ValidationQueueConfig, troop: TroopType, heroId: string | null): ValidationQueueConfig {
  // An unbound legacy/current panel is not a confirmed historical report.
  // Keep its direct-input semantics until the historical editor/import binds it.
  if (!hasBoundOrPlausibleQueueHistory(queue))
    return changeQueueHero(queue, troop, heroId);
  const baseline = captureQueueReportBaseline(queue);
  return normalizeQueueReportLineage({ ...baseline,
    reportLineage: { ...baseline.reportLineage!, source: "historicalReport" },
    leaderHeroIds: { ...queue.leaderHeroIds, [troop]: heroId } }, true);
}
export function changeIceFireReportHero(queue: ValidationQueueConfig, troop: TroopType, heroId: string | null): ValidationQueueConfig {
  const baseline = captureQueueReportBaseline(queue);
  return normalizeQueueReportLineage({ ...baseline,
    reportLineage: { ...baseline.reportLineage!, source: "historicalReport" },
    reportHeroByTroop: { ...baseline.reportHeroByTroop, [troop]: heroId } }, true);
}
export function changeIceFireReportAttribute(queue: ValidationQueueConfig, troop: TroopType,
  stat: typeof stats[number], value: number): ValidationQueueConfig {
  if (!hasBoundOrPlausibleQueueHistory(queue))
    return changeQueueAttribute(queue, troop, stat, value);
  const baseline = captureQueueReportBaseline(queue);
  const report = queue.sourceReportAttributes ?? queue.attributes!;
  const reportAttributes = { ...report, [troop]: { ...report[troop], [stat]: value } };
  const attributes = Object.fromEntries(TROOP_TYPES.map((type) => [type, Object.fromEntries(stats.map((field) => {
    const bonus = queue.sourceReportBonuses?.[type][field] ?? queue.importedReportModifiers?.[type][field];
    return [field, deriveRawReportAttribute({ reportPercent: reportAttributes[type][field],
      additivePercent: bonus?.additive ?? 0, buffDecimal: (bonus?.buff ?? 0) / 100,
      debuffDecimal: (bonus?.debuff ?? 0) / 100 })];
  }))])) as unknown as ValidationQueueAttributes;
  return { ...baseline, attributes, attributeSource: "manualInput", reportAttributeBasis: "raw",
    sourceReportAttributes: reportAttributes,
    reportLineage: { source: "historicalReport", historicalLineageConfirmed: true, attributeSnapshot: structuredClone(attributes) } };
}

export function changeQueueAttribute(queue: ValidationQueueConfig, troop: TroopType,
  stat: typeof stats[number], value: number): ValidationQueueConfig {
  if (queue.attributes === undefined) throw new Error("队列基础属性缺失。");
  // Convert untouched historical cells first so changing one cell cannot reinterpret
  // the other eleven. Source report snapshots are discarded with the manual edit.
  const attributes = queue.reportAttributeBasis !== "historicalReport" ? queue.attributes :
    Object.fromEntries(TROOP_TYPES.map((type) => [type, Object.fromEntries(stats.map((field) => {
      const bonus = queue.sourceReportBonuses?.[type][field] ?? queue.importedReportModifiers?.[type][field];
      return [field, deriveRawReportAttribute({ reportPercent: queue.attributes![type][field],
        additivePercent: bonus?.additive ?? 0, buffDecimal: (bonus?.buff ?? 0) / 100,
        debuffDecimal: (bonus?.debuff ?? 0) / 100 })];
    }))])) as unknown as ValidationQueueAttributes;
  const { sourceReportAttributes: _attributes, sourceReportBonuses: _bonuses,
    importedReportModifiers: _imported, ...rest } = queue;
  void [_attributes, _bonuses, _imported];
  return currentQueueBaseline({ ...rest, reportAttributeBasis: "raw", attributes: {
    ...attributes, [troop]: { ...attributes[troop], [stat]: value } } });
}

export function queueReportValueSource(queue: ValidationQueueConfig, path: string, value: number) {
  return { value, source: queue.attributeSource ?? "manualInput", path,
    ...(queue.reportLineage === undefined ? {} : { lineage: queue.reportLineage.source }) };
}

/** Uses the same resolved queue baseline as preflight; no shared side metadata. */
export function createQueueReportLineageAudit(queue: ValidationQueueConfig, path: string) {
  queue = normalizeQueueReportLineage(queue, true);
  const simulationHeroIds = queueHeroIds(queue.leaderHeroIds);
  const reportHoldHeroIds = queueHeroIds(queue.reportHeroByTroop ?? {});
  const correction = calculateHeroStatCorrection(
    reportHoldHeroIds.map((heroId) => ({ heroId, weaponLevel: queue.reportWeaponLevels?.[heroId] ?? 0 })),
    simulationHeroIds.map((heroId) => ({ heroId, weaponLevel: queue.weaponLevels?.[heroId] ?? 0 })));
  return { simulationHeroIds, reportHoldHeroIds,
    heroStaticDeltaPercent: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      Object.fromEntries(stats.map((stat) => [stat, (
        correction.simulationHeroContribution[troop][stat] - correction.reportHeroContribution[troop][stat]) * 100]))])),
    reportValueSource: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      Object.fromEntries(stats.map((stat) => [stat, queueReportValueSource(queue,
        `${path}.attributes.${troop}.${stat}`, queue.attributes?.[troop][stat] ?? Number.NaN)]))])) };
}
