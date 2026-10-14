import type { OcrImage } from "../pvp/battleReportRecognition/types";

interface UploadedOcrImage { readonly imageId: string; readonly dataBase64: string }
interface OcrResponse {
  readonly images?: readonly OcrImage[];
  readonly error?: string;
  readonly performance?: { readonly engineReused: boolean;
    readonly modelInitializationMs: number; readonly workerRequestMs: number };
}

/** Attributes and historical special bonuses: retain full-image boxes, never request troop-card crops. */
export async function recognizeLocalReport(images: readonly UploadedOcrImage[],
  request: typeof fetch = fetch): Promise<OcrResponse & { images: readonly OcrImage[] }> {
  const response = await request("/api/local-ocr", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "reportAttributesAndSpecialBonuses", images }) });
  const payload = await response.json() as OcrResponse;
  if (!response.ok || payload.images === undefined)
    throw new Error(payload.error ?? "本地 OCR 识别失败，请检查 .venv-ocr。");
  return { ...payload, images: payload.images.map(({ troopCardReadings: _ignored, ...image }) => {
    void _ignored; return image;
  }) };
}
