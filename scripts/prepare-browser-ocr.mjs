/* global console, URL */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const target = join(root, "public/browser-ocr/v6.0.1");
await mkdir(join(target, "core"), { recursive: true });
await mkdir(join(target, "lang"), { recursive: true });
await copyFile(join(root, "node_modules/tesseract.js/dist/worker.min.js"), join(target, "worker.min.js"));
const core = join(root, "node_modules/tesseract.js-core");
for (const name of await readdir(core)) if (name.endsWith(".wasm.js"))
  await copyFile(join(core, name), join(target, "core", name));
await copyFile(join(core, "LICENSE"), join(target, "LICENSE-tesseract-core.txt"));
await copyFile(join(root, "node_modules/tesseract.js/LICENSE.md"), join(target, "LICENSE-tesseract.txt"));
for (const lang of ["chi_sim", "eng"])
  await copyFile(join(root, `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),
    join(target, "lang", `${lang}.traineddata.gz`));
console.log("Browser OCR assets ready (self-hosted Chinese/English models).");
