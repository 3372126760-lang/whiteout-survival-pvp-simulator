import type { OcrLine } from "../pvp/battleReportRecognition/types";
interface TextRow { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; words?: readonly TextRow[] }
function spatialTokens(row: TextRow): TextRow[] {
  if (!row.words?.length) return [row];
  const kind = (text: string) => /[\u4e00-\u9fff]/.test(text) ? "label" : /^[+\-\d.,%％\s]+$/.test(text) ? "number" : "other";
  const groups: TextRow[][] = [];
  for (const word of row.words) {
    if (!word.text.trim()) continue;
    const group = groups.at(-1), prior = group?.at(-1);
    if (prior && kind(prior.text) === kind(word.text) &&
      word.bbox.x0 - prior.bbox.x1 <= Math.max(prior.bbox.y1 - prior.bbox.y0, word.bbox.y1 - word.bbox.y0) * 1.5) group!.push(word);
    else groups.push([word]);
  }
  return groups.map(group => ({ text: group.map(w => w.text).join(""), confidence: Math.min(...group.map(w => w.confidence)),
    bbox: { x0: Math.min(...group.map(w => w.bbox.x0)), y0: Math.min(...group.map(w => w.bbox.y0)),
      x1: Math.max(...group.map(w => w.bbox.x1)), y1: Math.max(...group.map(w => w.bbox.y1)) } }));
}
/** Chinese OCR inserts spaces between characters. Keep values and coordinate
 * order intact; never invent a missing percent or substitute an unread number. */
export function browserOcrLines(rows: readonly TextRow[], scale = 1): OcrLine[] {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid OCR image scale");
  return rows.flatMap(spatialTokens).filter(row => row.text.trim()).map(row => {
    const text = row.text.normalize("NFKC").replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1").trim();
    const { x0, y0, x1, y1 } = row.bbox;
    return { text, confidence: Math.min(1, Math.max(0, row.confidence / 100)),
      box: [[x0 / scale, y0 / scale], [x1 / scale, y0 / scale], [x1 / scale, y1 / scale], [x0 / scale, y1 / scale]],
      bbox: { x1: x0 / scale, y1: y0 / scale, x2: x1 / scale, y2: y1 / scale } };
  });
}
