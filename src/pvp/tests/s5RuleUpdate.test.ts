import { describe, expect, it } from "vitest";
import {
  REINA_SWIFT_SHADOW_DANCE,
  S5_HERO_SKILL_DEFINITIONS,
  createBattleState,
  createActiveEffect,
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
const DEFINITIONS = [...S5_HERO_SKILL_DEFINITIONS, REINA_SWIFT_SHADOW_DANCE];
const GALE = "hero-skill.heketuo.gale-strike";
const CATCH = "hero-skill.nuola.catch-off-guard";
const MOMENTUM = "hero-skill.nuola.momentum-pursuit";
const EAGLE = "hero-skill.gewen.eagle-vision";
const AERIAL = "hero-skill.gewen.aerial-suppression";
const DEMOLITION = "hero-skill.gewen.demolition-squad";
const DODGE = "hero-skill.lingnai.swift-shadow-dance";

function hero(id: string, enabled: readonly string[], counts: Partial<Record<TroopType, number>> = {}): HeroState {
  const created = createHeroStateFromDefinitions({ heroId: id, position: "leader" }, DEFINITIONS);
  return {
    ...created,
    skillStates: created.skillStates.map((runtime) => ({
      ...runtime,
      enabled: enabled.includes(runtime.skillId),
      mainAttackCounts: { ...runtime.mainAttackCounts, ...counts },
    })),
  };
}

function battle(
  aCounts: Partial<Record<TroopType, number>>,
  bCounts: Partial<Record<TroopType, number>>,
  heroesA: readonly HeroState[],
  heroesB: readonly HeroState[] = [],
): BattleState {
  return createBattleState({
    sideA: { ...makeSide(aCounts, { maxHpPerUnit: HP }), heroStates: heroesA },
    sideB: { ...makeSide(bCounts, { maxHpPerUnit: HP }), heroStates: heroesB },
  });
}

function system(overrides: HeroSkillTriggerOverrides = {}, onCheck?: (skillId: string) => void) {
  return createHeroSkillSystem({
    definitions: DEFINITIONS,
    randomSource: { next: () => .99 },
    triggerOverrides: overrides,
    ...(onCheck === undefined ? {} : { onProbabilityDecision: ({ skillId }) => onCheck(skillId) }),
  });
}

function attackEvents(result: ReturnType<typeof resolveRound>, skillId: string) {
  return result.trace.damageEvents.filter((event) => event.sourceSide === "A" && event.sourceSkillId === skillId);
}

describe("S5 confirmed expedition and independent shield event rules", () => {
  it("checks Hector survival once per natural round and adds to the received-reduction group", () => {
    const base = battle({ shield: 100 }, { shield: 100 }, [hero("hero.s5.heketuo", ["hero-skill.heketuo.survival-instinct"])]);
    const state = {
      ...base,
      sideA: {
        ...base.sideA,
        armyEffects: [makeDamageEffect({ id: "other-received", kind: "damageReduction", group: "receivedDamageReduction", value: .2 })],
      },
    };
    let checks = 0;
    const result = resolveRound(state, { heroSkillSystem: system({ "A:hero-skill.heketuo.survival-instinct": true },
      (id) => { if (id === "hero-skill.heketuo.survival-instinct") checks += 1; }) });
    expect(checks).toBe(1);
    expect(result.trace.damageEvents.find((event) => event.sourceSide === "B")?.reductionGroups)
      .toContainEqual(expect.objectContaining({ group: "receivedDamageReduction", multiplier: 1.7 }));
  });

  it("keeps Hector shield/marksman decay counters separate and stops after ten successful mains", () => {
    const state = battle({ shield: 100, marksman: 100 }, { shield: 100 },
      [hero("hero.s5.heketuo", ["hero-skill.heketuo.thunder-strike"])]);
    const options = { heroSkillSystem: system() };
    const first = resolveRound(state, options);
    const firstA = first.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(firstA.map((event) => event.increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue))
      .toEqual([2, 1]);
    const second = resolveRound(first.stateAfter, options);
    expect(second.trace.damageEvents.filter((event) => event.sourceSide === "A")
      .map((event) => event.increaseGroups.find((group) => group.group === "commonDamageIncrease")?.summedValue))
      .toEqual([1.7, .85]);
    const finished = simulateBattle(state, { ...options, maxRounds: 11, traceMode: "summary" });
    const runtime = finished.finalState.sideA.heroStates[0]!.skillStates.find((item) =>
      item.skillId === "hero-skill.heketuo.thunder-strike")!;
    expect(runtime.mainAttackCounts).toMatchObject({ shield: 11, lancer: 0, marksman: 11 });
    const eleventh = resolveRound({ ...finished.finalState, round: 12 }, options);
    expect(eleventh.trace.damageEvents.filter((event) => event.sourceSide === "A")
      .every((event) => !event.increaseGroups.some((group) => group.group === "commonDamageIncrease"))).toBe(true);
  });

  it("checks Hector Gale Strike independently per successful troop main and emits 1× parent base", () => {
    let checks = 0;
    const result = resolveRound(battle({ shield: 100, lancer: 100, marksman: 100 },
      { shield: 100, lancer: 100, marksman: 100 }, [hero("hero.s5.heketuo", [GALE])]), {
      heroSkillSystem: system({ [`A:${GALE}`]: true }, (id) => { if (id === GALE) checks += 1; }),
    });
    const mains = result.trace.damageEvents.filter((event) => event.sourceSide === "A" && event.damageType === "normalAttack");
    const extras = attackEvents(result, GALE);
    expect(checks).toBe(3);
    expect(mains).toHaveLength(3);
    expect(extras).toHaveLength(3);
    for (const extra of extras) {
      const parent = mains.find((event) => event.id === extra.parentEventId)!;
      expect(extra).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage", damageBasis: "parentBaseDamage" });
      expect(extra.baseDamage).toBe(parent.baseDamage);
    }
  });

  it("does not check Hector Gale Strike after Reina dodges the main hit", () => {
    let checks = 0;
    const result = resolveRound(battle({ shield: 100, lancer: 100, marksman: 100 }, { shield: 100 },
      [hero("hero.s5.heketuo", [GALE])], [hero("hero.s4.lingnai", [DODGE])]), {
      heroSkillSystem: system({ [`B:${DODGE}`]: true, [`A:${GALE}`]: true },
        (id) => { if (id === GALE) checks += 1; }),
    });
    expect(checks).toBe(0);
    expect(attackEvents(result, GALE)).toHaveLength(0);
  });

  it("attributes a Gale Strike casualty once to troop and skill without duplicating total casualties", () => {
    const a = makeSide({ shield: 100 }, { maxHpPerUnit: HP });
    const state = createBattleState({
      sideA: { ...a, heroStates: [hero("hero.s5.heketuo", [GALE])] },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: 15 }),
    });
    const result = resolveRoundCompact(state, { heroSkillSystem: system({ [`A:${GALE}`]: true }) });
    expect(result.stateAfter.sideB.troops.shield.aliveCount).toBe(0);
    expect(result.skillCasualtiesBySide.A[GALE]).toBe(1);
    expect(state.sideB.initialTotalCount - result.stateAfter.sideB.troops.shield.aliveCount).toBe(1);
  });

  it("adds Norah shield/marksman reduction to the shared received group", () => {
    const base = battle({ shield: 100, marksman: 100 }, { shield: 100, lancer: 100, marksman: 100 },
      [hero("hero.s5.nuola", ["hero-skill.nuola.multi-troop-combat"])]);
    const state = { ...base, sideA: { ...base.sideA, armyEffects: [
      makeDamageEffect({ id: "other-received", kind: "damageReduction", group: "receivedDamageReduction", value: .2 }),
    ] } };
    const result = resolveRound(state, { heroSkillSystem: system() });
    const incoming = result.trace.damageEvents.filter((event) => event.sourceSide === "B");
    expect(incoming.filter((event) => event.targetTroop === "shield").every((event) =>
      event.reductionGroups.some((group) => group.group === "receivedDamageReduction" && group.multiplier === 1.35))).toBe(true);
    expect(incoming.filter((event) => event.targetTroop === "marksman")).toHaveLength(0);
    expect(result.stateAfter.sideA.armyEffects.some((effect) =>
      effect.definition.kind === "damageReduction" && effect.definition.group === "norahTroopReduction")).toBe(false);
  });

  it("applies Norah's shared reduction to marksman but not lancer", () => {
    const run = (target: "lancer" | "marksman") => resolveRound(
      battle({ [target]: 100 }, { shield: 100 },
        [hero("hero.s5.nuola", ["hero-skill.nuola.multi-troop-combat"])]),
      { heroSkillSystem: system() },
    ).trace.damageEvents.find((event) => event.sourceSide === "B")!;
    expect(run("marksman").reductionGroups.find((group) => group.group === "receivedDamageReduction")?.summedValue).toBe(.15);
    expect(run("lancer").reductionGroups.some((group) => group.group === "receivedDamageReduction")).toBe(false);
  });

  it("emits three separate Norah Catch Off Guard events with independent targeting", () => {
    let checks = 0;
    const result = resolveRound(battle({ lancer: 100 }, { shield: 100, lancer: 100, marksman: 100 },
      [hero("hero.s5.nuola", [CATCH])]), {
      heroSkillSystem: system({ [`A:${CATCH}`]: true }, (id) => { if (id === CATCH) checks += 1; }),
    });
    const extras = attackEvents(result, CATCH);
    expect(checks).toBe(1);
    expect(extras.map((event) => event.targetTroop)).toEqual(["shield", "lancer", "marksman"]);
    expect(new Set(extras.map((event) => event.id)).size).toBe(3);
    expect(extras.every((event) => event.damageType === "skillDamage" && event.damageSubtype === "extraDamage")).toBe(true);
    expect(result.stateAfter.sideA.heroStates[0]!.skillStates.find((runtime) => runtime.skillId === CATCH)?.mainAttackCounts.lancer).toBe(1);
  });

  it("does not check Norah Catch Off Guard or advance momentum on a dodged lancer main", () => {
    let checks = 0;
    const result = resolveRound(battle({ lancer: 100 }, { shield: 100 },
      [hero("hero.s5.nuola", [CATCH, MOMENTUM])], [hero("hero.s4.lingnai", [DODGE])]), {
      heroSkillSystem: system({ [`B:${DODGE}`]: true, [`A:${CATCH}`]: true },
        (id) => { if (id === CATCH) checks += 1; }),
    });
    expect(checks).toBe(0);
    expect(attackEvents(result, CATCH)).toHaveLength(0);
    expect(result.stateAfter.sideA.heroStates[0]!.skillStates.find((runtime) => runtime.skillId === MOMENTUM)?.mainAttackCounts.lancer).toBe(0);
  });

  it("starts Norah momentum in the next round for two rounds after five successful lancer mains", () => {
    let state = battle({ lancer: 100 }, { shield: 100 }, [hero("hero.s5.nuola", [MOMENTUM])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 8; round += 1) {
      const result = resolveRound(state, options);
      const outgoing = result.trace.damageEvents.find((event) => event.sourceSide === "A")!;
      const incoming = result.trace.damageEvents.find((event) => event.sourceSide === "B")!;
      expect(outgoing.increaseGroups.some((group) => group.group === "commonDamageIncrease" && group.summedValue === .25))
        .toBe(round === 6 || round === 7);
      expect(incoming.reductionGroups.some((group) => group.group === "receivedDamageReduction" && group.summedValue === .25))
        .toBe(round === 6 || round === 7);
      state = result.stateAfter;
    }
  });

  it("applies Gwen Eagle Vision next round, permanently once per actual hit target", () => {
    let state = { ...battle({ shield: 100 }, { shield: 100 }, [hero("hero.s5.gewen", [EAGLE])]), round: 10 };
    const options = { heroSkillSystem: system() };
    for (let round = 10; round <= 13; round += 1) {
      const result = resolveRound(state, options);
      const hit = result.trace.damageEvents.find((event) => event.sourceSide === "A")!;
      expect(hit.increaseGroups.find((group) => group.group === "vulnerability")?.summedValue)
        .toBe(round === 10 ? undefined : .25);
      state = result.stateAfter;
    }
    const target = state.sideB.troops.shield.debuffs.find((effect) => effect.identity.sourceSkillId === EAGLE)!;
    expect(target.stackCount).toBe(1);
    expect(target.remainingRounds).toBeUndefined();
  });

  it("does not apply Eagle Vision to a main attack dodged by Reina", () => {
    const result = resolveRound(battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s5.gewen", [EAGLE])], [hero("hero.s4.lingnai", [DODGE])]),
      { heroSkillSystem: system({ [`B:${DODGE}`]: true }) });
    expect(result.stateAfter.sideB.troops.shield.debuffs.some((effect) =>
      effect.identity.sourceSkillId === EAGLE)).toBe(false);
  });

  it("adds ordinary vulnerability sources in one group when no aerial token is consumed", () => {
    const base = battle({ shield: 100 }, { shield: 100 }, [hero("hero.s5.gewen", [EAGLE])]);
    const other = createActiveEffect({
      identity: { sourceId: "test:other", sourceSkillId: "test:other", effectId: "test:other-vulnerability" },
      definition: { id: "test:other-vulnerability", name: "other vulnerability", kind: "incomingDamageIncrease",
        group: "vulnerability", value: .3, ruleStatus: "supported" },
      appliedRound: 1,
    });
    const initial = { ...base, sideB: { ...base.sideB, armyEffects: [other] } };
    const options = { heroSkillSystem: system() };
    const r1 = resolveRound(initial, options);
    const r2 = resolveRound(r1.stateAfter, options);
    expect(r1.trace.damageEvents.find((event) => event.sourceSide === "A")?.increaseGroups
      .find((group) => group.group === "vulnerability")?.summedValue).toBe(.3);
    expect(r2.trace.damageEvents.find((event) => event.sourceSide === "A")?.increaseGroups
      .find((group) => group.group === "vulnerability")?.summedValue).toBe(.55);
  });

  it("fires Gwen Aerial Suppression on successful attacks 6 and 12, not 5 or 11", () => {
    let state = battle({ shield: 100 }, { shield: 100 }, [hero("hero.s5.gewen", [AERIAL])]);
    const options = { heroSkillSystem: system() };
    for (let round = 1; round <= 12; round += 1) {
      const result = resolveRound(state, options);
      expect(attackEvents(result, AERIAL).length).toBe(round === 6 || round === 12 ? 1 : 0);
      state = result.stateAfter;
    }
    expect(state.sideA.heroStates[0]!.skillStates.find((runtime) => runtime.skillId === AERIAL)?.triggerCount).toBe(2);
  });

  it("overrides permanent 25% vulnerability with one-use 15%, then restores 25%", () => {
    let state = battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s5.gewen", [EAGLE, AERIAL], { shield: 5 })]);
    const options = { heroSkillSystem: system() };
    const r1 = resolveRound(state, options);
    expect(attackEvents(r1, AERIAL)).toHaveLength(1);
    state = r1.stateAfter;
    const r2 = resolveRound(state, options);
    const first = r2.trace.damageEvents.find((event) => event.sourceSide === "A")!;
    expect(first.increaseGroups.find((group) => group.group === "aerialSuppressionOverride")?.summedValue).toBe(.15);
    expect(first.increaseGroups.some((group) => group.group === "vulnerability")).toBe(false);
    const r3 = resolveRound(r2.stateAfter, options);
    const next = r3.trace.damageEvents.find((event) => event.sourceSide === "A")!;
    expect(next.increaseGroups.find((group) => group.group === "vulnerability")?.summedValue).toBe(.25);
    expect(next.increaseGroups.some((group) => group.group === "aerialSuppressionOverride")).toBe(false);
  });

  it("does not consume an aerial token on Reina's dodge, then consumes it on a real hit", () => {
    const initial = battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s5.gewen", [EAGLE, AERIAL], { shield: 5 })],
      [hero("hero.s4.lingnai", [DODGE])]);
    const options = { heroSkillSystem: system({
      [`1:B:${DODGE}`]: false, [`2:B:${DODGE}`]: true, [`3:B:${DODGE}`]: false,
    }) };
    const r1 = resolveRound(initial, options);
    const r2 = resolveRound(r1.stateAfter, options);
    expect(r2.trace.damageEvents.find((event) => event.sourceSide === "A")?.mainHitCancelled).toBe(true);
    expect(r2.stateAfter.sideB.troops.shield.debuffs.some((effect) => effect.identity.sourceSkillId === AERIAL)).toBe(true);
    const r3 = resolveRound(r2.stateAfter, options);
    expect(r3.trace.damageEvents.find((event) => event.sourceSide === "A")?.increaseGroups
      .find((group) => group.group === "aerialSuppressionOverride")?.summedValue).toBe(.15);
  });

  it("consumes the aerial token on one DamageEvent, not the whole normal-plus-extra root", () => {
    const state = battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s5.gewen", [EAGLE, AERIAL], { shield: 5 }), hero("hero.s5.heketuo", [GALE])]);
    const options = { heroSkillSystem: system({ [`A:${GALE}`]: true }) };
    const r1 = resolveRound(state, options);
    const r2 = resolveRound(r1.stateAfter, options);
    const main = r2.trace.damageEvents.find((event) => event.sourceSide === "A" && event.damageType === "normalAttack")!;
    const extra = attackEvents(r2, GALE)[0]!;
    expect(main.increaseGroups.some((group) => group.group === "aerialSuppressionOverride")).toBe(true);
    expect(extra.increaseGroups.some((group) => group.group === "aerialSuppressionOverride")).toBe(false);
    expect(extra.increaseGroups.find((group) => group.group === "vulnerability")?.summedValue).toBe(.25);
  });

  it("retains a newly issued aerial token when the prior token is consumed on that same main", () => {
    const r1 = resolveRound(battle({ shield: 100 }, { shield: 100 },
      [hero("hero.s5.gewen", [AERIAL], { shield: 5 })]), { heroSkillSystem: system() });
    const sideA = r1.stateAfter.sideA;
    const heroes = sideA.heroStates.map((entry) => ({ ...entry, skillStates: entry.skillStates.map((runtime) =>
      runtime.skillId === AERIAL ? { ...runtime, mainAttackCounts: { ...runtime.mainAttackCounts, shield: 11 } } : runtime) }));
    const r2 = resolveRound({ ...r1.stateAfter, sideA: { ...sideA, heroStates: heroes } },
      { heroSkillSystem: system() });
    expect(r2.trace.damageEvents.find((event) => event.sourceSide === "A" && event.damageType === "normalAttack")
      ?.increaseGroups.some((group) => group.group === "aerialSuppressionOverride")).toBe(true);
    expect(attackEvents(r2, AERIAL)).toHaveLength(1);
    expect(r2.stateAfter.sideB.troops.shield.debuffs.some((effect) =>
      effect.identity.sourceSkillId === AERIAL)).toBe(true);
    const r3 = resolveRound(r2.stateAfter, { heroSkillSystem: system() });
    expect(r3.trace.damageEvents.find((event) => event.sourceSide === "A")?.increaseGroups
      .some((group) => group.group === "aerialSuppressionOverride")).toBe(true);
  });

  it("fires Gwen Demolition Squad on marksman attempts 5 and 10, even when Reina dodges", () => {
    let state = battle({ marksman: 100 }, { shield: 100, lancer: 100, marksman: 100 },
      [hero("hero.s5.gewen", [DEMOLITION])], [hero("hero.s4.lingnai", [DODGE])]);
    const options = { heroSkillSystem: system({ [`B:${DODGE}`]: true }) };
    for (let round = 1; round <= 10; round += 1) {
      const result = resolveRound(state, options);
      const events = attackEvents(result, DEMOLITION);
      expect(events.length).toBe(round === 5 || round === 10 ? 3 : 0);
      if (round === 5 || round === 10) {
        expect(result.trace.damageEvents.find((event) => event.sourceSide === "A" && event.damageType === "normalAttack")?.finalDamage).toBe(0);
        expect(events.map((event) => event.targetTroop)).toEqual(["shield", "lancer", "marksman"]);
        expect(events.every((event) => event.baseDamage > 0 && event.damageSubtype === "extraDamage")).toBe(true);
      }
      state = result.stateAfter;
    }
    expect(state.sideA.heroStates[0]!.skillStates.find((runtime) => runtime.skillId === DEMOLITION)?.triggerCount).toBe(2);
  });

  it("counts 750 aerial post-dodge procs and 300 marksman pre-dodge procs across 1500 rounds", () => {
    const state = battle({ shield: 100, lancer: 100, marksman: 100 }, { shield: 100, lancer: 100, marksman: 100 },
      [hero("hero.s5.gewen", [AERIAL, DEMOLITION])]);
    const result = simulateBattle(state, { heroSkillSystem: system(), maxRounds: 1500, traceMode: "none" });
    expect(result.roundCount).toBe(1500);
    const runtimes = result.finalState.sideA.heroStates[0]!.skillStates;
    expect(runtimes.find((runtime) => runtime.skillId === AERIAL)?.triggerCount).toBe(750);
    expect(runtimes.find((runtime) => runtime.skillId === DEMOLITION)?.triggerCount).toBe(300);
  });
});
