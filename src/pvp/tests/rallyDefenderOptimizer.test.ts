import { describe, expect, it } from "vitest";
import { exportPersistedJson, parsePersistedJson } from "../../storage";
import { candidateToInput, compileValidationBattle, createStageSeeds, currentRallyRatios,
  defaultOptimizationConfig, generateAllHeadFormations, resolveBodySkillConfigs,
  runRallyOptimization, runRallyOptimizationAsync, runValidationBattle, verifyRallyCandidate,
  type OptimizationConfig, type ValidationBattleInput } from "../../pvp";
import { createJointSingleWaveSearchWorkflow } from "../optimizer/criterion/jointSearch";
import { knownRallyStructureReferences } from "../optimizer/criterion/jointPreFilter";
import { createEvaluationExecutor, runOptimizationWorkflow, type EvaluationJobResult } from "../optimizer/execution";
import { OptimizerProfiler } from "../optimizer/profiling";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { OPPONENT_HEAD, OLD_HEAD, rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

const bodies = ["hero-skill.shuyun.attack", "hero-skill.jiexi.penetration",
  "hero-skill.patelike.life", "hero-skill.xieergai.guardian-power"];

function compactDefenderConfig(objectiveMode: "auto" | "minRallies" = "auto"): OptimizationConfig {
  return { ...defaultOptimizationConfig(899), candidateSide: "B", objectiveMode,
    constraints: { fixedLeaders: OPPONENT_HEAD, fixedBodyExact: true, fixedMemberSkillIds: [] },
    // Saved legacy switches must still select the complete defender joint workflow.
    criterion: { enabled: false, headRatioLimit: 1, headRatioFraction: 0, smallSpaceHeadRatioFloor: 1,
      theoryCandidateLimit: 1, theoryCandidateFraction: 0, smallSpaceTheoryFloor: 1,
      formalCandidateLimit: 1, formalCandidateFraction: 0, smallSpaceFormalFloor: 1,
      c0TheoryRounds: 1, fineRadius: 1, finePerBasin: 1, finalHeadBasins: 1, finalBodyBasinsPerHead: 1 },
    adaptiveSearch: { enabled: false },
    theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 2 },
    monteCarloStages: [1, 2, 3, 4, 5].map((trials) => ({ trials, keep: 1 })),
    verificationTrials: 6, verificationTop: 1, topN: 2 };
}

