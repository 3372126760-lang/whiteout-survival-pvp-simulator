import { describe, expect, it } from "vitest";
import { defaultOptimizationConfig, runRallyOptimizationAsync, type OptimizationConfig, type OptimizationInput } from "../optimizer";
import { createEvaluationExecutor, type EvaluationJob, type EvaluationJobResult } from "../optimizer/execution";
import { OLD_HEAD, OPPONENT_HEAD, rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

const settings = (side: "A" | "B" = "A"): OptimizationConfig => ({ ...defaultOptimizationConfig(302), candidateSide: side,
  objectiveMode: "singleWin", profiling: true, constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] },
  jointPipeline: { criterionKeep: 1, criterionFineKeep: 1, theoryKeep: 1, formalRatioKeep: 1,
    formalStages: [20, 50, 100, 300].map((trials) => ({ trials, keep: 1 })) },
  theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 }, verificationTrials: 1000, topN: 2 });
function mockBattle(job: EvaluationJob): EvaluationJobResult {
  if (job.kind !== "battle") return createEvaluationExecutor()(job);
  const outcomes = job.seeds.map(() => {
    const a = { shield: job.side === "A" ? 100 : 0, lancer: 0, marksman: 0 };
    const b = { shield: job.side === "B" ? 100 : 0, lancer: 0, marksman: 0 };
    return { outcome: job.side, winner: job.side, failed: false, roundCount: 1, rounds: 1,
      remaining: { A: a, B: b }, aRemaining: a, bRemaining: b, winnerRemaining: job.side === "A" ? a : b };
  });
  return { samples: { trials: outcomes.length, requestedTrials: outcomes.length, wins: outcomes.length, losses: 0,
    failedTrials: 0, pruned: false, outcomes }, performance: { simulatedTrials: outcomes.length, skippedTrials: 0,
    prunedCandidates: 0, templateBuilds: 0, templateHits: 0 } };
}
async function run(input: OptimizationInput, config: OptimizationConfig) {
  const observed: EvaluationJob[] = [], before = JSON.stringify(input);
  const result = await runRallyOptimizationAsync(input, config, async (jobs) => jobs.map((job) => { observed.push(job); return mockBattle(job); }));
  expect(JSON.stringify(input)).toBe(before);
  return { result, observed: observed.filter((job) => job.kind === "battle") };
}
describe("fixed and empty Head on the sole joint pipeline", () => {
  it.each(["A", "B"] as const)("preserves final-report Head and actual Lv6 weapons on %s outside the automatic pool", async (side) => {
    const base = rallyHeadSearchFixture(), key = side === "A" ? "sideA" : "sideB";
    const own = { ...base[key], leaderHeroIds: OLD_HEAD, simulationWeaponLevels: Object.fromEntries(Object.values(OLD_HEAD).map((id) => [id, 6])) };
    const input = { ...base, attributeInputMode: "finalReport" as const, [key]: own, ownedHeroIds: [], optimizerHeroPool: { A: {}, B: {} } };
    const { result, observed } = await run(input, settings(side));
    expect(result.searchDiagnostics?.jointPipeline?.peak.headCount).toBe(1);
    for (const job of observed) {
      expect(job.input[key].leaderHeroIds).toEqual(OLD_HEAD);
      expect(job.input[key].simulationWeaponLevels).toEqual(own.simulationWeaponLevels);
      expect(job.input[side === "A" ? "sideB" : "sideA"]).toEqual(base[side === "A" ? "sideB" : "sideA"]);
    }
    expect(result.currentEvaluation.trials).toBe(1000);
  });
  it.each(["prediction", "finalReport"] as const)("keeps an empty %s Head and Body as genuine fixed templates", async (attributeInputMode) => {
    const base = rallyHeadSearchFixture(), empty = { shield: null, lancer: null, marksman: null };
    const input = { ...base, attributeInputMode, ownedHeroIds: [], rallyBodyPoolIds: [],
      sideA: { ...base.sideA, leaderHeroIds: empty, simulationWeaponLevels: {}, selectedMemberSkillIds: [], bodySkills: [] } };
    const { result } = await run(input, settings());
    expect(result.searchDiagnostics?.jointPipeline?.peak).toMatchObject({ headCount: 1, bodyCount: 1, evaluatedHeadBodyCount: 1 });
    expect(result.singleWaveTop.every((row) => Object.values(row.candidate.leaderHeroIds).every((id) => id === null) && !row.candidate.memberSkillIds.length)).toBe(true);
    expect(result.searchPerformanceReport?.stages.some((stage) => /C[0-3]|M1a|M1b/.test(stage.stage))).toBe(false);
  });
  it("honors an explicit old fixed Head without forcing recent-generation membership", async () => {
    const input = rallyHeadSearchFixture(), config = { ...settings(), constraints: { ...settings().constraints, fixedLeaders: OLD_HEAD } };
    const { result } = await run(input, config);
    expect(result.singleWaveTop.every((row) => JSON.stringify(row.candidate.leaderHeroIds) === JSON.stringify(OLD_HEAD))).toBe(true);
  });
  it("does not allow protected references to change a fixed Head", async () => {
    const base = rallyHeadSearchFixture(), input = { ...base, attributeInputMode: "finalReport" as const };
    const config = { ...settings(), protectedCandidates: [{ leaderHeroIds: OPPONENT_HEAD, memberSkillIds: [], ratios: { shield: 50, lancer: 20, marksman: 30 } }] };
    const { result } = await run(input, config);
    expect(result.singleWaveTop.every((row) => JSON.stringify(row.candidate.leaderHeroIds) === JSON.stringify(OLD_HEAD))).toBe(true);
  });
});
