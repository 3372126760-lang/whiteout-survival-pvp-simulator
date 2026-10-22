import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIMULATION_COUNT,
  MAX_BATCH_SIMULATION_COUNT,
  MIN_BATCH_SIMULATION_COUNT,
  deriveBatchSeed,
  resetAllProbabilityOverrides,
  runBatchSimulation,
  summarizeBatchMetric,
  runValidationBattleCore,
  validateBatchSimulationCount,
  type TroopType,
  type ValidationBattleInput,
  type ValidationSideInput,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import {
  createExpandedSections,
  rememberExpandedSection,
} from "../../ui/expandedSections";

describe("PVP validation batch simulation", () => {
  it("uses nearest-rank P5/P50/P95 with 1,000 samples and retains zero", () => {
    const values = Array.from({ length: 1_000 }, (_, index) => index);
    expect(summarizeBatchMetric(values)).toEqual({
      mean: 499.5, p05: 49, p50: 499, p95: 949, min: 0, max: 999,
    });
    expect(summarizeBatchMetric([0])).toEqual({
      mean: 0, p05: 0, p50: 0, p95: 0, min: 0, max: 0,
    });
    expect(summarizeBatchMetric([9, 0, 3])).toEqual({
      mean: 4, p05: 0, p50: 3, p95: 9, min: 0, max: 9,
    });
    expect(() => summarizeBatchMetric([])).toThrow();
  });

  it("validates the confirmed 1..100000 simulation-count range", () => {
    expect(DEFAULT_BATCH_SIMULATION_COUNT).toBe(1_000);
    expect(MIN_BATCH_SIMULATION_COUNT).toBe(1);
    expect(MAX_BATCH_SIMULATION_COUNT).toBe(100_000);
    expect(() => validateBatchSimulationCount(1)).not.toThrow();
    expect(() => validateBatchSimulationCount(100_000)).not.toThrow();
    for (const invalid of [0, 1.5, 100_001]) {
      expect(() => validateBatchSimulationCount(invalid)).toThrow();
    }
  });

  it("derives distinct deterministic seeds including uint32 wraparound", () => {
    expect([0, 1, 2].map((index) => deriveBatchSeed(123, index)))
      .toEqual([123, 124, 125]);
    expect([0, 1, 2].map((index) => deriveBatchSeed(0xffff_ffff, index)))
      .toEqual([0xffff_ffff, 0, 1]);
  });

  it("keeps fixed-seed batches reproducible and retains aggregates only", () => {
    const input = oneRoundMarksmanInput();
    const first = runBatchSimulation(input, 25);
    const second = runBatchSimulation(input, 25);
    expect(second).toEqual(first);
    expect(first.firstSeed).toBe(input.randomSeed);
    expect(first.lastSeed).toBe(input.randomSeed + 24);
    expect(first.outcomes.A + first.outcomes.B + first.outcomes.draw + first.outcomes.timeout)
      .toBe(25);
    expect("trace" in first).toBe(false);
    expect("rounds" in first).toBe(false);
    expect(first.distributions.roundCount.mean).toBe(first.averageRounds);
  });

  it("uses final-state survivors for expectations and preserves the troop-total identity", () => {
    const input = mirrored240Input();
    const single = runValidationBattleCore(input);
    const oneTrial = runBatchSimulation(input, 1);
    for (const side of ["A", "B"] as const) {
      const expected = oneTrial.expectedRemaining[side];
      const distributions = oneTrial.distributions.sides[side];
      expect(expected.shield).toBe(single.summary.remaining[side].shield);
      expect(expected.lancer).toBe(single.summary.remaining[side].lancer);
      expect(expected.marksman).toBe(single.summary.remaining[side].marksman);
      expect(expected.total).toBe(
        expected.shield + expected.lancer + expected.marksman,
      );
      expect(expected.total + oneTrial.expectedExitedTotal[side]).toBe(240);
      for (const troop of ["shield", "lancer", "marksman"] as const) {
        expect(distributions.remaining[troop].p50).toBe(single.summary.remaining[side][troop]);
        expect(distributions.exited[troop].p50 + distributions.remaining[troop].p50).toBe(80);
      }
      expect(distributions.remaining.total.p50 + distributions.exited.total.p50).toBe(240);
    }

    const batch = runBatchSimulation(input, 50);
    for (const side of ["A", "B"] as const) {
      const expected = batch.expectedRemaining[side];
      expect(expected.total).toBe(
        expected.shield + expected.lancer + expected.marksman,
      );
      expect(expected.total + batch.expectedExitedTotal[side]).toBeCloseTo(240, 12);
      expect(batch.distributions.sides[side].remaining.total.mean).toBeCloseTo(expected.total, 12);
      expect(batch.distributions.sides[side].exited.total.mean).toBeCloseTo(batch.expectedExitedTotal[side], 12);
    }
    expect(batch.distributions.roundCount.mean).toBe(batch.averageRounds);
  });

  it("keeps asymmetric A/B and troop slots aligned with single-battle final states", () => {
    const base = createDefaultValidationInput();
    const input: ValidationBattleInput = {
      ...base, maxRounds: 1, randomSeed: 73_005,
      sideA: withCounts(base.sideA, { shield: 100, lancer: 0, marksman: 0 }),
      sideB: withCounts(base.sideB, { shield: 0, lancer: 50, marksman: 25 }),
    };
    const single = runValidationBattleCore(input);
    const batch = runBatchSimulation(input, 1);
    for (const [side, initial] of [["A", 100], ["B", 75]] as const) {
      const distribution = batch.distributions.sides[side];
      for (const troop of ["shield", "lancer", "marksman"] as const) {
        const remaining = single.summary.remaining[side][troop];
        expect(distribution.remaining[troop].p05).toBe(remaining);
        expect(distribution.remaining[troop].p50).toBe(remaining);
        expect(distribution.remaining[troop].p95).toBe(remaining);
      }
      expect(distribution.remaining.total.p50 + distribution.exited.total.p50).toBe(initial);
    }
    expect(batch.distributions.roundCount.p50).toBe(single.summary.rounds);
  });

  it("uses a fresh injected base seed in random mode and a distinct seed per trial", () => {
    const input = { ...oneRoundMarksmanInput(), simulationMode: "random" as const };
    const result = runBatchSimulation(input, 4, () => 987_654);
    expect(result.simulationMode).toBe("random");
    expect(result.firstSeed).toBe(987_654);
    expect(result.lastSeed).toBe(987_657);
  });

  it("measures Rapid Fire near its theoretical 10% without recursive checks", () => {
    const result = runBatchSimulation(oneRoundMarksmanInput(), 10_000);
    const rapidFire = result.skillStatistics.filter(
      (skill) => skill.skillId === "marksman-rapid-fire",
    );
    expect(rapidFire).toHaveLength(2);
    const checks = rapidFire.reduce(
      (sum, skill) => sum + skill.probabilityCheckCount,
      0,
    );
    const successes = rapidFire.reduce(
      (sum, skill) => sum + skill.procSuccessCount,
      0,
    );
    expect(checks).toBe(20_000);
    expect(successes / checks).toBeGreaterThan(.085);
    expect(successes / checks).toBeLessThan(.115);
    for (const skill of rapidFire) {
      expect(skill.theoreticalProbability).toBeCloseTo(.1, 12);
    }
  }, 30_000);

  it("aggregates survivor expectations when only side A can use Rapid Fire", () => {
    const base = createDefaultValidationInput();
    const input: ValidationBattleInput = {
      ...base,
      maxRounds: 1,
      randomSeed: 48_121,
      sideA: withCounts(base.sideA, { shield: 0, lancer: 0, marksman: 240 }),
      sideB: withCounts(base.sideB, { shield: 240, lancer: 0, marksman: 0 }),
    };
    const result = runBatchSimulation(input, 200);
    const rapidFire = result.skillStatistics.filter(
      (skill) => skill.skillId === "marksman-rapid-fire",
    );
    expect(rapidFire).toHaveLength(1);
    expect(rapidFire[0]?.side).toBe("A");
    expect(rapidFire[0]?.probabilityCheckCount).toBe(200);
    for (const side of ["A", "B"] as const) {
      const expected = result.expectedRemaining[side];
      expect(expected.total).toBe(
        expected.shield + expected.lancer + expected.marksman,
      );
    }
  });

  it("aggregates direct skill casualties as secondary attribution without changing exits", () => {
    const base = createDefaultValidationInput();
    const input: ValidationBattleInput = {
      ...base,
      maxRounds: 1,
      triggerOverrides: { "A:lancer:lancer-crystal-spear": "FORCE_TRIGGER" },
      sideA: withCounts(base.sideA, { shield: 0, lancer: 100, marksman: 0 }),
      sideB: {
        ...withCounts(base.sideB, { shield: 100, lancer: 0, marksman: 0 }),
        troops: {
          ...base.sideB.troops,
          shield: { ...base.sideB.troops.shield, count: 100, defense: 0, life: 0 },
          lancer: { ...base.sideB.troops.lancer, count: 0 },
          marksman: { ...base.sideB.troops.marksman, count: 0 },
        },
      },
    };
    const batch = runBatchSimulation(input, 3);
    const attributed = batch.meanSkillCasualties.A["lancer-crystal-spear"] ?? 0;
    expect(attributed).toBeGreaterThan(0);
    expect(attributed).toBeLessThanOrEqual(batch.expectedExitedTotal.B);
    expect(batch.expectedRemaining.B.total + batch.expectedExitedTotal.B).toBe(100);
    expect(batch.meanSkillCasualties.A["lancer-charge"]).toBeUndefined();
  });

  it("resets every stored probability override to AUTO without a skill allow-list", () => {
    const reset = resetAllProbabilityOverrides({
      "A:marksman:marksman-rapid-fire": "FORCE_TRIGGER",
      "B:shield:shield-crystal-shield": "FORCE_NOT_TRIGGER",
      "A:future-probability-skill": "FORCE_TRIGGER",
    });
    expect(reset).toEqual({});
  });

  it("keeps debug expansion state independent from probability override changes", () => {
    const expanded = createExpandedSections();
    rememberExpandedSection(expanded, "advanced-debug", true);
    rememberExpandedSection(expanded, "probability-A", false);
    const before = [...expanded].sort();

    resetAllProbabilityOverrides({
      "A:marksman:marksman-rapid-fire": "FORCE_TRIGGER",
      "B:lancer:lancer-ambush": "FORCE_NOT_TRIGGER",
    });

    expect([...expanded].sort()).toEqual(before);
    expect(expanded.has("advanced-debug")).toBe(true);
    expect(expanded.has("probability-A")).toBe(false);
    expect(expanded.has("probability-B")).toBe(true);
  });

  it("wires the batch count, run action, and aggregate-only result panel into the UI", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('data-scope="batch-count"');
    expect(source).toContain('data-action="run-batch"');
    expect(source).toContain('data-action="auto-random"');
    expect(source).toContain('data-expanded-section="advanced-debug"');
    expect(source).toContain("expectedRemaining");
    expect(source).not.toContain("expectedExitedTotal");
    expect(source).toContain("renderBatchSkillDamageStatistics(value)");
    expect(source).toContain("90%模拟区间");
    expect(source).not.toContain("90%置信区间");
    expect(source).toContain("批量统计");
    expect(source).toContain("仅保存聚合结果，不保留批量 Trace");
  });
});

