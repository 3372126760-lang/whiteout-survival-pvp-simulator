import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { defaultOptimizationConfig, runRallyOptimizationAsync } from "../src/pvp/optimizer";
import { adaptiveSeedPools } from "../src/pvp/optimizer/adaptiveSampling";
import { toEngineScenario } from "../src/pvp/validationUi";
import { createPersistedEnvelope, restorePersistedConfig } from "../src/storage";
import { restoreOptimizerBenchmarkFixture } from "../src/ui/optimizerBenchmarkFixture";
import { assertMeasuredOptimizerFixture, benchmarkHash, type MeasuredOptimizerBenchmarkFixture } from "./optimizer-benchmark-fixture";
import type { EvaluationJob, EvaluationJobResult } from "../src/pvp/optimizer/execution";
import type { OptimizationInput, OptimizationConfig } from "../src/pvp/optimizer/types";

const args = process.argv.slice(2), value = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1]! : fallback;
const path = value("--fixture", "benchmarks/optimizer/joint-recall-gen12-input.json");
const text = readFileSync(path, "utf8"), raw = JSON.parse(text) as { input: OptimizationInput; optimizerConfig: OptimizationConfig; format?: string; kind?: string };
if (raw.kind === "exact-measured-canonical-input") assertMeasuredOptimizerFixture(raw as MeasuredOptimizerBenchmarkFixture);
const setup = raw.format ? await restoreOptimizerBenchmarkFixture(text) : restorePersistedConfig(createPersistedEnvelope(raw.input, 1000,
  { ...defaultOptimizationConfig(raw.input.randomSeed), ...raw.optimizerConfig }));
const input = setup.input, config = { ...setup.optimizationConfig, profiling: true }, workerCount = 4;
if (raw.kind === "exact-measured-canonical-input" && (benchmarkHash(input) !== benchmarkHash(raw.input) || benchmarkHash(config) !== benchmarkHash(raw.optimizerConfig)))
  throw new Error("The canonical codec changed the measured fixture; benchmark stopped before any battles.");
const output = value("--output", "artifacts/benchmarks/optimizer/joint-recall-gen12-profile.json");
if (resolve(output) === resolve(path)) throw new Error("Benchmark output must not overwrite its input fixture.");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const before = hash(input), slots = Array.from({ length: workerCount }, () => {
  const worker = new Worker(new URL("./joint-optimizer-node-worker.mjs", import.meta.url), { execArgv: [] });
  const pending = new Map<number, { resolve: (row: EvaluationJobResult) => void; reject: (error: Error) => void }>();
  worker.on("message", ({ id, result, error }: { id: number; result: EvaluationJobResult; error?: string }) => {
    const request = pending.get(id); if (!request) return; pending.delete(id);
    if (error) request.reject(new Error(error)); else request.resolve({ ...result, performance: { ...result.performance, workerCount } });
  });
  worker.on("error", (error) => { for (const item of pending.values()) item.reject(error); pending.clear(); });
  return { worker, pending };
});
let requestId = 0, lastLog = -Infinity;
const started = performance.now();
try {
  const result = await runRallyOptimizationAsync(input, config, async (jobs: readonly EvaluationJob[]) => Promise.all(jobs.map((job) =>
    new Promise<EvaluationJobResult>((resolve, reject) => {
      const affinity = job.kind === "jointPeak" ? job.jointPeakJob!.shard : parseInt(hash({ ...job.input, randomSeed: 0 }).slice(0, 8), 16);
      const slot = slots[affinity % workerCount]!, id = requestId++;
      slot.pending.set(id, { resolve, reject }); slot.worker.postMessage({ id, job });
    }))), (progress) => {
      if (performance.now() - lastLog > 5000) { lastLog = performance.now(); process.stdout.write(`${progress.stage}: ${progress.completed}/${progress.total}; ${(performance.now() - started).toFixed(0)} ms\n`); }
    });
  if (hash(input) !== before) throw new Error("Optimizer mutated its canonical fixture.");
  const seedPools = adaptiveSeedPools(config.firstSeed, 300, Math.max(1000, config.verificationTrials));
  const report = { inputFixture: path, inputSha256: before, optimizerConfig: config, node: process.version, cpu: cpus()[0]?.model,
    workerCount, interpretation: "Current supplied fixture only. Historical 65.2% input unavailable; no claim of reproducing it.",
    totalElapsedMs: performance.now() - started, profile: result.searchPerformanceReport, diagnostics: result.searchDiagnostics,
    finalRecommendations: result.singleWaveTop, currentEvaluation: result.currentEvaluation,
    canonicalBattleConfig: input, engineScenarioSha256: hash(toEngineScenario(input)),
    seedPolicy: { firstSeed: config.firstSeed, strategy: "common prefix 300 + independent validation at offset 500000",
      screeningSeeds: seedPools.screening, finalSeeds: seedPools.final, finalScreeningPrefix: seedPools.finalScreeningPrefix } };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ saved: output, totalElapsedMs: report.totalElapsedMs,
    battleEngineCalls: report.profile?.totalBattleEngineCalls, recallAudit: report.profile?.recallAudit }, null, 2) + "\n");
} finally { await Promise.all(slots.map((slot) => slot.worker.terminate())); }
