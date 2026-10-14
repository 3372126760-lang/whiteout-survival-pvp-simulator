/* global process, console, URL, fetch, WebSocket, setTimeout, performance, Buffer */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const url = new URL(process.argv[2] ?? "http://127.0.0.1:5173/");
const identity = await (await fetch(new URL("/__pvp/dev-server", url))).json();
const expectedRoot = fileURLToPath(new URL("..", import.meta.url));
if (identity.project !== "whiteout-survival-pvp-engine" ||
  identity.root.replaceAll("\\", "/").toLowerCase() !==
  expectedRoot.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase())
  throw new Error("目标服务器不属于当前项目，未执行 HMR 探测。");
const client = await (await fetch(new URL("/@vite/client", url))).text();
async function loadModule(path) {
  const response = await fetch(new URL(path, url));
  if (!response.ok) throw new Error(`模块加载失败：${path} (${response.status})`);
  // Consume the complete transformed module before probing its update.
  await response.text();
}
await loadModule("/src/ui/bootstrap.ts");
const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
if (token === undefined) throw new Error("无法获取 Vite HMR 握手信息。");
const socketUrl = new URL(url);
socketUrl.protocol = "ws:";
socketUrl.searchParams.set("token", token);
const socket = new WebSocket(socketUrl, "vite-hmr");
const messages = [];
socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
async function waitForMessage(accept) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const match = messages.find(accept);
    if (match !== undefined) return match;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Vite HMR 消息超时，已收到的消息类型：${messages.map((message) => message.type).join(",")}`);
}
try {
  await waitForMessage((message) => message.type === "connected");
  const results = [];
  for (const [path, webPath] of [["../src/ui/main.ts", "/src/ui/main.ts"],
    ["../src/pvp/battleReportRecognition/recognize.ts", "/src/pvp/battleReportRecognition/recognize.ts"],
    ["../scripts/local-ocr.py", null]]) {
    if (webPath !== null) await loadModule(webPath);
    const file = new URL(path, import.meta.url);
    const original = await readFile(file);
    messages.length = 0;
    const started = performance.now();
    try {
      const comment = path.endsWith(".py") ? "\n# HMR verification\n" : "\n// HMR verification\n";
      await writeFile(file, Buffer.concat([original, Buffer.from(comment)]));
      const normalizedFile = fileURLToPath(file).replaceAll("\\", "/");
      const change = await waitForMessage((message) =>
        message.type === "full-reload" ?
          message.triggeredBy?.replaceAll("\\", "/") === normalizedFile :
          message.type === "update" && message.updates.some((update) =>
            update.path === webPath || update.acceptedPath === webPath));
      results.push({ file: path, received: change.type,
        elapsedMs: performance.now() - started });
    } finally { await writeFile(file, original); }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  console.log(JSON.stringify({ url: url.href, pid: identity.pid,
    websocket: "connected", results }, null, 2));
} finally { socket.close(); }
