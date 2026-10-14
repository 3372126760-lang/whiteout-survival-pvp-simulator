import { describe, expect, it, vi } from "vitest";
import { USER_REPORT_TROOPS } from "./fixtures/userReportTroopGroundTruth";
import { detectTroopCardRegions } from "../battleReportRecognition/troopCards";
import { deriveRawReportAttribute } from "../battleReportRecognition/mapping";
import { parseCardCount } from "../battleReportRecognition/values";
import { matchSpecialBonusLabel } from "../battleReportRecognition/specialBonusRegistry";
import { recognizeLocalReport } from "../../ui/recognizeLocalReport";
import type { OcrImage, OcrLine, TroopCardReading } from "../battleReportRecognition/types";

function token(text: string, x: number, y: number, w = 50, h = 12): OcrLine {
  return { text, confidence: .98, box: [[x-w/2,y-h/2],[x+w/2,y-h/2],
    [x+w/2,y+h/2],[x-w/2,y+h/2]] };
}
function image(): OcrImage {
  return { imageId: "synthetic-layout-user-transcription", width: 1500, height: 680,
    lines: USER_REPORT_TROOPS.flatMap((row, index) => [
      token(row.display.toFixed(1), 150+index*230, 310),
      ...(index === 0 || index === 5 ? [] : [token(String(row.count), 150+index*230, 375, 110)]),
      ...(index === 1 ? [token("8", 150+index*230+76, 104, 20)] : []),
    ]) };
}
describe("expanded troop slots (synthetic geometry, user-transcribed values)", () => {
  it("separates portraits from complete slots and restores all six values through local crops", async () => {
    const full = image();
    const cards = detectTroopCardRegions(full);
    expect(cards).toHaveLength(6);
    const readings: TroopCardReading[] = cards.flatMap((card, index) => {
      const truth = USER_REPORT_TROOPS[index]!;
      const x = 150+index*230;
      expect(card.troopSlotBBox.y1).toBeLessThan(card.portraitBBox.y1);
      expect(card.fireCrystalRoi.x2).toBeGreaterThan(card.portraitBBox.x2);
      expect(card.countRoi.y2).toBeGreaterThan(card.portraitBBox.y2);
      return (["fireCrystal", "count"] as const).map((field) => ({ cardId: card.cardId, field,
        bbox: field === "count" ? card.countRoi : card.fireCrystalRoi,
        passes: (["original", "gray", "contrast"] as const).map((variant) => ({ variant,
          lines: [field === "fireCrystal" ? token(String(truth.fc), x+76, 104, 20) :
            token(truth.count.toLocaleString("en-US").replaceAll(",", "|"), x, 375, 110)] })) }));
    });
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ images: [{ ...full, troopCardReadings: readings }] })));
    const recognized = await recognizeLocalReport([{ imageId: full.imageId, dataBase64: "fixture" }], request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0]![1]!.body)).mode).toBe("reportAttributesAndSpecialBonuses");
    expect(recognized.images[0]).not.toHaveProperty("troopCardReadings");
  });
  it("repairs only plausible thousands separators inside a count crop", () => {
    for (const text of ["741,805", "741.805", "741|805", "741 805"]) expect(parseCardCount(text)).toBe(741805);
    expect(parseCardCount("3|149|491")).toBe(3149491);
    for (const text of ["11.4", "741805 64035", "886378/3149491", "FC9"]) expect(parseCardCount(text)).toBeUndefined();
  });
  it("uses game official canonicals exactly and retains the old spelling as an alias", () => {
    for (const stat of ["攻击力", "防御力", "穿透力", "生命值"]) {
      expect(matchSpecialBonusLabel(`官职赋予部队${stat}`)).toMatchObject({ matchType: "exact", confidence: 1,
        rule: { canonicalLabel: `官职赋予部队${stat}` } });
      expect(matchSpecialBonusLabel(`官职赐予部队${stat}`)).toMatchObject({ matchType: "alias", confidence: 1 });
    }
  });
  it("preserves both already-confirmed historical inversions", () => {
    expect(deriveRawReportAttribute({ reportPercent: 4527.7, additivePercent: 0,
      buffDecimal: .575, debuffDecimal: 0 })).toBeCloseTo(2838.222222222222, 9);
    expect(deriveRawReportAttribute({ reportPercent: 3115.7, additivePercent: 5,
      buffDecimal: .35, debuffDecimal: .2 })).toBeCloseTo(2753.4, 9);
  });
});
