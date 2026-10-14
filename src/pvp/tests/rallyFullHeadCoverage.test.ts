import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { availableHeadHeroesByTroop, createSingleWaveSearchWorkflow, defaultOptimizationConfig,
  createEvaluationExecutor, getValidationCatalog, searchSingleWave } from "../index";
import { rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

describe("global HeadRatio funnel and formal coverage", () => {
  it("scans all recent-eligible ratios and allows whole weak heads to disappear before the actual fast engine", () => {
    const base = createDefaultValidationInput();
    const catalog = getValidationCatalog();
    const pool = (troop: "shield" | "lancer" | "marksman", count: number) => catalog.leaderHeroes
      .filter((hero) => hero.troopType === troop && hero.rarity === "SSR").sort((a,b) => (b.generation ?? 0) - (a.generation ?? 0)).slice(0, count).map((hero) => hero.heroId);
    const input = { ...base, attributeInputMode: "prediction" as const, serverStage: "s16" as const, battleContext: "rally" as const,
      scenarioType: "RALLY" as const, maxRounds: 1,
      sideA: { ...base.sideA, leaderHeroIds: { shield: pool("shield", 1)[0]!, lancer: pool("lancer", 1)[0]!, marksman: pool("marksman", 1)[0]! } },
      availableHeroIds: [...pool("shield", 15), ...pool("lancer", 16), ...pool("marksman", 16)] };
    const options = { ...defaultOptimizationConfig(17), objectiveMode: "singleWin" as const,
      constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] },
      verificationTrials: 1, verificationTop: 1, topN: 1,
      criterion:{headRatioLimit:24,headRatioFraction:0,smallSpaceHeadRatioFloor:24,
        theoryCandidateLimit:24,theoryCandidateFraction:0,smallSpaceTheoryFloor:24,
        formalCandidateLimit:16,formalCandidateFraction:0,smallSpaceFormalFloor:16,
        fineRadius:0,minimumHeadRuns:1,uncertainHeadRuns:1,finalHeadBasins:1},
      monteCarloStages:[{trials:1,keep:1}],
      stages: [{ ratioStep: 50, trials: 1, keep: 2, maxCandidates: 2 },
        { ratioStep: 10, trials: 1, keep: 1, maxCandidates: 1 },
        { ratioStep: 1, trials: 1, keep: 1, maxCandidates: 1 }] as const };
    const choices = availableHeadHeroesByTroop(input, options.constraints);
    expect([choices.shield.length, choices.lancer.length, choices.marksman.length]).toEqual([15,16,16]);
    const workflow = createSingleWaveSearchWorkflow(input, options);
    const execute = createEvaluationExecutor();
    const visited = new Set<string>();
    const opponentBefore = JSON.stringify(input.sideB);
    let step = workflow.next();
    while (!step.done) {
      for (const job of step.value) {
        expect(job.kind).toBe("battle");
        expect(job.input.sideB).toBe(input.sideB);
        const head = job.rallyCandidate!.leaderHeroIds;
        expect(Object.values(head).every((id)=>id===null||input.availableHeroIds.includes(id!))).toBe(true);
        // The exact manual baseline is sampled too; it is not a generated legal head.
        if (job.input !== input && Object.values(head).every((id) => id !== null)) {
          expect(Object.values(head).some((id)=>catalog.leaderHeroes.find((hero)=>hero.heroId===id)!.generation!>=14)).toBe(true);
          visited.add(`${head.shield}|${head.lancer}|${head.marksman}`);
        }
      }
      const outcomes = step.value.map(execute);
      expect(outcomes.every((row) => row.samples.trials === 1 && row.samples.outcomes.length === 1)).toBe(true);
      step = workflow.next(outcomes);
    }
    const allLegalCount = 15 * 16 * 16;
    const oldCounts=[choices.shield,choices.lancer,choices.marksman].map((ids)=>ids.filter((id)=>(catalog.leaderHeroes.find((hero)=>hero.heroId===id)?.generation??0)<14).length);
    const recentEligibleCount=allLegalCount-oldCounts.reduce((product,count)=>product*count,1);
    const audit=step.value.searchDiagnostics.criterionAudit!;
    expect(audit).toMatchObject({allLegalHeadCount:allLegalCount,effectiveHeroGeneration:16,recentGenerationWindow:[14,16],
      recentEligibleHeadCount:recentEligibleCount,rejectedByRecentGenerationCount:allLegalCount-recentEligibleCount,
      rawHeadRatioCount:recentEligibleCount*231});
    expect(audit.retainedHeadRatioCount).toBeLessThanOrEqual(24);
    expect(audit.headsAfterC0).toBeLessThanOrEqual(24);
    expect(audit.headsAfterC0+audit.headsFullyEliminatedAtC0).toBe(recentEligibleCount);
    expect(audit.headsFullyEliminatedAtC0).toBeGreaterThan(0);
    expect(audit.eliminatedByTheoryPotential).toHaveLength(audit.headsFullyEliminatedAtC0);
    expect(visited.size).toBeGreaterThan(0);expect(visited.size).toBeLessThanOrEqual(audit.headsAfterC0);
    expect(audit.battleEngineCandidates).toBeLessThanOrEqual(17); // generated budget + exact manual baseline
    expect(audit.finalists.every((row)=>row.trials===1)).toBe(true);
    expect(step.value.searchDiagnostics.theoryCoverage).toMatchObject({
      theoryCandidateCount:recentEligibleCount*231,legalHeroLineupCount:recentEligibleCount,theoryHeroCoverage:100,ratiosPerHeroLineup:231});
    expect(step.value.searchDiagnostics.theoryLineups?.every((row)=>row.scannedRatios===231)).toBe(true);
    expect(JSON.stringify(input.sideB)).toBe(opponentBefore);
    // One-round battles exercise the funnel boundary, not recommendation quality.
  }, 240_000);
  it("reports unlocked body alternatives and actual visits separately", () => {
    const input = {...rallyHeadSearchFixture(),rallyBodyPoolIds:["hero.body.shuyun","hero.body.jiexi","hero.sr.patelike","hero.sr.xieergai"]};
    const options = { ...defaultOptimizationConfig(9), objectiveMode: "singleWin" as const,
      constraints: {},monteCarloStages:[{trials:2,keep:3}],criterion:{fineRadius:0}, stages: [ { ratioStep: 50, trials: 2, keep: 3, maxCandidates: 12 },
        { ratioStep: 10, trials: 2, keep: 2, maxCandidates: 4 },
        { ratioStep: 1, trials: 2, keep: 2, maxCandidates: 4 } ] as const,
      verificationTrials: 2, verificationTop: 2 };
    const result = searchSingleWave(input, options, undefined, (_candidate, seeds) =>
      seeds.map(() => ({ outcome: "B", self: { shield: 1, lancer: 0, marksman: 0 },
        enemy: { shield: 10, lancer: 0, marksman: 0 }, rounds: 1 })));
    expect(result.searchDiagnostics).toMatchObject({legalHeadCandidateCount:7,fixedBody:false});
    expect(result.searchDiagnostics.evaluatedUniqueHeadCandidateCount).toBeGreaterThan(0);
    expect(result.searchDiagnostics.evaluatedUniqueHeadCandidateCount).toBeLessThanOrEqual(7);
    const audit=result.searchDiagnostics.criterionAudit!;
    expect(audit).toMatchObject({allLegalHeadCount:8,recentEligibleHeadCount:7,rejectedByRecentGenerationCount:1});
    expect(audit.rawHeadRatioCount).toBe(7*231);
    expect(audit.headsEnteredBodySearch).toBe(audit.headsAfterC0);
    expect(result.searchDiagnostics.availableBodyCandidateCount).toBeGreaterThan(1);
    expect(result.searchDiagnostics.bodyCandidateCount).toBeGreaterThan(1);
  });
});
