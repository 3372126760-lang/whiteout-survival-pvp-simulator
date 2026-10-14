import { describe, expect, it } from "vitest";
import {
  createActiveEffect, createBattleState, createHeroSkillSystem,
  createHeroStateFromDefinitions, HENDRIK_HEIR_OF_FOREST, NORAH_CATCH_OFF_GUARD,
  resolveRound, TROOP_TYPES, type ActiveEffect, type BattleState,
  type HeroSkillDefinition, type TroopType,
} from "../../pvp";
import { createExpectationProgram } from "../optimizer/theory/expectationProgram";
import { defaultTheoryOptions } from "../optimizer/theory/types";
import { makeDamageEffect, makeSide } from "./helpers";

function battle(enemyCounts = [1000, 1000, 1000], skill = NORAH_CATCH_OFF_GUARD as HeroSkillDefinition) {
  const source = skill === HENDRIK_HEIR_OF_FOREST ? "marksman" : "lancer";
  return createBattleState({
    sideA: { ...makeSide({ [source]: 1000 }), heroStates: [
      createHeroStateFromDefinitions({ heroId: skill.heroId, position: "leader" }, [skill]),
    ] },
    sideB: makeSide(Object.fromEntries(TROOP_TYPES.map((troop, i) => [troop, enemyCounts[i]!]))),
  });
}

function theory(state: BattleState, round = 1) {
  const program = createExpectationProgram(state, defaultTheoryOptions(), new Set());
  const counts = [state.sideA, state.sideB].map((side) => TROOP_TYPES.map((troop) => side.troops[troop].aliveCount));
  const result = program.runRound(round, counts, Math.sqrt(state.fixedInitialMinTroops), program.createRuntime());
  return { program, result };
}

function withoutHero(state: BattleState): BattleState {
  return { ...state, sideA: { ...state.sideA, heroStates: [] } };
}

function extraDamage(state: BattleState, round = 1) {
  const withSkill = theory(state, round).result.damage[1]!;
  const normal = theory(withoutHero(state), round).result.damage[1]!;
  return withSkill.map((damage, i) => damage - normal[i]!);
}

function formal(state: BattleState, skill = NORAH_CATCH_OFF_GUARD as HeroSkillDefinition) {
  return resolveRound(state, { heroSkillSystem: createHeroSkillSystem({
    definitions: [skill], randomSource: { next: () => 0 },
  }) }).trace.damageEvents.filter((event) => event.sourceSide === "A" && event.sourceSkillId === skill.id);
}

function expectDamage(actual: readonly number[], expected: readonly number[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, value] of expected.entries()) {
    if (value === 0) expect(actual[index]).toBe(0);
    else expect(actual[index]).toBeCloseTo(value, 10);
  }
}

