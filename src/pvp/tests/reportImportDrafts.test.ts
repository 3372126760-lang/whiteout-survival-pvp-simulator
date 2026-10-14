import { normalizeRecognitionResult } from "./fixtures/historicalReportRecognition";
import { describe, expect, it } from "vitest";
import type { OcrImage } from "../../pvp";
import { mergeOwnedReportImage } from "../../ui/reportImportDrafts";

function special(imageId: string, value: number): OcrImage {
  return { imageId, width: 900, height: 300, lines: [{
    text: `宠物攻击力 +${value}%`, confidence: .98,
    box: [[20, 40], [240, 40], [240, 65], [20, 65]],
  }] };
}

describe("A/B recognition draft ownership", () => {
  it("keeps A's edits when B uploads and tags each bonus with its army", () => {
    const empty = { A: null, B: null };
    const withA = mergeOwnedReportImage(empty, "A",
      normalizeRecognitionResult(special("A-1", 5)));
    const withB = mergeOwnedReportImage(withA, "B",
      normalizeRecognitionResult(special("B-1", 15)));
    expect(withB.A).toBe(withA.A);
    expect(withB.A?.left?.specialBonuses?.buffs[0]).toMatchObject({
      sourceRecognitionState: "A", sourceReportSide: "left", amount: { value: 5 },
    });
    expect(withB.B?.left?.specialBonuses?.buffs[0]).toMatchObject({
      sourceRecognitionState: "B", sourceReportSide: "left", amount: { value: 15 },
    });
    const reuploadedB = mergeOwnedReportImage(withB, "B",
      normalizeRecognitionResult(special("B-2", 15)));
    expect(reuploadedB.A).toBe(withB.A);
    expect(reuploadedB.B?.left?.specialBonuses?.buffs).toHaveLength(1);
  });
});
