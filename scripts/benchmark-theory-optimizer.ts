import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { defaultOptimizationConfig, searchSingleWave, createEngineCandidateRunner,
  evaluateSingleCandidate, createStageSeeds, candidateKey } from "../src/pvp/optimizer";
import { searchSingleWave as legacySearch } from "./benchmarks/legacySingleWaveSearch";
import { rallyHeadSearchFixture, opponentCandidate } from "../src/pvp/tests/fixtures/rallyHeadSearch";

const input = rallyHeadSearchFixture();
const trials = Number(process.argv[2] ?? 1000);
const common = { ...defaultOptimizationConfig(91), objectiveMode: "singleWin" as const,
  constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] }, verificationTrials: trials,
  protectedCandidates: [opponentCandidate()],
  verificationTop: 10, topN: 5 };
const oldConfig = { ...common, stages: [
  { ratioStep: 5, trials: 20, keep: 8, maxCandidates: 300 },
  { ratioStep: 2, trials: 50, keep: 5, maxCandidates: 100 },
  { ratioStep: 1, trials: 200, keep: 5, maxCandidates: 60 },
] as const };
let lastUpdate = 0;
const progress = (label: string) => (value: { stage: string; completed: number; total: number }) => {
  if (performance.now() - lastUpdate > 10000 || value.completed === value.total) {
    process.stdout.write(`${label} ${value.stage}: ${value.completed}/${value.total}\n`); lastUpdate = performance.now();
  }
};
let start = performance.now();
const old = legacySearch(input, oldConfig, progress("old"));
const oldMs = performance.now() - start;
process.stdout.write(`Old completed: ${old.performance.simulatedTrials} battles, ${oldMs.toFixed(0)} ms\n`);
start = performance.now();
let theoryMs = 0;
const reportNew = progress("new");
const result = searchSingleWave(input, common, (value) => {
  if (value.stage.startsWith("Theory") && value.completed === value.total)
    theoryMs = performance.now() - start;
  reportNew(value);
});
const newMs = performance.now() - start;
const manual = evaluateSingleCandidate(opponentCandidate(), 36000,
  createStageSeeds(91, trials, 500_000), createEngineCandidateRunner(input));
const knownSelection = result.searchDiagnostics.battleSelections?.find((row) => row.candidateKey === candidateKey(opponentCandidate()));
const output = {
  provenance: "same synthetic equal-panel eight-lineup regression; no user real battle report provided",
  searchSpace: "8 legal heads × 231 theoretical coarse ratios; fixed empty body; same seed 91 and final seed range",
  verificationTrials: trials,
  old: { battles: old.performance.simulatedTrials, elapsedMs: oldMs,
    best: old.top[0], parameters: oldConfig },
  current: { theoryCandidates: result.searchDiagnostics.theoryCoverage?.theoryCandidateCount,
    theoryElapsedMs: theoryMs, battleCandidatesM1: result.searchDiagnostics.stage1CandidateCount,
    battles: result.performance.simulatedTrials, elapsedMs: newMs,
    best: result.top[0], parameters: common },
  battleCallReductionPercent: 100 * (1 - result.performance.simulatedTrials / old.performance.simulatedTrials),
  elapsedReductionPercent: 100 * (1 - newMs / oldMs),
  knownManualWinRate: manual.winRate, knownSelection,
  manualPreserved: knownSelection !== undefined,
  matchesOrExceedsManual: result.top[0]!.winRate >= manual.winRate,
  matchesOrExceedsOld: result.top[0]!.winRate >= old.top[0]!.winRate,
  coverage: result.searchDiagnostics.theoryCoverage,
  stages: result.searchDiagnostics.monteCarloStages,
};
writeFileSync("examples/theory-optimizer-benchmark.json", JSON.stringify(output, null, 2), "utf8");
process.stdout.write(JSON.stringify({ ...output, old: { ...output.old, best: old.top[0]!.winRate },
  current: { ...output.current, best: result.top[0]!.winRate } }, null, 2) + "\n");
if (!output.manualPreserved || !output.matchesOrExceedsManual || !output.matchesOrExceedsOld)
  throw new Error("Known manual / legacy quality regression failed.");
