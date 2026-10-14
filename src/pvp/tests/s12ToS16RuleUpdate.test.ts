import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  createActiveEffect,
  createBattleState,
  createConfirmedHeroFormation,
  createHeroSkillSystem,
  createPureTroopBattleState,
  getTroopConstant,
  resolveRound,
  simulateBattle,
  type BattleState,
  type HeroSkillTriggerOverrides,
  type RoundBattleTrace,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const DODGE = "hero-skill.lingnai.swift-shadow-dance";
const hugeHp = 1_000_000_000;
const troops = { shield: 100, lancer: 100, marksman: 100 };

function battle(heroId: string,
  own: Partial<Record<TroopType, number>> = troops,
  enemy: Partial<Record<TroopType, number>> = troops,
  dodge = false): BattleState {
  return createBattleState({
    sideA: { ...makeSide(own, { maxHpPerUnit: hugeHp }),
      heroStates: createConfirmedHeroFormation([{ heroId, position: "leader" }]) },
    sideB: { ...makeSide(enemy, { maxHpPerUnit: hugeHp }),
      heroStates: dodge
        ? createConfirmedHeroFormation([{ heroId: "hero.s4.lingnai", position: "leader" }])
        : [] },
  });
}

function system(overrides: HeroSkillTriggerOverrides = {},
  onProbabilityDecision?: (skillId: string) => void) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    triggerOverrides: overrides,
    randomSource: { next: () => .99 },
    ...(onProbabilityDecision === undefined ? {} : {
      onProbabilityDecision: ({ skillId }: { skillId: string }) => onProbabilityDecision(skillId),
    }),
  });
}

function main(round: RoundBattleTrace, side: "A" | "B", troop: TroopType) {
  return round.damageEvents.find((event) => event.sourceSide === side &&
    event.sourceTroop === troop && event.damageType === "normalAttack")!;
}

function skillEvents(round: RoundBattleTrace, skillId: string) {
  return round.damageEvents.filter((event) => event.sourceSkillId === skillId);
}

function attributeReduction(round: RoundBattleTrace, side: "A" | "B",
  troop: TroopType, attribute: "attack" | "defense") {
  return main(round, side, troop).attributeResolutions
    ?.find((entry) => entry.attribute === attribute)?.reductionGroups
    .reduce((sum, group) => sum + group.summedValue, 0) ?? 0;
}

function stun(state: BattleState, troop: TroopType): BattleState {
  const current = state.sideA.troops[troop];
  const debuff = createActiveEffect({
    identity: { sourceId: `test:stun:${troop}`, sourceSkillId: "test:stun",
      effectId: `test:stun:${troop}` },
    definition: { id: `test:stun:${troop}`, name: "stun",
      kind: "skipNextRoundAction", ruleStatus: "supported",
      lifecycle: { activationTiming: "immediate", durationRounds: 1,
        refreshMode: "replace" } },
    appliedRound: state.round, holderScope: troop,
  });
  return { ...state, sideA: { ...state.sideA, troops: { ...state.sideA.troops,
    [troop]: { ...current, debuffs: [...current.debuffs, debuff] } } } };
}

