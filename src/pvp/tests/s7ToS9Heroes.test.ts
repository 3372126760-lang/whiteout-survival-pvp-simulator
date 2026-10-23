import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  GATOT_KINGS_GIFT,
  calculateExclusiveWeaponBaseStats,
  createActiveEffect,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedHeroState,
  createHeroSkillSystem,
  createPureTroopBattleState,
  getExpeditionHeroData,
  getTroopConstant,
  getValidationCatalog,
  formatValidationHeroOption,
  resolveRound,
  simulateBattle,
  type ActiveEffect,
  type BattleContext,
  type BattleState,
  type HeroSkillTriggerOverrides,
  type RoundBattleTrace,
  type TroopType,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

const EDITH = "hero.s7.aidisi";
const GORDON = "hero.s7.gedun";
const BRADLEY = "hero.s7.buladeli";
const GATOT = "hero.s8.jiatuo";
const SONYA = "hero.s8.suoniya";
const HENDRIK = "hero.s8.hengdelike";
const MAGNUS = "hero.s9.magenusi";
const FRED = "hero.s9.fuleide";
const SHURA = "hero.s9.xiula";
const hugeHp = 1_000_000_000;

describe("S7-S9 expedition heroes", () => {
  it("1. registers nine heroes, Lv5 expedition skills and generation stats", () => {
    const cases = [
      [EDITH, "shield", 7, 6.5052, 1.605],
      [GORDON, "lancer", 7, 6.5052, 1.605],
      [BRADLEY, "marksman", 7, 6.5052, 1.605],
      [GATOT, "shield", 8, 7.8062, 1.93],
      [SONYA, "lancer", 8, 7.8062, 1.93],
      [HENDRIK, "marksman", 8, 7.8062, 1.93],
      [MAGNUS, "shield", 9, 9.4075, 2.32],
      [FRED, "lancer", 9, 9.4075, 2.32],
      [SHURA, "marksman", 9, 9.4075, 2.32],
    ] as const;
    for (const [heroId, troopType, generation, stat, weaponStat] of cases) {
      expect(getExpeditionHeroData(heroId)).toMatchObject({
        generation,
        stats: { troopType, attackBonus: stat, defenseBonus: stat },
        exclusiveWeapon: {
          maxPenetrationBonus: weaponStat,
          maxLifeBonus: weaponStat,
        },
      });
      const hero = createConfirmedHeroState({
        heroId, position: "leader", weaponLevel: 10,
      });
      expect(hero.skillStates.filter((skill) =>
        !skill.skillId.startsWith("hero-weapon-skill.")
      )).toHaveLength(3);
      expect(hero.skillStates.every((skill) =>
        skill.skillId.startsWith("hero-weapon-skill.") || skill.level === 5
      )).toBe(true);
      const weapon = calculateExclusiveWeaponBaseStats(heroId, 10);
      expect(weapon.penetrationBonus).toBeCloseTo(weaponStat);
      expect(weapon.lifeBonus).toBeCloseTo(weaponStat);
    }
  });

  it("2. applies all four Edith modifiers with ordinary life and defensive buffLife", () => {
    const normal = roundWithHero(EDITH, "challenge", {}, 10);
    expect(group(normal.trace, "A", "lancer", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.20);
    expect(group(normal.trace, "B", "shield", "reduction", "receivedDamageReduction"))
      .toBeCloseTo(.20);
    expect(normal.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(hugeHp * 1.25);
    const marksmanOnly = resolveRound(stateWithHero(
      EDITH,
      { marksman: 100 },
      "challenge",
      0,
      [],
      { marksman: 100 },
    ), { heroSkillSystem: heroSystem({}) });
    expect(group(marksmanOnly.trace, "B", "marksman", "reduction", "receivedDamageReduction"))
      .toBeCloseTo(.20);
    const defense = roundWithHero(EDITH, "rallyDefense", {}, 10);
    expect(defense.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(hugeHp * 1.25 * 1.15);
    expect(normal.snapshot.sideA.armyEffects.some((effect) =>
      effect.identity.sourceSkillId === "hero-weapon-skill.aidisi.defense-life"
    )).toBe(false);
  });

  it("3. triggers Gordon extraDamage on the second lancer main attack", () => {
    const simulation = simulate(GORDON, 2);
    expect(skillEvents(simulation.trace.rounds[0]!, "hero-skill.gedun.poisoned-blade"))
      .toHaveLength(0);
    expect(skillEvents(simulation.trace.rounds[1]!, "hero-skill.gedun.poisoned-blade"))
      .toHaveLength(1);
    const parent = normalAttack(simulation.trace.rounds[1]!, "A", "lancer");
    expect(skillEvents(simulation.trace.rounds[1]!, "hero-skill.gedun.poisoned-blade")[0]!
      .baseDamage).toBeCloseTo(parent.rawDamage);
    expect(simulation.trace.rounds[1]!.heroSkills.find((trace) =>
      trace.skillId === "hero-skill.gedun.poisoned-blade" && trace.triggered
    )).toMatchObject({
      attackCountAfter: 2,
      poisonTarget: "shield",
      poisonActivationRound: 3,
    });
  });

  it("4. activates Gordon Poison on R3 only and binds it to the hit stack", () => {
    const simulation = simulate(GORDON, 4);
    expect(group(simulation.trace.rounds[1]!, "B", "shield", "reduction", "poisonOutgoingDamageReduction"))
      .toBe(0);
    expect(group(simulation.trace.rounds[2]!, "B", "shield", "reduction", "poisonOutgoingDamageReduction"))
      .toBeCloseTo(.20);
    expect(group(simulation.trace.rounds[2]!, "B", "lancer", "reduction", "poisonOutgoingDamageReduction"))
      .toBe(0);
    expect(group(simulation.trace.rounds[3]!, "B", "shield", "reduction", "poisonOutgoingDamageReduction"))
      .toBe(0);
  });

  it("5. cancels Gordon Poison when its target dies without retargeting", () => {
    const system = heroSystem({});
    const roundOne = resolveRound(stateWithHero(
      GORDON, { lancer: 100 }, "challenge", 0, [],
      { shield: 100, lancer: 100 },
    ), { heroSkillSystem: system });
    const roundTwo = resolveRound(roundOne.stateAfter, { heroSkillSystem: system });
    expect(roundTwo.trace.heroSkills.find((trace) =>
      trace.skillId === "hero-skill.gedun.poisoned-blade" && trace.triggered
    )?.poisonTarget).toBe("shield");
    const shield = roundTwo.stateAfter.sideB.troops.shield;
    const targetRemoved: BattleState = {
      ...roundTwo.stateAfter,
      sideB: {
        ...roundTwo.stateAfter.sideB,
        troops: {
          ...roundTwo.stateAfter.sideB.troops,
          shield: {
            ...shield,
            aliveCount: 0,
            frontUnitHp: 0,
            levelComposition: shield.levelComposition.map((entry) => ({
              ...entry, aliveCount: 0,
            })),
          },
        },
      },
    };
    const roundThree = resolveRound(targetRemoved, { heroSkillSystem: system });
    expect(group(roundThree.trace, "B", "lancer", "reduction", "poisonOutgoingDamageReduction"))
      .toBe(0);
  });

  it("6. applies Gordon R3 fear and R4/R5 corrosion windows", () => {
    const simulation = simulate(GORDON, 6);
    expect(group(simulation.trace.rounds[2]!, "A", "lancer", "increase", "commonDamageIncrease"))
      .toBeCloseTo(1.50);
    expect(group(simulation.trace.rounds[3]!, "A", "lancer", "increase", "commonDamageIncrease"))
      .toBe(0);
    for (const round of [4, 5]) {
      expect(group(simulation.trace.rounds[round - 1]!, "A", "shield", "increase", "vulnerability"))
        .toBeCloseTo(.30);
      expect(group(simulation.trace.rounds[round - 1]!, "B", "marksman", "reduction", "gordonMarksmanOutgoingReduction"))
        .toBeCloseTo(.30);
    }
  });

  it("7. applies Bradley attack, target modifiers and R5/R6 cycle", () => {
    const simulation = simulate(BRADLEY, 10);
    expect(attributeGroup(simulation.trace.rounds[0]!, "A", "shield", "attack", "heroAttackBonus"))
      .toBeCloseTo(.25);
    expect(group(simulation.trace.rounds[0]!, "A", "shield", "increase", "troopVsTroopDamage"))
      .toBeCloseTo(.25);
    expect(group(simulation.trace.rounds[3]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBe(0);
    expect(group(simulation.trace.rounds[4]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.30);
    expect(group(simulation.trace.rounds[5]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.30);
    expect(group(simulation.trace.rounds[6]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBe(0);
    expect(group(simulation.trace.rounds[8]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.30);
    expect(group(simulation.trace.rounds[9]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.30);
    const vsLancer = resolveRound(stateWithHero(
      BRADLEY, { shield: 100 }, "challenge", 0, [], { lancer: 100 },
    ), { heroSkillSystem: heroSystem({}) });
    expect(group(vsLancer.trace, "A", "shield", "increase", "troopVsTroopDamage"))
      .toBeCloseTo(.30);
  });

  it("8. applies Gatot shield defense and enemyAttackReduction", () => {
    const result = roundWithHero(GATOT);
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(hugeHp);
    expect(normalAttack(result.trace, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1.30);
    expect(attributeReductionGroup(result.trace, "B", "shield", "attack", "enemyAttackReduction"))
      .toBeCloseTo(.25);
    expect(GATOT_KINGS_GIFT.metadata.ruleStatus).toBe("supported");
    expect(getExpeditionHeroData(GATOT)?.name).toBe("加托");
  });

  it("9. generates Gatot shield from report attack and current shield count", () => {
    const baseline = roundWithHero(GATOT);
    const reduced = roundWithHero(GATOT, "challenge", {}, 0, [
      makeDamageEffect({
        id: "target-reduction", kind: "damageReduction",
        group: "testTargetReduction", value: .80,
      }),
    ]);
    const baseTrace = baseline.trace.heroSkills.find((trace) =>
      trace.skillId === GATOT_KINGS_GIFT.id
    )!;
    const reducedTrace = reduced.trace.heroSkills.find((trace) =>
      trace.skillId === GATOT_KINGS_GIFT.id
    )!;
    expect(baseTrace).toMatchObject({
      temporaryShieldGenerated: true,
      temporaryShieldRuleStatus: "supported",
      activationTiming: "nextRound",
      triggerRound: 1,
      activationRound: 2,
    });
    const source = baseline.snapshot.sideA.troops.shield;
    expect(baseTrace.gatotShield?.calculatedAttackX).toBeCloseTo(
      100 * source.troopConstant * Math.sqrt(source.aliveCount) * (1 + source.attack));
    expect(baseTrace.generatedShieldHp).toBeCloseTo(baseTrace.gatotShield!.calculatedAttackX * .30);
    expect(reducedTrace.generatedShieldHp).toBeCloseTo(baseTrace.generatedShieldHp!);
    expect(reduced.stateAfterActionPhase.sideA.troops.shield.temporaryShieldHp).toBe(0);
    expect(reduced.stateAfter.sideA.troops.shield.temporaryShieldHp)
      .toBeCloseTo(reducedTrace.generatedShieldHp!);
  });

  it("9a. replaces a remaining Gatot shield when the next shield attack refreshes it", () => {
    const initial = stateWithHero(GATOT);
    const shield = initial.sideA.troops.shield;
    const oldLayer = {
      id: `temporary-shield:A:shield:${GATOT_KINGS_GIFT.id}`,
      sourceSkillId: GATOT_KINGS_GIFT.id,
      sourceHeroId: GATOT,
      ruleStatus: "supported" as const,
      generatedShieldHp: 40_000,
      remainingShieldHp: 40_000,
      generatedRound: 1,
      generatedActionOrder: 0,
      activeFromRound: 1,
      expiresAfterRound: 1,
    };
    const seeded = {
      ...initial,
      sideA: { ...initial.sideA, troops: { ...initial.sideA.troops,
        shield: { ...shield, temporaryShields: [oldLayer], temporaryShieldHp: 40_000 },
      } },
    };
    const result = resolveRound(seeded, { heroSkillSystem: heroSystem({}) });
    const generated = result.trace.heroSkills.find((entry) =>
      entry.skillId === GATOT_KINGS_GIFT.id)?.generatedShieldHp;
    expect(generated).toBeDefined();
    expect(result.stateAfterActionPhase.sideA.troops.shield.temporaryShields).toHaveLength(2);
    expect(result.stateAfterActionPhase.sideA.troops.shield.temporaryShieldHp)
      .toBeCloseTo(40_000);
    expect(result.stateAfter.sideA.troops.shield.temporaryShieldHp).toBeCloseTo(generated!);
    expect(result.trace.heroSkills.find((entry) =>
      entry.skillId === GATOT_KINGS_GIFT.id)?.gatotShield?.previousShield).toBe(40_000);
  });

  it("10. activates Gatot shield next round, then consumes it before troop HP", () => {
    const first = roundWithHero(GATOT);
    expect(normalAttack(first.trace, "B", "shield").temporaryShield).toHaveLength(0);
    const result = resolveRound(first.stateAfter, { heroSkillSystem: heroSystem({}) });
    const incoming = normalAttack(result.trace, "B", "shield");
    expect(incoming.temporaryShield).toHaveLength(1);
    expect(incoming.temporaryShield[0]).toMatchObject({
      shieldSourceSkill: GATOT_KINGS_GIFT.id,
      ruleStatus: "supported",
    });
    expect(incoming.temporaryShield[0]!.absorbedDamage).toBeCloseTo(
      Math.min(
        incoming.finalDamage,
        incoming.temporaryShield[0]!.generatedShieldHp,
      ),
    );
    expect(incoming.temporaryShieldAbsorbed).toBeCloseTo(
      incoming.temporaryShield[0]!.absorbedDamage,
    );
    expect(result.stateAfter.sideA.troops.shield.temporaryShields.every((layer) =>
      layer.activeFromRound === 3)).toBe(true);
  });

  it("11. applies Sonya damage and second-attack extraDamage plus one-round attack", () => {
    const simulation = simulate(SONYA, 3);
    expect(group(simulation.trace.rounds[0]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.20);
    expect(skillEvents(simulation.trace.rounds[1]!, "hero-skill.suoniya.bounty-temptation"))
      .toHaveLength(1);
    expect(attributeGroup(simulation.trace.rounds[1]!, "A", "marksman", "attack", "heroAttackBonus"))
      .toBe(0);
    expect(attributeGroup(simulation.trace.rounds[2]!, "A", "marksman", "attack", "heroAttackBonus"))
      .toBeCloseTo(.25);
  });

  it("12. stuns Sonya's hit target for the entire next round without attackCount", () => {
    const state = stateWithTwoHeroes(SONYA, GATOT);
    const simulation = simulateBattle(state, {
      maxRounds: 6,
      heroSkillSystem: heroSystem({}),
    });
    expect(skillEvents(simulation.trace.rounds[4]!, "hero-skill.suoniya.torrent-impact"))
      .toHaveLength(1);
    const parent = normalAttack(simulation.trace.rounds[4]!, "A", "lancer");
    expect(skillEvents(simulation.trace.rounds[4]!, "hero-skill.suoniya.torrent-impact")[0]!
      .baseDamage).toBeCloseTo(parent.baseDamage * 2.50);
    expect(simulation.trace.rounds[4]!.heroSkills.find((trace) =>
      trace.skillId === "hero-skill.suoniya.torrent-impact" && trace.triggered
    )).toMatchObject({ stunTarget: "shield", skippedRound: 6 });
    expect(simulation.trace.rounds[5]!.damageEvents.some((event) =>
      event.sourceSide === "B" && event.sourceTroop === "shield" &&
      event.parentEventId === undefined
    )).toBe(false);
    const gatot = simulation.finalState.sideB.heroStates.find(
      (hero) => hero.heroId === GATOT,
    )!;
    const runtime = gatot.skillStates.find(
      (skill) => skill.skillId === GATOT_KINGS_GIFT.id,
    )!;
    expect(runtime.mainAttackCounts.shield).toBe(5);
  });

  it("13. keeps Hendrik defenseReduction independent", () => {
    const result = roundWithHero(HENDRIK);
    expect(normalAttack(result.trace, "A", "shield").attributeResolutions
      ?.find((entry) => entry.attribute === "defense")?.reductionGroups)
      .toContainEqual(expect.objectContaining({
        group: "enemyDefenseReduction", summedValue: .25,
      }));
  });

  it("14. activates Hendrik Barnacle Armor on R5/R6 and removes it on R7", () => {
    const simulation = simulate(HENDRIK, 7);
    const values = simulation.trace.rounds.map((round) =>
      normalAttack(round, "B", "shield").attributeResolutions?.find((entry) =>
        entry.attribute === "defense")?.modifierGroups.find((entry) =>
          entry.group === "heroDefenseBonus")?.summedValue ?? 0
    );
    expect(values).toEqual([0, 0, 0, 0, .30, .30, 0]);
  });

  it("15. creates one Hendrik 40% event per currently alive enemy stack on R3", () => {
    const simulation = simulate(HENDRIK, 3);
    const events = skillEvents(
      simulation.trace.rounds[2]!,
      "hero-skill.s8.hengdelike.heir-of-forest",
    );
    expect(events.map((event) => event.targetTroop).sort()).toEqual([
      "lancer", "marksman", "shield",
    ]);
    expect(simulation.trace.rounds[2]!.heroSkills.find((trace) =>
      trace.skillId === "hero-skill.s8.hengdelike.heir-of-forest" && trace.triggered
    )?.multiTargetExtraDamageEvents).toHaveLength(3);
    const withDeadMarksman = simulateBattle(stateWithHero(
      HENDRIK,
      { shield: 100, lancer: 100, marksman: 100 },
      "challenge",
      0,
      [],
      { shield: 100, lancer: 100 },
    ), { maxRounds: 3, heroSkillSystem: heroSystem({}) });
    expect(skillEvents(
      withDeadMarksman.trace.rounds[2]!,
      "hero-skill.s8.hengdelike.heir-of-forest",
    ).map((event) => event.targetTroop).sort()).toEqual(["lancer", "shield"]);
  });

  it("15a. keeps S8 skill damage on kB and pools Sonya's R10 coefficients", () => {
    const simulation = simulate(SONYA, 10);
    const r2 = simulation.trace.rounds[1]!;
    const bounty = skillEvents(r2, "hero-skill.suoniya.bounty-temptation")[0]!;
    expect(bounty.damageBasis).toBe("parentBaseDamage");
    expect(bounty.baseDamage).toBeCloseTo(normalAttack(r2, "A", "lancer").baseDamage * .75);
    expect(attributeGroup(r2, "A", "marksman", "attack", "heroAttackBonus")).toBe(0);
    expect(attributeGroup(simulation.trace.rounds[2]!, "A", "marksman", "attack", "heroAttackBonus"))
      .toBeCloseTo(.25);
    const r10 = simulation.trace.rounds[9]!;
    const skills = r10.damageEvents.filter(e=>e.sourceSide === "A" && e.sourceTroop === "lancer" && e.damageType === "skillDamage");
    expect(skills.map(e=>e.skillCoefficient).sort()).toEqual([.75,2.5].sort());
    expect(skills.every(e=>e.skillPoolComponents === undefined)).toBe(true);
    expect(skills.reduce((sum,e)=>sum+e.baseDamage,0)).toBeCloseTo(normalAttack(r10,"A","lancer").baseDamage * 3.25);
  });

  it("15b. keeps Sonya's torrent on natural R5/R10 after a missed lancer attack", () => {
    const initial = stateWithTwoHeroes(SONYA, GATOT);
    const stun = createActiveEffect({
      identity: { sourceId: "test:sonya-stun", sourceSkillId: "test:stun",
        effectId: "test:sonya-stun" },
      definition: { id: "test:sonya-stun", name: "test:sonya-stun",
        kind: "skipNextRoundAction", ruleStatus: "supported",
        lifecycle: { activationTiming: "nextRound", durationRounds: 1,
          refreshMode: "replace" } },
      appliedRound: 1, holderScope: "lancer",
    });
    const lancer = initial.sideA.troops.lancer;
    const state: BattleState = { ...initial, sideA: { ...initial.sideA,
      troops: { ...initial.sideA.troops,
        lancer: { ...lancer, debuffs: [...lancer.debuffs, stun] } } } };
    const simulation = simulateBattle(state, {
      maxRounds: 11, heroSkillSystem: heroSystem({}),
    });
    expect(normalAttack(simulation.trace.rounds[1]!, "A", "lancer")).toBeUndefined();
    expect(skillEvents(simulation.trace.rounds[2]!, "hero-skill.suoniya.bounty-temptation"))
      .toHaveLength(1);
    expect(simulation.trace.rounds.flatMap((round) => round.heroSkills.filter((entry) =>
      entry.skillId === "hero-skill.suoniya.torrent-impact" &&
      entry.torrentTriggerRound !== undefined)
      .map(() => round.round))).toEqual([5, 10]);
    for (const roundNumber of [6, 11]) {
      expect(simulation.trace.rounds[roundNumber - 1]!.damageEvents.some((event) =>
        event.sourceSide === "B" && event.sourceTroop === "shield" &&
        event.parentEventId === undefined)).toBe(false);
    }
  });

  it("15c. matches 257 natural rounds, 51 torrent stuns and 206 Gatot attacks", () => {
    const simulation = simulateBattle(stateWithTwoHeroes(SONYA, GATOT), {
      maxRounds: 257, heroSkillSystem: heroSystem({}),
    });
    expect(simulation.trace.rounds).toHaveLength(257);
    expect(simulation.trace.rounds.flatMap((round) => round.heroSkills.filter((entry) =>
      entry.skillId === "hero-skill.suoniya.torrent-impact" &&
      entry.torrentTriggerRound !== undefined)))
      .toHaveLength(51);
    expect(simulation.trace.rounds.flatMap((round) => round.heroSkills.filter((entry) =>
      entry.skillId === GATOT_KINGS_GIFT.id && entry.triggered))).toHaveLength(206);
  });

  it("15c2. skips Gatot's R6 trigger after R5 torrent and leaves R7 without a new shield", () => {
    const simulation = simulateBattle(stateWithTwoHeroes(SONYA, GATOT), {
      maxRounds: 7, heroSkillSystem: heroSystem({}),
    });
    expect(simulation.trace.rounds[5]!.heroSkills.some((entry) =>
      entry.skillId === GATOT_KINGS_GIFT.id && entry.triggered)).toBe(false);
    expect(simulation.trace.rounds[6]!.damageEvents.find((event) =>
      event.sourceSide === "A" && event.sourceTroop === "lancer" &&
      event.targetSide === "B" && event.targetTroop === "shield" &&
      event.parentEventId === undefined)?.temporaryShield).toHaveLength(0);
  });

  it("15d. adds Gatot and Hendrik defense bonuses within one heroDefenseBonus group", () => {
    const initial = stateWithHero(GATOT);
    const sideA = { ...initial.sideA, heroStates: createConfirmedHeroFormation([
      { heroId: GATOT, position: "leader" },
      { heroId: HENDRIK, position: "leader" },
    ]) };
    const simulation = simulateBattle({ ...initial, sideA }, {
      maxRounds: 18, heroSkillSystem: heroSystem({}),
    });
    const activeRounds = simulation.trace.rounds.map((round, index) => {
      const event = normalAttack(round, "B", "shield");
      expect(event.targetDefenseMultiplier).toBeCloseTo(
        [5, 6, 9, 10, 13, 14, 17, 18].includes(index + 1) ? 1.60 : 1.30);
      return event.attributeResolutions?.find((entry) => entry.attribute === "defense")
        ?.modifierGroups.find((entry) => entry.group === "heroDefenseBonus")
        ?.summedValue === .60 ? index + 1 : 0;
    }).filter(Boolean);
    expect(activeRounds).toEqual([5, 6, 9, 10, 13, 14, 17, 18]);
  });

  it("15e. uses each target's defense for Hendrik's natural R3 multi-target 0.4B", () => {
    const initial = stateWithHero(HENDRIK);
    const targets = initial.sideB.troops;
    const state: BattleState = { ...initial, sideB: { ...initial.sideB,
      troops: { ...targets,
        shield: { ...targets.shield, defense: 0 },
        lancer: { ...targets.lancer, defense: 1 },
        marksman: { ...targets.marksman, defense: 2 },
      } } };
    const simulation = simulateBattle(state, { maxRounds: 3,
      heroSkillSystem: heroSystem({}) });
    const round = simulation.trace.rounds[2]!;
    const events = skillEvents(round, "hero-skill.s8.hengdelike.heir-of-forest");
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.damageBasis)).toEqual([
      "parentBaseDamage", "parentBaseDamage", "parentBaseDamage",
    ]);
    expect(events.every((event) => event.baseDamage === events[0]!.baseDamage)).toBe(true);
    expect(events.map((event) => event.targetDefenseMultiplier).sort())
      .toEqual([.8, 1.6, 2.4]);
    expect(events[0]!.baseDamage).toBeCloseTo(
      normalAttack(round, "A", "marksman").baseDamage * .40);
  });

  it.each([
    [GATOT, "rallyDefense"], [SONYA, "rallyDefense"],
    [HENDRIK, "rallyAttack"],
  ] as const)("15f. final-report avoids %s exclusive weapon double count", (heroId, battleContext) => {
    const troopLevel = "T10-FC10";
    const troopConstant = getTroopConstant(troopLevel);
    const troop = (count: number, damageCoefficient: number) => ({ count,
      attack: .5, penetration: .5, defense: .5, life: .5,
      troopLevel, troopConstant, damageCoefficient });
    const side = { shield: troop(1, 1), lancer: troop(1, 3),
      marksman: troop(1, 4) };
    const scenario = { id: "s8-final-report", battleContext,
      sideA: { ...side, attributeInputMode: "finalReport" as const,
        heroes: [{ heroId, position: "leader" as const, weaponLevel: 10 }] },
      sideB: { ...side, attributeInputMode: "finalReport" as const },
      maxRounds: 1 };
    const final = createPureTroopBattleState(scenario);
    const prediction = createPureTroopBattleState({ ...scenario,
      sideA: { ...scenario.sideA, attributeInputMode: "prediction" } });
    expect(final.sideA.heroStates[0]!.weaponLevel).toBe(0);
    expect(final.sideA.heroStates[0]!.skillStates.some((skill) =>
      skill.skillId.startsWith("hero-weapon-skill."))).toBe(false);
    expect(final.sideA.heroStates[0]!.skillStates).toHaveLength(3);
    expect(prediction.sideA.heroStates[0]!.skillStates.some((skill) =>
      skill.skillId.startsWith("hero-weapon-skill."))).toBe(true);
    expect(final.sideA.troops.shield.attack).toBe(.5);
    expect(final.sideA.troops.shield.defense).toBe(.5);
  });

  it("16. applies Magnus defense immediately after the shield attack for this round only", () => {
    const skillId = "hero-skill.magenusi.steel-phalanx";
    const simulation = simulate(MAGNUS, 2, {
      [skillId]: false,
      [`1:A:shield:${skillId}`]: true,
    });
    expect(normalAttack(simulation.trace.rounds[0]!, "B", "shield").targetDefenseMultiplier)
      .toBeCloseTo(1.50);
    expect(normalAttack(simulation.trace.rounds[0]!, "A", "marksman").targetDefenseMultiplier)
      .toBe(1);
    expect(normalAttack(simulation.trace.rounds[1]!, "B", "shield").targetDefenseMultiplier)
      .toBe(1);
    expect(simulation.trace.rounds[0]!.heroSkills.find((trace) =>
      trace.skillId === skillId && trace.triggered
    )).toMatchObject({
      defenseBuffActivation: "immediateCurrentRound",
      procResult: true,
      procRoll: null,
    });
    expect(attributeGroup(simulation.trace.rounds[0]!, "A", "shield", "attack", "heroAttackBonus"))
      .toBeCloseTo(.25);
    expect(group(simulation.trace.rounds[0]!, "A", "marksman", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.10);
    expect(group(simulation.trace.rounds[0]!, "B", "shield", "reduction", "receivedDamageReduction"))
      .toBeCloseTo(.10);
  });

  it("17. applies Fred static debuffs and R4/R5 tidal timing", () => {
    const simulation = simulate(FRED, 5);
    expect(attributeReductionGroup(simulation.trace.rounds[0]!, "B", "shield", "penetration", "enemyPenetrationReduction"))
      .toBeCloseTo(.20);
    expect(group(simulation.trace.rounds[0]!, "A", "shield", "increase", "vulnerability"))
      .toBeCloseTo(.20);
    for (const target of ["lancer", "marksman"] as const) {
      const onlyTarget = resolveRound(stateWithHero(
        FRED, { shield: 100 }, "challenge", 0, [], { [target]: 100 },
      ), { heroSkillSystem: heroSystem({}) });
      expect(group(onlyTarget.trace, "A", "shield", "increase", "vulnerability"))
        .toBe(0);
    }
    expect(skillEvents(simulation.trace.rounds[3]!, "hero-skill.fuleide.tidal-offensive"))
      .toHaveLength(1);
    expect(skillEvents(simulation.trace.rounds[3]!, "hero-skill.fuleide.tidal-offensive")[0]!
      .baseDamage).toBeCloseTo(
        normalAttack(simulation.trace.rounds[3]!, "A", "lancer").baseDamage * 2,
      );
    expect(group(simulation.trace.rounds[3]!, "B", "shield", "reduction", "fredNextRoundOutgoingReduction"))
      .toBe(0);
    expect(group(simulation.trace.rounds[4]!, "B", "shield", "reduction", "enemyOutgoingDamageReduction"))
      .toBeCloseTo(.20);
  });

  it("18. applies Shura static modifiers and R2 extra/R3 target vulnerability", () => {
    const simulation = simulate(SHURA, 3);
    expect(group(simulation.trace.rounds[0]!, "B", "shield", "reduction", "receivedDamageReduction"))
      .toBeCloseTo(.20);
    const marksmanOnly = resolveRound(stateWithHero(
      SHURA, { marksman: 100 }, "challenge", 0, [], { marksman: 100 },
    ), { heroSkillSystem: heroSystem({}) });
    expect(group(marksmanOnly.trace, "A", "marksman", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.10);
    expect(group(marksmanOnly.trace, "B", "marksman", "reduction", "receivedDamageReduction"))
      .toBeCloseTo(.35);
    expect(skillEvents(simulation.trace.rounds[1]!, "hero-skill.xiula.piercing-arrow"))
      .toHaveLength(1);
    expect(skillEvents(simulation.trace.rounds[1]!, "hero-skill.xiula.piercing-arrow")[0]!
      .baseDamage).toBeCloseTo(
        normalAttack(simulation.trace.rounds[1]!, "A", "marksman").baseDamage,
      );
    expect(group(simulation.trace.rounds[1]!, "A", "marksman", "increase", "vulnerability"))
      .toBe(0);
    expect(group(simulation.trace.rounds[2]!, "A", "marksman", "increase", "vulnerability"))
      .toBeCloseTo(.25);
  });

  it("19. exposes S7-S9 in the ordinary UI catalog and isolates Gatot tentative status", () => {
    const heroIds = new Set([
      EDITH, GORDON, BRADLEY, GATOT, SONYA, HENDRIK, MAGNUS, FRED, SHURA,
    ]);
    const catalog = getValidationCatalog().leaderHeroes.filter((hero) =>
      heroIds.has(hero.heroId)
    );
    expect(catalog).toHaveLength(9);
    expect(formatValidationHeroOption(catalog.find((hero) => hero.heroId === GATOT)!))
      .toBe("加托（S8）");
    const definitions = CONFIRMED_HERO_SKILL_DEFINITIONS.filter((definition) =>
      heroIds.has(definition.heroId)
    );
    expect(definitions.filter((definition) =>
      definition.positionRule.kind === "expeditionSkillSlot"
    )).toHaveLength(27);
    expect(definitions.filter((definition) =>
      definition.positionRule.kind === "exclusiveWeapon"
    )).toHaveLength(9);
    expect(definitions.filter((definition) =>
      definition.metadata.ruleStatus === "TENTATIVE"
    ).map((definition) => definition.id)).toEqual([]);
  });
});

function roundWithHero(
  heroId: string,
  battleContext: BattleContext = "challenge",
  overrides: HeroSkillTriggerOverrides = {},
  weaponLevel = 0,
  enemyArmyEffects: readonly ActiveEffect[] = [],
) {
  return resolveRound(stateWithHero(
    heroId,
    { shield: 100, lancer: 100, marksman: 100 },
    battleContext,
    weaponLevel,
    enemyArmyEffects,
  ), { heroSkillSystem: heroSystem(overrides) });
}

function simulate(
  heroId: string,
  rounds: number,
  overrides: HeroSkillTriggerOverrides = {},
) {
  return simulateBattle(stateWithHero(heroId), {
    maxRounds: rounds,
    heroSkillSystem: heroSystem(overrides),
  });
}

function stateWithHero(
  heroId: string,
  counts: Partial<Record<TroopType, number>> = {
    shield: 100, lancer: 100, marksman: 100,
  },
  battleContext: BattleContext = "challenge",
  weaponLevel = 0,
  enemyArmyEffects: readonly ActiveEffect[] = [],
  enemyCounts: Partial<Record<TroopType, number>> = {
    shield: 100, lancer: 100, marksman: 100,
  },
  enemyMaxHp = hugeHp,
): BattleState {
  return createBattleState({
    battleContext,
    sideA: {
      ...makeSide(counts, { maxHpPerUnit: hugeHp }),
      heroStates: createConfirmedHeroFormation([
        { heroId, position: "leader", weaponLevel },
      ]),
    },
    sideB: makeSide(enemyCounts, {
      maxHpPerUnit: enemyMaxHp,
      armyEffects: enemyArmyEffects,
    }),
  });
}

function stateWithTwoHeroes(sideAHeroId: string, sideBHeroId: string) {
  return createBattleState({
    sideA: {
      ...makeSide(
        { shield: 100, lancer: 100, marksman: 100 },
        { maxHpPerUnit: hugeHp },
      ),
      heroStates: createConfirmedHeroFormation([
        { heroId: sideAHeroId, position: "leader" },
      ]),
    },
    sideB: {
      ...makeSide(
        { shield: 100, lancer: 100, marksman: 100 },
        { maxHpPerUnit: hugeHp },
      ),
      heroStates: createConfirmedHeroFormation([
        { heroId: sideBHeroId, position: "leader" },
      ]),
    },
  });
}

function heroSystem(overrides: HeroSkillTriggerOverrides) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    triggerOverrides: overrides,
    randomSource: { next: () => .99 },
  });
}

function normalAttack(
  round: RoundBattleTrace,
  side: "A" | "B",
  troop: TroopType,
) {
  return round.damageEvents.find((event) =>
    event.sourceSide === side && event.sourceTroop === troop &&
    event.damageSubtype === "normalAttack" && event.parentEventId === undefined
  )!;
}

function skillEvents(round: RoundBattleTrace, skillId: string) {
  return round.damageEvents.filter((event) => event.sourceSkillId === skillId);
}

function group(
  round: RoundBattleTrace,
  side: "A" | "B",
  troop: TroopType,
  kind: "increase" | "reduction",
  groupName: string,
): number {
  const event = normalAttack(round, side, troop);
  const groups = kind === "increase" ? event.increaseGroups : event.reductionGroups;
  return groups.find((entry) => entry.group === groupName)?.summedValue ?? 0;
}

function attributeGroup(
  round: RoundBattleTrace,
  side: "A" | "B",
  troop: TroopType,
  attribute: "attack" | "penetration",
  groupName: string,
): number {
  return normalAttack(round, side, troop).attributeResolutions
    ?.find((entry) => entry.attribute === attribute)
    ?.modifierGroups.find((entry) => entry.group === groupName)
    ?.summedValue ?? 0;
}

function attributeReductionGroup(
  round: RoundBattleTrace,
  side: "A" | "B",
  troop: TroopType,
  attribute: "attack" | "penetration",
  groupName: string,
): number {
  return normalAttack(round, side, troop).attributeResolutions
    ?.find((entry) => entry.attribute === attribute)
    ?.reductionGroups.find((entry) => entry.group === groupName)
    ?.summedValue ?? 0;
}
