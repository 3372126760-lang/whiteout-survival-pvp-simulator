import { expect, it } from "vitest";
import { browserOcrLines } from "./browserOcrTokens";
import { normalizeRecognitionResult } from "../pvp/battleReportRecognition/recognize";

it("preserves bilingual OCR coordinates, decimal values and both sides of a real report row", () => {
  const labels = ["盾 兵 攻 击 力", "盾 兵 防 御 力", "盾 兵 穿 透 力", "盾 兵 生 命 值"];
  const lines = browserOcrLines(labels.map((label, i) => ({ text: `+4194.6% ${label} +1881.2%`, confidence: 92,
    bbox: { x0: 50, y0: 100 + i * 80, x1: 950, y1: 140 + i * 80 } })), 2);
  const parsed = normalizeRecognitionResult({ imageId: "test", width: 500, height: 500, lines });
  expect(parsed.left?.attributes.shield?.attack?.value).toBe(4194.6);
  expect(parsed.right?.attributes.shield?.attack?.value).toBe(1881.2);
  expect(lines[0]!.box).toEqual([[25, 50], [475, 50], [475, 70], [25, 70]]);
  expect(lines[0]!.confidence).toBe(.92);
});

it("does not turn missing percentage symbols into values or invent uncertain digits", () => {
  const lines = browserOcrLines([{ text: "4194.6 盾兵攻击力 1881.2", confidence: 40,
    bbox: { x0: 0, y0: 0, x1: 500, y1: 40 } }]);
  const parsed = normalizeRecognitionResult({ imageId: "test", width: 500, height: 100, lines });
  expect(parsed.left).toBeUndefined(); expect(parsed.right).toBeUndefined();
  expect(lines[0]!.confidence).toBe(.4);
  expect(() => browserOcrLines([], 0)).toThrow();
});

it("does not assign the right-side percentage to the left when OCR misses the left percent symbol", () => {
  const lines = browserOcrLines([{ text: "+771.226 射手攻击力 +508.0%", confidence: 80,
    bbox: { x0: 50, y0: 20, x1: 950, y1: 60 }, words: [
      { text: "+771.226", confidence: 40, bbox: { x0: 50, y0: 20, x1: 200, y1: 60 } },
      { text: "射手", confidence: 95, bbox: { x0: 420, y0: 20, x1: 480, y1: 60 } },
      { text: "攻击力", confidence: 95, bbox: { x0: 482, y0: 20, x1: 580, y1: 60 } },
      { text: "+508.0%", confidence: 95, bbox: { x0: 800, y0: 20, x1: 950, y1: 60 } },
    ] }]);
  const parsed = normalizeRecognitionResult({ imageId: "test", width: 1000, height: 100, lines });
  expect(parsed.left?.attributes.marksman?.attack).toBeUndefined();
  expect(parsed.right?.attributes.marksman?.attack?.value).toBe(508);
});