describe("S12–S16 provisional PVP rules", () => {
  it("marks every future skill provisional and records template provenance", () => {
    const future = CONFIRMED_HERO_SKILL_DEFINITIONS.filter((definition) =>
      (definition.metadata.generation ?? 0) >= 12);
    expect(future).toHaveLength(57);
    expect(future.every((definition) => definition.metadata.ruleStatus === "TENTATIVE" &&
      definition.metadata.verificationStatus === "inferredFromPriorGenerations")).toBe(true);
    expect(future.flatMap((definition) => Object.values(definition.levelValues)
      .flatMap((level) => level.effects))
      .filter((effect) => effect.kind === "extraDamage")
      .every((effect) => effect.kind === "extraDamage" && effect.basis === "parentBaseDamage"))
      .toBe(true);
    expect(future.find((definition) => definition.id === "hero-skill.elif.brocade-veil")
      ?.metadata.templateSource).toBe("hero-skill.jiatuo.kings-gift");
  });

  it("shares Ligeia's every second marksman attempt and pools two 1B events only on hit", () => {
    const result = simulateBattle(battle("hero.s12.ligeia", { marksman: 100 },
      { shield: 100 }), { maxRounds: 3, heroSkillSystem: system() });
    const second = result.trace.rounds[1]!;
    const pooled = second.damageEvents.filter((event) => event.damageSubtype === "extraDamage");
    expect(pooled).toHaveLength(1);
    expect(pooled[0]).toMatchObject({ damageBasis: "parentBaseDamage", skillCoefficient: 2,
      targetTroop: "shield" });
    expect(pooled[0]!.skillPoolComponents).toHaveLength(2);
    const third = result.trace.rounds[2]!;
    expect(main(third, "A", "marksman").increaseGroups.find((group) =>
      group.group === "vulnerability")?.summedValue).toBeCloseTo(.25);
    expect(main(third, "B", "shield").reductionGroups.find((group) =>
      group.group === "enemyOutgoingDamageReduction")?.summedValue).toBeCloseTo(.20);

    const dodged = simulateBattle(battle("hero.s12.ligeia", { marksman: 100 },
      { shield: 100 }, true), { maxRounds: 3, heroSkillSystem: system({
      [`B:${DODGE}`]: false, [`2:B:marksman:${DODGE}`]: true,
    }) });
    expect(main(dodged.trace.rounds[1]!, "A", "marksman").mainHitCancelled).toBe(true);
    expect(dodged.trace.rounds[1]!.damageEvents.filter((event) =>
      event.damageSubtype === "extraDamage")).toHaveLength(0);
    expect(dodged.finalState.sideA.heroStates[0]!.skillStates.filter((entry) =>
      entry.skillId.startsWith("hero-skill.ligeia.") &&
      entry.mainAttackCounts.marksman === 3)).toHaveLength(2);
    expect(main(dodged.trace.rounds[2]!, "A", "marksman").increaseGroups.some((group) =>
      group.group === "vulnerability")).toBe(false);
  });

  it("uses Magnus's Gisela attempt roll despite dodge and skips a stunned shield", () => {
    const skillId = "hero-skill.gisela.temporary-fortification";
    let checks = 0;
    const heroSkillSystem = system({ [`A:${skillId}`]: true,
      [`B:${DODGE}`]: true }, (id) => { if (id === skillId) checks += 1; });
    const first = resolveRound(battle("hero.s13.gisela", { shield: 100 },
      { shield: 100 }, true), { heroSkillSystem });
    expect(main(first.trace, "A", "shield").mainHitCancelled).toBe(true);
    expect(first.trace.heroSkills.find((entry) => entry.skillId === skillId))
      .toMatchObject({ mainAttackAttempted: true, triggered: true,
        templateSource: "hero-skill.magenusi.steel-phalanx" });
    expect(checks).toBe(1);
    resolveRound(stun(first.stateAfter, "shield"), { heroSkillSystem });
    expect(checks).toBe(1);
  });

  it("keeps Flora's attempted-attack vulnerability when the normal hit is dodged", () => {
    const skillId = "hero-skill.flora.thorn-vine-dance";
    const result = simulateBattle(battle("hero.s13.flora", { lancer: 100 },
      { shield: 100 }, true), { maxRounds: 2, heroSkillSystem: system({
      [`A:${skillId}`]: true, [`1:B:lancer:${DODGE}`]: true,
      [`B:${DODGE}`]: false,
    }) });
    expect(main(result.trace.rounds[0]!, "A", "lancer").mainHitCancelled).toBe(true);
    expect(result.trace.rounds[0]!.heroSkills.find((entry) => entry.skillId === skillId))
      .toMatchObject({ mainAttackAttempted: true, triggered: true,
        templateSource: "hero-skill.miya.doom-entanglement" });
    expect(main(result.trace.rounds[1]!, "A", "lancer").increaseGroups.find((group) =>
      group.group === "vulnerability")?.summedValue).toBeCloseTo(.50);
  });

  it("keeps Vulcanus's Gwen token and 1B semantics from the shared template", () => {
    const run = (heroId: string, selectedSkill: string) => {
      const original = battle(heroId, { marksman: 100 }, { shield: 100 });
      const isolated: BattleState = { ...original, sideA: { ...original.sideA,
        heroStates: original.sideA.heroStates.map((hero) => ({ ...hero,
          skillStates: hero.skillStates.filter((entry) => entry.skillId === selectedSkill) })) } };
      return simulateBattle(isolated, { maxRounds: 13, heroSkillSystem: system() });
    };
    const gwenSkill = "hero-skill.gewen.aerial-suppression";
    const vulcanusSkill = "hero-skill.vulcanus.rifting-blade";
    const gwen = run("hero.s5.gewen", gwenSkill);
    const vulcanus = run("hero.s13.vulcanus", vulcanusSkill);
    const oldEvent = skillEvents(gwen.trace.rounds[5]!, gwenSkill)[0]!;
    const newEvent = skillEvents(vulcanus.trace.rounds[5]!, vulcanusSkill)[0]!;
    expect(newEvent).toMatchObject({ skillCoefficient: oldEvent.skillCoefficient,
      damageBasis: oldEvent.damageBasis, targetTroop: oldEvent.targetTroop });
    expect(newEvent.baseDamage).toBeCloseTo(oldEvent.baseDamage);
    expect(main(vulcanus.trace.rounds[6]!, "A", "marksman").increaseGroups
      .find((group) => group.group === "aerialSuppressionOverride")?.summedValue).toBeCloseTo(.15);
    for (let round = 0; round < 13; round += 1) {
      const oldMain = main(gwen.trace.rounds[round]!, "A", "marksman");
      const newMain = main(vulcanus.trace.rounds[round]!, "A", "marksman");
      expect(newMain.appliedDamage).toBe(oldMain.appliedDamage);
      expect(newMain.increaseGroups.map(({ group, multiplier, summedValue }) =>
        ({ group, multiplier, summedValue }))).toEqual(oldMain.increaseGroups.map(
        ({ group, multiplier, summedValue }) => ({ group, multiplier, summedValue })));
      expect(skillEvents(vulcanus.trace.rounds[round]!, vulcanusSkill)
        .map((event) => event.appliedDamage)).toEqual(
        skillEvents(gwen.trace.rounds[round]!, gwenSkill)
          .map((event) => event.appliedDamage));
    }
  });

  it("generates the same next-round shield from Elif and Gatot", () => {
    const gatot = resolveRound(battle("hero.s8.jiatuo", { shield: 100 },
      { shield: 100 }), { heroSkillSystem: system() });
    const elif = resolveRound(battle("hero.s14.elif", { shield: 100 },
      { shield: 100 }), { heroSkillSystem: system() });
    const oldShield = gatot.trace.heroSkills.find((entry) => entry.temporaryShieldGenerated)!;
    const newShield = elif.trace.heroSkills.find((entry) => entry.temporaryShieldGenerated)!;
    expect(newShield.generatedShieldHp).toBeCloseTo(oldShield.generatedShieldHp!);
    expect(newShield.gatotShield?.calculatedAttackX).toBeCloseTo(oldShield.gatotShield!.calculatedAttackX);
    expect(newShield.activationRound).toBe(2);
  });

  it("cancels Dominic's hit-only 0.6B and vulnerability on lancer dodge", () => {
    const skillId = "hero-skill.dominic.rose-thrust";
    const result = simulateBattle(battle("hero.s14.dominic", { lancer: 100 },
      { shield: 100 }, true), { maxRounds: 2, heroSkillSystem: system({
      [`B:${DODGE}`]: true,
    }) });
    expect(main(result.trace.rounds[0]!, "A", "lancer").mainHitCancelled).toBe(true);
    expect(skillEvents(result.trace.rounds[0]!, skillId)).toHaveLength(0);
    expect(main(result.trace.rounds[1]!, "A", "lancer").increaseGroups.some((group) =>
      group.group === "vulnerability")).toBe(false);
  });

  it("uses Wayne's split Cara attack on a dodged second attempt without retarget", () => {
    const skillId = "hero-skill.cara.witch-assault";
    const result = simulateBattle(battle("hero.s14.cara", { marksman: 100 },
      { lancer: 100, marksman: 100 }, true), { maxRounds: 2,
      heroSkillSystem: system({ [`B:${DODGE}`]: false,
        [`2:B:marksman:${DODGE}`]: true }) });
    expect(main(result.trace.rounds[1]!, "A", "marksman").mainHitCancelled).toBe(true);
    expect(skillEvents(result.trace.rounds[1]!, skillId).map((event) =>
      [event.targetTroop, event.skillCoefficient])).toEqual([
      ["lancer", .4], ["marksman", .2],
    ]);
    const onlyMarksman = simulateBattle(battle("hero.s14.cara", { marksman: 100 },
      { marksman: 100 }), { maxRounds: 2, heroSkillSystem: system() });
    expect(skillEvents(onlyMarksman.trace.rounds[1]!, skillId).map((event) =>
      event.targetTroop)).toEqual(["marksman"]);
  });

  it("counts Hank's dodged fifth shield attempt, then activates R6/R7", () => {
    const skillId = "hero-skill.hank.sparks-fly";
    const result = simulateBattle(battle("hero.s15.hank", { shield: 100 },
      { shield: 100 }, true), { maxRounds: 8, heroSkillSystem: system({
      [`B:${DODGE}`]: false, [`5:B:shield:${DODGE}`]: true,
    }) });
    const fifth = result.trace.rounds[4]!;
    expect(main(fifth, "A", "shield").mainHitCancelled).toBe(true);
    expect(fifth.heroSkills.find((entry) => entry.skillId === skillId))
      .toMatchObject({ attackCountAfter: 5, triggered: true, activationRound: 6 });
    for (const round of [6, 7]) {
      expect(main(result.trace.rounds[round - 1]!, "A", "shield").increaseGroups
        .find((group) => group.group === "commonDamageIncrease")?.summedValue).toBeCloseTo(.25);
    }
    expect(main(result.trace.rounds[7]!, "A", "shield").increaseGroups.some((group) =>
      group.group === "commonDamageIncrease")).toBe(false);
  });

  it("does not count a stunned Hank shield or a stunned Ursa lancer", () => {
    for (const [heroId, skillId, troop, before] of [
      ["hero.s15.hank", "hero-skill.hank.sparks-fly", "shield", 4],
      ["hero.s16.ursa", "hero-skill.ursa.poison-blade", "lancer", 1],
    ] as const) {
      let state = battle(heroId, { [troop]: 100 }, { shield: 100 });
      const heroSkillSystem = system();
      for (let round = 0; round < before; round += 1) {
        state = resolveRound(state, { heroSkillSystem }).stateAfter;
      }
      const skipped = resolveRound(stun(state, troop), { heroSkillSystem });
      expect(skipped.trace.damageEvents.some((event) =>
        event.sourceSide === "A" && event.sourceTroop === troop)).toBe(false);
      expect(skipped.stateAfter.sideA.heroStates[0]!.skillStates.find((entry) =>
        entry.skillId === skillId)?.mainAttackCounts[troop]).toBe(before);
    }
  });

  it("uses a post-hit 20% Viveca roll and sends separate 1B to living targets", () => {
    const skillId = "hero-skill.viveca.shadow-vision";
    let checks = 0;
    const hit = resolveRound(battle("hero.s15.viveca", { marksman: 100 }, troops), {
      heroSkillSystem: system({ [`A:${skillId}`]: true },
        (id) => { if (id === skillId) checks += 1; }),
    });
    expect(checks).toBe(1);
    expect(skillEvents(hit.trace, skillId).map((event) =>
      [event.targetTroop, event.skillCoefficient])).toEqual([
      ["shield", 1], ["lancer", 1], ["marksman", 1],
    ]);
    checks = 0;
    const dodged = resolveRound(battle("hero.s15.viveca", { marksman: 100 },
      { shield: 100 }, true), { heroSkillSystem: system({
        [`A:${skillId}`]: true, [`B:${DODGE}`]: true,
      }, (id) => { if (id === skillId) checks += 1; }) });
    expect(main(dodged.trace, "A", "marksman").mainHitCancelled).toBe(true);
    expect(checks).toBe(0);
    expect(skillEvents(dodged.trace, skillId)).toHaveLength(0);
  });

  it("uses attribute divisors for Sigel and natural even-round Ursa effects", () => {
    const sigel = resolveRound(battle("hero.s16.sigel"), { heroSkillSystem: system() });
    expect(attributeReduction(sigel.trace, "A", "shield", "attack")).toBeCloseTo(.20);
    expect(attributeReduction(sigel.trace, "B", "lancer", "attack")).toBeCloseTo(.35);
    expect(attributeReduction(sigel.trace, "B", "marksman", "attack")).toBeCloseTo(.35);
    expect(attributeReduction(sigel.trace, "B", "shield", "attack")).toBe(0);

    const ursa = simulateBattle(battle("hero.s16.ursa"),
      { maxRounds: 6, heroSkillSystem: system() });
    expect(ursa.trace.rounds.map((round) =>
      attributeReduction(round, "A", "shield", "defense"))).toEqual([
      0, .3, 0, .3, 0, .3,
    ]);
  });

  it("counts Ursa's second lancer attempt on dodge without 1B or vulnerability", () => {
    const skillId = "hero-skill.ursa.poison-blade";
    const result = simulateBattle(battle("hero.s16.ursa", { lancer: 100 },
      { shield: 100 }, true), { maxRounds: 3, heroSkillSystem: system({
      [`B:${DODGE}`]: false, [`2:B:lancer:${DODGE}`]: true,
    }) });
    expect(result.trace.rounds[1]!.damageEvents.some((event) =>
      event.sourceSkillId === skillId)).toBe(false);
    expect(result.finalState.sideA.heroStates[0]!.skillStates.find((entry) =>
      entry.skillId === skillId)?.mainAttackCounts.lancer).toBe(3);
    expect(main(result.trace.rounds[2]!, "A", "lancer").increaseGroups.some((group) =>
      group.group === "vulnerability")).toBe(false);
  });

  it("applies Aishilin's R3 150% to each living 0.4B target and never retargets", () => {
    const skillId = "hero-skill.aishilin.forest-fury";
    const result = simulateBattle(battle("hero.s16.aishilin", { marksman: 100 },
      { shield: 100, marksman: 100 }), { maxRounds: 3, heroSkillSystem: system() });
    const third = result.trace.rounds[2]!;
    const events = skillEvents(third, skillId);
    expect(events.map((event) => event.targetTroop)).toEqual(["shield", "marksman"]);
    expect(events.every((event) => event.skillCoefficient === .4 &&
      event.damageBasis === "parentBaseDamage" &&
      event.increaseGroups.some((group) =>
        group.group === "commonDamageIncrease" && Math.abs(group.summedValue - 1.70) < 1e-9)))
      .toBe(true);
    expect(main(third, "B", "shield").reductionGroups.find((group) =>
      group.group === "enemyOutgoingDamageReduction")?.summedValue).toBeCloseTo(.30);
  });

  it("keeps static and weapon inputs out of final-report battle attributes", () => {
    const troopLevel = "T10-FC10";
    const troopConstant = getTroopConstant(troopLevel);
    const troop = (count: number, coefficient: number) => ({ count,
      attack: .5, penetration: .5, defense: .5, life: .5,
      troopLevel, troopConstant, damageCoefficient: coefficient });
    const side = { shield: troop(1, 1), lancer: troop(1, 3), marksman: troop(1, 4) };
    for (const heroId of ["hero.s12.hervor", "hero.s13.gisela", "hero.s14.elif",
      "hero.s15.hank", "hero.s16.sigel"]) {
      const state = createPureTroopBattleState({ id: `future-${heroId}`,
        battleContext: "rallyDefense", sideA: { ...side,
          attributeInputMode: "finalReport",
          heroes: [{ heroId, position: "leader", weaponLevel: 10 }] },
        sideB: { ...side, attributeInputMode: "finalReport" }, maxRounds: 1 });
      expect(state.sideA.troops.shield.attack).toBe(.5);
      expect(state.sideA.troops.shield.life).toBe(.5);
      expect(state.sideA.heroStates[0]!.weaponLevel).toBe(0);
    }
  });
});
