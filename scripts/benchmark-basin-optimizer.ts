import { performance } from "node:perf_hooks";
import { readFileSync, writeFileSync } from "node:fs";
import { defaultOptimizationConfig, searchSingleWave, createEngineCandidateRunner,
  evaluateSingleCandidate, createStageSeeds, candidateKey } from "../src/pvp/optimizer";
import { searchSingleWave as previousSearch } from "./benchmarks/previousMultiPeak/singleWaveSearch";
import type { CandidateEvaluation, RallySearchDiagnostics } from "../src/pvp/optimizer";
import type { TheoryCoverage } from "../src/pvp/optimizer/theory";
import { rallyHeadSearchFixture, opponentCandidate } from "../src/pvp/tests/fixtures/rallyHeadSearch";

const input = rallyHeadSearchFixture(), trials = Number(process.argv[2] ?? 1000);
const config = { ...defaultOptimizationConfig(91), objectiveMode: "singleWin" as const,
  constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] }, protectedCandidates: [opponentCandidate()],
  verificationTrials: trials, verificationTop: 10, topN: 5 };
const progress = (label: string) => {
  let last = 0;
  return (row: { stage: string; completed: number; total: number }) => {
    if (performance.now() - last > 15000 || row.completed === row.total) {
      process.stdout.write(`${label} ${row.stage}: ${row.completed}/${row.total}\n`); last = performance.now();
    }
  };
};
let start = performance.now();
const recorded = process.argv.includes("--reuse-previous") ? JSON.parse(readFileSync("examples/basin-optimizer-first-attempt.json", "utf8")) as {
  seed: number; verificationTrials: number; previous: { battles: number; elapsedMs: number;
    best: CandidateEvaluation; coverage: TheoryCoverage;
    stages: RallySearchDiagnostics["monteCarloStages"] };
} : undefined;
if (recorded && (recorded.seed !== 91 || recorded.verificationTrials !== trials)) throw new Error("Recorded previous seed/trials mismatch.");
const previous = recorded ? { top: [recorded.previous.best], performance: { simulatedTrials: recorded.previous.battles },
  searchDiagnostics: { theoryCoverage: recorded.previous.coverage, monteCarloStages: recorded.previous.stages } }
  : previousSearch(input, config, progress("previous"));
const previousMs = recorded?.previous.elapsedMs ?? performance.now() - start;
process.stdout.write(`previous complete: ${previous.performance.simulatedTrials} calls\n`);
start = performance.now();
let theoryMs = 0;
const report = progress("current");
const current = searchSingleWave(input, config, (row) => {
  if (row.stage.startsWith("Theory") && row.completed === row.total) theoryMs = performance.now() - start;
  report(row);
});
const currentMs = performance.now() - start;
const manual = evaluateSingleCandidate(opponentCandidate(), 36000,
  createStageSeeds(91, trials, 500000), createEngineCandidateRunner(input));
const output = {
  provenance: "Synthetic equal-panel regression, not a real user battle report. Previous code is a frozen copy of the immediately preceding multi-peak version.",
  timingNote: "Wall time is observational; a reused previous run included concurrent verification work. Official battle counts and common-seed final results are the comparable measurements.",
  reusedPreviousMeasurement: recorded !== undefined,
  seed: 91, verificationTrials: trials, config,
  previous: { battles: previous.performance.simulatedTrials, elapsedMs: previousMs, best: previous.top[0],
    coverage: previous.searchDiagnostics.theoryCoverage, stages: previous.searchDiagnostics.monteCarloStages },
  current: { battles: current.performance.simulatedTrials, elapsedMs: currentMs, theoryMs, best: current.top[0],
    diagnostics: current.searchDiagnostics },
  battleCallReductionPercent: 100 * (1 - current.performance.simulatedTrials / previous.performance.simulatedTrials),
  elapsedReductionPercent: 100 * (1 - currentMs / previousMs),
  knownManualWinRate: manual.winRate,
  manualPreserved: current.searchDiagnostics.battleSelections?.some((row) => row.candidateKey === candidateKey(opponentCandidate())),
  matchesOrExceedsManual: current.top[0]!.winRate >= manual.winRate,
  matchesOrExceedsPrevious: current.top[0]!.winRate >= previous.top[0]!.winRate,
};
writeFileSync("examples/basin-optimizer-benchmark.json", JSON.stringify(output, null, 2), "utf8");
process.stdout.write(JSON.stringify({ previous: { battles: output.previous.battles, elapsedMs: previousMs, best: previous.top[0]!.winRate },
  current: { battles: output.current.battles, elapsedMs: currentMs, best: current.top[0]!.winRate, theoryMs,
    coverage: current.searchDiagnostics.theoryCoverage, heroPoolAudit: current.searchDiagnostics.heroPoolAudit,
    ratioSearchAudit: current.searchDiagnostics.ratioSearchAudit }, manual: manual.winRate,
  reduction: output.battleCallReductionPercent, quality: output.matchesOrExceedsPrevious }, null, 2) + "\n");
if (!output.manualPreserved || !output.matchesOrExceedsManual || !output.matchesOrExceedsPrevious) throw new Error("Protected manual reference regression.");
