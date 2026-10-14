/* global URL, process, console, fetch, AbortSignal */
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 5173;
const url = `http://127.0.0.1:${port}/`;
const args = process.argv.slice(2);
if (args.some((arg) => /^(?:--port|--host|--strictPort)(?:=|$)/.test(arg))) {
  console.error("开发服务器固定为 127.0.0.1:5173；请勿覆盖端口或主机。");
  process.exit(1);
}

const available = await new Promise((accept, reject) => {
  const probe = createServer();
  probe.once("error", (error) => error.code === "EADDRINUSE" ? accept(false) : reject(error));
  probe.listen(port, "127.0.0.1", () => probe.close(() => accept(true)));
});
if (!available) {
  let server;
  try {
    const response = await fetch(`${url}__pvp/dev-server`, { signal: AbortSignal.timeout(2000) });
    server = await response.json();
  } catch { /* An unrelated service is never stopped automatically. */ }
  if (server?.project === "whiteout-survival-pvp-engine" &&
    typeof server.root === "string" &&
    resolve(server.root).toLowerCase() === resolve(root).toLowerCase()) {
    console.log(`复用当前项目开发服务器（PID ${server.pid}）：${url}`);
    process.exit(0);
  }
  console.error(`端口 5173 已被占用，未启动额外实例。请检查 netstat -ano 中的监听 PID。\n当前目标 URL：${url}`);
  process.exit(1);
}

console.log(`启动唯一开发服务器：${url}`);
const child = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"),
  "--host", "127.0.0.1", "--port", String(port), "--strictPort", ...args],
{ cwd: root, stdio: "inherit", windowsHide: true });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
