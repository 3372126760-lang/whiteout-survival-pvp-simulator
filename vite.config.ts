import { defineConfig, normalizePath } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Connect } from "vite";
import { LocalOcrBridge } from "./scripts/localOcrBridge.ts";

const root = dirname(fileURLToPath(import.meta.url));
const ocrPython = join(root, ".venv-ocr", "Scripts", "python.exe");
const ocrScript = join(root, "scripts", "local-ocr.py");
const ocrBridge = new LocalOcrBridge(ocrPython, ocrScript, root);
const devUpdates = { lastWatchedFile: "", lastHotUpdateFile: "" };

const localOcr: Connect.NextHandleFunction = (request, response, next) => {
  if (request.url !== "/api/local-ocr" || request.method !== "POST") {
    next();
    return;
  }
  const bodyChunks: Buffer[] = [];
  let bodyBytes = 0;
  request.on("data", (chunk: Buffer) => {
    bodyChunks.push(chunk);
    bodyBytes += chunk.length;
    if (bodyBytes > 56_000_000) request.destroy();
  });
  request.on("end", () => {
    void ocrBridge.recognize(Buffer.concat(bodyChunks).toString("utf8")).then((result) => {
      if (response.writableEnded) return;
      const payload = result as { error?: string };
      response.statusCode = payload.error === undefined ? 200 : 422;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(result));
    }, (error: Error) => {
      if (response.writableEnded) return;
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: error.message }));
    });
  });
};

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/whiteout-survival-pvp-simulator/" : "/",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [{ name: "local-report-ocr", configureServer(server) {
    server.watcher.add(ocrScript);
    server.watcher.on("change", (file) => { devUpdates.lastWatchedFile = file; });
    server.middlewares.use((request, response, next) => {
      if (request.url === "/__pvp/ocr-status") {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(ocrBridge.status()));
        return;
      }
      if (request.url !== "/__pvp/dev-server") return next();
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(JSON.stringify({ project: "whiteout-survival-pvp-engine", root,
        pid: process.pid, port: server.config.server.port, updates: devUpdates }));
    });
    server.middlewares.use(localOcr);
    server.httpServer?.once("close", () => ocrBridge.dispose());
  }, configurePreviewServer(server) {
    server.middlewares.use(localOcr);
    server.httpServer.once("close", () => ocrBridge.dispose());
  }, handleHotUpdate(context) {
    devUpdates.lastHotUpdateFile = context.file;
    if (context.file === normalizePath(ocrScript)) {
      ocrBridge.dispose();
      context.server.ws.send({ type: "full-reload", path: "*", triggeredBy: context.file });
    }
  } }],
  build: {
    outDir: "dist-ui",
    emptyOutDir: true,
  },
}));
