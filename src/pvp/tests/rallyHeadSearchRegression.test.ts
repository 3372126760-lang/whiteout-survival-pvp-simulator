import { describe, expect, it } from "vitest";
import { availableHeadHeroesByTroop, candidateToInput, defaultOptimizationConfig,
  generateFormations, generateAllHeadFormations, searchSingleWave, runRallyOptimization, createEngineCandidateRunner,
  evaluateSingleCandidate, adaptiveSeedPools, type OptimizationConfig } from "../index";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { rallyHeadSearchFixture, opponentCandidate, OPPONENT_HEAD, OLD_HEAD } from "./fixtures/rallyHeadSearch";

function config(): OptimizationConfig {
  return { ...defaultOptimizationConfig(91), objectiveMode: "singleWin",
    constraints: { fixedBodyExact: true, fixedMemberSkillIds: [] },
    criterion: { ...defaultOptimizationConfig().criterion, fineRadius: 2 },
    monteCarloStages: [{ trials: 5, keep: 8 }, { trials: 20, keep: 5 }, { trials: 50, keep: 5 }],
    basinSearch: { fineRadius: 2, maxBasins: 2, fineBasins: 2, maxClimbRounds: 3 },
    stages: [ { ratioStep: 50, trials: 20, keep: 8, maxCandidates: 30 },
      { ratioStep: 10, trials: 30, keep: 5, maxCandidates: 20 },
      { ratioStep: 1, trials: 40, keep: 5, maxCandidates: 20 } ],
    verificationTrials: 1000, verificationTop: 5, topN: 5 };
}
describe("rally head search and locks", () => {
  it("recovers a known manual head and ratio using real fast battles", () => {
    const input = rallyHeadSearchFixture();
    const seeds = adaptiveSeedPools(91, 300, 1000, true).final;
    const run = createEngineCandidateRunner(input);
    const manual = evaluateSingleCandidate(opponentCandidate(), 36000, seeds, run);
    const weak = evaluateSingleCandidate({ ...opponentCandidate(), leaderHeroIds: OLD_HEAD }, 36000, seeds, run);
    const options = { ...config(), stages: [
      { ratioStep: 50, trials: 8, keep: 8, maxCandidates: 30 },
      { ratioStep: 10, trials: 15, keep: 5, maxCandidates: 20 },
      { ratioStep: 1, trials: 20, keep: 5, maxCandidates: 20 },
    ] as const, verificationTrials: 80, protectedCandidates: [opponentCandidate()] };
    const result = runRallyOptimization(input, { ...options, jointPipeline: { criterionKeep: 7, criterionFineKeep: 7, theoryKeep: 2, formalRatioKeep: 2, formalStages: [20,50,100,300].map((trials) => ({trials,keep:2})) } });
    expect(weak.winRate).toBeLessThan(.3);
    expect(manual.winRate).toBeGreaterThan(.4);
    expect(manual.actualCounts).toEqual({ shield: 18000, lancer: 7200, marksman: 10800 });
    expect(manual.selfRemaining.total.max).toBeLessThanOrEqual(36000);
    expect(result.singleWaveTop[0]!.winRate).toBeGreaterThanOrEqual(manual.winRate);
    expect(result.searchDiagnostics!.evaluatedHeadLineups).toContainEqual(OPPONENT_HEAD);
    expect(result.singleWaveTop[0]!.candidate.leaderHeroIds).not.toEqual(OLD_HEAD);
  }, 120_000);
  it("generates seven recent-eligible lineups and excludes the old-only head", () => {
    const input = rallyHeadSearchFixture();
    expect(availableHeadHeroesByTroop(input, {})).toMatchObject({
      shield: expect.arrayContaining([OLD_HEAD.shield, OPPONENT_HEAD.shield]),
      lancer: expect.arrayContaining([OLD_HEAD.lancer, OPPONENT_HEAD.lancer]),
      marksman: expect.arrayContaining([OLD_HEAD.marksman, OPPONENT_HEAD.marksman]),
    });
    const rows = generateFormations(input, config().constraints, 30);
    expect(rows).toHaveLength(7);
    expect(rows.some((row) => JSON.stringify(row.leaderHeroIds) === JSON.stringify(OLD_HEAD))).toBe(false);
    expect(rows.some((row) => JSON.stringify(row.leaderHeroIds) === JSON.stringify(OPPONENT_HEAD))).toBe(true);
  });
  it("evaluates Y, preserves its head through all stages and changes only A", () => {
    const input = rallyHeadSearchFixture();
    const before = JSON.stringify(input);
    const visited = new Set<string>();
    // Old configurations could allocate their entire coarse budget to the ratio grid.
    const limited = { ...config(), protectedCandidates: [opponentCandidate()], stages: [{ ...config().stages[0], maxCandidates: 6 },
      config().stages[1], config().stages[2]] as const };
    const pools = adaptiveSeedPools(91, 300, 1000, true);
    const indices = new Map(pools.final.map((seed, index) => [seed, index]));
    const result = searchSingleWave(input, limited, undefined, (candidate, seeds) => {
      const key = JSON.stringify(candidate.leaderHeroIds);
      visited.add(key);
      const isY = key === JSON.stringify(OPPONENT_HEAD);
      const mapped = candidateToInput(input, candidate);
      expect(mapped.sideB).toBe(input.sideB);
      expect(mapped.sideA.leaderHeroIds).toEqual(candidate.leaderHeroIds);
      return seeds.map((seed) => ({ outcome: isY && (indices.get(seed) ?? 0) % 2 === 0 ? "A" as const : "B" as const,
        self: { shield: isY ? 100 : 1, lancer: 0, marksman: 0 },
        enemy: { shield: 10, lancer: 0, marksman: 0 }, rounds: 10 }));
    });
    expect(visited.has(JSON.stringify(OPPONENT_HEAD))).toBe(true);
    expect(result.top[0]!.candidate.leaderHeroIds).toEqual(OPPONENT_HEAD);
    expect(result.top[0]!.winRate).toBe(.5);
    expect(result.searchDiagnostics).toMatchObject({ fixedHead: false,
      shieldCandidateCount: 2, lancerCandidateCount: 2, marksmanCandidateCount: 2,
      headCandidateCount: 7, optimizationTargetSide: "A", candidateChangedSide: "A",
      bestHeadLineup: OPPONENT_HEAD });
    expect(JSON.stringify(input)).toBe(before);
  });
  it("accepts locked old-only heads and preserves locks with body/ratio dimensions available", () => {
    const input = { ...rallyHeadSearchFixture(), rallyBodyPoolIds: ["hero.body.shuyun", "hero.s5.nuola"] };
    expect(generateAllHeadFormations(input, { fixedLeaders: OLD_HEAD, fixedBodyExact: true, fixedMemberSkillIds: [] }))
      .toEqual([{ leaderHeroIds: OLD_HEAD, memberSkillIds: [] }]);
    const locked = { ...config(), constraints: { fixedLeaders: OPPONENT_HEAD } };
    const result = searchSingleWave(input, locked, undefined, (candidate, seeds) => {
      // The exact old manual baseline remains a separate comparison only.
      expect([JSON.stringify(OPPONENT_HEAD), JSON.stringify(OLD_HEAD)]).toContain(JSON.stringify(candidate.leaderHeroIds));
      return seeds.map(() => ({ outcome: "B", self: { shield: 1, lancer: 0, marksman: 0 },
        enemy: { shield: 10, lancer: 0, marksman: 0 }, rounds: 10 }));
    });
    expect(result.searchDiagnostics).toMatchObject({ fixedHead: true, headCandidateCount: 1,
      searchDimensions: { headShield: false, headLancer: false, headMarksman: false,
        body: true, troopRatio: true } });
  });
  it("intersects the user pool and optimizer pool rather than expanding ownership", () => {
    const input = { ...rallyHeadSearchFixture(), availableHeroIds: Object.values(OLD_HEAD) };
    const choices = availableHeadHeroesByTroop(input, {
      heroPoolIds: [...Object.values(OLD_HEAD), ...Object.values(OPPONENT_HEAD)] });
    expect(choices).toEqual({ shield: [OLD_HEAD.shield], lancer: [OLD_HEAD.lancer], marksman: [OLD_HEAD.marksman] });
  });
  it("does not drop non-current definitions due to body runtime identities or weapon levels", () => {
    const input = rallyHeadSearchFixture();
    const withWeapons = { ...input, sideA: { ...input.sideA, simulationWeaponLevels: {
      [OLD_HEAD.shield]: 2, [OPPONENT_HEAD.shield]: 10 } } };
    const candidates = generateFormations(withWeapons, config().constraints, 30);
    const candidate = candidates.find((row) => row.leaderHeroIds.shield === OPPONENT_HEAD.shield)!;
    const applied = candidateToInput(withWeapons, { ...candidate, ratios: input.sideA.rallyDeployment!.ratios });
    expect(applied.sideA.simulationWeaponLevels?.[OPPONENT_HEAD.shield]).toBe(10);
    expect(candidates).toHaveLength(7);
  });
  it("clears ambiguous v2 auto-persisted locks; preserves explicit v3 locks", () => {
    const input = rallyHeadSearchFixture();
    const envelope = createPersistedEnvelope(input, 1000, { ...config(), constraints: { fixedLeaders: OLD_HEAD } });
    expect(restorePersistedConfig(envelope).optimizationConfig.constraints.fixedLeaders).toEqual(OLD_HEAD);
    const migrated = restorePersistedConfig({ ...envelope, schemaVersion: 2 });
    expect(migrated.optimizationConfig.constraints.fixedLeaders).toBeUndefined();
    expect(migrated.migrated).toBe(true);
    expect(defaultOptimizationConfig().constraints.fixedLeaders).toBeUndefined();
  });
});
