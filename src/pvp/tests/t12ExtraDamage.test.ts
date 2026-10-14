import { describe, expect, it } from "vitest";
import {
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  LANCER_RADIANT_FORMATION,
  MARKSMAN_BLAZING_STAR,
  SHIELD_IMMORTAL_WALL,
  createBattleState,
  createConfirmedTroopSkillLoadout,
  createSequenceRandomSource,
  createTroopSkillSystem,
  resolveRound,
  simulateBattle,
  type BattleSideSetup,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const hugeHp = 1_000_000_000;

describe("T12 troop skill classification", () => {
  it("17. makes lancer T12 marksman bonus a scoped damage increase", () => {
    const result = resolveRound(createBattleState({
      sideA: t12Side("lancer", { lancer: 100, marksman: 100 }),
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
    }), { troopSkillSystem: system() });
    const primary = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.sourceTroop === "marksman" &&
      event.damageSubtype === "normalAttack"
    )!;
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === LANCER_RADIANT_FORMATION.id
    );
    expect(extra).toBeUndefined();
    expect(primary.increaseGroups.find((group) =>
      group.group === "commonDamageIncrease"
    )?.summedValue).toBeCloseTo(.24);
  });

  it("resolves both lancer T12 effects in rounds 1-5 and ends both in round 6", () => {
    const owner = t12Side("lancer", { shield: 100, lancer: 100, marksman: 100 });
    const result = simulateBattle(createBattleState({
      sideA: owner,
      sideB: makeSide({ marksman: 100 }, { maxHpPerUnit: hugeHp }),
    }), { maxRounds: 6, troopSkillSystem: system() });
    expect(result.trace.rounds).toHaveLength(6);
    for (const [index, round] of result.trace.rounds.entries()) {
      const incoming = round.damageEvents.find((event) =>
        event.sourceSide === "B" && event.targetTroop === "shield")!;
      const outgoing = round.damageEvents.find((event) =>
        event.sourceSide === "A" && event.sourceTroop === "marksman" &&
        event.damageSubtype === "normalAttack")!;
      const reduction = incoming.reductionGroups.find((group) =>
        group.group === "receivedDamageReduction");
      const increase = outgoing.increaseGroups.find((group) =>
        group.group === "commonDamageIncrease");
      if (index < 5) {
        expect(reduction?.multiplier).toBeCloseTo(1.24);
        expect(incoming.modifiedDamage).toBeCloseTo(incoming.rawDamage / 1.24);
        expect(increase?.summedValue).toBeCloseTo(.24);
      } else {
        expect(reduction).toBeUndefined();
        expect(increase).toBeUndefined();
      }
    }
  });

  it("18. makes marksman T12 a permanent ordinary damage-increase stack", () => {
    expect(MARKSMAN_BLAZING_STAR.metadata.ruleStatus).toBe("supported");
    const simulation = simulateBattle(createBattleState({
      sideA: t12Side("marksman", { marksman: 100 }),
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
    }), { maxRounds: 16, troopSkillSystem: system() });
    const extraCounts = simulation.trace.rounds.map((round) =>
      round.damageEvents.filter((event) =>
        event.sourceSkillId === MARKSMAN_BLAZING_STAR.id
      ).length
    );
    expect(extraCounts).toEqual(Array(16).fill(0));
    expect(simulation.trace.rounds.map((round) => round.troopSkills.find((entry) =>
      entry.skillId === MARKSMAN_BLAZING_STAR.id)?.currentStacks)).toEqual([
      0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3,
    ]);
    for (const [index, round] of simulation.trace.rounds.entries()) {
      const normal = round.damageEvents.find((event) => event.sourceSide === "A" && event.damageSubtype === "normalAttack")!;
      const expected = Math.floor(index / 5) * 0.12;
      expect(normal.increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue ?? 0)
        .toBeCloseTo(expected);
    }
  });

  it("19. keeps shield T12 as enemyOutgoingDamageReduction", () => {
    const effect = SHIELD_IMMORTAL_WALL.levelValues[24]?.effects[0];
    expect(effect).toMatchObject({
      kind: "damageReduction", group: "enemyOutgoingDamageReduction",
    });
    expect(effect?.kind === "damageReduction" ? effect.value : 0).toBeCloseTo(.144);
  });

  it("20. combines Flame Impact base B and T12 ordinary damage increase", () => {
    const simulation = simulateBattle(createBattleState({
      sideA: t12Side("marksman", { marksman: 100 }),
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
    }), { maxRounds: 6, troopSkillSystem: system() });
    const roundSix = simulation.trace.rounds[5]!;
    const primary = roundSix.damageEvents.find((event) =>
      event.sourceSide === "A" && event.damageSubtype === "normalAttack"
    )!;
    expect(primary.baseDamageFormula?.baseDamageMultiplier).toBeCloseTo(1.06);
    expect(primary.increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue).toBeCloseTo(.12);
  });
});

function t12Side(
  skillOwner: TroopType,
  counts: Partial<Record<TroopType, number>>,
): BattleSideSetup {
  const side = makeSide(counts, { maxHpPerUnit: hugeHp });
  const troopLevel = "T12-FC10";
  return {
    ...side,
    troops: {
      ...side.troops,
      [skillOwner]: {
        ...side.troops[skillOwner],
        troopLevel,
        skillStates: createConfirmedTroopSkillLoadout(
          skillOwner,
          troopLevel,
          24,
        ),
      },
    },
  };
}

function system() {
  return createTroopSkillSystem({
    definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
    randomSource: createSequenceRandomSource([.99]),
  });
}