function oneRoundMarksmanInput(): ValidationBattleInput {
  const input = createDefaultValidationInput();
  return {
    ...input,
    maxRounds: 1,
    randomSeed: 12_345,
    simulationMode: "fixedSeed",
    sideA: marksmanOnly(input.sideA),
    sideB: marksmanOnly(input.sideB),
  };
}

function marksmanOnly(side: ValidationSideInput): ValidationSideInput {
  const counts: Readonly<Record<TroopType, number>> = {
    shield: 0,
    lancer: 0,
    marksman: 100_000,
  };
  return {
    ...side,
    troops: Object.fromEntries(
      (["shield", "lancer", "marksman"] as const).map((troop) => [
        troop,
        { ...side.troops[troop], count: counts[troop] },
      ]),
    ) as ValidationSideInput["troops"],
  };
}

function mirrored240Input(): ValidationBattleInput {
  const input = createDefaultValidationInput();
  const counts = { shield: 80, lancer: 80, marksman: 80 } as const;
  return {
    ...input,
    maxRounds: 5,
    randomSeed: 99_240,
    sideA: withCounts(input.sideA, counts),
    sideB: withCounts(input.sideB, counts),
  };
}

function withCounts(
  side: ValidationSideInput,
  counts: Readonly<Record<TroopType, number>>,
): ValidationSideInput {
  return {
    ...side,
    troops: Object.fromEntries(
      (["shield", "lancer", "marksman"] as const).map((troop) => [
        troop,
        { ...side.troops[troop], count: counts[troop] },
      ]),
    ) as ValidationSideInput["troops"],
  };
}
