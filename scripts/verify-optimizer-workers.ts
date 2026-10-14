import { readFileSync, readdirSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createEvaluationExecutor, createStageSeeds, getValidationCatalog,
  type EvaluationJob, type EvaluationJobResult } from "../src/pvp";
import { createDefaultValidationInput } from "../src/ui/defaultInput";

// Execute the actual Vite-built candidate worker in separate Node threads.
// Only the browser message transport is shimmed; engine/job code is unchanged.
const assets = new URL("../dist-ui/assets/", import.meta.url);
const name = readdirSync(assets).find((path) => /^optimizerCandidateWorker-.*\.js$/.test(path));
if (name === undefined) throw new Error("Run npm run build:ui before verifying workers.");
const source = readFileSync(new URL(name, assets), "utf8");
const wrapper = `const { parentPort } = require("node:worker_threads");
globalThis.self = { postMessage: (message) => parentPort.postMessage(message) };
${source}
parentPort.on("message", (data) => self.onmessage({ data }));
parentPort.postMessage({ ready: true });`;

const workers = Array.from({ length: 4 }, () => new Worker(wrapper, { eval: true }));
const pending = new Map<number, { resolve: (row: EvaluationJobResult) => void;
  reject: (error: Error) => void }>();
try {
  await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
    worker.on("error", (error) => {
      reject(error);
      pending.forEach((request) => request.reject(error));
      pending.clear();
    });
    worker.on("message", (message: { ready?: boolean; id: number;
      result?: EvaluationJobResult; error?: string }) => {
      if (message.ready) { resolve(); return; }
      const request = pending.get(message.id);
      if (request === undefined) return;
      pending.delete(message.id);
      if (message.error !== undefined) request.reject(new Error(message.error));
      else if (message.result !== undefined) request.resolve(message.result);
      else request.reject(new Error("Invalid worker reply."));
    });
  })));
  const base = createDefaultValidationInput();
  const lineup = Object.fromEntries(getValidationCatalog().leaderHeroes
    .filter((hero) => hero.generation === 8).map((hero) => [hero.troopType, hero.heroId]));
  const input = { ...base, maxRounds: 8,
    sideA: { ...base.sideA, leaderHeroIds: lineup } };
  const rally = { ...input, scenarioType: "RALLY" as const, battleContext: "rally" as const };
  const rallyCandidate = { leaderHeroIds: lineup, memberSkillIds: [],
    ratios: { shield: 50, lancer: 20, marksman: 30 } };
  const jobs: EvaluationJob[] = Array.from({ length: 12 }, (_, index) => ({
    kind: "battle", input: { ...input, randomSeed: index }, side: "A",
    seeds: createStageSeeds(index, 3), collectOutcomes: true,
  }));
  jobs.push(...Array.from({ length: 4 }, (_, index): EvaluationJob => ({ kind: "threeQueue",
    input: { ...base, scenarioType: "THREE_QUEUE", attributeInputMode: "prediction", maxRounds: 300,
      sideA: { ...base.sideA, deploymentCapacity: 60 },
      sideB: { ...base.sideB, deploymentCapacity: 60 } },
    side: "A", seeds: createStageSeeds(index, 3) })));
  jobs.push(...Array.from({ length: 4 }, (_, index): EvaluationJob => ({ kind: "multiWave",
    input: rally, sequence: [rallyCandidate, rallyCandidate],
    initialEnemy: { shield: 100, lancer: 50, marksman: 30 }, targetProbability: .9,
    side: "A", seeds: createStageSeeds(index, 3) })));
  const results = await Promise.all(jobs.map((job, id) => new Promise<EvaluationJobResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    workers[id % workers.length]!.postMessage({ id, job });
  })));
  const execute = createEvaluationExecutor();
  jobs.forEach((job, index) => {
    const expected = execute(job);
    if (JSON.stringify(results[index]!.samples) !== JSON.stringify(expected.samples) ||
      JSON.stringify(results[index]!.multiWave) !== JSON.stringify(expected.multiWave)) {
      throw new Error(`Worker seed/result mismatch at job ${index}.`);
    }
  });
  process.stdout.write(`PASS: ${jobs.length} jobs in 4 real worker threads; seeded battle/three-queue/multi-wave results match sequential execution.\n`);
  process.stdout.write(`Built worker: ${fileURLToPath(new URL(name, assets))}\n`);
} finally {
  await Promise.all(workers.map((worker) => worker.terminate()));
}
