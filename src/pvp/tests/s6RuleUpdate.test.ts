import { describe, expect, it } from "vitest";
import {
  REINA_SWIFT_SHADOW_DANCE,
  S6_HERO_SKILL_DEFINITIONS,
  createBattleState,
  createHeroSkillSystem,
  createHeroStateFromDefinitions,
  resolveRound,
  resolveRoundCompact,
  simulateBattle,
  type BattleState,
  type HeroSkillTriggerOverrides,
  type HeroState,
  type TroopType,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

const HP = 1_000_000_000_000;
const MARK = "hero-skill.ruini.dream-mark";
const CATCH = "hero-skill.ruini.dream-catcher";
const FRAGMENT = "hero-skill.ruini.dream-fragment";
const THUNDER = "hero-skill.weien.thunder-raid";
const FLANK = "hero-skill.weien.flanking-strike";
const CRIT = "hero-skill.weien.lightning-speed";
const DODGE = REINA_SWIFT_SHADOW_DANCE.id;
const definitions = [...S6_HERO_SKILL_DEFINITIONS, REINA_SWIFT_SHADOW_DANCE];

function hero(id: string, skills: readonly string[], level = 5): HeroState {
  const created = createHeroStateFromDefinitions({ heroId: id, position: "leader" }, definitions);
  return { ...created, skillStates: created.skillStates.map((runtime) => ({
    ...runtime, enabled: skills.includes(runtime.skillId), level,
  })) };
}

function battle(
  a: Partial<Record<TroopType, number>>,
  b: Partial<Record<TroopType, number>>,
  heroesA: readonly HeroState[],
  heroesB: readonly HeroState[] = [],
  bHp = HP,
): BattleState {
  return createBattleState({
    sideA: { ...makeSide(a, { maxHpPerUnit: HP }), heroStates: heroesA },
    sideB: { ...makeSide(b, { maxHpPerUnit: bHp }), heroStates: heroesB },
  });
}

function system(overrides: HeroSkillTriggerOverrides = {}, onCheck?: (skillId: string) => void) {
  return createHeroSkillSystem({
    definitions,
    randomSource: { next: () => .99 },
    triggerOverrides: overrides,
    ...(onCheck === undefined ? {} : { onProbabilityDecision: ({ skillId }) => onCheck(skillId) }),
  });
}

function aEvents(result: ReturnType<typeof resolveRound>, skillId: string) {
  return result.trace.damageEvents.filter((event) =>
    event.sourceSide === "A" && event.sourceSkillId === skillId);
}

function aMain(result: ReturnType<typeof resolveRound>, troop: TroopType = "lancer") {
  return result.trace.damageEvents.find((event) =>
    event.sourceSide === "A" && event.sourceTroop === troop &&
    event.damageType === "normalAttack")!;
}

describe("S6 battle-report corrections", () => {
  it("Wuming's normal reduction applies only to normal attacks", () => {
    const result = resolveRound(battle({ shield: 100 }, { shield: 100 }, [],
      [hero("hero.s6.wuming", ["hero-skill.wuming.wind-shelter"])]),
    { heroSkillSystem: system() });
    const incoming = aMain(result, "shield");
    expect(incoming.reductionGroups.some((group) => group.group === "receivedNormalAttackReduction" && group.summedValue === .25)).toBe(true);
    expect(incoming.reductionGroups.some((group) => group.group === "receivedSkillDamageReduction")).toBe(false);
  });

  it("Wuming's skill reduction includes extraDamage but excludes normal reduction", () => {
    let state = battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s6.weien", [THUNDER])], [hero("hero.s6.wuming", ["hero-skill.wuming.wind-shelter"])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 3; round += 1) state = resolveRound(state, options).stateAfter;
    const result = resolveRound(state, options);
    const extra = aEvents(result, THUNDER)[0]!;
    expect(extra.reductionGroups.some((group) => group.group === "receivedSkillDamageReduction" && group.summedValue === .30)).toBe(true);
    expect(extra.reductionGroups.some((group) => group.group === "receivedNormalAttackReduction")).toBe(false);
  });

  it("Wuming's all-damage and skill-only groups multiply separately", () => {
    let state = battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s6.wuming", ["hero-skill.wuming.half-moon", "hero-skill.wuming.four-images"]),
        hero("hero.s6.weien", [THUNDER])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 3; round += 1) state = resolveRound(state, options).stateAfter;
    const result = resolveRound(state, options);
    const normal = aMain(result, "shield");
    const skill = aEvents(result, THUNDER)[0]!;
    expect(normal.increaseGroups.map((group) => group.group)).toContain("commonDamageIncrease");
    expect(normal.increaseGroups.some((group) => group.group === "skillDamageIncrease")).toBe(false);
    expect(normal.increaseMultiplier).toBeCloseTo(1.2);
    expect(skill.increaseMultiplier).toBeCloseTo(1.5);
  });

  it("Renee counts pre-dodge attempts and marks the selected target on attempt 2", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s6.ruini", [MARK])],
      [hero("hero.s4.lingnai", [DODGE])]);
    const options = { heroSkillSystem: system({ [`B:${DODGE}`]: true }) };
    state = resolveRound(state, options).stateAfter;
    const second = resolveRound(state, options);
    expect(aMain(second).mainHitCancelled).toBe(true);
    expect(second.trace.heroSkills.find((entry) => entry.skillId === MARK && entry.triggered)?.dreamMarkTarget).toBe("shield");
    expect(second.stateAfter.sideB.troops.shield.debuffs.some((effect) =>
      effect.definition.kind === "targetBoundMark")).toBe(true);
    expect(second.stateAfter.sideA.heroStates[0]!.skillStates.find((runtime) => runtime.skillId === MARK)?.mainAttackCounts.lancer).toBe(2);
  });

  it("Renee mark starts next round and lasts exactly one whole round", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s6.ruini", [MARK, CATCH, FRAGMENT])]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(state, options).stateAfter;
    const r2 = resolveRound(state, options);
    expect(aEvents(r2, MARK)).toHaveLength(0);
    expect(aMain(r2).increaseGroups.some((group) => group.group === "dreamMarkDamage")).toBe(false);
    const r3 = resolveRound(r2.stateAfter, options);
    expect(aEvents(r3, MARK)).toHaveLength(1);
    expect(aMain(r3).increaseGroups.find((group) => group.group === "dreamMarkDamage")?.summedValue).toBe(2.25);
    const r4 = resolveRound(r3.stateAfter, options);
    expect(aMain(r4).increaseGroups.some((group) => group.group === "dreamMarkDamage")).toBe(false);
  });

  it("Renee 2B is independent skillDamage and receives both additive mark bonuses", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s6.ruini", [MARK, CATCH, FRAGMENT])]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(resolveRound(state, options).stateAfter, options).stateAfter;
    const r3 = resolveRound(state, options);
    const extra = aEvents(r3, MARK)[0]!;
    expect(extra).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage", sourceTroop: "lancer", targetTroop: "shield" });
    expect(extra.baseDamage).toBeCloseTo(aMain(r3).rawDamage * 2);
    expect(extra.increaseGroups.find((group) => group.group === "dreamMarkDamage")?.summedValue).toBe(2.25);
    expect(extra.modifiedDamage).toBeCloseTo(extra.rawDamage * 3.25);
  });

  it("Renee mark remains active after its 2B event for later friendly actions in that round", () => {
    let state = battle({ lancer: 100, marksman: 100 }, { shield: 100 },
      [hero("hero.s6.ruini", [MARK, CATCH, FRAGMENT])]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(resolveRound(state, options).stateAfter, options).stateAfter;
    const r3 = resolveRound(state, options);
    expect(aEvents(r3, MARK)).toHaveLength(1);
    expect(aMain(r3, "marksman").increaseGroups.find((group) =>
      group.group === "dreamMarkDamage")?.summedValue).toBe(.75);
  });

  it("Renee 2B excludes normal-only increase while the lancer main receives it", () => {
    const base = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s6.ruini", [MARK])]);
    let state: BattleState = { ...base, sideA: { ...base.sideA, armyEffects: [makeDamageEffect({
      id: "reina-lv4-normal-only", kind: "damageIncrease",
      group: "normalAttackDamageIncrease", value: .25,
      scope: { damageTypes: ["normalAttack"] },
    })] } };
    const options = { heroSkillSystem: system() };
    state = resolveRound(resolveRound(state, options).stateAfter, options).stateAfter;
    const r3 = resolveRound(state, options);
    expect(aMain(r3).increaseMultiplier).toBeCloseTo(1.25);
    expect(aEvents(r3, MARK)[0]!.increaseGroups.some((group) =>
      group.group === "normalAttackDamageIncrease")).toBe(false);
  });

  it("Renee mark never retargets after its shield target dies", () => {
    let state = battle({ lancer: 100 }, { shield: 1, lancer: 100 }, [hero("hero.s6.ruini", [MARK])]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(state, options).stateAfter;
    state = { ...state, sideB: { ...state.sideB, troops: {
      ...state.sideB.troops,
      shield: { ...state.sideB.troops.shield, frontUnitHp: 1 },
    } } };
    const r2 = resolveRound(state, options);
    expect(r2.stateAfter.sideB.troops.shield.aliveCount).toBe(0);
    const r3 = resolveRound(r2.stateAfter, options);
    expect(aEvents(r3, MARK)).toHaveLength(0);
  });

  it("Renee creates 750 marks but only 749 delayed hits in 1500 rounds", () => {
    let state = battle({ lancer: 10 }, { shield: 10 }, [hero("hero.s6.ruini", [MARK])]);
    const options = { heroSkillSystem: system() };
    let marks = 0;
    let hits = 0;
    for (let round = 1; round <= 1500; round += 1) {
      const result = resolveRound(state, options);
      marks += result.trace.heroSkills.filter((entry) => entry.skillId === MARK && entry.reason === "deterministic" && entry.triggered).length;
      hits += aEvents(result, MARK).length;
      state = result.stateAfter;
    }
    expect(marks).toBe(750);
    expect(hits).toBe(749);
  });

  it("Renee 2B casualties exit the stack without separate skill attribution", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s6.ruini", [MARK])], [], 500);
    const options = { heroSkillSystem: system() };
    state = resolveRoundCompact(state, options).stateAfter;
    state = resolveRoundCompact(state, options).stateAfter;
    const before = state.sideB.troops.shield.aliveCount;
    const r3 = resolveRoundCompact(state, options);
    expect(r3.stateAfter.sideB.troops.shield.aliveCount).toBeLessThan(before);
    expect(r3.skillCasualtiesBySide.A[MARK]).toBeUndefined();
  });

  it("Wayne Thunder is due on natural round 4 for each living source troop", () => {
    let state = battle({ shield: 100, lancer: 100, marksman: 100 }, { shield: 100 },
      [hero("hero.s6.weien", [THUNDER])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 3; round += 1) {
      const result = resolveRound(state, options);
      expect(aEvents(result, THUNDER)).toHaveLength(0);
      state = result.stateAfter;
    }
    const r4 = resolveRound(state, options);
    expect(aEvents(r4, THUNDER).map((event) => event.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
  });

  it("Wayne Thunder has 750 events with two stacks across 1500 rounds", () => {
    let state = battle({ shield: 10, marksman: 10 }, { shield: 10 }, [hero("hero.s6.weien", [THUNDER], 4)]);
    const options = { heroSkillSystem: system() };
    let events = 0;
    for (let round = 1; round <= 1500; round += 1) {
      const result = resolveRound(state, options);
      events += aEvents(result, THUNDER).length;
      state = result.stateAfter;
    }
    expect(events).toBe(750);
  });

  it("Wayne Thunder Lv4 is .8B and Lv5 is 1B", () => {
    for (const [level, coefficient] of [[4, .8], [5, 1]] as const) {
      let state = battle({ shield: 100 }, { shield: 100 }, [hero("hero.s6.weien", [THUNDER], level)]);
      const options = { heroSkillSystem: system() };
      for (let round = 1; round <= 3; round += 1) state = resolveRound(state, options).stateAfter;
      const r4 = resolveRound(state, options);
      expect(aEvents(r4, THUNDER)[0]?.baseDamage).toBeCloseTo(aMain(r4, "shield").rawDamage * coefficient);
    }
  });

  it("Wayne Thunder survives a dodged R4 main without adding a main attack", () => {
    let state = battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s6.weien", [THUNDER])], [hero("hero.s4.lingnai", [DODGE])]);
    const options = { heroSkillSystem: system({ [`B:${DODGE}`]: true }) };
    for (let round = 1; round <= 3; round += 1) state = resolveRound(state, options).stateAfter;
    const r4 = resolveRound(state, options);
    expect(aMain(r4, "shield").mainHitCancelled).toBe(true);
    expect(aEvents(r4, THUNDER)).toHaveLength(1);
    expect(r4.trace.damageEvents.filter((event) => event.sourceSide === "A" && event.damageType === "normalAttack")).toHaveLength(1);
  });

  it("Wayne flanking counts attempts and survives a dodged second main", () => {
    let state = battle({ marksman: 100 }, { shield: 100, lancer: 100, marksman: 100 },
      [hero("hero.s6.weien", [FLANK])], [hero("hero.s4.lingnai", [DODGE])]);
    const options = { heroSkillSystem: system({ [`B:${DODGE}`]: true }) };
    state = resolveRound(state, options).stateAfter;
    const r2 = resolveRound(state, options);
    expect(aMain(r2, "marksman").mainHitCancelled).toBe(true);
    expect(aEvents(r2, FLANK).map((event) => event.targetTroop)).toEqual(["lancer", "marksman"]);
    expect(r2.stateAfter.sideA.heroStates[0]!.skillStates.find((runtime) => runtime.skillId === FLANK)?.mainAttackCounts.marksman).toBe(2);
  });

  it("Wayne flanking Lv5 emits .4B lancer and .2B marksman", () => {
    let state = battle({ marksman: 100 }, { shield: 100, lancer: 100, marksman: 100 }, [hero("hero.s6.weien", [FLANK])]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(state, options).stateAfter;
    const r2 = resolveRound(state, options);
    const extras = aEvents(r2, FLANK);
    expect(extras).toHaveLength(2);
    expect(extras[0]!.baseDamage).toBeCloseTo(aMain(r2, "marksman").rawDamage * .4);
    expect(extras[1]!.baseDamage).toBeCloseTo(aMain(r2, "marksman").rawDamage * .2);
  });

  it("Wayne flanking emits no damage when only enemy shield survives", () => {
    let state = battle({ marksman: 100 }, { shield: 100 }, [hero("hero.s6.weien", [FLANK])]);
    const options = { heroSkillSystem: system() };
    state = resolveRound(state, options).stateAfter;
    expect(aEvents(resolveRound(state, options), FLANK)).toHaveLength(0);
  });

  it("Wayne flanking triggers 750 times in 1500 marksman attempts", () => {
    const result = simulateBattle(battle({ marksman: 10 }, { shield: 10 },
      [hero("hero.s6.weien", [FLANK])]),
    { heroSkillSystem: system(), maxRounds: 1500, traceMode: "summary" });
    const runtime = result.finalState.sideA.heroStates[0]!.skillStates.find((skill) => skill.skillId === FLANK)!;
    expect(runtime.mainAttackCounts.marksman).toBe(1500);
    expect(runtime.triggerCount).toBe(750);
  });

  it("Wayne crit Lv4/Lv5 probabilities remain 20%/25%", () => {
    expect(S6_HERO_SKILL_DEFINITIONS.find((skill) => skill.id === CRIT)?.levelValues[4]?.probability).toBe(.20);
    expect(S6_HERO_SKILL_DEFINITIONS.find((skill) => skill.id === CRIT)?.levelValues[5]?.probability).toBe(.25);
  });

  it("Wayne crit is checked post-dodge and not checked when the main is dodged", () => {
    let checks = 0;
    const result = resolveRound(battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s6.weien", [CRIT])], [hero("hero.s4.lingnai", [DODGE])]),
    { heroSkillSystem: system({ [`B:${DODGE}`]: true, [`A:${CRIT}`]: true },
      (skillId) => { if (skillId === CRIT) checks += 1; }) });
    expect(aMain(result, "shield").mainHitCancelled).toBe(true);
    expect(checks).toBe(0);
    expect(aEvents(result, CRIT)).toHaveLength(0);
  });

  it("Wayne crit doubles the normal main without a skill event", () => {
    const result = resolveRound(battle({ shield: 100 }, { shield: 100 }, [hero("hero.s6.weien", [CRIT])]),
      { heroSkillSystem: system({ [`A:${CRIT}`]: true }) });
    const main = aMain(result, "shield");
    expect(aEvents(result, CRIT)).toHaveLength(0);
    expect(main.increaseGroups.find((group) => group.group === "criticalNormalAttack")?.summedValue).toBe(1);
    expect(main.increaseMultiplier).toBeCloseTo(2);
  });

  it("Wayne crit multiplies a normal-only increase", () => {
    const base = battle({ shield: 100 }, { shield: 100 }, [hero("hero.s6.weien", [CRIT])]);
    const state = { ...base, sideA: { ...base.sideA, armyEffects: [makeDamageEffect({
      id: "reina-lv4-normal-only", kind: "damageIncrease",
      group: "normalAttackDamageIncrease", value: .25,
      scope: { damageTypes: ["normalAttack"] },
    })] } };
    const result = resolveRound(state, { heroSkillSystem: system({ [`A:${CRIT}`]: true }) });
    expect(aMain(result, "shield").increaseMultiplier).toBeCloseTo(2.5);
    expect(aEvents(result, CRIT)).toHaveLength(0);
  });

  it("Wayne crit remains normal damage under Wuming skill-only increase", () => {
    const result = resolveRound(battle({ shield: 100 }, { shield: 100 }, [
      hero("hero.s6.weien", [CRIT]), hero("hero.s6.wuming", ["hero-skill.wuming.four-images"]),
    ]), { heroSkillSystem: system({ [`A:${CRIT}`]: true }) });
    expect(aMain(result, "shield").increaseMultiplier).toBeCloseTo(2);
    expect(aEvents(result, CRIT)).toHaveLength(0);
  });

  it("Wayne crit receives Wuming's normal reduction only", () => {
    const result = resolveRound(battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s6.weien", [CRIT])],
      [hero("hero.s6.wuming", ["hero-skill.wuming.wind-shelter"])]),
    { heroSkillSystem: system({ [`A:${CRIT}`]: true }) });
    const normal = aMain(result, "shield");
    expect(normal.reductionGroups.map((group) => group.group)).toContain("receivedNormalAttackReduction");
    expect(normal.reductionGroups.some((group) => group.group === "receivedSkillDamageReduction")).toBe(false);
    expect(aEvents(result, CRIT)).toHaveLength(0);
  });

  it("Wayne crit casualty belongs to the one normal attack", () => {
    const state = battle({ shield: 100 }, { shield: 1 }, [hero("hero.s6.weien", [CRIT])], [], 15);
    const result = resolveRoundCompact(state, { heroSkillSystem: system({ [`A:${CRIT}`]: true }) });
    expect(result.stateAfter.sideB.troops.shield.aliveCount).toBe(0);
    expect(result.skillCasualtiesBySide.A[CRIT]).toBeUndefined();
  });
});