describe("A1 Theory all-target extra damage", () => {
  it.each([
    { label: "three living targets", counts: [1000, 1000, 1000], expected: [600, 600, 600] },
    { label: "two living targets", counts: [1000, 0, 1000], expected: [600, 0, 600] },
    { label: "one living target", counts: [0, 1000, 0], expected: [0, 600, 0] },
  ])("propagates Nora's extra to $label exactly once", ({ counts, expected }) => {
    expectDamage(extraDamage(battle(counts)), expected);
  });

  it("resolves each target's defense, skill reduction, vulnerability and scoped increase separately", () => {
    const initial = battle();
    const targetEffects = TROOP_TYPES.flatMap((troop, i): ActiveEffect[] => [
      makeDamageEffect({ id: `reduction-${troop}`, kind: "damageReduction",
        group: "receivedSkillDamageReduction", value: [.25, .5, .75][i]!,
        scope: { sourceTroops: ["lancer"], targetTroops: [troop], damageTypes: ["skillDamage"] } }),
      createActiveEffect({ identity: { sourceId: `source:B:${troop}`, sourceSkillId: "test-vulnerability", effectId: troop },
        definition: { id: `vulnerable-${troop}`, name: troop, kind: "incomingDamageIncrease",
          group: "vulnerability", value: [.1, .2, .3][i]!, ruleStatus: "supported",
          scope: { sourceTroops: ["lancer"], targetTroops: [troop], damageTypes: ["skillDamage"] } }, appliedRound: 1 }),
    ]);
    const state: BattleState = { ...initial,
      sideA: { ...initial.sideA, armyEffects: [
        makeDamageEffect({ id: "normal-only", kind: "damageIncrease", group: "normalAttackDamageIncrease", value: .9,
          scope: { damageTypes: ["normalAttack"] } }),
        makeDamageEffect({ id: "skill-to-marksman", kind: "damageIncrease", group: "skillDamageIncrease", value: .5,
          scope: { sourceTroops: ["lancer"], targetTroops: ["marksman"], damageTypes: ["skillDamage"] } }),
      ] },
      sideB: { ...initial.sideB, armyEffects: targetEffects,
        troops: { ...initial.sideB.troops,
          lancer: { ...initial.sideB.troops.lancer, defense: 1 },
          marksman: { ...initial.sideB.troops.marksman, defense: 2 },
        } },
    };
    const expected = [600 * 1.1 / 1.25, 600 * 1.2 / (2 * 1.5), 600 * 1.3 * 1.5 / (3 * 1.75)];
    const actual = extraDamage(state);
    for (const [i, damage] of actual.entries()) expect(damage).toBeCloseTo(expected[i]!, 10);
    expect(new Set(actual).size).toBe(3);
    for (const event of formal(state)) {
      const index = TROOP_TYPES.indexOf(event.targetTroop);
      expect(actual[index]).toBeCloseTo(.2 * event.modifiedDamage, 10);
    }
  });

  it("reports the implemented all-target mechanism without an omitted-mechanism marker", () => {
    expect(theory(battle()).program.omittedMechanisms).toEqual([]);
  });

  it("matches the formal engine's three-target direction under a fixed random source", () => {
    const state = battle();
    const events = formal(state);
    expect(events.map((event) => event.targetTroop)).toEqual(TROOP_TYPES);
    expect(events.map((event) => event.modifiedDamage)).toEqual([3000, 3000, 3000]);
    const extra = extraDamage(state);
    for (const event of events) expect(extra[TROOP_TYPES.indexOf(event.targetTroop)])
      .toBeCloseTo(.2 * event.modifiedDamage, 10);
    expectDamage(theory(state).result.damage[1]!, [3600, 600, 600]);
  });

  it("rebuilds cached round contributions when targets die without leaking earlier all-target damage", () => {
    const state = battle(), program = createExpectationProgram(state, defaultTheoryOptions(), new Set());
    const run = (enemy: number[]) => program.runRound(1, [[0, 1000, 0], enemy],
      Math.sqrt(1000), program.createRuntime()).damage[1];
    expectDamage(run([1000, 1000, 1000])!, [3600, 600, 600]);
    expectDamage(run([1000, 0, 1000])!, [3600, 0, 600]);
    expectDamage(run([0, 1000, 0])!, [0, 3600, 0]);
    expectDamage(run([1000, 1000, 1000])!, [3600, 600, 600]);
  });

  it("uses the selected main target's raw basis with target-specific scope when ambush branches split", () => {
    const initial = battle();
    const state: BattleState = { ...initial, sideA: { ...initial.sideA,
      troops: { ...initial.sideA.troops, lancer: { ...initial.sideA.troops.lancer,
        skillStates: [{ skillId: "lancer-ambush", level: 1, enabled: true, stacks: 0,
          remainingDuration: 0, cooldown: 0, lastTriggeredRound: null, triggerCount: 0 }] } },
      armyEffects: [createActiveEffect({ identity: { sourceId: "source:A:test", sourceSkillId: "test", effectId: "attack-vs-marksman" },
        definition: { id: "attack-vs-marksman", name: "attack", kind: "attributeModifier", attribute: "attack",
          operation: "multiplyAttributeFactor", group: "heroAttackBonus", value: 1, ruleStatus: "supported",
          scope: { targetTroops: ["marksman"] } }, appliedRound: 1 })],
    } };
    // Main raw B is 3000 (80%) or 6000 (20%); each all-target child uses its own mitigation.
    expectDamage(extraDamage(state), [720, 720, 720]);
  });

  it("retargets parentBaseDamage all-children using skill attributes and the parent's base multiplier", () => {
    const initial = battle([1000, 1000, 1000], HENDRIK_HEIR_OF_FOREST);
    const attribute = (troop: TroopType) => createActiveEffect({
      identity: { sourceId: "source:A:test", sourceSkillId: "test", effectId: `skill-attack-${troop}` },
      definition: { id: `skill-attack-${troop}`, name: "skill attack", kind: "attributeModifier", attribute: "attack",
        operation: "multiplyAttributeFactor", group: "heroAttackBonus", value: 1, ruleStatus: "supported",
        scope: { targetTroops: [troop], damageTypes: ["skillDamage"] } }, appliedRound: 1,
    });
    const state: BattleState = { ...initial, round: 3, sideA: { ...initial.sideA, armyEffects: [
      attribute("shield"), attribute("lancer"),
      createActiveEffect({ identity: { sourceId: "source:A:test", sourceSkillId: "test", effectId: "base" },
        definition: { id: "base", name: "base", kind: "baseDamageMultiplier", group: "testBase", value: .2,
          ruleStatus: "supported", scope: { targetTroops: ["shield"], damageTypes: ["normalAttack"] } }, appliedRound: 1 }),
    ] } };
    const actual = extraDamage(state, 3), events = formal(state, HENDRIK_HEIR_OF_FOREST);
    expect(events.map((event) => event.modifiedDamage)).toEqual([1920, 3840, 1920]);
    for (const event of events) expect(actual[TROOP_TYPES.indexOf(event.targetTroop)]).toBeCloseTo(event.modifiedDamage, 10);
  });
});
