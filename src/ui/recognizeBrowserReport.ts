import { createWorker, OEM, PSM, type Worker, type Page } from "tesseract.js";
import type { OcrImage } from "../pvp/battleReportRecognition/types";
import { browserOcrLines } from "./browserOcrTokens";

interface UploadedImage { readonly imageId: string; readonly dataBase64: string; readonly mimeType?: string }
let workerPromise: Promise<Worker> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let onStatus: (text: string) => void = () => {};
let phase = "";
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const rows = (data: Page) => data.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines)) ?? [];

async function deadline<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([task, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("识别超时，请尝试单张清晰的属性截图，或手动填写。")), ms);
  })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function discardWorker() {
  const old = workerPromise; workerPromise = undefined;
  if (old) void old.then(w => w.terminate()).catch(() => {});
}
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const base = new URL(`${import.meta.env.BASE_URL}browser-ocr/v6.0.1/`, location.href).href;
    workerPromise = createWorker(["chi_sim", "eng"], OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`, corePath: `${base}core`, langPath: `${base}lang`,
      workerBlobURL: false, cachePath: "wos-browser-ocr-bestint-v1", gzip: true,
      logger: message => onStatus(message.status === "recognizing text"
        ? `${phase} · ${Math.round(message.progress * 100)}%`
        : "正在准备中文识别模型，首次加载需要下载，后续会缓存…"),
    });
  }
  return deadline(workerPromise, 180_000);
}
async function readImages(images: readonly UploadedImage[], progress: (text: string) => void) {
  if (images.length < 1 || images.length > 8) throw new Error("每次请选择 1～8 张图片。");
  onStatus = progress;
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  const started = performance.now(), reused = workerPromise !== undefined;
  try {
    progress("正在准备中文识别模型，图片仅在当前设备处理…");
    const worker = await getWorker(), initializationMs = performance.now() - started;
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1", user_defined_dpi: "150" });
    const output: OcrImage[] = [];
    for (const [index, image] of images.entries()) {
      if (image.dataBase64.length > 14 * 1024 * 1024) throw new Error("请选择不超过 10 MB 的图片。");
      const mime = /^image\/(?:png|jpeg|webp|bmp|gif|avif)$/.test(image.mimeType ?? "") ? image.mimeType! : "image/png";
      const decoded = new Image(); decoded.src = `data:${mime};base64,${image.dataBase64}`;
      await deadline(decoded.decode(), 30_000);
      const width = decoded.naturalWidth, height = decoded.naturalHeight;
      if (!width || !height || width * height > 25_000_000) throw new Error("图片过大，请选择不超过 2500 万像素的截图。");
      const scale = Math.min(2, 2400 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("此浏览器无法处理截图，请更换浏览器或手动填写。");
      try {
        ctx.drawImage(decoded, 0, 0, canvas.width, canvas.height);
        phase = `识别第 ${index + 1}/${images.length} 张图片`;
        const first = await deadline(worker.recognize(canvas, {}, { blocks: true }), 120_000);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray = .299 * pixels.data[i]! + .587 * pixels.data[i + 1]! + .114 * pixels.data[i + 2]!;
          const value = Math.max(0, Math.min(255, (gray - 128) * 1.6 + 128));
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
        }
        ctx.putImageData(pixels, 0, 0);
        phase = `复核第 ${index + 1}/${images.length} 张图片`;
        const second = await deadline(worker.recognize(canvas, {}, { blocks: true }), 120_000);
        const firstLines = browserOcrLines(rows(first.data), scale), secondLines = browserOcrLines(rows(second.data), scale);
        // Keep alternate passes as separate evidence. The existing merger can
        // recover missing rows and require confirmation for disagreeing values.
        output.push({ imageId: image.imageId, width, height, lines: firstLines, enhancedLines: secondLines },
          { imageId: `${image.imageId}:enhanced`, width, height, lines: secondLines, enhancedLines: firstLines });
      } finally { canvas.width = canvas.height = 1; decoded.src = ""; }
    }
    return { images: output, performance: { engineReused: reused,
      modelInitializationMs: initializationMs, workerRequestMs: performance.now() - started } };
  } catch (error) {
    await discardWorker();
    throw new Error(`浏览器识图未完成：${error instanceof Error ? error.message : String(error)} 可重新选择图片重试，或手动填写。`);
  } finally {
    onStatus = () => {};
    if (workerPromise) idleTimer = setTimeout(() => { void discardWorker(); }, 60_000);
  }
}
/** Serialize OCR requests to bound memory and keep per-image progress isolated. */
export function recognizeBrowserReport(images: readonly UploadedImage[], progress: (text: string) => void = () => {}) {
  const job = queue.then(() => readImages(images, progress));
  queue = job.catch(() => {}); return job;
}
