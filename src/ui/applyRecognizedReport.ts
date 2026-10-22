import { getValidationThreeQueues } from "../pvp/validationUi/adapter";
import { normalizeIceFireReportLineage, normalizeQueueReportLineage } from "../pvp/validationUi/queueReportLineage";
import { mapReportContextSide } from "../pvp/battleReportRecognition/mapping";
import { TROOP_TYPES, type SideId } from "../pvp/types/combat";
import type { ParsedBattleReport, ReportSourceSide, SpecialBonusCompleteness } from "../pvp/battleReportRecognition/types";
import type { ValidationBattleInput, ValidationQueueConfig, ValidationSideInput, ValidationQueueAttributes } from "../pvp/validationUi/types";

/** Commit a reviewed OCR draft to one army and, in three-queue mode, one queue. */
export function applyRecognizedReport(input: ValidationBattleInput,
  report: ParsedBattleReport, source: ReportSourceSide, target: SideId,
  completeness: SpecialBonusCompleteness, queueIndex: 0 | 1 | 2 = 0): ValidationBattleInput {
  if (input.scenarioType !== "THREE_QUEUE" && input.scenarioType !== "ICE_FIRE_LEAGUE") {
    return mapReportContextSide(input, report, source, target, completeness);
  }
  const key = target === "A" ? "sideA" : "sideB";
  const before = input[key];
  const queues = getValidationThreeQueues(before);
  const mapped = mapReportContextSide(input, report, source, target, completeness);
  const updatedSide = mapped[key];
  const parsed = report[source];
  if (parsed === undefined) throw new Error(`图片缺少 ${source} 侧数据。`);
  const attributes = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
    attack: updatedSide.troops[troop].attack,
    defense: updatedSide.troops[troop].defense,
    penetration: updatedSide.troops[troop].penetration,
    life: updatedSide.troops[troop].life,
  }])) as ValidationQueueAttributes;
  const troopLevels = Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, parsed.troopSetup[troop]?.level === undefined && parsed.troopSetup[troop]?.displayedTroopLevel === undefined ?
      queues[queueIndex].troopLevels![troop] : updatedSide.troops[troop].troopLevel])) as
      NonNullable<ValidationQueueConfig["troopLevels"]>;
  const parsedCounts = TROOP_TYPES.map((troop) => parsed.troopSetup[troop]?.count);
  let ratios = queues[queueIndex].ratios;
  if (parsedCounts.every((count) => count !== undefined)) {
    const counts = TROOP_TYPES.map((troop) => updatedSide.troops[troop].count);
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total <= 0) throw new Error("识图兵种总数必须大于 0。");
    const exact = counts.map((count) => count / total * 10_000);
    const basisPoints = exact.map(Math.floor);
    const rank = TROOP_TYPES.map((_, index) => index).sort((left, right) =>
      exact[right]! - basisPoints[right]! - (exact[left]! - basisPoints[left]!) ||
      left - right);
    const remainder = 10_000 - basisPoints.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < remainder; i += 1)
      basisPoints[rank[i]!]! += 1;
    ratios = { shield: basisPoints[0]! / 100, lancer: basisPoints[1]! / 100,
      marksman: basisPoints[2]! / 100 };
  }
  const { reportLineage: _oldLineage, ...queueBase } = queues[queueIndex];
  void _oldLineage;
  // OCR does not identify heroes. New attribute values cannot inherit an old
  // historical lineup, even when the old and new reports target the same queue.
  const replacement: ValidationQueueConfig = normalizeQueueReportLineage({ ...queueBase, attributes, ratios,
    attributeSource: "importedReport", reportHeroByTroop: queueBase.leaderHeroIds,
    reportWeaponLevels: queueBase.weaponLevels ?? {},
    troopLevels, importedReportModifiers: updatedSide.importedReportModifiers,
    sourceReportBonuses: updatedSide.sourceReportBonuses!,
    sourceReportAttributes: updatedSide.sourceReportAttributes!,
    reportAttributeBasis: "raw",
    troopLevelCompositions: { ...queues[queueIndex].troopLevelCompositions,
      ...Object.fromEntries(TROOP_TYPES.flatMap((troop) =>
        parsed.troopSetup[troop]?.level === undefined && parsed.troopSetup[troop]?.displayedTroopLevel === undefined ? [] : [[troop,
          updatedSide.troops[troop].levelComposition ?? [{ level: updatedSide.troops[troop].troopLevel,
            aliveCount: updatedSide.troops[troop].count }]]])) },
    troopResolutionSources: { ...queues[queueIndex].troopResolutionSources,
      ...Object.fromEntries(TROOP_TYPES.flatMap((troop) =>
        updatedSide.troops[troop].resolutionSource === undefined ||
        parsed.troopSetup[troop]?.level === undefined && parsed.troopSetup[troop]?.displayedTroopLevel === undefined ? [] :
          [[troop, updatedSide.troops[troop].resolutionSource]])) } }, true);
  const nextQueues = queues.map((queue, index) => index === queueIndex ?
    replacement : queue) as unknown as NonNullable<ValidationSideInput["threeQueues"]>;
  return normalizeIceFireReportLineage({ ...input, attributeInputMode: "prediction",
    [key]: { ...before, threeQueues: nextQueues } });
}
