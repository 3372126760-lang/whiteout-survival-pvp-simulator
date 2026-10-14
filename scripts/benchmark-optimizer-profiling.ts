import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { defaultOptimizationConfig, searchSingleWave } from "../src/pvp/optimizer";
import { rallyHeadSearchFixture, opponentCandidate } from "../src/pvp/tests/fixtures/rallyHeadSearch";

const config = { ...defaultOptimizationConfig(91), objectiveMode: "singleWin" as const,
  adaptiveSearch: { enabled: false },
  stages: [{ ratioStep: 5, trials: 20, keep: 3000, maxCandidates: 300 },
    { ratioStep: 2, trials: 50, keep: 500, maxCandidates: 100 },
    { ratioStep: 1, trials: 200, keep: 50, maxCandidates: 60 }] as const,
  constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] },
  protectedCandidates: [opponentCandidate()], verificationTrials: 1000,
  verificationTop: 10, topN: 5 };
let last = 0;
const start = performance.now();
const profiled = searchSingleWave(rallyHeadSearchFixture(), { ...config, profiling: true }, (row) => {
  if (performance.now() - last > 15000 || row.completed === row.total) {
    process.stdout.write(`profiled ${row.stage}: ${row.completed}/${row.total}\n`); last = performance.now();
  }
});
const profiledWallMs = performance.now() - start;
writeFileSync("examples/optimizer-performance-report.json", JSON.stringify(profiled.searchPerformanceReport, null, 2));
process.stdout.write(`profiled done: ${profiled.performance.simulatedTrials} trials, ${profiledWallMs.toFixed(0)} ms\n`);
last = 0;
const baselineStart = performance.now();
const baseline = searchSingleWave(rallyHeadSearchFixture(), { ...config, profiling: false }, (row) => {
  if (performance.now() - last > 15000 || row.completed === row.total) {
    process.stdout.write(`unprofiled ${row.stage}: ${row.completed}/${row.total}\n`); last = performance.now();
  }
});
const unprofiledWallMs = performance.now() - baselineStart;
const { searchPerformanceReport, ...withoutTiming } = profiled;
const identical = JSON.stringify(withoutTiming) === JSON.stringify(baseline);
const result = {
  provenance: "Synthetic six-hero equal-panel regression; full real BattleEngine pipeline, empty fixed body, seed 91, final 1000 trials. No real user report. Sequential runs on the same machine; wall times are observations, not a speedup claim.",
  config, profiledWallMs, unprofiledWallMs, identicalExcludingTiming: identical,
  actualBattleCallsMatchSamples: searchPerformanceReport!.totalBattleEngineCalls === profiled.performance.simulatedTrials,
  topCandidates: profiled.top, report: searchPerformanceReport,
  topThreeStages: [...searchPerformanceReport!.stages].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 3),
};
writeFileSync("examples/optimizer-profiling-benchmark.json", JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify({ identical, profiledWallMs, unprofiledWallMs,
  report: searchPerformanceReport, best: profiled.top[0]!.winRate }, null, 2) + "\n");
if (!identical || !result.actualBattleCallsMatchSamples) throw new Error("Profiling changed results or miscounted formal battles.");
