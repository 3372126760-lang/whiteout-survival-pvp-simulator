import { parentPort } from "node:worker_threads";
import { register } from "tsx/esm/api";
register();
const { createEvaluationExecutor } = await import("../src/pvp/optimizer/execution.ts");
const execute = createEvaluationExecutor();
parentPort.on("message", ({ id, job }) => {
  try { parentPort.postMessage({ id, result: execute(job) }); }
  catch (error) { parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
