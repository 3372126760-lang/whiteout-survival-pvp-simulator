import { describe, expect, it } from "vitest";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, GREG_LAW_DETERRENCE as law, RUFUS_VIOLENT_BLAST as blast,
  createActiveEffect, createBattleState, createConfirmedHeroFormation, createHeroSkillSystem,
  createSeededRandomSource, createTroopSkillSystem, CONFIRMED_TROOP_SKILL_DEFINITIONS,
  resolveRound, simulateBattle, type BattleState, type HeroSkillTriggerOverrides,
  type RandomSource, type TroopType } from "../../pvp";
import { makeSide } from "./helpers";
import { GREG, LAW, SWORD, GREG_LAW_SEED, gregLaw1500State } from "./fixtures/gregLaw1500";
import { createEffectSignature } from "../optimizer/criterion/signatures";
import { damageDependencyPolicy, createExpectationProgram } from "../optimizer/theory/expectationProgram";
import { defaultTheoryOptions } from "../optimizer/theory";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { defaultOptimizationConfig } from "../optimizer";
import { createJointCoefficientTable } from "../optimizer/jointPipeline/coefficients";
import { preprocessBodyCombinations, createBodySkillSignature } from "../optimizer/criterion/bodyPreprocess";
import { getHeroSkillUiSummary } from "../skillPresentation";

