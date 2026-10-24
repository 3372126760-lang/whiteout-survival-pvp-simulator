import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { restorePersistedConfig } from "../src/storage";
import { runRallyOptimization, createEngineCandidateRunner, createStageSeeds } from "../src/pvp/optimizer";
const [fixturePath, phase] = process.argv.slice(2);
if (!fixturePath || !/^(before|after|final)$/.test(phase ?? "")) throw new Error("Usage: tsx scripts/benchmark-target-value.ts fixture.json before|after|final");
const raw = readFileSync(fixturePath, "utf8"), fixture = JSON.parse(raw);
const { input, optimizationConfig } = restorePersistedConfig(fixture.envelope);
let last = "";
const started = performance.now();
const result = runRallyOptimization(input, optimizationConfig, progress => {
  if (progress.stage !== last) { last = progress.stage; console.log(last); }
});
const elapsedMs = performance.now() - started;
const runner = createEngineCandidateRunner(input), holdout = createStageSeeds(20261024, 1000, 2700000);
const top = result.singleWaveTop.map((row, i) => ({ rank: i + 1, candidate: row.candidate, winRate: row.winRate,
  trials: row.trials, selfRemaining: row.selfRemaining.total.mean,
  holdoutWinRate: i < 2 ? runner(row.candidate, holdout).filter(s => s.outcome === "A").length / holdout.length : null }));
const output = { phase, fixtureSha256: createHash("sha256").update(raw).digest("hex"), elapsedMs,
  calls: result.performance.simulatedTrials, top, diagnostics: result.searchDiagnostics };
writeFileSync(`examples/target-value-${phase}-2026-10-24.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ phase, elapsedMs, calls: output.calls, top: top.map(row => ({
  rank: row.rank, body: row.candidate.memberSkillIds, ratios: row.candidate.ratios, winRate: row.winRate, holdoutWinRate: row.holdoutWinRate,
})) }, null, 2));
