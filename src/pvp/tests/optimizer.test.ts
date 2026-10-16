import { describe, expect, it } from "vitest";
import {
  allocateRallyTroopsByRatio,
  AutoObjective,
  candidateToInput,
  candidateKey,
  compareSingleWin,
  compileValidationBattle,
  createEngineCandidateRunner,
  createStageSeeds,
  defaultOptimizationConfig,
  evaluateMultiWaveSequence,
  evaluateSingleCandidate,
  generateFormations,
  generateRatioGrid,
  getValidationCatalog,
  searchMultiWave,
  searchSingleWave,
  runRallyOptimization,
  toEngineScenario,
  wilsonInterval,
  type RallyCandidate,
  type TroopSurvivors,
} from "../../pvp";
import { createDefaultValidationInput as createUiDefaultInput } from "../../ui/defaultInput";

const createDefaultValidationInput = () => {
  const base = createUiDefaultInput();
  return { ...base, attributeInputMode: "prediction" as const,
    sideA: { ...base.sideA, leaderHeroIds: { shield: "hero.s1.nataliya", lancer: "hero.s1.moli", marksman: "hero.s1.jinman" } } };
};

const zeros: TroopSurvivors = { shield: 0, lancer: 0, marksman: 0 };
const candidateA: RallyCandidate = {
  leaderHeroIds: { shield: null, lancer: null, marksman: null },
  memberSkillIds: [],
  ratios: { shield: 100, lancer: 0, marksman: 0 },
};
const candidateB: RallyCandidate = {
  ...candidateA, ratios: { shield: 0, lancer: 0, marksman: 100 },
};

