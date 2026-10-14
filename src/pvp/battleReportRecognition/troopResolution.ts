import { SUPPORTED_TROOP_LEVELS } from "../data/troopConstants";
import type { ParsedTroopSetup, ResolvedBaseCompositionEntry,
  ResolvedTroopCompositionEntry } from "./types";

export const TROOP_APPROXIMATION_WARNING = "兵种等级与火晶等级已按战报显示值自动还原。由于战报显示精度有限，真实混兵构成可能与默认还原存在少量偏差；如已知实际配置，可在导入后手动修改。";

export function resolveDisplayedBaseComposition(level: number, count?: number):
  readonly ResolvedBaseCompositionEntry[] {
  if (!Number.isFinite(level) || level < 1 || level > 12 ||
    Math.abs(level * 10 - Math.round(level * 10)) > 1e-7)
    throw new RangeError("显示兵种等级只支持 1–12 的一位小数。");
  if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
    throw new RangeError("兵种数量格式无效。");
  const lower = Math.floor(level);
  const upperRatio = Math.round((level - lower) * 10) / 10;
  const lowerRatio = Math.round((1 - upperRatio) * 10) / 10;
  if (upperRatio === 0) return [{ level: lower, ratio: 1,
    ...(count === undefined ? {} : { count }) }];
  const lowerCount = count === undefined ? undefined : Math.round(count * lowerRatio);
  return [{ level: lower, ratio: lowerRatio,
    ...(lowerCount === undefined ? {} : { count: lowerCount }) },
  { level: lower + 1, ratio: upperRatio,
    ...(count === undefined || lowerCount === undefined ? {} : { count: count - lowerCount }) }];
}

export function resolveDisplayedTroopComposition(displayed: number, fireCrystal = 0,
  count?: number): readonly ResolvedTroopCompositionEntry[] {
  if (!Number.isInteger(fireCrystal) || fireCrystal < 0 || fireCrystal > 10)
    throw new RangeError("战报火晶等级须为 0–10 的整数。");
  return resolveDisplayedBaseComposition(displayed, count).map((part) => {
    const level = `T${part.level}${fireCrystal === 0 ? "" : `-FC${fireCrystal}`}`;
    if (!SUPPORTED_TROOP_LEVELS.some((available) => available === level))
      throw new RangeError(`战报显示值对应不存在的兵种等级：${level}，请核对。`);
    return { baseTier: part.level, fireCrystalLevel: fireCrystal, level,
      ratio: part.ratio, ...(part.count === undefined ? {} : { count: part.count }) };
  });
}

/** Display precision is a warning. Only OCR/format/real-level errors need review. */
export function resolveParsedTroopSetup(setup: ParsedTroopSetup): ParsedTroopSetup {
  if (setup.resolutionSource === "userOverride") return setup;
  const display = setup.displayedTroopLevel;
  if (display === undefined) return setup;
  let resolvedBaseComposition = setup.resolvedBaseComposition;
  try {
    resolvedBaseComposition = resolveDisplayedBaseComposition(display.value, setup.count?.value);
    const crystal = setup.displayedFireCrystalLevel;
    if (setup.cardBbox !== undefined && display.value >= 10 && crystal === undefined)
      return { ...setup, resolvedBaseComposition,
        displayedTroopLevel: { ...display, needsConfirmation: true } };
    const fc = crystal?.value ?? Number(/-FC(\d+)$/.exec(setup.level?.value ?? "")?.[1] ?? 0);
    const resolvedTroopComposition = resolveDisplayedTroopComposition(display.value, fc, setup.count?.value);
    const confidence = Math.min(display.finalConfidence ?? display.confidence,
      crystal?.finalConfidence ?? crystal?.confidence ?? 1);
    return { ...setup, resolvedBaseComposition, resolvedTroopComposition,
      resolutionSource: "battleReportApproximation",
      level: { ...display, alternatives: [], value: resolvedTroopComposition[0]!.level,
        confidence, finalConfidence: confidence,
        needsConfirmation: Boolean(display.needsConfirmation || crystal?.needsConfirmation),
        confirmed: display.confirmed === true && (crystal === undefined || crystal.confirmed === true) } };
  } catch {
    return { ...setup, ...(resolvedBaseComposition === undefined ? {} : { resolvedBaseComposition }),
      displayedTroopLevel: { ...display, needsConfirmation: true } };
  }
}
