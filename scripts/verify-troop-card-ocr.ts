import { fileURLToPath } from "node:url";
import { LocalOcrBridge } from "./localOcrBridge";
import { USER_REPORT_TROOPS } from "../src/pvp/tests/fixtures/userReportTroopGroundTruth";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { recognizeLocalReport } from "../src/ui/recognizeLocalReport";
import { normalizeRecognitionResult } from "../src/pvp/battleReportRecognition/recognize";
import { detectTroopCardRegions, insideCardRegion } from "../src/pvp/battleReportRecognition/troopCards";
import type { OcrImage } from "../src/pvp/battleReportRecognition/types";

const server = process.argv[2];
if (server === undefined) throw new Error("Pass the actual running dev server URL; this check does not start one.");
const bridge = server === "--local" ? new LocalOcrBridge(
  fileURLToPath(new URL("../.venv-ocr/Scripts/python.exe", import.meta.url)),
  fileURLToPath(new URL("./local-ocr.py", import.meta.url)),
  fileURLToPath(new URL("../", import.meta.url))) : undefined;
try {
const imageId = "ocr-card-regression.png";
const dataBase64 = (await readFile(new URL(`../examples/${imageId}`, import.meta.url))).toString("base64");
const request: typeof fetch = async (input, init) => {
  if (bridge === undefined) return fetch(new URL(String(input), server), init);
  const payload = await bridge.recognize(String(init?.body)) as { error?: string };
  return new Response(JSON.stringify(payload), { status: payload.error === undefined ? 200 : 422 });
};
const response = await recognizeLocalReport([{ imageId, dataBase64 }], request);
// Exercise the Python ROI path even when the synthetic full image is already clear.
const cards = detectTroopCardRegions(response.images[0]!);
const cardRegions = cards.flatMap((card) => [
  { cardId: card.cardId, field: "fireCrystal", bbox: card.fireCrystalRoi },
  { cardId: card.cardId, field: "fireCrystal", bbox: card.fireCrystalFallbackRoi },
  { cardId: card.cardId, field: "count", bbox: card.countRoi },
]);
const cropResponse = await request("/api/local-ocr", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "troopCards",
    images: [{ imageId, dataBase64, cardRegions }] }) });
const crops = await cropResponse.json() as { images?: OcrImage[]; error?: string };
assert.ok(cropResponse.ok, crops.error);
assert.equal(crops.images?.[0]?.troopCardReadings?.length, 18);
assert.ok(crops.images![0]!.troopCardReadings!.every((reading) => reading.passes.length === 3));
const report = normalizeRecognitionResult({ ...response.images[0]!,
  // Remove full-image tokens for these fields: assertions must rely on actual ROI OCR.
  lines: response.images[0]!.lines.filter((line) => cards.some((card) => card.anchor === line) ||
    !cardRegions.some((region) => insideCardRegion(line, region.bbox))), enhancedLines: [],
  troopCardReadings: crops.images![0]!.troopCardReadings! });
for (const truth of USER_REPORT_TROOPS) {
  const setup = report[truth.side]?.troopSetup[truth.troop];
  assert.equal(setup?.count?.value, truth.count, `${truth.side} ${truth.troop} count`);
  assert.equal(setup?.displayedFireCrystalLevel?.value, truth.fc, `${truth.side} ${truth.troop} FC`);
  assert.equal(setup?.displayedTroopLevel?.value, truth.display);
  assert.equal(setup?.displayedFireCrystalLevel?.needsConfirmation, false);
  assert.equal(setup?.count?.needsConfirmation, false);
  assert.deepEqual(setup?.resolvedTroopComposition?.map((part) => [part.level, part.ratio]), truth.composition);
}
await writeFile(new URL("../examples/ocr-card-regression-result.json", import.meta.url),
  JSON.stringify({ syntheticFixture: true, response, crops, report }, null, 2));
console.log("Synthetic local OCR passed: 6 levels, 6 counts, 6 FC values; NOT a real game screenshot.");

} finally { bridge?.dispose(); }
