import { describe, expect, it } from "vitest";
import { candidateToInput, defaultOptimizationConfig, generateAllHeadFormations,
  runRallyOptimizationAsync, type OptimizationConfig, type OptimizationInput } from "../optimizer";
import { preFilterJointRallyCandidates } from "../optimizer/criterion/jointPreFilter";
import type { EvaluationJob, EvaluationJobResult } from "../optimizer/execution";
import { OLD_HEAD, OPPONENT_HEAD, rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

function fixedConfig(side: "A" | "B" = "A"): OptimizationConfig {
  return { ...defaultOptimizationConfig(302), candidateSide: side, objectiveMode: "singleWin",
    constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] },
    criterion: { enabled: false, headRatioLimit: 1, headRatioFraction: 0, smallSpaceHeadRatioFloor: 1,
      theoryCandidateLimit: 1, theoryCandidateFraction: 0, smallSpaceTheoryFloor: 1,
      formalCandidateLimit: 1, formalCandidateFraction: 0, smallSpaceFormalFloor: 1,
      fineRadius: 0, c0TheoryRounds: 1 },
    theory: { ...defaultOptimizationConfig().theory!, deterministicRounds: 1 },
    monteCarloStages: [{ trials: 5, keep: 10 }, { trials: 20, keep: 3 }],
    verificationTrials: 1000, verificationTop: 3 };
}
function emptyInput(mode: "finalReport" | "prediction" = "finalReport"): OptimizationInput {
  const base = rallyHeadSearchFixture();
  return { ...base, attributeInputMode: mode, availableHeroIds: [], ownedHeroIds: [], rallyBodyPoolIds: [],
    optimizerHeroPool: { A: {}, B: {} },
    sideA: { ...base.sideA, leaderHeroIds: { shield: null, lancer: null, marksman: null },
      troops: { ...base.sideA.troops, shield: { ...base.sideA.troops.shield, count: 36000 },
        lancer: { ...base.sideA.troops.lancer, count: 0 }, marksman: { ...base.sideA.troops.marksman, count: 0 } },
      rallyDeployment: { totalTroops: 36000, ratios: { shield: 100, lancer: 0, marksman: 0 } } } };
}
function outcomes(job: EvaluationJob, wins: boolean): EvaluationJobResult {
  const side = job.side ?? "A", winner = wins ? side : side === "A" ? "B" : "A";
  const aRemaining = { shield: winner === "A" ? 100 : 0, lancer: 0, marksman: 0 };
  const bRemaining = { shield: winner === "B" ? 100 : 0, lancer: 0, marksman: 0 };
  const rows = job.seeds.map(() => ({ outcome: winner, winner, failed: false, rounds: 1, roundCount: 1,
    remaining: { A: aRemaining, B: bRemaining }, aRemaining, bRemaining,
    winnerRemaining: winner === "A" ? aRemaining : bRemaining }));
  return { samples: { trials: rows.length, requestedTrials: rows.length, wins: wins ? rows.length : 0,
    losses: wins ? 0 : rows.length, failedTrials: 0, pruned: false, outcomes: rows },
    performance: { simulatedTrials: rows.length, skippedTrials: 0, prunedCandidates: 0, templateBuilds: 0, templateHits: 0 } };
}

