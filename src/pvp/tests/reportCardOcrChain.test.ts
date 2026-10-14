import { normalizeRecognitionResult } from "./fixtures/historicalReportRecognition";
import { describe, expect, it, vi } from "vitest";
import { detectTroopCardRegions } from "../battleReportRecognition/troopCards";
import { parseCount } from "../battleReportRecognition/values";
import { matchSpecialBonusLabel } from "../battleReportRecognition/specialBonusRegistry";
import { mergeSpecialBonuses } from "../battleReportRecognition/specialBonusMerge";
import type { OcrImage, OcrLine, TroopCardReading } from "../battleReportRecognition/types";
import { recognizeLocalReport } from "../../ui/recognizeLocalReport";
import { reportBonusSummary } from "../../ui/reportBonusSummary";
import { mapReportContextSide } from "../battleReportRecognition/mapping";
import { createDefaultValidationInput } from "../../ui/defaultInput";

function line(text: string, x: number, y: number, width = 90, confidence = .98): OcrLine {
  return { text, confidence, box: [[x - width / 2, y - 10], [x + width / 2, y - 10],
    [x + width / 2, y + 10], [x - width / 2, y + 10]] };
}
function cards(scale = 1): OcrImage {
  const levels = ["11", "10.3", "11.4", "11", "11.5", "11.4"];
  const lines = levels.flatMap((value, index) => [line(value, 100 + index * 180, 140, 60),
    ...(index === 3 || index === 5 ? [] : [line("4,659,053", 100 + index * 180, 180, 125)])]);
  return { imageId: "cards.png", width: 1200 * scale, height: 450 * scale,
    lines: lines.map((row) => ({ ...row, box: row.box.map(([x, y]) =>
      [x * scale, y * scale] as const) as unknown as OcrLine["box"] })) };
}
function roiReadings(image: OcrImage): TroopCardReading[] {
  return detectTroopCardRegions(image).flatMap((card) => {
    const x = (card.bbox.x1 + card.bbox.x2) / 2;
    return (["fireCrystal", "count"] as const).map((field) => ({
      cardId: card.cardId, field,
      bbox: field === "count" ? card.countRoi : card.fireCrystalRoi,
      passes: (["original", "gray", "contrast"] as const).map((variant) => ({ variant,
        lines: [line(field === "fireCrystal" ? "10" : card.troop === "shield" ?
          "741,805" : card.troop === "lancer" ? "4,659,053" : "886,378", x,
          field === "fireCrystal" ? 105 : 180, field === "fireCrystal" ? 35 : 125)] })) }));
  });
}

describe("local troop card OCR chain", () => {
  it("requests only full-image attribute OCR and never crops troop cards", async () => {
    const full = cards();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ images: [full] })));
    const result = await recognizeLocalReport([{ imageId: full.imageId, dataBase64: "test" }], request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body))).toMatchObject({mode:"reportAttributesAndSpecialBonuses"});
    expect(result.images[0]).not.toHaveProperty("troopCardReadings");
  });
  it.each([.5, 1, 2])("detects relative card regions at scale %s", (scale) => {
    const image = cards(scale), regions = detectTroopCardRegions(image);
    expect(regions).toHaveLength(6);
    expect(regions[5]!.bbox.x1 / scale).toBeCloseTo(detectTroopCardRegions(cards())[5]!.bbox.x1);
  });
  it("reads naked fire-crystal numerals and does not treat the level row as FC", () => {
    const image = cards();
    const report = normalizeRecognitionResult({ ...image,
      lines: [...image.lines, ...Array.from({ length: 6 }, (_, index) =>
        line("10", 100 + index * 180, 105, 30))] });
    expect(report.left?.troopSetup.shield?.displayedTroopLevel?.value).toBe(11);
    expect(report.left?.troopSetup.shield?.displayedFireCrystalLevel?.value).toBe(10);
    expect(report.left?.troopSetup.shield?.level?.value).toBe("T11-FC10");
  });
  it("does not fabricate FC0 when a card's displayed fire crystal is missing", () => {
    const report = normalizeRecognitionResult(cards());
    expect(report.left?.troopSetup.shield?.resolvedTroopComposition).toBeUndefined();
    expect(() => mapReportContextSide(createDefaultValidationInput(), report, "left", "A", "explicitZero"))
      .toThrow(/火晶等级未识别/);
  });
  it("blocks missing card counts even on a combined attribute screenshot", () => {
    const image = cards();
    const report = normalizeRecognitionResult({ ...image, troopCardReadings: roiReadings(image)
      .filter((reading) => reading.field === "fireCrystal") });
    const attributePage = { ...report, pageTypes: ["attributes" as const] };
    expect(() => mapReportContextSide(createDefaultValidationInput(), attributePage, "right", "B", "explicitZero"))
      .toThrow(/shield兵数或战报等级未识别/);
  });
  it("rejects cross-card count lines and never borrows the neighboring count", () => {
    const image = cards();
    const crossed = line("741805 4659053", 730, 180, 290);
    const report = normalizeRecognitionResult({ ...image, lines: [...image.lines, crossed] });
    expect(report.right?.troopSetup.shield?.count).toBeUndefined();
    expect(report.right?.troopSetup.lancer?.count?.value).toBe(4659053);
    expect(report.right?.troopSetup.marksman?.count).toBeUndefined();
  });
  it("parses comma/full-width/space thousands and rejects concatenated counts", () => {
    for (const text of ["4,659,053", "４，６５９，０５３", "4 659 053"])
      expect(parseCount(text)).toBe(4659053);
    expect(parseCount("4659053 886378")).toBeUndefined();
    expect(parseCount("4659053/886378")).toBeUndefined();
  });
  it("keeps equally reliable conflicting ROI readings pending", () => {
    const image = cards();
    const card = detectTroopCardRegions(image)[3]!;
    const reading: TroopCardReading = { cardId: card.cardId, field: "count", bbox: card.countRoi,
      passes: [{ variant: "original", lines: [line("741805", 640, 180, 110)] },
        { variant: "contrast", lines: [line("741806", 640, 180, 110)] }] };
    const report = normalizeRecognitionResult({ ...image, troopCardReadings: [reading] });
    expect(report.right?.troopSetup.shield?.count?.needsConfirmation).toBe(true);
  });
});