describe("rally defender uses the complete original-side joint optimizer", () => {
  it("executes H0 through Final with candidate B, fixed opponent A, independent body IDs and own win rate", () => {
    const base = rallyHeadSearchFixture(), input = { ...base, availableHeroIds: Object.values(OPPONENT_HEAD), maxRounds: 2,
      sideA: { ...base.sideA, leaderHeroIds: OLD_HEAD }, sideB: { ...base.sideB, leaderHeroIds: OPPONENT_HEAD,
        troops:{...base.sideB.troops,shield:{...base.sideB.troops.shield,count:24000},
          lancer:{...base.sideB.troops.lancer,count:4000},marksman:{...base.sideB.troops.marksman,count:12000}},
        bodySkills: resolveBodySkillConfigs(bodies, Object.values(OPPONENT_HEAD), "s11", "B"), selectedMemberSkillIds: bodies,
        rallyDeployment: { totalTroops: 40000, ratios: { shield: 60, lancer: 10, marksman: 30 } } } };
    const config = { ...defaultOptimizationConfig(899), candidateSide: "B" as const, objectiveMode: "singleWin" as const,
      constraints: { fixedLeaders: input.sideB.leaderHeroIds, fixedBodyExact: true,
        fixedMemberSkillIds: input.sideB.selectedMemberSkillIds }, criterion: { headRatioLimit: 2, headRatioFraction: 0,
        smallSpaceHeadRatioFloor: 2, theoryCandidateLimit: 2, theoryCandidateFraction: 0, smallSpaceTheoryFloor: 2,
        formalCandidateLimit: 2, formalCandidateFraction: 0, smallSpaceFormalFloor: 2,
        screeningKeep: [1, 1, 1, 1, 1], fineRadius: 1, finePerBasin: 1 }, verificationTop: 1 };
    const before = JSON.stringify(input), observedStages: string[] = [], outcomesBySeed = new Map<number, "A" | "B" | "draw" | "timeout">();
    expect(generateAllHeadFormations(input, config.constraints, undefined, "B").map((row) => row.leaderHeroIds))
      .toEqual([OPPONENT_HEAD]);
    expect(currentRallyRatios(input, "B")).toEqual({ shield: 60, lancer: 10, marksman: 30 });
    const onProgress=(progress:{stage:string})=>observedStages.push(progress.stage),profiler=new OptimizerProfiler(onProgress);
    const result = runOptimizationWorkflow(createJointSingleWaveSearchWorkflow(input, config,
      onProgress,profiler), (job): EvaluationJobResult => {
      expect(job.side).toBe("B");
      expect(job.input.sideA).toEqual(input.sideA);
      expect(job.input.sideB.leaderHeroIds).toEqual(OPPONENT_HEAD);
      expect(job.input.sideB.bodySkills!.map((body) => body.runtimeInstanceId))
        .toEqual(["B-body-0", "B-body-1", "B-body-2", "B-body-3"]);
      const outcomes = job.seeds.map((seed) => {
        // Explicit draw+timeout prove defender wins are not inferred as 1-A wins.
        const outcome = ["A", "B", "draw", "timeout"][seed % 4] as "A" | "B" | "draw" | "timeout";
        outcomesBySeed.set(seed, outcome);
        const aRemaining = { shield: outcome === "B" ? 0 : 100, lancer: 0, marksman: 0 };
        const bRemaining = { shield: outcome === "A" ? 0 : 200, lancer: 0, marksman: 0 };
        const winner = outcome === "A" || outcome === "B" ? outcome : null;
        return { outcome, winner, failed: outcome === "timeout", rounds: 1, roundCount: 1,
          remaining: { A: aRemaining, B: bRemaining }, aRemaining, bRemaining,
          winnerRemaining: outcome === "B" ? bRemaining : aRemaining };
      });
      return { samples: { trials: outcomes.length, requestedTrials: outcomes.length,
        wins: outcomes.filter((row) => row.outcome === "B").length, losses: outcomes.filter((row) => row.outcome === "A").length,
        failedTrials: outcomes.filter((row) => row.failed).length, pruned: false, outcomes },
        performance: { simulatedTrials: outcomes.length, skippedTrials: 0, prunedCandidates: 0, templateBuilds: 0, templateHits: 0 } };
    });
    const audit = result.searchDiagnostics.criterionAudit!, recommendation = result.top[0]!;
    expect(audit).toMatchObject({ battleScenario: "rally", candidateSide: "B", candidateRole: "defender",
      fixedOpponentSide: "A", optimizationObjective: "candidateSideWinRate", m1aBattlePerCandidate: 5,
      candidatesEliminatedByConfidenceWith5Samples: 0 });
    for (const stage of ["C0", "C1", "C2", "Theory", "M1a", "M1b", "M2", "M3", "M4", "Final"])
      expect(audit.stageCoverage[stage]).toBeDefined();
    expect(observedStages.some((name) => name.startsWith("H0"))).toBe(true);
    expect(observedStages.some((name) => name.startsWith("B0"))).toBe(true);
    expect(observedStages.some((name) => name.startsWith("1%"))).toBe(true);
    expect(observedStages.some((name) => name.includes("联合盆地正式复筛"))).toBe(true);
    expect(recommendation.trials).toBe(1000);
    expect(recommendation.draws + recommendation.timeouts).toBeGreaterThan(0);
    expect(recommendation.winRate).toBe(recommendation.wins / 1000);
    expect(recommendation.winRate).not.toBe(1 - recommendation.losses / 1000);
    expect(recommendation.winRate).toBeGreaterThanOrEqual(result.current.winRate);
    expect(audit.battleRunsRequested).toBe(audit.battleRunsExecuted + audit.battleRunsReused);
    const applied = candidateToInput(input, recommendation.candidate, "B");
    expect(applied.sideA).toEqual(input.sideA);
    expect(applied.sideB.rallyDeployment!.ratios).toEqual(recommendation.candidate.ratios);
    const restored = parsePersistedJson(exportPersistedJson(applied, 1000, config));
    expect(restored.optimizationConfig.candidateSide).toBe("B");
    expect(restored.input.sideA).toEqual(parsePersistedJson(exportPersistedJson(input,1000,config)).input.sideA);
    expect(restored.input.sideB.bodySkills!.map((body) => body.runtimeInstanceId))
      .toEqual(["B-body-0", "B-body-1", "B-body-2", "B-body-3"]);
    expect(() => runValidationBattle(restored.input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
    expect(outcomesBySeed.size).toBeGreaterThanOrEqual(1000);
  }, 20_000);

  it("restores candidateSide B independently of the ordinary battle-side configuration", () => {
    const input = { ...createDefaultValidationInput(), scenarioType: "RALLY" as const, battleContext: "rally" as const };
    const config = { ...defaultOptimizationConfig(), candidateSide: "B" as const };
    const restored = parsePersistedJson(exportPersistedJson(input, 1000, config));
    expect(restored.optimizationConfig.candidateSide).toBe("B");
    const baseline = parsePersistedJson(exportPersistedJson(input, 1000, defaultOptimizationConfig()));
    expect(restored.input.sideA).toEqual(baseline.input.sideA);
    expect(restored.input.sideB).toEqual(baseline.input.sideB);
  });

  it.each(["auto", "minRallies"] as const)("keeps legacy %s defender requests on the joint single-win sync and async APIs", async (mode) => {
    const input = { ...rallyHeadSearchFixture(), maxRounds: 1 }, config = { ...compactDefenderConfig(mode), profiling: true };
    const before = JSON.stringify(input), syncStages: string[] = [], asyncStages: string[] = [];
    const syncResult = runRallyOptimization(input, config, (progress) => syncStages.push(progress.stage));
    const execute = createEvaluationExecutor();
    const asyncResult = await runRallyOptimizationAsync(input, config, async (jobs) => jobs.map((job) => {
      expect(job.kind).toBe("battle");
      expect(job.side).toBe("B");
      expect(job.input.sideA).toEqual(input.sideA);
      return execute(job);
    }), (progress) => asyncStages.push(progress.stage));
    expect(asyncResult.singleWaveTop).toEqual(syncResult.singleWaveTop);
    expect(asyncResult.currentEvaluation).toEqual(syncResult.currentEvaluation);
    expect(asyncResult.performance).toEqual(syncResult.performance);
    for (const result of [syncResult, asyncResult]) {
      expect(result.optimizationContext).toEqual({ battleScenario: "rally", candidateSide: "B",
        rallyRole: "defender", fixedOpponentSide: "A", optimizationObjective: "candidateSideWinRate" });
      expect(result.requestedMode).toBe(mode);
      expect(result.selectedMode).toBe("singleWin");
      expect(result.multiWaveTop).toEqual([]);
      expect(result.currentEvaluation.trials).toBe(6);
      expect(result.currentEvaluation.timeouts).toBe(6);
      const audit = result.searchDiagnostics!.criterionAudit!;
      expect(audit).toMatchObject({ candidateSide: "B", candidateRole: "defender", fixedOpponentSide: "A" });
      for (const stage of ["C0", "C1", "C2", "Theory", "M1a", "M1b", "M2", "M3", "M4", "Final"])
        expect(audit.stageCoverage[stage]).toBeDefined();
      expect(result.singleWaveTop.every((row) => row.trials === 6)).toBe(true);
    }
    for (const stages of [syncStages, asyncStages]) {
      for (const prefix of ["H0", "B0", "1%", "Final"])
        expect(stages.some((name) => name.startsWith(prefix))).toBe(true);
    }
    expect(JSON.stringify(input)).toBe(before);
  }, 20_000);

  it.each([
    { outcome: "B", aTroops: 0, bTroops: 10 },
    { outcome: "A", aTroops: 10, bTroops: 0 },
    { outcome: "draw", aTroops: 0, bTroops: 0 },
    { outcome: "timeout", aTroops: 36000, bTroops: 36000 },
  ] as const)("reverifies defender $outcome outcomes using actual engine B wins and B survivors", ({ outcome, aTroops, bTroops }) => {
    const base = rallyHeadSearchFixture(), ratios = { shield: 100, lancer: 0, marksman: 0 };
    const deploy = (side: ValidationBattleInput["sideA"], totalTroops: number) => ({ ...side,
      troops: { shield: { ...side.troops.shield, count: totalTroops },
        lancer: { ...side.troops.lancer, count: 0 }, marksman: { ...side.troops.marksman, count: 0 } },
      rallyDeployment: { totalTroops, ratios } });
    const input = { ...base, maxRounds: 1, sideA: deploy(base.sideA, aTroops), sideB: deploy(base.sideB, bTroops) };
    const candidate = { leaderHeroIds: OPPONENT_HEAD, memberSkillIds: [], ratios };
    const trials = 4, firstSeed = 931, seeds = createStageSeeds(firstSeed, trials, 1_000_000);
    const compiled = compileValidationBattle(candidateToInput(input, candidate, "B"));
    const actual = seeds.map((seed) => compiled.runFastTrial(seed));
    expect(actual.every((row) => row.outcome === outcome)).toBe(true);
    const result = verifyRallyCandidate(input, candidate, trials, firstSeed, "B");
    const wins = actual.filter((row) => row.outcome === "B").length;
    const losses = actual.filter((row) => row.outcome === "A").length;
    expect(result).toMatchObject({ candidate, trials, wins, losses, winRate: wins / trials,
      draws: actual.filter((row) => row.outcome === "draw").length,
      timeouts: actual.filter((row) => row.outcome === "timeout").length,
      actualCounts: { shield: bTroops, lancer: 0, marksman: 0 } });
    const total = (counts: { shield: number; lancer: number; marksman: number }) => counts.shield + counts.lancer + counts.marksman;
    expect(result.selfRemaining.total.mean).toBe(actual.reduce((sum, row) => sum + total(row.remaining.B), 0) / trials);
    expect(result.enemyRemaining.total.mean).toBe(actual.reduce((sum, row) => sum + total(row.remaining.A), 0) / trials);
    if (outcome === "draw" || outcome === "timeout") expect(result.winRate).not.toBe(1 - losses / trials);
  });

  it("rejects non-rally inputs for defender optimization and verification", async () => {
    const input = { ...rallyHeadSearchFixture(), scenarioType: "SINGLE" as const, battleContext: "challenge" as const };
    const config = compactDefenderConfig(), candidate = { leaderHeroIds: OPPONENT_HEAD, memberSkillIds: [],
      ratios: { shield: 50, lancer: 20, marksman: 30 } };
    expect(() => runRallyOptimization(input, config)).toThrow("Optimizer is available only for rally battles.");
    await expect(runRallyOptimizationAsync(input, config, async () => {
      throw new Error("Non-rally input reached the executor.");
    })).rejects.toThrow("Optimizer is available only for rally battles.");
    expect(() => verifyRallyCandidate(input, candidate, 2, 931, "B"))
      .toThrow("Candidate verification requires a rally deployment on the candidate side.");
  });

  it("does not inject historical attacker reference structures into defender search", () => {
    const input = { ...rallyHeadSearchFixture(),
      availableHeroIds: ["hero.s10.gregory", "hero.s11.eleonora", "hero.s3.miya", "hero.s11.rufus"],
      rallyBodyPoolIds: ["hero.s6.wuming", "hero.s5.nuola"] };
    const config = defaultOptimizationConfig();
    expect(knownRallyStructureReferences(input, config)).toHaveLength(2);
    expect(knownRallyStructureReferences(input, { ...config, candidateSide: "B" })).toEqual([]);
  });
});
