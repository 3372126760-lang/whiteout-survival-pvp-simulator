import { writeFileSync } from "node:fs";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { TROOP_TYPES } from "../src/pvp/types";
import { createSimpleOptimizationWorkflow, defaultSimpleScenarioOptimizationOptions } from "../src/pvp/optimizer/scenarioOptimizer";
import { emptyOptimizationPerformance, runOptimizationWorkflow,
  type EvaluationJob, type EvaluationJobResult } from "../src/pvp/optimizer/execution";
import { defaultOptimizationConfig } from "../src/pvp/optimizer";
import { preFilterJointRallyCandidates } from "../src/pvp/optimizer/criterion/jointPreFilter";
import { defaultTheoryOptions } from "../src/pvp/optimizer/theory";

const base = createDefaultValidationInput();
const input = { ...base, scenarioType: "SINGLE" as const, maxRounds: 2,
  ownedHeroIds: [], availableHeroIds: [], optimizerHeroPool: { A: {}, B: {} },
  sideA: { ...base.sideA, troops: { ...base.sideA.troops,
    shield: { ...base.sideA.troops.shield, count: 10000 },
    lancer: { ...base.sideA.troops.lancer, count: 0 },
    marksman: { ...base.sideA.troops.marksman, count: 0 } } } };
const jobs: EvaluationJob[] = [];
// Controlled outcome oracle isolates candidate coverage. Criterion / Theory
// are real; these outcomes are deliberately NOT game-war-report predictions.
const execute = (job: EvaluationJob): EvaluationJobResult => {
  jobs.push(job);
  const troops = job.input.sideA.troops;
  const wins = troops.shield.count === 5000 && troops.lancer.count === 1000;
  const winner = wins ? "A" as const : "B" as const;
  const remaining = { A: { shield: wins ? 1 : 0, lancer: 0, marksman: 0 },
    B: { shield: wins ? 0 : 1, lancer: 0, marksman: 0 } };
  const outcomes = job.seeds.map(() => ({ outcome: winner, winner, failed: false,
    rounds: 1, roundCount: 1, remaining, aRemaining: remaining.A,
    bRemaining: remaining.B, winnerRemaining: remaining[winner] }));
  return { samples: { trials: outcomes.length, requestedTrials: outcomes.length,
    wins: wins ? outcomes.length : 0, losses: wins ? 0 : outcomes.length,
    failedTrials: 0, pruned: false, outcomes },
    performance: { ...emptyOptimizationPerformance(), simulatedTrials: outcomes.length } };
};
const single = runOptimizationWorkflow(createSimpleOptimizationWorkflow(input, {
  ...defaultSimpleScenarioOptimizationOptions(51), profiling: true,
  theory: { ...defaultTheoryOptions(), deterministicRounds: 2 },
  basinSearch: { fineBasins: 1, fineRadius: 1 } }), execute);
const firstJobs = jobs.slice(0, 231);
const visited = new Set(firstJobs.map((job) => TROOP_TYPES.map((troop) =>
  job.input.sideA.troops[troop].count).join("/")));
if (visited.size !== 231 || !visited.has("5000/1000/4000") ||
  firstJobs.reduce((sum, job) => sum + job.seeds.length, 0) !== 4620)
  throw new Error("EMPTY_HEAD must exhaust the coarse ratio grid.");
const rallyInput = { ...input, scenarioType: "RALLY" as const, battleContext: "rally" as const,
  rallyBodyPoolIds: [], sideA: { ...input.sideA,
    rallyDeployment: { totalTroops: 10000, ratios: { shield: 100, lancer: 0, marksman: 0 } } } };
const rallyOptions = { ...defaultOptimizationConfig(302), objectiveMode: "singleWin" as const,
  constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] },
  theory: { ...defaultTheoryOptions(), deterministicRounds: 1 },
  criterion: { c0TheoryRounds: 1 } };
const rally = preFilterJointRallyCandidates(rallyInput, rallyOptions);
const withBodies = preFilterJointRallyCandidates({ ...rallyInput,
  rallyBodyPoolIds: ["hero.body.shuyun", "hero.sr.patelike", "hero.s5.nuola"] }, { ...rallyOptions, constraints: {} });
const report = {
  fixtureKind: "controlledSearchCoverageRegression",
  note: "Real Criterion/Theory and workflow, synthetic formal-stage outcomes; not a reproduction of the user's 0.2% war-report matchup.",
  reproductionCommand: "node scripts/run-tsx.mjs scripts/audit-fixed-head-search-round5.ts",
  single: { ...single.searchDimensionAudit, criterion: single.criterionAudit,
    firstStageCandidateCount: visited.size,
    firstStageRequestedBattles: firstJobs.reduce((sum, job) => sum + job.seeds.length, 0),
    ratio514Included: visited.has("5000/1000/4000"),
    baselineRatio: single.current.candidate.ratios,
    recommendedRatio: single.topCandidates[0]!.candidate.ratios,
    finalTrials: single.topCandidates.map((row) => row.trials),
    stages: single.searchIntegrityReport!.perStage,
    performance: single.searchPerformanceReport },
  rallyEmptyBody: { ...rally.dimensions, headTemplateCount: rally.audit.headTemplateCount,
    ratioCount: rally.audit.ratioCount, bodyCandidateCount: rally.audit.bodyCandidateCount,
    roughJointCount: rally.audit.roughJointCount },
  rallyBodySearch: { ...withBodies.dimensions, headTemplateCount: withBodies.audit.headTemplateCount,
    ratioCount: withBodies.audit.ratioCount, bodyCandidateCount: withBodies.audit.bodyCandidateCount,
    roughJointCount: withBodies.audit.roughJointCount },
};
writeFileSync("examples/criterion-round5-fixed-head-audit.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ singleRatios: visited.size, firstStageBattles: 4620,
  ratio514Included: report.single.ratio514Included, rallyEmptyBody: report.rallyEmptyBody,
  rallyBodySearch: report.rallyBodySearch }));
