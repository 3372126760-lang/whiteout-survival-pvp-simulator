// tsx asks for os.userInfo() only to namespace its temporary cache. Some
// restricted Windows sessions fail that call. Supplying a stable uid avoids
// the environment lookup and does not affect the executed TypeScript program.
import { URL, fileURLToPath } from "node:url";

if (typeof globalThis.process.geteuid !== "function") {
  Object.defineProperty(globalThis.process, "geteuid", {
    configurable: true,
    value: () => 0,
  });
}

const preload = fileURLToPath(new URL("./tsx-windows-preload.cjs", import.meta.url));
const existingNodeOptions = globalThis.process.env.NODE_OPTIONS;
globalThis.process.env.NODE_OPTIONS = [
  `--require=${JSON.stringify(preload)}`,
  existingNodeOptions,
].filter(Boolean).join(" ");

await import("tsx/cli");