describe("official labels through the real report parser", () => {
  it("uses exact normalized labels with 100% matching and accepts both zero and five", () => {
    const labels = ["官职赋予部队攻击力", "官职赋予部队防御力",
      "官职赋予部队穿透力", "官职赋予部队生命值"];
    const image: OcrImage = { imageId: "official.png", width: 900, height: 400,
      lines: labels.flatMap((label, index) => [line(`『${label}』\u200b`, 440, 80 + index * 55, 290),
        line("+0%", 180, 80 + index * 55, 55), line("+5%", 710, 80 + index * 55, 55)]) };
    const report = normalizeRecognitionResult(image);
    for (const side of ["left", "right"] as const) {
      expect(report[side]?.specialBonuses?.additive).toHaveLength(4);
      for (const bonus of report[side]!.specialBonuses!.additive) {
        expect(bonus.matchType).toBe("exact");
        expect(bonus.matchScore).toBe(1);
        expect(bonus.amount.value).toBe(side === "left" ? 0 : 5);
        expect(bonus.amount.needsConfirmation).toBe(false);
      }
    }
    expect(reportBonusSummary(report.left)).toBe("4项 / 0待确认");
    expect(reportBonusSummary(report.right)).toBe("4项 / 0待确认");
  });
  it("measures fuzzy similarity instead of assigning the old direct-rule 75%", () => {
    const result = matchSpecialBonusLabel("部队攻击力未知效果");
    expect(result?.matchType).toBe("fuzzy");
    expect(result?.confidence).toBeLessThan(.75);
    expect(matchSpecialBonusLabel("| 部队攻击力 +10% |")?.matchType).toBe("exact");
  });
  it("does not retain a stale 75% match score when an exact overlap observation wins", () => {
    const image: OcrImage = { imageId: "official.png", width: 900, height: 300,
      lines: [line("官职赋予部队攻击力", 420, 80, 280), line("+0%", 150, 80, 55)] };
    const exact = normalizeRecognitionResult(image).left!.specialBonuses!.additive[0]!;
    const old = { ...exact, matchType: "fuzzy" as const, matchScore: .75, matchConfidence: .75,
      amount: { ...exact.amount, confidence: .75, finalConfidence: .75, needsConfirmation: true } };
    for (const [first, second] of [[old, exact], [exact, old]]) {
      const merged = mergeSpecialBonuses([first!], [second!])[0]!;
      expect(merged.matchType).toBe("exact");
      expect(merged.matchScore).toBe(1);
      expect(merged.matchConfidence).toBe(1);
      expect(merged.amount.needsConfirmation).toBe(false);
    }
  });
});
