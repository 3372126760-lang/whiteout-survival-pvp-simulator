import { writeFileSync } from "node:fs";
import { createEngineCandidateRunner, evaluateSingleCandidate, createStageSeeds,
  defaultOptimizationConfig, runRallyOptimization } from "../src/pvp/index";
import { rallyHeadSearchFixture, opponentCandidate } from "../src/pvp/tests/fixtures/rallyHeadSearch";

const input = rallyHeadSearchFixture();
const run = createEngineCandidateRunner(input);
const trials = Number(process.argv[2] ?? 1000);
const seeds = createStageSeeds(91, trials, 500_000);
const current = evaluateSingleCandidate({ ...opponentCandidate(), leaderHeroIds: input.sideA.leaderHeroIds! },
  36000, seeds, run);
const manual = evaluateSingleCandidate(opponentCandidate(), 36000, seeds, run);
const config = { ...defaultOptimizationConfig(91), objectiveMode: "singleWin" as const,
  constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] },
  protectedCandidates: [opponentCandidate()],
  stages: [ { ratioStep: 50, trials: 30, keep: 8, maxCandidates: 30 },
    { ratioStep: 10, trials: 100, keep: 5, maxCandidates: 20 },
    { ratioStep: 1, trials: 150, keep: 5, maxCandidates: 20 } ] as const,
  verificationTrials: trials, verificationTop: 5, topN: 5 };
const result = runRallyOptimization(input, config);
if (current.winRate >= .3 || manual.winRate < .4 || 
  result.singleWaveTop[0]!.winRate < manual.winRate ||
  !result.searchDiagnostics?.evaluatedHeadLineups.some((head) =>
    JSON.stringify(head) === JSON.stringify(opponentCandidate().leaderHeroIds))) {
  throw new Error("Rally head regression failed: known opponent head was not searched or matched.");
}
const output = { provenance: "synthetic equal-panel regression, not the user's saved configuration",
  trials, currentWinRate: current.winRate, manualOpponentHeadWinRate: manual.winRate,
  recommendationWinRate: result.singleWaveTop[0]!.winRate,
  searchDiagnostics: result.searchDiagnostics };
writeFileSync("examples/rally-head-search-regression.json", JSON.stringify(output, null, 2), "utf8");
process.stdout.write(JSON.stringify(output, null, 2));
