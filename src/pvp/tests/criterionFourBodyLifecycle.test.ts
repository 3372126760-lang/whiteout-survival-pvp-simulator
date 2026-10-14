import { describe, expect, it } from "vitest";
import { exportPersistedJson, parsePersistedJson } from "../../storage";
import { candidateToInput, defaultOptimizationConfig, generateBodyFormations } from "../optimizer";
import { createJointSingleWaveSearchWorkflow } from "../optimizer/criterion/jointSearch";
import { bodyPrimaryEffectFamily } from "../optimizer/criterion/bodyPreprocess";
import { runOptimizationWorkflow, type EvaluationJobResult } from "../optimizer/execution";
import { runValidationBattle, toEngineScenario } from "../validationUi";
import { OPPONENT_HEAD, rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

const fourEffects = ["hero-skill.shuyun.attack", "hero-skill.jiexi.penetration",
  "hero-skill.patelike.life", "hero-skill.xieergai.guardian-power"];

describe("four distinct optimizer body slots through Final and recommendation application", () => {
  it("runs C0 through Final, applies, exports, restores and executes four different body heroes", () => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: Object.values(OPPONENT_HEAD), maxRounds: 2 };
    const config = { ...defaultOptimizationConfig(121), constraints: { fixedLeaders: OPPONENT_HEAD,
      fixedBodyExact: true, fixedMemberSkillIds: fourEffects }, verificationTop: 1, verificationTrials: 1000,
      criterion: { headRatioLimit: 2, headRatioFraction: 0, smallSpaceHeadRatioFloor: 2,
        theoryCandidateLimit: 2, theoryCandidateFraction: 0, smallSpaceTheoryFloor: 2,
        formalCandidateLimit: 2, formalCandidateFraction: 0, smallSpaceFormalFloor: 2,
        fineRadius: 0, screeningKeep: [1, 1, 1, 1, 1] } };
    expect(new Set(fourEffects.map((id) => bodyPrimaryEffectFamily(id))).size).toBe(4);
    expect(generateBodyFormations(input, config.constraints, OPPONENT_HEAD)
      .map((row) => row.memberSkillIds)).toEqual([fourEffects]);
    const before = JSON.stringify(input);
    const result = runOptimizationWorkflow(createJointSingleWaveSearchWorkflow(input, config), (job): EvaluationJobResult => {
      const win = job.input.sideA.selectedMemberSkillIds.length === 4;
      const aRemaining = { shield: win ? 100 : 0, lancer: 0, marksman: 0 };
      const bRemaining = { shield: win ? 0 : 100, lancer: 0, marksman: 0 };
      const outcome = win ? "A" as const : "B" as const;
      const outcomes = job.seeds.map(() => ({ outcome, winner: outcome, failed: false, rounds: 1, roundCount: 1,
        remaining: { A: aRemaining, B: bRemaining }, aRemaining, bRemaining, winnerRemaining: win ? aRemaining : bRemaining }));
      return { samples: { trials: outcomes.length, requestedTrials: outcomes.length, wins: win ? outcomes.length : 0,
        losses: win ? 0 : outcomes.length, failedTrials: 0, pruned: false, outcomes },
        performance: { simulatedTrials: outcomes.length, skippedTrials: 0, prunedCandidates: 0, templateBuilds: 0, templateHits: 0 } };
    });
    const recommendation = result.top[0]!, audit = result.searchDiagnostics.criterionAudit!;
    expect(recommendation.candidate.memberSkillIds).toEqual(fourEffects);
    expect(recommendation.trials).toBe(1000);
    expect(recommendation.winRate).toBeGreaterThanOrEqual(result.current.winRate);
    expect(audit).toMatchObject({ m1aBattlePerCandidate: 5, candidatesEliminatedByConfidenceWith5Samples: 0,
      headsEliminatedByConfidenceWithLessThan20Samples: 0, highUncertaintyEliminatedWithLessThan40Samples: 0,
      afterSameEffectMax2: 1, finalPreprocessedBodyCount: 1, rejectedByLowMarginalStacking: 0 });
    expect(audit.m1aAdvancedCount).toBe(audit.stageCoverage.M1a!.candidates);
    expect(audit.m1bCandidateCount).toBe(audit.m1aAdvancedCount);
    expect(audit.pairedProbeEvidence.every((pair) => pair.seeds.length === 5)).toBe(true);
    expect(audit.finalists.some((row) => row.bodySkillIds.join("|") === fourEffects.join("|") && row.trials === 1000)).toBe(true);
    const finalist = audit.finalists.find((row) => row.bodySkillIds.join("|") === fourEffects.join("|"))!;
    expect(finalist.bodySlots.map((slot) => slot.skillId)).toEqual(fourEffects);
    expect(new Set(finalist.bodySlots.map((slot) => slot.heroDefinitionId)).size).toBe(4);
    expect(new Set(finalist.bodySlots.map((slot) => slot.runtimeInstanceId)).size).toBe(4);
    expect(finalist.bodySlots.every((slot) => slot.level === 5 && slot.effectFamily.length > 0)).toBe(true);
    // candidateToInput is the same conversion used by the result UI's apply button.
    const applied = candidateToInput(input, recommendation.candidate);
    const restored = parsePersistedJson(exportPersistedJson(applied, 1000, config)).input;
    expect(restored.sideA.selectedMemberSkillIds).toEqual(fourEffects);
    expect(restored.sideA.bodySkills).toEqual(applied.sideA.bodySkills);
    expect(new Set(restored.sideA.bodySkills!.map((slot) => slot.heroDefinitionId)).size).toBe(4);
    expect(new Set(restored.sideA.bodySkills!.map((slot) => slot.runtimeInstanceId)).size).toBe(4);
    expect(() => toEngineScenario(restored)).not.toThrow();
    // This final call uses the official engine and real registry, not the fake workflow executor.
    const official = runValidationBattle(restored);
    const members = official.initialState.sideA.heroStates.filter((hero) => hero.position === "member");
    expect(members).toHaveLength(4);
    expect(new Set(members.map((hero) => hero.heroDefinitionId)).size).toBe(4);
    expect(new Set(members.map((hero) => hero.runtimeInstanceId)).size).toBe(4);
    expect(official.trace.rounds.length).toBeGreaterThan(0);
    expect(JSON.stringify(input)).toBe(before);
  }, 20_000);

  it("allows A+A+B+C with separate runtime instance IDs when A shares one effect family", () => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: Object.values(OPPONENT_HEAD), maxRounds: 1 };
    const ids = [fourEffects[0]!, fourEffects[0]!, fourEffects[1]!, fourEffects[2]!];
    expect(generateBodyFormations(input, { fixedBodyExact: true, fixedMemberSkillIds: ids }, OPPONENT_HEAD))
      .toHaveLength(1);
    const applied = candidateToInput(input, { leaderHeroIds: OPPONENT_HEAD, memberSkillIds: ids,
      ratios: { shield: 50, lancer: 20, marksman: 30 } });
    expect(applied.sideA.bodySkills![0]!.heroDefinitionId).toBe(applied.sideA.bodySkills![1]!.heroDefinitionId);
    expect(applied.sideA.bodySkills![0]!.runtimeInstanceId).not.toBe(applied.sideA.bodySkills![1]!.runtimeInstanceId);
    expect(() => runValidationBattle(applied)).not.toThrow();
  });

  it("allows a formally probed weak Head to disappear by global budget before 40 samples", () => {
    const weak = "hero.s10.gregory", strong = OPPONENT_HEAD.shield;
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: [weak, ...Object.values(OPPONENT_HEAD)], maxRounds: 2 };
    const config = { ...defaultOptimizationConfig(122), constraints: { fixedBodyExact: true, fixedMemberSkillIds: fourEffects },
      verificationTop: 1, verificationTrials: 1000, criterion: { headRatioLimit: 1000, headRatioFraction: 1,
        theoryCandidateLimit: 1000, theoryCandidateFraction: 1, formalCandidateLimit: 1000, formalCandidateFraction: 1,
        fineRadius: 0, screeningTrials: [5, 20], screeningKeep: [30, 1] } };
    const probedHeads = new Set<string>();
    const result = runOptimizationWorkflow(createJointSingleWaveSearchWorkflow(input, config), (job): EvaluationJobResult => {
      if (job.seeds.length === 5) probedHeads.add(job.rallyCandidate!.leaderHeroIds.shield!);
      const win = job.rallyCandidate!.leaderHeroIds.shield === strong;
      const aRemaining = { shield: win ? 100 : 0, lancer: 0, marksman: 0 };
      const bRemaining = { shield: win ? 0 : 100, lancer: 0, marksman: 0 }, outcome = win ? "A" as const : "B" as const;
      const outcomes = job.seeds.map(() => ({ outcome, winner: outcome, failed: false, rounds: 1, roundCount: 1,
        remaining: { A: aRemaining, B: bRemaining }, aRemaining, bRemaining, winnerRemaining: win ? aRemaining : bRemaining }));
      return { samples: { trials: outcomes.length, requestedTrials: outcomes.length, wins: win ? outcomes.length : 0,
        losses: win ? 0 : outcomes.length, failedTrials: 0, pruned: false, outcomes },
        performance: { simulatedTrials: outcomes.length, skippedTrials: 0, prunedCandidates: 0, templateBuilds: 0, templateHits: 0 } };
    });
    expect(probedHeads.has(weak)).toBe(true);
    expect(probedHeads.has(strong)).toBe(true);
    const audit = result.searchDiagnostics.criterionAudit!;
    expect(audit.finalists.some((row) => row.headHeroIds.shield === weak)).toBe(false);
    expect(audit.finalists.some((row) => row.headHeroIds.shield === strong)).toBe(true);
    const weakBudgetExits = audit.eliminations.filter((row) => row.headKey.split("|")[0] === weak && row.reason !== "confidence");
    expect(weakBudgetExits.length).toBeGreaterThan(0);
    expect(weakBudgetExits.some((row) => row.samples < 40)).toBe(true);
    expect(audit.candidatesEliminatedByConfidenceWith5Samples).toBe(0);
    expect(audit.eliminations.some((row) => row.samples === 5 && row.reason === "confidence")).toBe(false);
    expect(result.searchDiagnostics.searchIntegrityReport!.perStage.every((row) =>
      row.candidatesEntered === row.candidatesAdvanced + row.candidatesEliminated)).toBe(true);
  }, 20_000);

  it("accounts for both confidence and budget eliminations when the 50-run stage drops candidates", () => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: ["hero.s10.gregory", ...Object.values(OPPONENT_HEAD)], maxRounds: 2 };
    const config = { ...defaultOptimizationConfig(123), constraints: { fixedBodyExact: true, fixedMemberSkillIds: fourEffects },
      verificationTop: 1, verificationTrials: 1000, criterion: { headRatioLimit: 1000, headRatioFraction: 1,
        theoryCandidateLimit: 1000, theoryCandidateFraction: 1, formalCandidateLimit: 1000, formalCandidateFraction: 1,
        fineRadius: 0, screeningTrials: [5, 20, 50], screeningKeep: [500, 500, 1] } };
    const result = runOptimizationWorkflow(createJointSingleWaveSearchWorkflow(input, config), (job): EvaluationJobResult => {
      const win = job.rallyCandidate!.leaderHeroIds.shield === OPPONENT_HEAD.shield;
      const aRemaining = { shield: win ? 100 : 0, lancer: 0, marksman: 0 };
      const bRemaining = { shield: win ? 0 : 100, lancer: 0, marksman: 0 }, outcome = win ? "A" as const : "B" as const;
      const outcomes = job.seeds.map(() => ({ outcome, winner: outcome, failed: false, rounds: 1, roundCount: 1,
        remaining: { A: aRemaining, B: bRemaining }, aRemaining, bRemaining, winnerRemaining: win ? aRemaining : bRemaining }));
      return { samples: { trials: outcomes.length, requestedTrials: outcomes.length, wins: win ? outcomes.length : 0,
        losses: win ? 0 : outcomes.length, failedTrials: 0, pruned: false, outcomes },
        performance: { simulatedTrials: outcomes.length, skippedTrials: 0, prunedCandidates: 0, templateBuilds: 0, templateHits: 0 } };
    });
    const integrity = result.searchDiagnostics.searchIntegrityReport!, audit = result.searchDiagnostics.criterionAudit!;
    expect(integrity.racing.eliminatedByConfidence).toBeGreaterThan(0);
    expect(audit.eliminations.some((row) => row.reason === "confidence" && row.samples === 50)).toBe(true);
    expect(audit.eliminations.some((row) => row.reason === "budget" && row.samples === 50)).toBe(true);
    expect(integrity.perStage.every((row) => row.candidatesEntered === row.candidatesAdvanced + row.candidatesEliminated)).toBe(true);
    expect(audit.battleRunsRequested).toBe(audit.battleRunsExecuted + audit.battleRunsReused);
  }, 20_000);
});
