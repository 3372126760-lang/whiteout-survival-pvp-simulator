import { describe, expect, it } from "vitest";
import {
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
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

const HIGH_HP = 1_000_000_000_000;

function sideWithSkill(troop: TroopType, level: string, t12Level = 0): BattleSideSetup {
  const side = makeSide({ [troop]: 100 }, { maxHpPerUnit: HIGH_HP });
  return {
    ...side,
    troops: {
      ...side.troops,
      [troop]: {
        ...side.troops[troop],
        troopLevel: level,
        skillStates: createConfirmedTroopSkillLoadout(troop, level, t12Level),
      },
    },
  };
}

function skillSystem(overrides: Readonly<Record<string, boolean>>) {
  return createTroopSkillSystem({
    definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
    triggerOverrides: overrides,
  });
}

describe("final confirmed troop event rules", () => {
  it.each([
    ["T10-FC2", null, null],
    ["T10-FC3", 1, null],
    ["T10-FC5", 2, null],
    ["T10-FC8", 2, 1],
    ["T10-FC10", 2, 2],
  ] as const)("derives only legal fire-crystal levels for %s", (level, first, second) => {
    for (const [troop, firstId, secondId] of [
      ["shield", "shield-crystal-shield", "shield-lightforged-body"],
      ["lancer", "lancer-crystal-spear", "lancer-crimson-field"],
      ["marksman", "marksman-crystal-powder", "marksman-flame-impact"],
    ] as const) {
      const loadout = createConfirmedTroopSkillLoadout(troop, level);
      expect(loadout.find((entry) => entry.skillId === firstId)?.level ?? null).toBe(first);
      expect(loadout.find((entry) => entry.skillId === secondId)?.level ?? null).toBe(second);
    }
  });

  it("checks Crimson Field per independent event but not rapid-fire's internal segment", () => {
    const result = resolveRound(createBattleState({
      sideA: sideWithSkill("marksman", "T10-FC10"),
      sideB: sideWithSkill("lancer", "T10-FC10"),
    }), { troopSkillSystem: skillSystem({
      "A:marksman-rapid-fire": true,
      "A:marksman-crystal-powder": true,
      "B:lancer-crimson-field": true,
      "B:lancer-ambush": false,
      "B:lancer-crystal-spear": false,
    }) });
    const incoming = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    const checks = result.trace.troopSkills.filter((entry) =>
      entry.side === "B" && entry.skillId === "lancer-crimson-field");
    expect(incoming).toHaveLength(2);
    expect(incoming[0]?.internalSegments).toHaveLength(1);
    expect(incoming[1]?.damageSubtype).toBe("extraDamage");
    expect(checks).toHaveLength(2);
    expect(checks.map((entry) => entry.parentEventId)).toEqual(incoming.map((event) => event.id));
    expect(incoming.map((event) => event.receivedDamageReductionDenominator)).toEqual([1.5, 1.5]);
  });

  it("sets Crimson Field probability to FC8 10% and FC10 15%", () => {
    const definition = CONFIRMED_TROOP_SKILL_DEFINITIONS.find((entry) => entry.id === "lancer-crimson-field")!;
    expect(definition.levelValues[1]?.probability).toBe(0.1);
    expect(definition.levelValues[2]?.probability).toBe(0.15);
    expect(definition.levelValues[2]?.effects[0]).toMatchObject({
      kind: "damageReduction", group: "receivedDamageReduction", value: 0.5,
      scope: { damageType: "all" },
    });
  });

  it("records a separate Crimson Field RNG roll for normal and powder events", () => {
    const result = resolveRound(createBattleState({
      sideA: sideWithSkill("marksman", "T10-FC8"),
      sideB: sideWithSkill("lancer", "T10-FC8"),
    }), { troopSkillSystem: createTroopSkillSystem({
      definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
      randomSource: createSequenceRandomSource([0.05, 0.5]),
      triggerOverrides: {
        "A:marksman-rapid-fire": false,
        "A:marksman-crystal-powder": true,
        "B:lancer-ambush": false,
        "B:lancer-crystal-spear": false,
      },
    }) });
    const checks = result.trace.troopSkills.filter((entry) =>
      entry.side === "B" && entry.skillId === "lancer-crimson-field");
    expect(checks.map((entry) => entry.rngRoll)).toEqual([0.05, 0.5]);
    expect(checks.map((entry) => entry.triggered)).toEqual([true, false]);
    expect(result.trace.damageEvents.filter((event) => event.sourceSide === "A")
      .map((event) => event.receivedDamageReductionDenominator)).toEqual([1.5, 1]);
  });

  it("upgrades each independent Crystal Shield event check to 51% received reduction", () => {
    const result = resolveRound(createBattleState({
      sideA: sideWithSkill("marksman", "T10-FC10"),
      sideB: sideWithSkill("shield", "T10-FC10"),
    }), { troopSkillSystem: skillSystem({
      "A:marksman-rapid-fire": true,
      "A:marksman-crystal-powder": true,
      "B:shield-crystal-shield": true,
    }) });
    const incoming = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(incoming).toHaveLength(2);
    expect(result.trace.troopSkills.filter((entry) => entry.skillId === "shield-crystal-shield")).toHaveLength(2);
    for (const event of incoming) {
      expect(event.receivedDamageReductionDenominator).toBeCloseTo(1.51);
      expect(event.receivedDamageReductionSources).toEqual([
        expect.objectContaining({ effectId: "shield-crystal-shield-reduction", effectiveValue: 0.51 }),
      ]);
    }
  });

  it("keeps T12 marksman stacks and bonus in BattleTrace at L3", () => {
    const simulation = simulateBattle(createBattleState({
      sideA: sideWithSkill("marksman", "T12-FC10", 3),
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: HIGH_HP }),
    }), { maxRounds: 16, troopSkillSystem: skillSystem({
      "A:marksman-rapid-fire": true,
      "A:marksman-crystal-powder": true,
    }) });
    expect(simulation.trace.rounds).toHaveLength(16);
    for (const [index, round] of simulation.trace.rounds.entries()) {
      const stacks = Math.floor(index / 5);
      const bonus = stacks * 0.015;
      const skill = round.troopSkills.find((entry) => entry.skillId === "marksman-blazing-star-t12")!;
      expect(skill.currentStacks).toBe(stacks);
      expect(skill.currentBonus).toBeCloseTo(bonus);
      expect(skill.triggered).toBe([5, 10, 15].includes(index));
      const events = round.damageEvents.filter((event) => event.sourceSide === "A");
      expect(events).toHaveLength(2);
      for (const event of events) {
        expect(event.increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue ?? 0)
          .toBeCloseTo(bonus);
      }
      expect(events[0]?.internalSegments).toHaveLength(1);
    }
  });
});