const DODGE = "hero-skill.lingnai.swift-shadow-dance";
function system(overrides: HeroSkillTriggerOverrides = {}, randomSource: RandomSource = { next: () => .99 }) {
  return createHeroSkillSystem({ definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    triggerOverrides: overrides, randomSource });
}
function battle(dodge = false): BattleState {
  return createBattleState({
    sideA: { ...makeSide({ shield: 100, lancer: 100 }, { maxHpPerUnit: 1e9 }),
      heroStates: createConfirmedHeroFormation([{ heroId: GREG, position: "leader" }]) },
    sideB: { ...makeSide({ shield: 100, marksman: 100 }, { maxHpPerUnit: 1e9 }),
      heroStates: dodge ? createConfirmedHeroFormation([{ heroId: "hero.s4.lingnai", position: "leader" }]) : [] },
  });
}
function main(trace: ReturnType<typeof resolveRound>["trace"], troop: TroopType) {
  return trace.damageEvents.find((e) => e.sourceSide === "B" && e.sourceTroop === troop &&
    e.damageType === "normalAttack" && e.parentEventId === undefined)!;
}
function pen(trace: ReturnType<typeof resolveRound>["trace"], troop: TroopType) {
  return main(trace, troop).attributeResolutions?.find((r) => r.attribute === "penetration");
}
describe("Greg Law Intimidation correction (Rufus template)", () => {
  it.each([1, 2, 3, 4, 5])("A–G: Lv%d uses only current-target penetration reduction", (level) => {
    expect(law).toMatchObject({ trigger: "beforeAttack", triggerTiming: "mainAttackAttempt", probability: .2 });
    expect(law.levelValues[level]!.effects).toEqual([{
      ...blast.levelValues[5]!.effects[0], id: "hero-effect.gelaige.law-deterrence",
      name: "hero-effect.gelaige.law-deterrence", value: level / 10,
    }]);
    expect(law.levelValues[level]!.effects[0]).toMatchObject({ kind: "attributeReduction",
      attribute: "penetration", group: "enemyPenetrationReduction", scope: { source: "army", target: "currentTarget", damageType: "all" },
      lifecycle: { durationRounds: 2, activationTiming: "immediate", refreshMode: "replace" } });
  });
  it("H/J: procs before evade and refreshes one state per target without stacking", () => {
    const heroSkillSystem = system({ [LAW]: true, [SWORD]: false, [DODGE]: true });
    const first = resolveRound(battle(true), { heroSkillSystem });
    expect(first.trace.damageEvents.find((e) => e.sourceSide === "A" && e.sourceTroop === "shield")!.mainHitCancelled).toBe(true);
    expect(pen(first.trace, "shield")?.divisionFactor).toBe(1.5);
    const second = resolveRound(first.stateAfter, { heroSkillSystem });
    const debuffs = second.stateAfter.sideB.troops.shield.debuffs.filter((e) => e.identity.sourceSkillId === LAW);
    expect(debuffs).toHaveLength(1);
    expect(debuffs[0]).toMatchObject({ appliedRound: 2, stackCount: 1 });
    expect(pen(second.trace, "shield")?.divisionFactor).toBe(1.5);
    expect(main(second.trace, "shield").reductionGroups.some((g) => g.group === "enemyOutgoingDamageReduction")).toBe(false);
  });
  it("I: stunned troops have neither an attempt nor a Law probability roll", () => {
    const state = battle();
    const stun = createActiveEffect({ identity: { sourceId: "test", sourceSkillId: "test", effectId: "stun" },
      definition: { id: "stun", name: "stun", kind: "skipNextRoundAction", ruleStatus: "supported",
        lifecycle: { activationTiming: "immediate", durationRounds: 1, refreshMode: "replace" } }, appliedRound: 1, holderScope: "shield" });
    const skipped = resolveRound({ ...state, sideA: { ...state.sideA, troops: { ...state.sideA.troops,
      shield: { ...state.sideA.troops.shield, debuffs: [stun] } } } }, { heroSkillSystem: system({ [LAW]: true }) });
    expect(skipped.trace.damageEvents.some((e) => e.sourceSide === "A" && e.sourceTroop === "shield")).toBe(false);
    expect(skipped.trace.heroSkills.filter((e) => e.skillId === LAW).map((e) => e.sourceTroop)).toEqual(["lancer"]);
  });
  it("K: switched current targets retain independent shield and marksman statuses", () => {
    const round = resolveRound(battle(), { heroSkillSystem: system({ [LAW]: true }), ambushTriggered: { A: true } });
    expect(round.trace.heroSkills.filter((e) => e.skillId === LAW && e.triggered).map((e) => e.targetTroop)).toEqual(["shield", "marksman"]);
    for (const target of ["shield", "marksman"] as const) expect(round.stateAfter.sideB.troops[target].debuffs
      .filter((e) => e.identity.sourceSkillId === LAW)).toHaveLength(1);
  });
  it("L: Sword and Law consume independent probability draws", () => {
    const values = [.1, .9, .1]; let index = 0;
    const round = resolveRound(battle(), { heroSkillSystem: system({}, { next: () => values[index++] ?? .99 }) });
    expect(round.trace.heroSkills.find((e) => e.skillId === SWORD)).toMatchObject({ triggered: true, rngRoll: .1 });
    expect(round.trace.heroSkills.filter((e) => e.skillId === LAW).map((e) => [e.triggered, e.rngRoll]))
      .toEqual([[false, .9], [true, .1]]);
    expect(index).toBe(3);
  });
  it("M/N: deterministic 1500 rounds hit only B shield, preserving 189/126 and lancer 178", () => {
    const run = simulateBattle(gregLaw1500State(), { maxRounds: 1500,
      troopSkillSystem: createTroopSkillSystem({ definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS }),
      heroSkillSystem: system({}, createSeededRandomSource(GREG_LAW_SEED)) });
    const rounds = run.trace.rounds;
    expect(rounds).toHaveLength(1500);
    expect(rounds.flatMap((r) => r.heroSkills).filter((e) => e.skillId === "hero-skill.jiatuo.kings-gift" && e.triggered)).toHaveLength(1500);
    const laws = rounds.flatMap((r) => r.heroSkills.filter((e) => e.skillId === LAW));
    expect(laws).toHaveLength(1500);
    expect(laws.every((e) => e.sourceTroop === "lancer" && e.targetTroop === "shield")).toBe(true);
    const procs = laws.filter((e) => e.triggered);
    // New reproducible synthetic input, not the report's 288/311 counts.
    expect(procs).toHaveLength(294);
    expect(rounds.flatMap((r) => r.heroSkills).filter((e) => e.skillId === SWORD && e.triggered)).toHaveLength(276);
    for (let i = 0; i < rounds.length; i++) {
      const active = i > 0 && laws[i - 1]!.triggered;
      expect(main(rounds[i]!, "shield").roundedDamage).toBe(active ? 126 : 189);
      expect(main(rounds[i]!, "lancer").roundedDamage).toBe(178);
      expect(pen(rounds[i]!, "lancer")?.divisionFactor ?? 1).toBe(1);
    }
    const affected = rounds.filter((r) => main(r, "shield").roundedDamage === 126).length;
    expect(affected).toBe(procs.length - (laws.at(-1)!.triggered ? 1 : 0));
    expect(affected).toBe(294);
    expect(rounds.reduce((sum, r) => sum + main(r, "shield").roundedDamage, 0)).toBe(264978);
  });
  it("separates penetration /1.70 from the wrong outgoing /1.80", () => {
    const state = battle();
    const permanent = createActiveEffect({ identity: { sourceId: "test", sourceSkillId: "test.pen20", effectId: "pen20" },
      definition: { id: "pen20", name: "known 20% penetration reduction", kind: "attributeReduction", attribute: "penetration",
        group: "enemyPenetrationReduction", value: .2, ruleStatus: "supported" }, appliedRound: 1 });
    const round = resolveRound({ ...state, sideB: { ...state.sideB, armyEffects: [permanent] } },
      { heroSkillSystem: system({ [LAW]: true, [SWORD]: false }) });
    expect(pen(round.trace, "shield")?.divisionFactor).toBe(1.7);
    expect(pen(round.trace, "shield")?.divisionFactor).not.toBe(1.8);
  });
  it("Criterion and Theory flag current-target correlation and inherit pre-dodge dependency", () => {
    const signature = createEffectSignature([{ skill: law, level: 5, runtimeId: GREG }], "greg");
    expect(signature.effects).toHaveLength(0);
    expect(signature.omittedMechanisms).toContain(`${LAW}:target-bound debuff`);
    const theory = createExpectationProgram(battle(), defaultTheoryOptions(), new Set());
    expect(theory.omittedMechanisms).toContain(`${LAW}:target-bound debuff correlation`);
    expect(damageDependencyPolicy(law)).toEqual(damageDependencyPolicy(blast));
    expect(damageDependencyPolicy(law)).toEqual({ affectedByDodge: false, affectedByStun: true, requiresMainHit: false });
    expect(theory.probabilityEquivalents.find((e) => e.skillId === LAW)?.mathematicalExpectation).toBe(.1);
    const feature = createBodySkillSignature(law);
    expect(feature.multiplierGroup).toBe("enemyPenetrationReduction");
    expect(getHeroSkillUiSummary(law)).toContain("20%概率当前目标穿透降低 50%");
  });
  it("J and extracted features combine Greg with a stable 20% penetration debuff in one group", () => {
    const base = createDefaultValidationInput();
    const stable = "hero-skill.lloyd.bird-harassment";
    const input = { ...base, scenarioType: "RALLY" as const, battleContext: "rally" as const,
      attributeInputMode: "prediction" as const,
      disabledSkillIds: [...CONFIRMED_HERO_SKILL_DEFINITIONS, ...CONFIRMED_TROOP_SKILL_DEFINITIONS]
        .filter((s) => s.id !== LAW && s.id !== stable).map((s) => s.id),
      sideA: { ...base.sideA, leaderHeroIds: { lancer: "hero.s11.lloyd", marksman: GREG }, selectedMemberSkillIds: [], bodySkills: [] },
      sideB: { ...base.sideB, leaderHeroIds: {}, selectedMemberSkillIds: [], bodySkills: [] } };
    const bodies = preprocessBodyCombinations([{ memberSkillIds: [] }], () => []).bodies;
    const table = createJointCoefficientTable(input, defaultOptimizationConfig(),
      [{ leaderHeroIds: input.sideA.leaderHeroIds, memberSkillIds: [] }], bodies);
    // The repeatable two-round debuff uses steady refresh coverage, not just
    // the first two rounds of the entire 40-round scoring window.
    // Both skills must compile into the SAME typed penetration group in all six survival lanes.
    expect(table.routes).toHaveLength(6);
    expect(table.routes.every((r) => r.key.includes("attributeReduction:enemyPenetrationReduction:penetration"))).toBe(true);
    expect(table.routes.every((r) => r.lane < 6 && !r.inverse)).toBe(true);
    const expected = .2 + .5 * (1 - .8 ** 2);
    for (const value of table.headValues) expect(value).toBeCloseTo(expected, 12);
  });
});
