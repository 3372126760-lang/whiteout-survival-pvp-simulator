import { describe, expect, it } from "vitest";
import {
  REINA_SWIFT_SHADOW_DANCE,
  S7_HERO_SKILL_DEFINITIONS,
  createBattleState,
  createHeroSkillSystem,
  createHeroStateFromDefinitions,
  resolveRound,
  resolveTroopAttribute,
  simulateBattle,
  type BattleState,
  type HeroSkillRuntimeState,
  type HeroState,
  type TroopType,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

const HP = 1_000_000_000_000;
const POISON = "hero-skill.gedun.poisoned-blade";
const FEAR = "hero-skill.gedun.toxic-phobia";
const CLOUD = "hero-skill.gedun.poison-cloud";
const INSIGHT = "hero-skill.buladeli.battlefield-insight";
const DODGE = REINA_SWIFT_SHADOW_DANCE.id;
const definitions = [...S7_HERO_SKILL_DEFINITIONS, REINA_SWIFT_SHADOW_DANCE];

function hero(id: string, enabled: readonly string[], level = 5): HeroState {
  const created = createHeroStateFromDefinitions({ heroId: id, position: "leader" }, definitions);
  return { ...created, skillStates: created.skillStates.map((runtime) => ({
    ...runtime, enabled: enabled.includes(runtime.skillId), level,
  })) };
}

function battle(
  a: Partial<Record<TroopType, number>>,
  b: Partial<Record<TroopType, number>>,
  heroesA: readonly HeroState[],
  heroesB: readonly HeroState[] = [],
): BattleState {
  return createBattleState({
    sideA: { ...makeSide(a, { maxHpPerUnit: HP }), heroStates: heroesA },
    sideB: { ...makeSide(b, { maxHpPerUnit: HP }), heroStates: heroesB },
  });
}

function system(overrides: Record<string, boolean> = {}) {
  return createHeroSkillSystem({
    definitions, randomSource: { next: () => .99 }, triggerOverrides: overrides,
  });
}

function main(result: ReturnType<typeof resolveRound>, side: "A" | "B", troop: TroopType) {
  return result.trace.damageEvents.find((event) =>
    event.sourceSide === side && event.sourceTroop === troop &&
    event.damageType === "normalAttack")!;
}

function extras(result: ReturnType<typeof resolveRound>, skillId: string) {
  return result.trace.damageEvents.filter((event) => event.sourceSkillId === skillId);
}

function runtime(state: BattleState, skillId: string): HeroSkillRuntimeState {
  return state.sideA.heroStates[0]!.skillStates.find((skill) => skill.skillId === skillId)!;
}

describe("S7 confirmed battle-report rules", () => {
  it("Edith marksman reduction adds to ordinary received reduction", () => {
    const base = battle({ marksman: 100 }, { shield: 100 }, [hero("hero.s7.aidisi", ["hero-skill.aidisi.offense-and-defense"])]);
    const state = { ...base, sideA: { ...base.sideA, armyEffects: [makeDamageEffect({
      id: "other-received", kind: "damageReduction", group: "receivedDamageReduction", value: .25,
    })] } };
    const event = main(resolveRound(state, { heroSkillSystem: system() }), "B", "shield");
    expect(event.reductionGroups.find((group) => group.group === "receivedDamageReduction")?.multiplier).toBeCloseTo(1.45);
  });

  it("Edith shield reduction shares the same group", () => {
    const base = battle({ shield: 100 }, { shield: 100 }, [hero("hero.s7.aidisi", ["hero-skill.aidisi.iron-body"])]);
    const state = { ...base, sideA: { ...base.sideA, armyEffects: [makeDamageEffect({
      id: "other-received", kind: "damageReduction", group: "receivedDamageReduction", value: .25,
    })] } };
    const event = main(resolveRound(state, { heroSkillSystem: system() }), "B", "shield");
    expect(event.reductionGroups.find((group) => group.group === "receivedDamageReduction")?.multiplier).toBeCloseTo(1.45);
  });

  it("Edith's shield/marksman protections never spill onto lancer", () => {
    const result = resolveRound(battle({ shield: 100, lancer: 100, marksman: 100 }, { shield: 100 },
      [hero("hero.s7.aidisi", ["hero-skill.aidisi.iron-body", "hero-skill.aidisi.offense-and-defense"])]),
    { heroSkillSystem: system() });
    expect(result.snapshot.sideA.armyEffects.filter((effect) =>
      effect.definition.kind === "damageReduction" && effect.definition.group === "receivedDamageReduction")
      .map((effect) => effect.definition.scope?.targetTroops)).toEqual([["marksman"], ["shield"]]);
    expect(result.snapshot.sideA.armyEffects.some((effect) =>
      effect.definition.kind === "damageReduction" && effect.definition.scope?.targetTroops?.includes("lancer"))).toBe(false);
  });

  it("Edith lancer +20% applies to normal and independent skill damage", () => {
    const result = resolveRound(battle({ lancer: 100 }, { shield: 100 }, [
      hero("hero.s7.aidisi", ["hero-skill.aidisi.offense-and-defense"]),
      hero("hero.s7.gedun", [POISON]),
    ]), { heroSkillSystem: system() });
    const r2 = resolveRound(result.stateAfter, { heroSkillSystem: system() });
    expect(main(r2, "A", "lancer").increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue).toBe(.2);
    expect(extras(r2, POISON)[0]!.increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue).toBe(.2);
  });

  it("Edith life +25% multiplies the panel life factor without altering its input", () => {
    const side = makeSide({ shield: 100 }, { maxHpPerUnit: 1000 });
    const state = createBattleState({ sideA: { ...side, troops: { ...side.troops,
      shield: { ...side.troops.shield, life: 2 },
    }, heroStates: [hero("hero.s7.aidisi", ["hero-skill.aidisi.steel-armor"])] },
    sideB: makeSide({ shield: 100 }, { maxHpPerUnit: HP }) });
    const result = resolveRound(state, { heroSkillSystem: system() });
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1000 * 3 * 1.25);
    expect(result.snapshot.sideA.troops.shield.life).toBe(2);
  });

  it("Gordon counts successful lancer mains, not attempts dodged by Reina", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s7.gedun", [POISON])],
      [hero("hero.s4.lingnai", [DODGE])]);
    const options = { heroSkillSystem: system({ [`2:B:${DODGE}`]: true }) };
    state = resolveRound(state, options).stateAfter;
    const r2 = resolveRound(state, options);
    expect(main(r2, "A", "lancer").mainHitCancelled).toBe(true);
    expect(extras(r2, POISON)).toHaveLength(0);
    expect(runtime(r2.stateAfter, POISON).mainAttackCounts.lancer).toBe(1);
    const r3 = resolveRound(r2.stateAfter, options);
    expect(runtime(r3.stateAfter, POISON).mainAttackCounts.lancer).toBe(2);
    expect(extras(r3, POISON)).toHaveLength(1);
  });

  it("Gordon Lv1/Lv5 extra is .2B/1B skillDamage", () => {
    for (const [level, coefficient] of [[1, .2], [5, 1]] as const) {
      let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s7.gedun", [POISON], level)]);
      const options = { heroSkillSystem: system() };
      state = resolveRound(state, options).stateAfter;
      const r2 = resolveRound(state, options);
      expect(extras(r2, POISON)[0]).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage" });
      expect(extras(r2, POISON)[0]!.baseDamage).toBeCloseTo(main(r2, "A", "lancer").rawDamage * coefficient);
    }
  });

  it("Gordon poison starts R3 on the hit target only, then expires R4", () => {
    let state = battle({ lancer: 100 }, { shield: 100, lancer: 100, marksman: 100 }, [hero("hero.s7.gedun", [POISON])]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(state, options).stateAfter;
    const r2 = resolveRound(state, options);
    expect(main(r2, "B", "shield").reductionGroups.some((group) => group.group === "poisonOutgoingDamageReduction")).toBe(false);
    const r3 = resolveRound(r2.stateAfter, options);
    expect(main(r3, "B", "shield").reductionGroups.find((group) => group.group === "poisonOutgoingDamageReduction")?.summedValue).toBe(.2);
    for (const troop of ["lancer", "marksman"] as const) {
      expect(main(r3, "B", troop).reductionGroups.some((group) => group.group === "poisonOutgoingDamageReduction")).toBe(false);
    }
    const r4 = resolveRound(r3.stateAfter, options);
    expect(main(r4, "B", "shield").reductionGroups.some((group) => group.group === "poisonOutgoingDamageReduction")).toBe(false);
  });

  it("Gordon's no-dodge 1500-round report yields 750 poison, 500 fear, 375 cloud", () => {
    const result = simulateBattle(battle({ lancer: 10 }, { shield: 10 },
      [hero("hero.s7.gedun", [POISON, FEAR, CLOUD])]),
    { heroSkillSystem: system(), maxRounds: 1500, traceMode: "summary" });
    expect(result.roundCount).toBe(1500);
    expect(runtime(result.finalState, POISON).triggerCount).toBe(750);
    expect(runtime(result.finalState, FEAR).triggerCount).toBe(500);
    expect(runtime(result.finalState, CLOUD).triggerCount).toBe(375);
  });

  it("Gordon and Reina report: 132 dodges leave 1368 successes, 684 poison, 500 fear, 375 cloud", () => {
    let dodgeChecks = 0;
    const heroSkillSystem = createHeroSkillSystem({
      definitions,
      randomSource: { next: () => ++dodgeChecks <= 132 ? 0 : .99 },
    });
    const result = simulateBattle(battle({ lancer: 10 }, { shield: 10 },
      [hero("hero.s7.gedun", [POISON, FEAR, CLOUD])],
      [hero("hero.s4.lingnai", [DODGE])]),
    { heroSkillSystem, maxRounds: 1500, traceMode: "summary" });
    expect(dodgeChecks).toBe(1500);
    expect(runtime(result.finalState, POISON).mainAttackCounts.lancer).toBe(1368);
    expect(runtime(result.finalState, POISON).triggerCount).toBe(684);
    expect(runtime(result.finalState, FEAR).triggerCount).toBe(500);
    expect(runtime(result.finalState, CLOUD).triggerCount).toBe(375);
  });

  it("Gordon fear is active only R3/R6/R9 and boosts all lancer damage", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s7.gedun", [FEAR, POISON])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 9; round += 1) {
      const result = resolveRound(state, options);
      const due = round % 3 === 0;
      const mainBonus = main(result, "A", "lancer").increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue;
      expect(mainBonus ?? 0).toBe(due ? 1.5 : 0);
      const extra = extras(result, POISON)[0];
      if (extra !== undefined) expect(extra.increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue ?? 0).toBe(due ? 1.5 : 0);
      state = result.stateAfter;
    }
  });

  it("Gordon cloud occupies R4/R5 and R8/R9, not the intervening rounds", () => {
    let state = battle({ shield: 100, lancer: 100 }, { shield: 100, marksman: 100 },
      [hero("hero.s7.gedun", [CLOUD])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 9; round += 1) {
      const result = resolveRound(state, options);
      const expected = [4, 5, 8, 9].includes(round) ? .3 : 0;
      expect(main(result, "A", "shield").increaseGroups.find((group) => group.group === "vulnerability")?.summedValue ?? 0).toBe(expected);
      expect(main(result, "B", "marksman").reductionGroups.find((group) => group.group === "gordonMarksmanOutgoingReduction")?.summedValue ?? 0).toBe(expected);
      expect(main(result, "B", "shield").reductionGroups.some((group) => group.group === "gordonMarksmanOutgoingReduction")).toBe(false);
      state = result.stateAfter;
    }
  });

  it("Gordon fear and cloud coexist in R9", () => {
    let state = battle({ lancer: 100 }, { shield: 100, marksman: 100 }, [hero("hero.s7.gedun", [FEAR, CLOUD])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round < 9; round += 1) state = resolveRound(state, options).stateAfter;
    const r9 = resolveRound(state, options);
    expect(main(r9, "A", "lancer").increaseGroups.map((group) => group.group)).toEqual(expect.arrayContaining(["commonDamageIncrease", "vulnerability"]));
    expect(main(r9, "B", "marksman").reductionGroups.map((group) => group.group)).toEqual(expect.arrayContaining(["gordonPeriodicOutgoingReduction", "gordonMarksmanOutgoingReduction"]));
  });

  it("Gordon's explicitly confirmed Lv1 fear/cloud use 30%/6% and 6%/6%", () => {
    let state = battle({ shield: 100, lancer: 100 }, { shield: 100, marksman: 100 },
      [hero("hero.s7.gedun", [FEAR, CLOUD], 1)]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 2; round += 1) state = resolveRound(state, options).stateAfter;
    const r3 = resolveRound(state, options);
    expect(main(r3, "A", "lancer").increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue).toBe(.3);
    expect(main(r3, "B", "shield").reductionGroups.find((group) => group.group === "gordonPeriodicOutgoingReduction")?.summedValue).toBe(.06);
    const r4 = resolveRound(r3.stateAfter, options);
    expect(main(r4, "A", "shield").increaseGroups.find((group) => group.group === "vulnerability")?.summedValue).toBe(.06);
    expect(main(r4, "B", "marksman").reductionGroups.find((group) => group.group === "gordonMarksmanOutgoingReduction")?.summedValue).toBe(.06);
  });

  it("Bradley attack +25% multiplies the panel factor", () => {
    const side = makeSide({ shield: 100 }, { maxHpPerUnit: HP });
    const state = createBattleState({ sideA: { ...side, troops: { ...side.troops,
      shield: { ...side.troops.shield, attack: 1.5 },
    }, heroStates: [hero("hero.s7.buladeli", ["hero-skill.buladeli.veterans-pride"])] },
    sideB: makeSide({ shield: 100 }, { maxHpPerUnit: HP }) });
    const result = resolveRound(state, { heroSkillSystem: system() });
    const resolved = resolveTroopAttribute(result.snapshot.sideA, "shield", "attack", 1,
      { targetTroop: "shield", damageType: "normalAttack" });
    expect(1 + resolved.effectiveValue).toBeCloseTo(2.5 * 1.25);
    expect(result.snapshot.sideA.troops.shield.attack).toBe(1.5);
  });

  it("Bradley cannon is +25% vs shield, +30% vs lancer, zero vs marksman", () => {
    for (const [target, bonus] of [["shield", .25], ["lancer", .3], ["marksman", 0]] as const) {
      const result = resolveRound(battle({ shield: 100 }, { [target]: 100 },
        [hero("hero.s7.buladeli", ["hero-skill.buladeli.head-cannon"])]),
      { heroSkillSystem: system() });
      expect(main(result, "A", "shield").increaseGroups.find((group) => group.group === "troopVsTroopDamage")?.summedValue ?? 0).toBe(bonus);
    }
  });

  it("Bradley cannon applies to normal and extra skill damage", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [
      hero("hero.s7.buladeli", ["hero-skill.buladeli.head-cannon"]),
      hero("hero.s7.gedun", [POISON]),
    ]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(state, options).stateAfter;
    const r2 = resolveRound(state, options);
    expect(main(r2, "A", "lancer").increaseGroups.find((group) => group.group === "troopVsTroopDamage")?.summedValue).toBe(.25);
    expect(extras(r2, POISON)[0]!.increaseGroups.find((group) => group.group === "troopVsTroopDamage")?.summedValue).toBe(.25);
  });

  it("Bradley insight windows are R5/R6, R9/R10, R13/R14", () => {
    let state = battle({ shield: 100 }, { shield: 100 }, [hero("hero.s7.buladeli", [INSIGHT])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 14; round += 1) {
      const result = resolveRound(state, options);
      const expected = [5, 6, 9, 10, 13, 14].includes(round) ? .3 : 0;
      expect(main(result, "A", "shield").increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue ?? 0).toBe(expected);
      state = result.stateAfter;
    }
  });

  it("Bradley insight boosts an independent skill extra in its active window", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [
      hero("hero.s7.buladeli", [INSIGHT]), hero("hero.s7.gedun", [POISON]),
    ]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round < 6; round += 1) state = resolveRound(state, options).stateAfter;
    const r6 = resolveRound(state, options);
    expect(main(r6, "A", "lancer").increaseGroups.find((group) =>
      group.group === "commonDamageIncrease")?.summedValue).toBe(.3);
    expect(extras(r6, POISON)[0]!.increaseGroups.find((group) =>
      group.group === "commonDamageIncrease")?.summedValue).toBe(.3);
  });
});
