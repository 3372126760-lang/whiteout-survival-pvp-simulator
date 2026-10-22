import { SUPPORTED_TROOP_LEVELS } from "../data/troopConstants";
import type { ReportAttribute } from "../externalBuffs";
import { TROOP_TYPES, type SideId, type TroopType } from "../types/combat";
import { normalizeHistoricalTree } from "../validationUi/historicalBonuses";
import type { ValidationBattleInput, ValidationSideInput } from "../validationUi/types";
import type { ParsedBattleReport, ParsedBattleReportSide, ParsedSpecialBonus,
  RecognizedValue, ReportSourceSide, SpecialBonusCompleteness } from "./types";
import { resolveParsedTroopSetup, resolveDisplayedTroopComposition } from "./troopResolution";
import { deriveExpectedReportAttribute } from "../validationUi/expectedReportAttribute";

const attributes: readonly ReportAttribute[] = ["attack", "defense", "penetration", "life"];
const validLevels = new Set<string>(SUPPORTED_TROOP_LEVELS);
export const LOW_OCR_CONFIDENCE = .85;

export interface DerivedAttribute {
  readonly reportValue: number;
  readonly additive: number;
  readonly buff: number;
  readonly debuff: number;
  readonly rawValue: number;
}

function accepted<T>(field: RecognizedValue<T> | undefined, name: string):
  RecognizedValue<T> {
  if (field === undefined) throw new Error(`${name} 未识别，请手动补充。`);
  if ((field.needsConfirmation || field.finalConfidence !== undefined &&
    field.finalConfidence < LOW_OCR_CONFIDENCE ||
    field.confidence < LOW_OCR_CONFIDENCE) && field.confirmed !== true) {
    throw new Error(`${name} 置信度较低，需人工确认。`);
  }
  return field;
}
function side(report: ParsedBattleReport, source: ReportSourceSide): ParsedBattleReportSide {
  const value = report[source];
  if (value === undefined) throw new Error(`图片缺少 ${source} 侧数据。`);
  return value;
}
function applyTroops(current: ValidationSideInput,
  source: ParsedBattleReportSide, requireTroops = false): ValidationSideInput["troops"] {
  requireTroops ||= Object.values(source.troopSetup).some((setup) => setup?.cardBbox !== undefined);
  return Object.fromEntries(TROOP_TYPES.map((troop) => {
    const parsed = source.troopSetup[troop] === undefined ? undefined :
      resolveParsedTroopSetup(source.troopSetup[troop]!);
    const existing = current.troops[troop];
    if (parsed?.cardBbox !== undefined && (parsed.displayedTroopLevel?.value ?? 0) >= 10 &&
      parsed.displayedFireCrystalLevel === undefined && parsed.resolutionSource !== "userOverride")
      throw new Error(`${troop}战报火晶等级未识别，请重传清晰卡片图片。`);
    if (requireTroops && (parsed?.count === undefined ||
      parsed.level === undefined && parsed.displayedTroopLevel === undefined))
      throw new Error(`${troop}兵数或战报等级未识别，请手动补充。`);
    const level = parsed?.level === undefined ? existing.troopLevel :
      accepted(parsed.level, `${troop}兵种等级`).value;
    if (!validLevels.has(level)) throw new Error(`${troop}兵种等级不存在：${level}`);
    const count = parsed?.count === undefined ? existing.count :
      accepted(parsed.count, `${troop}兵数`).value;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${troop}兵数格式无效。`);
    if (parsed?.displayedTroopLevel !== undefined &&
      (parsed.resolutionSource !== "userOverride" || parsed.resolvedTroopComposition !== undefined)) {
      const display = accepted(parsed.displayedTroopLevel, `${troop}战报等级`).value;
      const fc = parsed.displayedFireCrystalLevel === undefined ?
        Number(/-FC(\d+)$/.exec(level)?.[1] ?? 0) :
        accepted(parsed.displayedFireCrystalLevel, `${troop}战报火晶等级`).value;
      const composition = resolveDisplayedTroopComposition(display, fc, count);
      return [troop, { ...existing, count, troopLevel: composition[0]!.level,
        levelMode: composition.length > 1 ? "mixed" : "single",
        levelComposition: composition.length > 1 ? composition.map((part) =>
          ({ level: part.level, aliveCount: part.count! })) : undefined,
        resolutionSource: parsed.resolutionSource ?? "battleReportApproximation" }];
    }
    return [troop, { ...existing, troopLevel: level, count,
      ...(parsed?.level === undefined ? {} : { levelMode: "single" as const,
        levelComposition: undefined, resolutionSource: parsed.resolutionSource ?? "userOverride" }) }];
  })) as unknown as ValidationSideInput["troops"];
}

export function specialTotals(source: ParsedBattleReportSide, troop: TroopType,
  attribute: ReportAttribute,
  opposing?: ParsedBattleReportSide, _owner?: SideId):
  { additivePercent: number; buffDecimal: number; debuffDecimal: number } {
  // The report column supplies the historical owner; model A/B is diagnostic only.
  void _owner;
  const relevantUnknown = [source, opposing].some((column) =>
    column?.unmatchedBonuses?.some((item) =>
      item.possibleAttribute === undefined || item.possibleAttribute === attribute));
  if (relevantUnknown) throw new Error(`${attribute} 存在待确认的特殊加成。`);
  const matches = (bonus: ParsedSpecialBonus) => bonus.attribute === attribute &&
    ["all", troop].includes(bonus.troopScope ?? bonus.troop ?? "all");
  const sum = (list: readonly ParsedSpecialBonus[], target: "self" | "enemy",
    category?: "additive" | "buff" | "debuff") =>
    list.filter((item) => matches(item) &&
      (item.effectTarget ?? (category === "debuff" ? "enemy" : "self")) === target).reduce(
    (total, item) => {
      if (category === "additive" && !/官职|官職/.test(item.label)) {
        throw new Error(`${item.label} 不是已确认的官职 additive 加成。`);
      }
      if (item.conflict) throw new Error(`${item.label} 多张图片数值冲突，需人工确认。`);
      const value = accepted(item.amount, item.label).value;
      if (!Number.isFinite(value) || value < 0 || value > 100_000 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
        throw new Error(`${item.label} 百分比格式无效，请手动修正。`);
      }
      return total + value;
    }, 0);
  return {
    additivePercent: sum(source.specialBonuses?.additive ?? [], "self",
      "additive") + sum(opposing?.specialBonuses?.additive ?? [], "enemy",
      "additive"),
    buffDecimal: (sum(source.specialBonuses?.buffs ?? [], "self", "buff") +
      sum(opposing?.specialBonuses?.buffs ?? [], "enemy",
        "buff")) / 100,
    debuffDecimal: (sum(source.specialBonuses?.debuffs ?? [], "self",
      "debuff") + sum(opposing?.specialBonuses?.debuffs ?? [], "enemy",
        "debuff")) / 100,
  };
}

export interface ReportAttributeMathInput {
  readonly reportPercent: number;
  readonly additivePercent: number;
  readonly buffDecimal: number;
  readonly debuffDecimal: number;
}

export function deriveFinalReportAttribute(input: {
  readonly rawPercent: number;
  readonly additivePercent: number;
  readonly buffDecimal: number;
  readonly debuffDecimal: number;
}): number {
  return deriveExpectedReportAttribute({ raw: input.rawPercent, formationDelta: 0,
    targetAdditive: input.additivePercent, targetBuff: input.buffDecimal,
    targetDebuff: input.debuffDecimal });
}

/** Canonical inverse of the confirmed report-panel multiplier groups. */
export function deriveRawReportAttribute(input: ReportAttributeMathInput): number {
  const { reportPercent, additivePercent, buffDecimal, debuffDecimal } = input;
  if (![reportPercent, additivePercent, buffDecimal, debuffDecimal]
    .every(Number.isFinite) || reportPercent <= -100 ||
    buffDecimal < 0 || debuffDecimal < 0) {
    throw new RangeError("战报属性或特殊加成格式无效。");
  }
  const rawFactor = (1 + reportPercent / 100) *
    (1 + debuffDecimal) / (1 + buffDecimal) - additivePercent / 100;
  if (rawFactor <= 0) throw new RangeError("反推裸属性因子无效。");
  return (100 + reportPercent) * (1 + debuffDecimal) /
    (1 + buffDecimal) - 100 - additivePercent;
}

/** All arguments are percentage points for the legacy public interface. */
export function reverseReportAttribute(report: number, additive: number,
  buff: number, debuff: number): number {
  return deriveRawReportAttribute({ reportPercent: report, additivePercent: additive,
    buffDecimal: buff / 100, debuffDecimal: debuff / 100 });
}

export function deriveReportAttribute(reportValue: number, additive: number,
  buff: number, debuff: number): DerivedAttribute {
  return { reportValue, additive, buff, debuff,
    rawValue: reverseReportAttribute(reportValue, additive, buff, debuff) };
}

export function previewRecognizedAttribute(source: ParsedBattleReportSide,
  opposing: ParsedBattleReportSide | undefined, owner: SideId, troop: TroopType,
  attribute: ReportAttribute, assumeZeroSpecial = false,
  assumeZeroOpposing = false): {
  readonly reportValueSource: { readonly value: number;
    readonly source: "ocrPreview" };
  readonly specialBonusAdditivePercent: number;
  readonly buffDecimal: number;
  readonly debuffDecimal: number;
  readonly rawPercent: number;
} {
  if (!source.specialEvidence && !assumeZeroSpecial ||
    !opposing?.specialEvidence && !assumeZeroOpposing) {
    throw new Error("特殊加成信息不完整，无法反推预览属性。");
  }
  const field = accepted(source.attributes[troop]?.[attribute],
    `${troop}${attribute}`);
  const totals = specialTotals(source, troop, attribute, opposing, owner);
  return { reportValueSource: { value: field.value, source: "ocrPreview" },
    specialBonusAdditivePercent: totals.additivePercent,
    buffDecimal: totals.buffDecimal, debuffDecimal: totals.debuffDecimal,
    rawPercent: deriveRawReportAttribute({ reportPercent: field.value,
      ...totals }) };
}

export interface ReceivedDebuffContribution {
  readonly targetModelSide: SideId;
  readonly sourceRecognitionState: SideId;
  readonly sourceReportSide: ReportSourceSide;
  readonly canonicalLabel: string;
  readonly value: number;
}

/** Only the selected historical report and its opposite column are in scope. */
export function previewReportContextAttribute(report: ParsedBattleReport,
  selected: ReportSourceSide, owner: SideId, completeness: SpecialBonusCompleteness,
  troop: TroopType, attribute: ReportAttribute) {
  if (completeness === "incomplete")
    throw new Error("特殊加成信息尚未完整，无法可靠反推属性。");
  const parsed = side(report, selected);
  const opposing = report[selected === "left" ? "right" : "left"];
  const field = accepted(parsed.attributes[troop]?.[attribute], `${troop}${attribute}`);
  const totals = completeness === "explicitZero" ?
    { additivePercent: 0, buffDecimal: 0, debuffDecimal: 0 } :
    specialTotals(parsed, troop, attribute, opposing);
  const receivedDebuffContributions: ReceivedDebuffContribution[] =
    completeness === "explicitZero" ? [] : [parsed, opposing].flatMap((column) =>
      column?.specialBonuses?.debuffs.filter((bonus) =>
        (bonus.effectTarget ?? "enemy") === (column === parsed ? "self" : "enemy") &&
        bonus.attribute === attribute &&
        ["all", troop].includes(bonus.troopScope ?? bonus.troop ?? "all"))
        .map((bonus) => ({ targetModelSide: owner, sourceRecognitionState: owner,
          sourceReportSide: column.sourceSide,
          canonicalLabel: bonus.canonicalLabel ?? bonus.label, value: bonus.amount.value })) ?? []);
  return { reportValueSource: { value: field.value, source: "ocrPreview" as const },
    specialBonusAdditivePercent: totals.additivePercent, buffDecimal: totals.buffDecimal,
    debuffDecimal: totals.debuffDecimal, receivedDebuffContributions,
    rawPercent: deriveRawReportAttribute({ reportPercent: field.value, ...totals }) };
}

export function mapReportSide(input: ValidationBattleInput,
  report: ParsedBattleReport, sourceSide: ReportSourceSide, targetSide: SideId,
  mode: "prediction" | "finalReport", assumeZeroSpecial = false,
  opposing?: ParsedBattleReportSide,
  assumeZeroOpposing = false, completeness?: SpecialBonusCompleteness): ValidationBattleInput {
  const parsed = side(report, sourceSide);
  if (mode === "prediction" && completeness === "incomplete")
    throw new Error("特殊加成信息尚未完整，无法可靠反推属性。");
  const explicitZero = completeness === "explicitZero";
  if (mode === "prediction" && completeness === undefined && !parsed.specialEvidence && !assumeZeroSpecial) {
    throw new Error("特殊加成信息不完整，无法可靠反推原始属性。请补充图片或明确选择特殊加成均按0处理。");
  }
  if (mode === "prediction" && completeness === undefined && !opposing?.specialEvidence && !assumeZeroOpposing) {
    throw new Error("对方特殊加成信息不完整，无法确定本方受到的减益。请补充图片或明确按0处理。");
  }
  if (mode === "prediction" && !explicitZero && ((parsed.unmatchedBonuses?.length ?? 0) > 0 ||
    (opposing?.unmatchedBonuses?.length ?? 0) > 0)) {
    throw new Error("特殊加成存在未归类项目，需先在详情中确认。");
  }
  const current = targetSide === "A" ? input.sideA : input.sideB;
  const totals = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(attributes.map((attribute) => [attribute,
      mode === "prediction" && !explicitZero ? specialTotals(parsed, troop, attribute,
        opposing, targetSide) :
        { additivePercent: 0, buffDecimal: 0, debuffDecimal: 0 }]))])) as
    Readonly<Record<TroopType, Readonly<Record<ReportAttribute,
      ReturnType<typeof specialTotals>>>>>;
  const modifiers = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(attributes.map((attribute) => [attribute, {
      additive: totals[troop][attribute].additivePercent,
      buff: totals[troop][attribute].buffDecimal * 100,
      debuff: totals[troop][attribute].debuffDecimal * 100,
    }]))])) as
    NonNullable<ValidationSideInput["importedReportModifiers"]>;
  const troops = applyTroops(current, parsed, report.pageTypes?.includes("troops") ?? false);
  const updatedTroops = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
    ...troops[troop], ...Object.fromEntries(attributes.map((attribute) => {
      const field = accepted(parsed.attributes[troop]?.[attribute],
        `${troop}${attribute}`);
      const value = field.value;
      if (!Number.isFinite(value) || value <= -100 || value > 100_000 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
        throw new Error(`${troop}${attribute} 百分比格式无效。`);
      }
      return [attribute, mode === "prediction" ? deriveRawReportAttribute({
        reportPercent: value, ...totals[troop][attribute] }) : value];
    })) }])) as ValidationSideInput["troops"];
  const { importedReportModifiers: _previousModifiers, ...currentWithoutImport } = current;
  void _previousModifiers;
  const nextSide: ValidationSideInput = { ...currentWithoutImport, troops: updatedTroops,
    ...(mode === "prediction" ? { importedReportModifiers: modifiers,
      sourceReportBonuses: modifiers, reportAttributeBasis: "raw",
      sourceReportAttributes: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
        Object.fromEntries(attributes.map((stat) => [stat, parsed.attributes[troop]![stat]!.value]))])) as
          NonNullable<ValidationSideInput["sourceReportAttributes"]>,
    } : {
      reportWeaponLevels: {}, simulationWeaponLevels: {},
    }) };
  return normalizeHistoricalTree({ ...input, attributeInputMode: mode,
    ...(targetSide === "A" ? { sideA: nextSide } : { sideB: nextSide }) });
}

export function mapReportContextSide(input: ValidationBattleInput,
  report: ParsedBattleReport, selected: ReportSourceSide, target: SideId,
  completeness: SpecialBonusCompleteness): ValidationBattleInput {
  return mapReportSide(input, report, selected, target, "prediction", false,
    report[selected === "left" ? "right" : "left"], false, completeness);
}

export function mapDoubleSidedFinalReport(input: ValidationBattleInput,
  report: ParsedBattleReport, leftTarget: SideId): ValidationBattleInput {
  const rightTarget = leftTarget === "A" ? "B" : "A";
  return mapReportSide(mapReportSide(input, report, "left", leftTarget,
    "finalReport"), report, "right", rightTarget, "finalReport");
}
