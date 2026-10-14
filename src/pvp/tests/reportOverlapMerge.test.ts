import { normalizeRecognitionResult } from "./fixtures/historicalReportRecognition";
import { describe, expect, it } from "vitest";
import { mergeBattleReports } from "../battleReportRecognition/reportData";
import { matchSpecialBonusLabel } from "../battleReportRecognition/specialBonusRegistry";
import { selectSpecialBonusCandidate } from "../battleReportRecognition/specialBonusMerge";
import { specialTotals } from "../battleReportRecognition/mapping";
import type { OcrImage } from "../battleReportRecognition/types";

const label = "城镇被攻击时守城部队攻击力";
function page(imageId: string, value: number, confidence = .96, y = 60, name = label): OcrImage {
  return { imageId, width: 1200, height: 500, lines: [{ text: `${name} +${value}%`, confidence,
    box: [[20, y], [420, y], [420, y + 24], [20, y + 24]] }] };
}

describe("overlapping special bonus screenshots", () => {
  it("deduplicates equal observations and preserves both images as provenance", () => {
    const merged = mergeBattleReports([page("one", 10), page("two", 10)]
      .map(normalizeRecognitionResult));
    const rows = merged.left!.specialBonuses!.buffs;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sources?.map((source) => source.imageId)).toEqual(["one", "two"]);
    expect(rows[0]?.sources?.map((source) => source.imageIndex)).toEqual([0, 1]);
    expect(rows[0]?.conflict).toBe(false);
    expect(rows[0]?.amount.needsConfirmation).toBe(false);
    expect(merged.warnings).not.toEqual(expect.arrayContaining([expect.stringMatching(/冲突/)]));
    expect(specialTotals(merged.left!, "shield", "attack").buffDecimal).toBe(.1);
  });

  it.each([false, true])("prefers a complete 96%% row over a clipped 60%% row, reversed=%s", (reversed) => {
    const reports = [page("complete", 10), page("clipped", 0, .6, 0)].map(normalizeRecognitionResult);
    const merged = mergeBattleReports(reversed ? reports.reverse() : reports);
    const row = merged.left!.specialBonuses!.buffs[0]!;
    expect(row.amount.value).toBe(10);
    expect(row.conflict).toBe(false);
    expect(row.amount.needsConfirmation).toBe(false);
    expect(row.rowQuality?.isPartiallyClipped).toBe(false);
    expect(row.sources?.find((source) => source.imageId === "clipped")?.isPartiallyClipped).toBe(true);
    expect(specialTotals(merged.left!, "shield", "attack").buffDecimal).toBe(.1);
  });

  it("retains all high quality conflicting values across three screenshots and lets the user choose", () => {
    const first = mergeBattleReports([page("one", 10), page("two", 15, .95)]
      .map(normalizeRecognitionResult));
    const merged = mergeBattleReports([first, normalizeRecognitionResult(page("three", 20, .97))]);
    const row = merged.left!.specialBonuses!.buffs[0]!;
    expect(row.conflict).toBe(true);
    expect(new Set(row.conflictValues)).toEqual(new Set([10, 15, 20]));
    expect(row.candidates).toHaveLength(3);
    expect(row.sources).toHaveLength(3);
    expect(() => specialTotals(merged.left!, "shield", "attack")).toThrow(/冲突/);
    const selected = selectSpecialBonusCandidate(row, row.candidates!.findIndex((candidate) => candidate.amount.value === 15));
    expect(selected.amount.value).toBe(15);
    expect(selected.amount.confirmed).toBe(true);
    expect(selected.conflict).toBe(false);
    expect(specialTotals({ ...merged.left!, specialBonuses: {
      ...merged.left!.specialBonuses!, buffs: [selected] } }, "shield", "attack").buffDecimal).toBe(.15);
  });

  it("distinguishes short garrison and town-under-attack canonical labels before fuzzy matching", () => {
    expect(matchSpecialBonusLabel("守城部队攻击力")?.matchType).toBe("exact");
    expect(matchSpecialBonusLabel(label)?.matchType).toBe("exact");
    expect(matchSpecialBonusLabel("守城攻击")?.matchType).toBe("alias");
    const merged = mergeBattleReports([normalizeRecognitionResult(page("short", 10, .96, 60, "守城部队攻击力")),
      normalizeRecognitionResult(page("long", 15))]);
    expect(merged.left?.specialBonuses?.buffs.map((row) => row.canonicalLabel)).toEqual([
      "守城部队攻击力", label,
    ]);
    expect(merged.left?.specialBonuses?.buffs.some((row) => row.conflict)).toBe(false);
  });

  it("only a low quality disagreement remains OCR review, not a genuine high-quality conflict", () => {
    const merged = mergeBattleReports([page("weak1", 10, .6), page("weak2", 15, .65)]
      .map(normalizeRecognitionResult));
    const row = merged.left!.specialBonuses!.buffs[0]!;
    expect(row.conflict).toBe(false);
    expect(row.amount.needsConfirmation).toBe(true);
    expect(() => specialTotals(merged.left!, "shield", "attack")).toThrow(/人工确认/);
  });
});
