import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";
register();
try {
  const { runReneeVariant } = await import("./benchmark-renee-stacking.ts");
  const result = await runReneeVariant(workerData.root, workerData.fixture, workerData.variant,
    (progress) => parentPort.postMessage({ progress }));
  parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.stack : String(error) }); }
