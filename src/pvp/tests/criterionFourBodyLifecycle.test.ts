import { createEvaluationExecutor } from "../optimizer/execution";
import { describe, expect, it } from "vitest";
import { exportPersistedJson, parsePersistedJson } from "../../storage";
import { candidateToInput, defaultOptimizationConfig, generateBodyFormations } from "../optimizer";
import { createPeakJointWorkflow } from "../optimizer/jointPipeline/workflow";
import { bodyPrimaryEffectFamily } from "../optimizer/criterion/bodyPreprocess";
import { runOptimizationWorkflow, type EvaluationJobResult } from "../optimizer/execution";
import { runValidationBattle, toEngineScenario } from "../validationUi";
import { OPPONENT_HEAD, rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

const fourEffects = ["hero-skill.shuyun.attack", "hero-skill.jiexi.penetration",
  "hero-skill.patelike.life", "hero-skill.xieergai.guardian-power"];

describe("four distinct optimizer body slots through Final and recommendation application", () => {
  it("runs J recall through Final, applies, exports, restores and executes four different body heroes", () => {
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
    const result = runOptimizationWorkflow(createPeakJointWorkflow(input, config), (job): EvaluationJobResult => {
      if (job.kind === "jointPeak") return createEvaluationExecutor()(job);
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
    expect(audit.finalPreprocessedBodyCount).toBe(1);
    expect(result.searchDiagnostics.jointPipeline!.recallAudit!.mergedRecallCount).toBeGreaterThan(0);
    expect(result.searchDiagnostics.jointPipeline!.finalCorrelation!.finalists.every((row) => row.recalledBy?.length)).toBe(true);
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



});
