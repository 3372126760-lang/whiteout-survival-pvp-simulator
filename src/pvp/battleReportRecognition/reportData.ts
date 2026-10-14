import { REPORT_ATTRIBUTES, REPORT_TROOPS } from "./anchors";
import type { ParsedBattleReport, ParsedBattleReportSide, ParsedSpecialBonus,
  RecognizedValue, ReportPageType, ReportSourceSide, UnmatchedSpecialBonus } from "./types";
import { mergeSpecialBonuses } from "./specialBonusMerge";
const SIDES: readonly ReportSourceSide[] = ["left", "right"];

export function refreshReportDiagnostics(report: ParsedBattleReport): ParsedBattleReport {
  const columns = [report.left, report.right].flatMap((column) => column ?? []);
  const values = columns.flatMap(allValues);
  const conflicts = columns.flatMap((column) => (["additive", "buffs", "debuffs"] as const)
    .flatMap((group) => column.specialBonuses?.[group].filter((bonus) => bonus.conflict)
      .map((bonus) => `特殊加成冲突：${bonus.canonicalLabel ?? bonus.label}`) ?? []));
  return { ...report, confidence: values.length === 0 ? 0 :
    Math.min(...values.map((value) => value.finalConfidence ?? value.confidence)),
    warnings: [...new Set([...report.warnings.filter((warning) =>
      !warning.startsWith("特殊加成冲突")), ...conflicts])] };
}

export function allValues(side: ParsedBattleReportSide): RecognizedValue<unknown>[] {
  return [...REPORT_TROOPS.flatMap((troop) => [
    ...REPORT_ATTRIBUTES.flatMap((attribute) => side.attributes[troop]?.[attribute] ?? []),
    ...(["level", "displayedTroopLevel", "displayedFireCrystalLevel", "count"] as const)
      .flatMap((key) => side.troopSetup[troop]?.[key] ?? []),
  ]), ...(["additive", "buffs", "debuffs"] as const).flatMap((group) =>
    side.specialBonuses?.[group].map((item) => item.amount) ?? []),
  ...(side.unmatchedBonuses ?? []).flatMap((item) => item.amount ?? [])];
}

export function reportWarnings(report: Pick<ParsedBattleReport, "left" | "right" | "pageTypes">):
  readonly string[] {
  if (!report.pageTypes?.includes("attributes")) return [];
  return SIDES.flatMap((sideName) => {
    const side = report[sideName];
    if (side === undefined) return [];
    const found = REPORT_TROOPS.flatMap((troop) => REPORT_ATTRIBUTES.filter((attribute) =>
      side.attributes[troop]?.[attribute] !== undefined));
    if (found.length === 0) return [];
    return REPORT_TROOPS.flatMap((troop) => REPORT_ATTRIBUTES.flatMap((attribute) =>
      side.attributes[troop]?.[attribute] === undefined ?
        [`missing ${sideName}.${troop}.${attribute}`] : []));
  });
}

function mergeField<T>(old: RecognizedValue<T> | undefined,
  incoming: RecognizedValue<T> | undefined): RecognizedValue<T> | undefined {
  if (old === undefined) return incoming;
  if (incoming === undefined) return old;
  if (old.value === incoming.value) return old.confidence >= incoming.confidence ? old : incoming;
  return { ...old, confidence: Math.min(old.confidence, .45), finalConfidence: .45,
    needsConfirmation: true, alternatives: [incoming.value] };
}

function mergeUnmatched(old: readonly UnmatchedSpecialBonus[],
  incoming: readonly UnmatchedSpecialBonus[]): readonly UnmatchedSpecialBonus[] {
  const rows = [...old];
  for (const item of incoming) {
    const index = rows.findIndex((row) => row.normalizedText === item.normalizedText);
    if (index < 0) { rows.push(item); continue; }
    const prior = rows[index]!;
    if (prior.amount?.value === item.amount?.value) continue;
    if (prior.amount === undefined || item.amount === undefined) {
      rows[index] = prior.amount === undefined ? item : prior;
      continue;
    }
    rows[index] = { ...prior, conflict: true,
      amount: { ...prior.amount,
        confidence: .4, finalConfidence: .4, needsConfirmation: true,
        alternatives: [item.amount.value] } };
  }
  return rows;
}

