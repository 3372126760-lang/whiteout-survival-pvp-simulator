import { bounds, rowDistance, sameRow } from "./layout";
import type { OcrImage, OcrLine, RecognizedValue } from "./types";

export function parsePercent(text: string): number | undefined {
  text = text.normalize("NFKC").replace(/(\d\.)[OoＯ](?=\s*%)/g, "$10");
  const match = /(^|[^\d.,])([+\-－]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*[%％]/.exec(text);
  if (match === null) return undefined;
  const value = Number(match[2]!.replaceAll(",", "").replace("－", "-"));
  return Number.isFinite(value) && value > -100 && value <= 100_000 ? value : undefined;
}

export function parseCount(text: string): number | undefined {
  const tail = text.normalize("NFKC").replace(/^.*(?:数量|兵力|兵数)/, "").trim();
  const match = /^(\d{1,3}(?:[,\s]\d{3})+|\d{1,12})\s*(?:人|名|兵)?$/.exec(tail);
  if (match === null) return undefined;
  const value = Number(match[1]!.replaceAll(/[,\s]/g, ""));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Only used inside one troop's count ROI. Repair separators, never concatenate
 * an arbitrary row of numbers or interpret a displayed decimal level as a count. */
export function parseCardCount(text: string): number | undefined {
  const clean = text.normalize("NFKC").trim();
  const normal = parseCount(clean);
  if (normal !== undefined) return normal;
  if (!/^\d{1,3}(?:[.,;:|·'’\s]+\d{3})+\s*(?:人|名|兵)?$/.test(clean)) return undefined;
  return parseCount(clean.replaceAll(/[.;:|·'’]/g, ","));
}

export function makeValue<T>(value: T, anchor: OcrLine, token: OcrLine,
  valid = true, structural = 1, enhanced?: OcrImage["enhancedLines"],
  parse?: (text: string) => T | undefined): RecognizedValue<T> {
  const ocr = Math.min(anchor.confidence, token.confidence);
  const second = enhanced?.filter((line) => sameRow(token, line) &&
    Math.abs(bounds(token).centerX - bounds(line).centerX) <=
      Math.max(bounds(token).width, bounds(line).width, 30) * .85)
    .sort((a, b) => rowDistance(token, a) - rowDistance(token, b))[0];
  const secondValue = second === undefined || parse === undefined ? undefined : parse(second.text);
  const disagreement = secondValue !== undefined && secondValue !== value;
  const validationConfidence = valid ? 1 : 0;
  const structuralConfidence = Math.max(0, Math.min(1, structural));
  const finalConfidence = Math.min(ocr, structuralConfidence, validationConfidence,
    disagreement ? .45 : 1);
  return { value, rawText: token.text, confidence: finalConfidence,
    ocrConfidence: ocr, structuralConfidence, validationConfidence,
    finalConfidence, needsConfirmation: finalConfidence < .85 || disagreement,
    ...(disagreement ? { alternatives: [secondValue] } : {}), box: token.box };
}
