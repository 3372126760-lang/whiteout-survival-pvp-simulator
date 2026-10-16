import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { generateAllHeadFormations } from "../src/pvp/optimizer/candidateGenerator";
import { headLineupKey } from "../src/pvp/optimizer/theory";
import { enumeratePreprocessedBodyPool } from "../src/pvp/optimizer/criterion/bodyEnumeration";
import { createJointCoefficientTable, type JointCoefficientTable } from "../src/pvp/optimizer/jointPipeline/coefficients";
import { scanJointPeaks, JointPeakHeap, type JointPeakChunk } from "../src/pvp/optimizer/jointPipeline/peakScan";
import type { OptimizationConfig, OptimizationInput } from "../src/pvp/optimizer/types";
const directory = "benchmarks/optimizer", fixture = JSON.parse(readFileSync(`${directory}/joint-rally-gen11-input.json`, "utf8")) as { input: OptimizationInput; optimizerConfig: OptimizationConfig };
const prepStart = performance.now(), heads = [...generateAllHeadFormations(fixture.input, fixture.optimizerConfig.constraints)].sort((a, b) => headLineupKey(a.leaderHeroIds) < headLineupKey(b.leaderHeroIds) ? -1 : 1);
const bodies = [...enumeratePreprocessedBodyPool(fixture.input, fixture.optimizerConfig.constraints, heads[0]!.leaderHeroIds, { jointPolicy: true }).bodies].sort((a, b) => a.ids.join("|") < b.ids.join("|") ? -1 : 1);
process.stdout.write(`Actual J space: ${heads.length} × ${bodies.length}\n`);
const actual = createJointCoefficientTable(fixture.input, fixture.optimizerConfig, heads, bodies), preparationElapsedMs = performance.now() - prepStart;
/** Requested-size measurement uses real numeric signatures sampled deterministically.
 * Full optimizer uses every legal Body, regardless of this benchmark shape. */
function reshape(table: JointCoefficientTable, headCount: number, bodyCount: number): JointCoefficientTable {
  const h = Array.from({ length: headCount }, (_, i) => i % table.headCount), b = Array.from({ length: bodyCount }, (_, i) => Math.floor(i * table.bodyCount / bodyCount) % table.bodyCount);
  const pick = (values: Float64Array, indices: readonly number[], stride: number) => Float64Array.from(indices.flatMap((i) => [...values.subarray(i * stride, (i + 1) * stride)]));
  const offsets = [0], terms: number[] = [], values: number[] = [];
  for (const i of b) { for (let j = table.bodyOffsets[i]!; j < table.bodyOffsets[i + 1]!; j++) { terms.push(table.bodyTerms[j]!); values.push(table.bodyValues[j]!); } offsets.push(terms.length); }
  return { ...table, headCount, bodyCount, headBase: pick(table.headBase, h, 6), headValues: pick(table.headValues, h, table.routes.length),
    headChannels: pick(table.headChannels, h, 6), headFactors: pick(table.headFactors, h, 12), bodyChannels: pick(table.bodyChannels, b, 6),
    bodyOffsets: Uint32Array.from(offsets), bodyTerms: Uint32Array.from(terms), bodyValues: Float64Array.from(values),
    reductions: table.reductions.map((r) => ({ ...r, headIds: Uint32Array.from(h.map((i) => r.headIds[i]!)), bodyIds: Uint32Array.from(b.map((i) => r.bodyIds[i]!)) })) };
}
const table = reshape(actual, 876, 3368), job = { table, headStart: 0, headEnd: 876, shard: 0 };
let gcMs = 0; const observer = new PerformanceObserver((list) => { gcMs += list.getEntries().reduce((sum, e) => sum + e.duration, 0); }); observer.observe({ entryTypes: ["gc"] });
scanJointPeaks({ ...job, headEnd: 5 });
const before = process.memoryUsage(), start = performance.now(), serial = scanJointPeaks(job), serialElapsedMs = performance.now() - start;
await new Promise((resolve) => setImmediate(resolve)); const after = process.memoryUsage();
process.stdout.write(`2,950,368 serial pairs: ${serialElapsedMs.toFixed(1)} ms\n`);
const workers = Array.from({ length: 4 }, () => new Worker(new URL("./joint-optimizer-node-worker.mjs", import.meta.url), { execArgv: [] }));
const readyStart = performance.now();
// Warm each worker before timing so compilation/startup is reported separately.
async function run(worker: Worker, id: number, headStart: number, headEnd: number): Promise<JointPeakChunk> {
  return new Promise((resolve, reject) => { worker.once("message", (event) => event.error ? reject(new Error(event.error)) : resolve(event.result.jointPeak)); worker.once("error", reject);
    worker.postMessage({ id, job: { kind: "jointPeak", input: fixture.input, seeds: [], side: "A", jointPeakJob: { table, headStart, headEnd, shard: id } } }); });
}
await Promise.all(workers.map((w, i) => run(w, i, i, i + 1))); const workerStartupMs = performance.now() - readyStart;
const workerStart = performance.now(), chunks = await Promise.all(workers.map((w, i) => run(w, i, Math.floor(876 * i / 4), Math.floor(876 * (i + 1) / 4))));
const workerComputeAndCloneElapsedMs = performance.now() - workerStart;
const heap = new JointPeakHeap(); chunks.forEach((c) => c.rows.forEach((r) => heap.push(r))); const parallel = heap.sorted();
const workerElapsedMs = performance.now() - workerStart;
await Promise.all(workers.map((w) => w.terminate())); observer.disconnect();
const identical = JSON.stringify(parallel) === JSON.stringify(serial.rows); if (!identical) throw new Error("Serial/Worker Top10000 differs.");
const output = process.argv[2] ?? "artifacts/benchmarks/optimizer/joint-peak-microbenchmark.json";
mkdirSync(dirname(output), { recursive: true });
const report = { recordedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
  provenance: "876 × 3368 requested-size microbenchmark with current canonical S11 signatures. Body signatures sampled evenly from the full legal B0 pool; the full optimizer never uses this subset.",
  actualSpace: { heads: actual.headCount, bodies: actual.bodyCount, pairs: actual.headCount * actual.bodyCount }, benchmarkSpace: { heads: 876, bodies: 3368, pairs: 2950368 },
  preparationElapsedMs, serialElapsedMs, workerElapsedMs, workerComputeAndCloneElapsedMs, workerStartupMs, workerCount: 4,
  serialHeadBodyPerSecond: 2950368 * 1000 / serialElapsedMs, workerHeadBodyPerSecond: 2950368 * 1000 / workerElapsedMs,
  objectiveEvaluationCount: serial.objectiveEvaluationCount, avgObjectiveCallsPerHeadBody: serial.objectiveEvaluationCount / 2950368,
  kktEvaluationCount: serial.kktEvaluationCount, avgKktEvaluationsPerHeadBody: serial.kktEvaluationCount / 2950368,
  retainedCount: serial.rows.length, top10000CutoffJ: serial.rows.at(-1)?.score, serialWorkerEquivalent: identical,
  memory: { before, after, lifetimePeakRssBytes: process.resourceUsage().maxRSS * 1024,
    note: "Node process lifetime maxRSS includes signature preparation and Worker hosting; it is not isolated per-stage heap peak." }, gcObservedMs: gcMs,
  gcNote: "PerformanceObserver GC durations for coordinator process; Worker-local GC not included." };
writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); process.stdout.write(JSON.stringify(report, null, 2) + "\n");