describe("Rally fixed report and empty head search", () => {
  it.each(["A", "B"] as const)("fixes current actual head and Lv6 weapons on %s despite disabled, unowned old heroes", (side) => {
    const base = rallyHeadSearchFixture(), sideKey = side === "A" ? "sideA" : "sideB", own = base[sideKey];
    const weapon = OLD_HEAD.shield;
    const input: OptimizationInput = { ...base, attributeInputMode: "finalReport", ownedHeroIds: [], availableHeroIds: [],
      optimizerHeroPool: { A: { [weapon]: { enabled: false, weaponLevel: 10 } }, B: { [weapon]: { enabled: false, weaponLevel: 10 } } },
      [sideKey]: { ...own, leaderHeroIds: OLD_HEAD, simulationWeaponLevels: { [weapon]: 6 } } };
    const config = fixedConfig(side), scan = preFilterJointRallyCandidates(input, config);
    expect(scan.formations.map((row) => row.leaderHeroIds)).toEqual([OLD_HEAD]);
    expect(scan.audit).toMatchObject({ headSearchEnabled: false, headFixedReason: "finalReportAttributes",
      headTemplateCount: 1, ratioCount: 231, retainedHeadRatioCount: 231, rejectedByRecentGenerationCount: 0 });
    expect(scan.dimensions.searchDimensions).toEqual(["ratio"]);
    expect(scan.candidates).toHaveLength(231);
    expect(scan.candidates.every((candidate) => candidate.headWeaponLevels?.[weapon] === 6)).toBe(true);
    const applied = candidateToInput(input, { ...scan.candidates[0]!, leaderHeroIds: OPPONENT_HEAD,
      headWeaponLevels: { [weapon]: 10 } }, side);
    expect(applied[sideKey].leaderHeroIds).toEqual(OLD_HEAD);
    expect(applied[sideKey].simulationWeaponLevels?.[weapon]).toBe(6);
    expect(applied[side === "A" ? "sideB" : "sideA"]).toEqual(base[side === "A" ? "sideB" : "sideA"]);
    expect(scan.heroPoolAudit).toBeUndefined();
  });

  it.each(["finalReport", "prediction"] as const)("treats empty %s head and fixed empty body as one template, scanning all 231 ratios", (mode) => {
    const input = emptyInput(mode), config = fixedConfig();
    const scan = preFilterJointRallyCandidates(input, config);
    expect(scan.formations).toHaveLength(1);
    expect(scan.formations[0]!.leaderHeroIds).toEqual({ shield: null, lancer: null, marksman: null });
    expect(scan.audit).toMatchObject({ headMode: "EMPTY_HEAD", headTemplateCount: 1, ratioCount: 231,
      bodyCandidateCount: 1, roughJointCount: 231, theoreticalEvaluationCount: 231, recentEligibleHeadCount: 1,
      rejectedByRecentGenerationCount: 0 });
    expect(scan.candidates.some((candidate) => candidate.ratios.shield === 50 && candidate.ratios.lancer === 10 && candidate.ratios.marksman === 40)).toBe(true);
  });

  it("finds a stronger 514 ratio through the actual workflow instead of verifying only current 100% shield", async () => {
    const input = emptyInput(), config = fixedConfig(), seen = new Set<string>(), before = JSON.stringify(input);
    const result = await runRallyOptimizationAsync(input, config, async (jobs) => jobs.map((job) => {
      const ratio = job.rallyCandidate!.ratios;
      seen.add(`${ratio.shield}/${ratio.lancer}/${ratio.marksman}`);
      return outcomes(job, ratio.shield === 50 && ratio.lancer === 10 && ratio.marksman === 40);
    }));
    expect(seen.size).toBe(231);
    expect(result.singleWaveTop[0]!.candidate.ratios).toEqual({ shield: 50, lancer: 10, marksman: 40 });
    expect(result.singleWaveTop[0]!.winRate).toBe(1);
    expect(result.currentEvaluation.winRate).toBe(0);
    expect(result.singleWaveTop[0]!.trials).toBe(1000);
    expect(result.searchDimensionAudit?.searchDimensions).toEqual(["ratio"]);
    expect(result.searchDiagnostics!.criterionAudit!.finalists.every((row) => row.weaponLevelSource !== "optimizerHeroPool")).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("performs Ratio × Body scanning with EMPTY_HEAD and independent legal body preprocessing", () => {
    const input = { ...emptyInput(), rallyBodyPoolIds: ["hero.s5.nuola", "hero.s6.wuming"] };
    const config = { ...fixedConfig(), constraints: {} }, scan = preFilterJointRallyCandidates(input, config);
    expect(scan.dimensions.searchDimensions).toEqual(["ratio", "body"]);
    expect(scan.audit.headTemplateCount).toBe(1);
    expect(scan.audit.legalBodyCount).toBeGreaterThan(0);
    expect(scan.audit.roughJointCount).toBe(231 * scan.audit.legalBodyCount);
    expect(scan.audit.rawBodyCombinationCount).toBe(16);
    expect(scan.audit.afterSameEffectMax2).toBe(6);
    expect(scan.candidates.every((candidate) => Object.values(candidate.leaderHeroIds).every((id) => id === null))).toBe(true);
  });

  it("accepts an explicitly fixed old prediction head without pool or recent-generation membership", () => {
    const base = rallyHeadSearchFixture(), input = { ...base, availableHeroIds: [], ownedHeroIds: [] };
    expect(generateAllHeadFormations(input, { fixedLeaders: OLD_HEAD, fixedBodyExact: true, fixedMemberSkillIds: [] }))
      .toEqual([{ leaderHeroIds: OLD_HEAD, memberSkillIds: [] }]);
  });

  it("treats fixedCurrentBody with no stored selections as legal EMPTY_BODY", () => {
    const scan = preFilterJointRallyCandidates(emptyInput(), { ...fixedConfig(), constraints: { fixedBodyExact: true } });
    expect(scan.audit.legalBodyCount).toBe(1);
    expect(scan.candidates).toHaveLength(231);
    expect(scan.candidates.every((candidate) => candidate.memberSkillIds.length === 0)).toBe(true);
  });

  it.each([1, 10])("uses the fixed-head full 5%% grid despite a saved %s%% theory step", (ratioStep) => {
    const config = fixedConfig(), scan = preFilterJointRallyCandidates(emptyInput(), {
      ...config, theory: { ...config.theory!, ratioStep } });
    expect(scan.grid).toHaveLength(231);
    expect(scan.options.ratioStep).toBe(5);
    expect(scan.audit.roughJointCount).toBe(231);
  });

  it("ignores saved CONFIG references that change the head after switching to FINAL_REPORT", () => {
    const base = rallyHeadSearchFixture(), config = fixedConfig();
    const scan = preFilterJointRallyCandidates({ ...base, attributeInputMode: "finalReport",
      sideA: { ...base.sideA, simulationWeaponLevels: { [OLD_HEAD.shield]: 6 } } }, {
      ...config, protectedCandidates: [{ leaderHeroIds: OPPONENT_HEAD,
        headWeaponLevels: { [OPPONENT_HEAD.shield]: 10 }, memberSkillIds: [],
        ratios: { shield: 50, lancer: 10, marksman: 40 } }] });
    expect(scan.audit.ignoredProtectedReferencesByFixedHead).toBe(1);
    expect(scan.formations).toHaveLength(1);
    expect(scan.candidates.every((candidate) => JSON.stringify(candidate.leaderHeroIds) === JSON.stringify(OLD_HEAD))).toBe(true);
    expect(scan.candidates.every((candidate) => candidate.headWeaponLevels?.[OLD_HEAD.shield] === 6)).toBe(true);
  });
});