describe("rally optimization", () => {
  it("retains deterministic largest-remainder troop totals and zero-ratio troops", () => {
    expect(allocateRallyTroopsByRatio({ totalTroops: 101, ratios: { shield: 50, lancer: 25, marksman: 25 } }))
      .toEqual({ shield: 51, lancer: 25, marksman: 25 });
    expect(allocateRallyTroopsByRatio({ totalTroops: 101, ratios: { shield: 0, lancer: 0, marksman: 100 } }))
      .toEqual({ shield: 0, lancer: 0, marksman: 101 });
    expect(() => allocateRallyTroopsByRatio({ totalTroops: 101, ratios: { shield: 40, lancer: 40, marksman: 0 } })).toThrow();
    expect(generateRatioGrid(5)).toHaveLength(231);
  });

  it("filters hero generations and honors fixed/forbidden heroes", () => {
    const input = { ...createDefaultValidationInput(), serverStage: "s10_t12" as const };
    const formations = generateFormations(input, {}, 20);
    expect(formations.length).toBeGreaterThan(0);
    for (const formation of formations) {
      expect(Object.values(formation.leaderHeroIds).every((id) => id === null || !id.startsWith("hero.s11"))).toBe(true);
      const members = getValidationCatalog().memberSkills;
      for (const skillId of formation.memberSkillIds) {
        const option = members.find((entry) => entry.sourceSkillIds.includes(skillId));
        const heroId = option?.sourceHeroIds[option.sourceSkillIds.indexOf(skillId)];
        const generation = getValidationCatalog().leaderHeroes.find((hero) => hero.heroId === heroId)?.generation ?? 0;
        expect(generation).toBeLessThanOrEqual(10);
      }
    }
    const fixed = generateFormations(input, {
      fixedLeaders: { shield: "hero.s5.heketuo" },
      forbiddenHeroIds: ["hero.s5.nuola"],
    }, 10);
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.every((formation) => formation.leaderHeroIds.shield === "hero.s5.heketuo")).toBe(true);
    expect(fixed.every((formation) =>
      Object.values(formation.leaderHeroIds).every((id) => id !== "hero.s5.nuola"))).toBe(true);
    expect(() => generateFormations({ ...input, serverStage: "s4_t11" }, {
      fixedLeaders: { shield: "hero.s5.heketuo" },
    }, 10)).toThrow();
    const required = generateFormations({ ...input, serverStage: "s5_t11" }, {
      requiredHeroIds: ["hero.s5.heketuo"],
    }, 10);
    expect(required.length).toBeGreaterThan(0);
    expect(required.every((entry) => entry.leaderHeroIds.shield === "hero.s5.heketuo")).toBe(true);
  });

  it("deduplicates member permutations only when equivalence is explicitly enabled", () => {
    const first = { ...candidateA, memberSkillIds: ["a", "b", "c", "d"] };
    const permuted = { ...candidateA, memberSkillIds: ["d", "c", "b", "a"] };
    expect(candidateKey(first)).not.toBe(candidateKey(permuted));
    expect(candidateKey(first, true)).toBe(candidateKey(permuted, true));
  });

  it("keeps the body exact while allowing unlocked leaders to vary", () => {
    const input = createDefaultValidationInput();
    const formations = generateFormations(input, {
      fixedBodyExact: true, fixedMemberSkillIds: [],
    }, 12);
    expect(formations.length).toBeGreaterThan(1);
    expect(formations.every((formation) => formation.memberSkillIds.length === 0)).toBe(true);
    expect(new Set(formations.map((formation) => JSON.stringify(formation.leaderHeroIds)))
      .size).toBeGreaterThan(1);
  });

  it("uses the same stage seed set, verifies finalists uniformly, and never mutates input", () => {
    const input = { ...createDefaultValidationInput(), battleContext: "rally" as const };
    const before = JSON.stringify(input);
    const config = {
      ...defaultOptimizationConfig(91),
      constraints: { fixedLeaders: { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" }, fixedMemberSkillIds: [], fixedBodyExact: true },
      monteCarloStages: [{ trials: 2, keep: 3 }, { trials: 3, keep: 2 }, { trials: 4, keep: 2 }],
      stages: [
        { ratioStep: 5, trials: 2, keep: 3, maxCandidates: 231 },
        { ratioStep: 2, trials: 3, keep: 2, maxCandidates: 6 },
        { ratioStep: 1, trials: 4, keep: 2, maxCandidates: 6 },
      ] as const,
      verificationTrials: 5, verificationTop: 2, topN: 2,
    };
    const calls: number[][] = [];
    const result = searchSingleWave(input, config, undefined, (candidate, seeds) => {
      calls.push([...seeds]);
      return seeds.map(() => ({
        outcome: candidate.ratios.shield >= 50 ? "A" as const : "B" as const,
        self: { shield: candidate.ratios.shield, lancer: 0, marksman: 0 },
        enemy: zeros, rounds: 2,
      }));
    });
    expect(calls[0]).toEqual(createStageSeeds(91, 20));
    expect(result.top.every((row) => row.trials === 1000)).toBe(true);
    expect(result.top[0]?.winRate).toBe(1);
    expect(JSON.stringify(input)).toBe(before);
    expect(createStageSeeds(91, 3)).toEqual([91, 92, 93]);
  });

  it("uses wins first and self survivors to break statistically close win rates", () => {
    const seeds = createStageSeeds(1, 10);
    const strong = evaluateSingleCandidate(candidateA, 100, seeds, () => seeds.map(() => ({
      outcome: "A", self: { shield: 80, lancer: 0, marksman: 0 }, enemy: zeros, rounds: 1,
    })));
    const weak = evaluateSingleCandidate(candidateB, 100, seeds, () => seeds.map(() => ({
      outcome: "A", self: { shield: 50, lancer: 0, marksman: 0 }, enemy: zeros, rounds: 1,
    })));
    expect(compareSingleWin(strong, weak)).toBeLessThan(0);
    expect(strong.wilson95[1]).toBeLessThanOrEqual(1);
  });

  it("ranks a statistically separated higher win rate ahead of residual troops", () => {
    const seeds = createStageSeeds(1, 100);
    const strong = evaluateSingleCandidate(candidateA, 100, seeds, (_candidate, sample) => sample.map(() => ({
      outcome: "A", self: { shield: 1, lancer: 0, marksman: 0 }, enemy: zeros, rounds: 1,
    })));
    const weak = evaluateSingleCandidate(candidateB, 100, seeds, (_candidate, sample) => sample.map(() => ({
      outcome: "B", self: { shield: 100, lancer: 0, marksman: 0 }, enemy: zeros, rounds: 1,
    })));
    expect(compareSingleWin(strong, weak)).toBeLessThan(0);
    expect(wilsonInterval(100, 100)[0]).toBeGreaterThan(wilsonInterval(0, 100)[1]);
  });

  it("changes only attacker lineup/ratio and retains the defender's full config", () => {
    const input = { ...createDefaultValidationInput(), battleContext: "rally" as const };
    const revised = candidateToInput(input, candidateA);
    expect(revised.sideB).toBe(input.sideB);
    expect(revised.sideA.troops).toBe(input.sideA.troops);
    expect(revised.sideA.externalBuffs).toBe(input.sideA.externalBuffs);
    expect(revised.sideA.rallyDeployment?.totalTroops).toBe(input.sideA.rallyDeployment?.totalTroops);
    expect(revised.sideA.rallyDeployment?.ratios).toEqual(candidateA.ratios);
  });

  it("forces rally tiers to single-level stacks even if old challenge composition exists", () => {
    const base = createDefaultValidationInput();
    const sideA = { ...base.sideA, troops: { ...base.sideA.troops,
      shield: { ...base.sideA.troops.shield, levelMode: "mixed" as const,
        levelComposition: [{ level: "T3", aliveCount: 5 }, { level: "T4", aliveCount: 5 }] },
    } };
    const scenario = toEngineScenario({ ...base, battleContext: "rally", sideA });
    expect(scenario.sideA.shield.levelComposition).toEqual([
      { level: base.sideA.troops.shield.troopLevel, aliveCount: 12_240 },
    ]);
  });

  it("repeats the same compact candidate trial exactly for a fixed seed", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, battleContext: "rally" as const, maxRounds: 2 };
    const runner = createEngineCandidateRunner(input);
    expect(runner(candidateA, [10, 11])).toEqual(runner(candidateA, [10, 11]));
  });

  it("carries each trajectory's actual enemy composition instead of averaged or reallocated counts", () => {
    const seen: TroopSurvivors[] = [];
    const run = (_candidate: RallyCandidate, enemy: TroopSurvivors, seed: number): TroopSurvivors => {
      seen.push({ ...enemy });
      if (enemy.shield === 500) return seed % 2 === 0
        ? { shield: 100, lancer: 50, marksman: 30 }
        : { shield: 80, lancer: 70, marksman: 40 };
      return zeros;
    };
    const result = evaluateMultiWaveSequence([candidateA, candidateB],
      { shield: 500, lancer: 300, marksman: 200 }, [10, 11], .9, run);
    expect(seen[0]).toEqual({ shield: 500, lancer: 300, marksman: 200 });
    expect(seen[1]).toEqual({ shield: 100, lancer: 50, marksman: 30 });
    expect(seen[2]).toEqual({ shield: 500, lancer: 300, marksman: 200 });
    expect(seen[3]).toEqual({ shield: 80, lancer: 70, marksman: 40 });
    expect(result.targetWaves).toBe(2);
    expect(result.waves[0]?.enemyRemaining.shield.mean).toBe(90);
  });

  it("allows a different configuration in each wave and finds a two-wave clear", () => {
    const input = createDefaultValidationInput();
    const sideB = { ...input.sideB, rallyDeployment: { totalTroops: 200, ratios: { shield: 50, lancer: 0, marksman: 50 } } };
    const config = { ...defaultOptimizationConfig(3), maxWaves: 2,
      beamWidth: 3, branchWidth: 2, beamTrials: 3, verificationTrials: 4, verificationTop: 3 };
    const attack = (candidate: RallyCandidate, enemy: TroopSurvivors): TroopSurvivors =>
      candidate.ratios.shield === 100
        ? { ...enemy, shield: Math.max(0, enemy.shield - 80) }
        : { ...enemy, shield: Math.max(0, enemy.shield - 20), marksman: 0 };
    const plans = searchMultiWave({ ...input, battleContext: "rally", sideB },
      [candidateA, candidateB], config, undefined, attack);
    expect(plans[0]?.targetWaves).toBe(2);
    expect(plans[0]?.sequence.length).toBe(2);
    expect(plans[0]?.sequence[0]).not.toEqual(plans[0]?.sequence[1]);
    expect(plans[0]?.waves[1]?.defeatProbability).toBe(1);
  });

  it("returns K=3 when cumulative defeat is 10%, 50%, then 95% at a 90% target", () => {
    const third: RallyCandidate = { ...candidateA, ratios: { shield: 0, lancer: 100, marksman: 0 } };
    const seeds = Array.from({ length: 20 }, (_, index) => index);
    const result = evaluateMultiWaveSequence([candidateA, candidateB, third],
      { shield: 100, lancer: 0, marksman: 0 }, seeds, .9,
      (candidate, _enemy, seed) => {
        const wave = candidate === candidateA ? 0 : candidate === candidateB ? 1 : 2;
        const trajectory = ((seed - wave * 1_000_003) % 0x1_0000_0000 + 0x1_0000_0000) % 0x1_0000_0000;
        const threshold = wave === 0 ? 2 : wave === 1 ? 10 : 19;
        return trajectory < threshold ? zeros : { shield: 1, lancer: 0, marksman: 0 };
      });
    expect(result.waves.map((wave) => wave.defeatProbability)).toEqual([.1, .5, .95]);
    expect(result.targetWaves).toBe(3);
  });

  it("recreates a fresh battle with only enemy counts carried across", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, battleContext: "rally" as const, maxRounds: 1,
      sideA: { ...base.sideA, rallyDeployment: { totalTroops: 1_000, ratios: { shield: 100, lancer: 0, marksman: 0 } } },
      sideB: { ...base.sideB, rallyDeployment: { totalTroops: 1_000, ratios: { shield: 50, lancer: 30, marksman: 20 } } },
    };
    const compiled = compileValidationBattle(input);
    const fresh = compiled.createFreshState({ shield: 200, lancer: 250, marksman: 180 });
    expect(fresh.round).toBe(1);
    expect(compiled.initialState.fixedInitialMinTroops).toBe(1_000);
    expect(fresh.fixedInitialMinTroops).toBe(630);
    expect([fresh.sideB.troops.shield.aliveCount, fresh.sideB.troops.lancer.aliveCount,
      fresh.sideB.troops.marksman.aliveCount]).toEqual([200, 250, 180]);
    expect(fresh.sideB.troops.shield.frontUnitHp).toBe(fresh.sideB.troops.shield.maxHpPerUnit);
    expect(fresh.sideA.troops.shield.aliveCount).toBe(1_000);
    expect(fresh.sideB.heroStates).toEqual(compiled.initialState.sideB.heroStates);
    expect(compiled.runFreshTrial(5, { shield: 200, lancer: 250, marksman: 180 }).roundCount).toBe(1);
  });

  it("creates a full new attacker for a different second-wave ratio", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, battleContext: "rally" as const, maxRounds: 1 };
    const first = compileValidationBattle(candidateToInput(input, candidateA));
    const second = compileValidationBattle(candidateToInput(input, candidateB));
    const enemy = { shield: 200, lancer: 250, marksman: 180 };
    expect(first.createFreshState(enemy).sideA.troops.shield.aliveCount).toBe(36_000);
    expect(first.createFreshState(enemy).sideA.troops.marksman.aliveCount).toBe(0);
    expect(second.createFreshState(enemy).sideA.troops.shield.aliveCount).toBe(0);
    expect(second.createFreshState(enemy).sideA.troops.marksman.aliveCount).toBe(36_000);
  });

  it("selects the weak-match objective only below the configured threshold", () => {
    const config = defaultOptimizationConfig();
    expect(AutoObjective.select(.02, config)).toBe("minRallies");
    expect(AutoObjective.select(.50, config)).toBe("singleWin");
    expect(AutoObjective.select(.99, config)).toBe("singleWin");
  });

  it("runs a real compact engine search without returning BattleTrace", () => {
    const base = createDefaultValidationInput();
    const input = {
      ...base, battleContext: "rally" as const, maxRounds: 1,
      sideA: { ...base.sideA, rallyDeployment: { totalTroops: 10, ratios: { shield: 100, lancer: 0, marksman: 0 } } },
      sideB: { ...base.sideB, rallyDeployment: { totalTroops: 10, ratios: { shield: 0, lancer: 100, marksman: 0 } } },
    };
    const config = {
      ...defaultOptimizationConfig(2), objectiveMode: "singleWin" as const,
      constraints: { fixedLeaders: { shield: "hero.s11.eleonora", lancer: null, marksman: null }, fixedMemberSkillIds: [], fixedBodyExact: true },
      monteCarloStages: [{ trials: 1, keep: 2 }],
      stages: [
        { ratioStep: 5, trials: 1, keep: 2, maxCandidates: 231 },
        { ratioStep: 2, trials: 1, keep: 2, maxCandidates: 4 },
        { ratioStep: 1, trials: 1, keep: 2, maxCandidates: 4 },
      ] as const,
      verificationTrials: 2, verificationTop: 2, topN: 2,
    };
    const result = runRallyOptimization(input, config);
    expect(result.singleWaveTop.length).toBeGreaterThan(0);
    expect(result.singleWaveTop.every((entry) => entry.trials === 1000)).toBe(true);
    expect(result.currentEvaluation.trials).toBe(1000);
    expect(result.singleWaveTop[0]!.winRate)
      .toBeGreaterThanOrEqual(result.currentEvaluation.winRate);
    expect(result.status).toBe("success");
    expect("trace" in result).toBe(false);
    expect("trace" in result.singleWaveTop[0]!).toBe(false);
  }, 15_000);

  it("returns a visible best approximation when the multi-wave target is unreachable", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, scenarioType: "RALLY" as const,
      battleContext: "rally" as const, maxRounds: 1,
      sideA: { ...base.sideA, rallyDeployment: { totalTroops: 1,
        ratios: { shield: 100, lancer: 0, marksman: 0 } } },
      sideB: { ...base.sideB, rallyDeployment: { totalTroops: 100_000,
        ratios: { shield: 100, lancer: 0, marksman: 0 } } } };
    const config = { ...defaultOptimizationConfig(42),
      objectiveMode: "minRallies" as const, targetDefeatProbability: 1,
      maxWaves: 1, beamWidth: 1, branchWidth: 1, beamTrials: 2,
      constraints: { fixedLeaders: { shield: "hero.s11.eleonora", lancer: null, marksman: null },
        fixedMemberSkillIds: [], fixedBodyExact: true },
      monteCarloStages: [{ trials: 1, keep: 2 }],
      stages: [
        { ratioStep: 5, trials: 1, keep: 2, maxCandidates: 231 },
        { ratioStep: 2, trials: 1, keep: 2, maxCandidates: 4 },
        { ratioStep: 1, trials: 1, keep: 2, maxCandidates: 4 },
      ] as const,
      verificationTrials: 2, verificationTop: 2, topN: 2 };
    const result = runRallyOptimization(input, config);
    expect(result.status).toBe("target_not_met");
    expect(result.multiWaveTop).toHaveLength(1);
    expect(result.multiWaveTop[0]?.waves[0]?.defeatProbability).toBeLessThan(1);
    expect(result.multiWaveTop[0]?.sequence.length).toBe(1);
  }, 15_000);
});
