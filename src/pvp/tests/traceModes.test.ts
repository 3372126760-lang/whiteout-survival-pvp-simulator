import { describe, expect, it } from "vitest";
import { compileValidationBattle, runBatchSimulation, runValidationBattleCore, type ValidationBattleInput } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

function scenario(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  return {
    ...base,
    maxRounds: 12,
    sideA: {
      ...base.sideA,
      troops: {
        ...base.sideA.troops,
        shield: { ...base.sideA.troops.shield, count: 10 },
        lancer: { ...base.sideA.troops.lancer, count: 1_000 },
        marksman: { ...base.sideA.troops.marksman, count: 0 },
      },
    },
    sideB: {
      ...base.sideB,
      troops: {
        ...base.sideB.troops,
        shield: { ...base.sideB.troops.shield, count: 10 },
        lancer: { ...base.sideB.troops.lancer, count: 1_000 },
        marksman: { ...base.sideB.troops.marksman, count: 0 },
      },
    },
  };
}

describe("battle trace modes", () => {
  it("preserves final outcomes and damage for full, summary and none with identical seeds", () => {
    const input = scenario();
    const compiled = compileValidationBattle(input);
    for (const seed of [0, 1, 12_345, 987_654]) {
      const full = runValidationBattleCore({ ...input, randomSeed: seed });
      const summary = compiled.runTrial(seed, "summary");
      const none = compiled.runTrial(seed, "none");
      for (const compact of [summary, none]) {
        expect(compact.finalState.sideA.troops).toEqual(full.simulation.finalState.sideA.troops);
        expect(compact.finalState.sideB.troops).toEqual(full.simulation.finalState.sideB.troops);
        expect(compact.roundCount).toBe(full.simulation.rounds.length);
        expect(compact.endReason).toBe(full.simulation.endReason);
        expect(compact.totalDamage.A).toBe(full.roundDamage.reduce((sum, round) => sum + round.AtoB, 0));
        expect(compact.totalDamage.B).toBe(full.roundDamage.reduce((sum, round) => sum + round.BtoA, 0));
        expect(compact.finalState.battleLog).toEqual([]);
        expect("trace" in compact).toBe(false);
        expect("rounds" in compact).toBe(false);
      }
    }
  });

  it("counts probability decisions directly without retaining detailed skill traces", () => {
    const base = scenario();
    const input: ValidationBattleInput = {
      ...base,
      sideA: {
        ...base.sideA,
        leaderHeroIds: { shield: null, lancer: "hero.s3.miya", marksman: null },
      },
      sideB: {
        ...base.sideB,
        leaderHeroIds: { shield: null, lancer: null, marksman: "hero.s2.alongsuo" },
      },
    };
    const full = runValidationBattleCore(input);
    const fromTrace = new Map<string, { checks: number; triggers: number }>();
    for (const round of full.simulation.trace.rounds) {
      for (const trace of [...round.troopSkills, ...round.heroSkills]) {
        if (trace.probability === null || !trace.eligible) continue;
        const key = `${trace.side}:${trace.skillId}`;
        const current = fromTrace.get(key) ?? { checks: 0, triggers: 0 };
        current.checks += 1;
        current.triggers += Number(trace.triggered);
        fromTrace.set(key, current);
      }
    }
    const direct = new Map<string, { checks: number; triggers: number }>();
    compileValidationBattle(input).runTrial(input.randomSeed, "summary", (decision) => {
      const key = `${decision.side}:${decision.skillId}`;
      const current = direct.get(key) ?? { checks: 0, triggers: 0 };
      current.checks += 1;
      current.triggers += Number(decision.triggered);
      direct.set(key, current);
    });
    expect(direct).toEqual(fromTrace);
    const batch = runBatchSimulation(input, 1);
    for (const skill of batch.skillStatistics) {
      const expected = fromTrace.get(`${skill.side}:${skill.skillId}`) ?? { checks: 0, triggers: 0 };
      expect(skill.probabilityCheckCount).toBe(expected.checks);
      expect(skill.procSuccessCount).toBe(expected.triggers);
    }
  });
});