function mergeSide(old: ParsedBattleReportSide | undefined,
  incoming: ParsedBattleReportSide | undefined, name: ReportSourceSide):
  ParsedBattleReportSide | undefined {
  if (old === undefined) return incoming;
  if (incoming === undefined) return old;
  const attributes = Object.fromEntries(REPORT_TROOPS.map((troop) => [troop,
    Object.fromEntries(REPORT_ATTRIBUTES.flatMap((attribute) => {
      const value = mergeField(old.attributes[troop]?.[attribute],
        incoming.attributes[troop]?.[attribute]);
      return value === undefined ? [] : [[attribute, value]];
    }))])) as ParsedBattleReportSide["attributes"];
  const troopKeys = ["level", "displayedTroopLevel", "displayedFireCrystalLevel",
    "fireCrystal", "count"] as const;
  const troopSetup = Object.fromEntries(REPORT_TROOPS.map((troop) => {
    const before = old.troopSetup[troop];
    const after = incoming.troopSetup[troop];
    const fields = Object.fromEntries(troopKeys.flatMap((key) => {
      const value = mergeField<unknown>(before?.[key], after?.[key]);
      return value === undefined ? [] : [[key, value]];
    }));
    return [troop, { ...fields,
      ...(after?.cardBbox === undefined && before?.cardBbox === undefined ? {} : {
        cardBbox: after?.cardBbox ?? before?.cardBbox }),
      portraitBBox: after?.portraitBBox ?? before?.portraitBBox,
      troopSlotBBox: after?.troopSlotBBox ?? before?.troopSlotBBox,
      cardConfidence: after?.cardConfidence ?? before?.cardConfidence,
      resolvedBaseComposition: after?.resolvedBaseComposition ??
        before?.resolvedBaseComposition,
      resolvedTroopComposition: after?.resolvedTroopComposition ?? before?.resolvedTroopComposition,
      resolutionSource: after?.resolutionSource ?? before?.resolutionSource }];
  })) as ParsedBattleReportSide["troopSetup"];
  const groups = ["additive", "buffs", "debuffs"] as const;
  const specialBonuses = Object.fromEntries(groups.map((group) => [group,
    mergeSpecialBonuses(old.specialBonuses?.[group] ?? [],
      incoming.specialBonuses?.[group] ?? [])])) as
      NonNullable<ParsedBattleReportSide["specialBonuses"]>;
  return { sourceSide: name, attributes, troopSetup, specialBonuses,
    unmatchedBonuses: mergeUnmatched(old.unmatchedBonuses ?? [],
      incoming.unmatchedBonuses ?? []),
    specialEvidence: old.specialEvidence || incoming.specialEvidence };
}

export function mergeBattleReports(reports: readonly ParsedBattleReport[]): ParsedBattleReport {
  if (reports.length === 0) throw new RangeError("至少需要一张战报图片。");
  const imageIds = [...new Set(reports.flatMap((report) => report.imageIds ?? [report.imageId]))];
  const withSources = reports.map((report) => {
    const column = (side: ParsedBattleReportSide | undefined) => side === undefined ? undefined :
      { ...side, specialBonuses: Object.fromEntries((["additive", "buffs", "debuffs"] as const)
        .map((group) => [group, (side.specialBonuses?.[group] ?? []).map((bonus) => {
          const reindex = (sources: NonNullable<ParsedSpecialBonus["sources"]>) =>
            sources.map((source) => ({ ...source, imageIndex: imageIds.indexOf(source.imageId) }));
          return { ...bonus, sources: reindex(bonus.sources ?? []),
            ...(bonus.candidates === undefined ? {} : { candidates: bonus.candidates.map((candidate) =>
              ({ ...candidate, sources: reindex(candidate.sources) })) }) };
        })])) as unknown as NonNullable<ParsedBattleReportSide["specialBonuses"]> };
    return { ...report, left: column(report.left), right: column(report.right) };
  });
  const pageTypes = [...new Set(reports.flatMap((report) =>
    report.pageTypes ?? [report.pageType ?? "unknown"]))] as ReportPageType[];
  const left = withSources.reduce<ParsedBattleReportSide | undefined>((sum, report) =>
    mergeSide(sum, report.left, "left"), undefined);
  const right = withSources.reduce<ParsedBattleReportSide | undefined>((sum, report) =>
    mergeSide(sum, report.right, "right"), undefined);
  const values = [left, right].flatMap((side) => side === undefined ? [] : allValues(side));
  const merged: ParsedBattleReport = { imageId: reports[0]!.imageId,
    imageIds,
    pageType: pageTypes[0] ?? "unknown", pageTypes,
    ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }),
    warnings: [], confidence: values.length === 0 ? 0 :
      Math.min(...values.map((value) => value.finalConfidence ?? value.confidence)) };
  return { ...merged, warnings: [...new Set([
    ...reportWarnings(merged), ...reports.flatMap((report) =>
      report.warnings.filter((warning) => !warning.startsWith("missing ") &&
        !warning.startsWith("特殊加成冲突"))),
    ...[left, right].flatMap((side) => side === undefined ? [] :
      (["additive", "buffs", "debuffs"] as const).flatMap((group) =>
        side.specialBonuses?.[group].filter((bonus) => bonus.conflict)
          .map((bonus) => `特殊加成冲突：${bonus.canonicalLabel ?? bonus.label}`) ?? [])),
  ])] };
}

