import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  calculateExclusiveWeaponBaseStats,
  calculateHeroStatCorrection,
  createBattleState,
  createConfirmedHeroFormation,
  createHeroSkillSystem,
  createTroopSkillSystem,
  createConfirmedTroopSkillLoadout,
  getExclusiveWeaponSkillTier,
  getExpeditionHeroData,
  resolveRound,
  type BattleContext,
  type BattleState,
  type HeroFormationInput,
  type RandomSource,
  type ResolvedRound,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const JERONIMO = "hero.s1.heluonimo";
const NATALIA = "hero.s1.nataliya";
const MOLLY = "hero.s1.moli";
const ZINMAN = "hero.s1.jinman";
const hugeHp = 1_000_000_000;

describe("S1 expedition heroes and exclusive weapons", () => {
  it("1. records Jeronimo expedition attack/defense as 260.20%", () => {
    expect(getExpeditionHeroData(JERONIMO)?.stats).toMatchObject({
      troopType: "shield",
      attackBonus: 2.602,
      defenseBonus: 2.602,
    });
  });

  it("2. records all other S1 attack/defense as 200.16%", () => {
    for (const id of [NATALIA, MOLLY, ZINMAN]) {
      expect(getExpeditionHeroData(id)?.stats).toMatchObject({
        attackBonus: 2.0016,
        defenseBonus: 2.0016,
      });
    }
  });

  it("3. computes Jeronimo Lv10 weapon base stats as 62.5% / 62.5%", () => {
    expect(calculateExclusiveWeaponBaseStats(JERONIMO, 10)).toEqual({
      level: 10,
      penetrationBonus: .625,
      lifeBonus: .625,
    });
  });

  it("4. computes other S1 Lv10 weapon base stats as 55% / 55%", () => {
    for (const id of [NATALIA, MOLLY, ZINMAN]) {
      expect(calculateExclusiveWeaponBaseStats(id, 10)).toEqual({
        level: 10,
        penetrationBonus: .55,
        lifeBonus: .55,
      });
    }
  });

  it("5. keeps Lv0 weapon base stats at zero", () => {
    expect(calculateExclusiveWeaponBaseStats(JERONIMO, 0)).toEqual({
      level: 0,
      penetrationBonus: 0,
      lifeBonus: 0,
    });
  });

  it("6. linearly computes Jeronimo Lv9 as 56.25% / 56.25%", () => {
    expect(calculateExclusiveWeaponBaseStats(JERONIMO, 9)).toEqual({
      level: 9,
      penetrationBonus: .5625,
      lifeBonus: .5625,
    });
  });

  it("7. linearly computes other S1 Lv9 as 49.5% / 49.5%", () => {
    expect(calculateExclusiveWeaponBaseStats(MOLLY, 9)).toEqual({
      level: 9,
      penetrationBonus: .495,
      lifeBonus: .495,
    });
  });

  it("8. maps Lv9 weapon scene skill to tier 4 and 12.5%", () => {
    expect(getExclusiveWeaponSkillTier(9)).toBe(4);
    const event = attack(roundWithHero(
      { heroId: JERONIMO, position: "leader", weaponLevel: 9 },
      "rallyAttack",
    ), "A", "shield");
    expect(attributeGroup(event, "attack", "buffAttack")).toMatchObject({
      operation: "addToExternalBuff",
      summedValue: .125,
    });
  });

  it("9. maps Lv10 weapon scene skill to tier 5 and 15%", () => {
    expect(getExclusiveWeaponSkillTier(10)).toBe(5);
    const event = attack(roundWithHero(
      { heroId: NATALIA, position: "leader", weaponLevel: 10 },
      "rallyAttack",
      countedRandom([.9]),
    ), "A", "shield");
    expect(attributeGroup(event, "penetration", "buffPenetration")?.summedValue)
      .toBe(.15);
  });

  it("10. activates Jeronimo skill 3 only on 5/6/9/10...", () => {
    let state = heroBattleState(
      { heroId: JERONIMO, position: "leader" },
      "rallyAttack",
      { shield: 100 },
    );
    const activeRounds: number[] = [];
    for (let round = 1; round <= 10; round += 1) {
      const resolved = resolveRound(state, { heroSkillSystem: heroSystem() });
      const event = attack(resolved, "A", "shield");
      if (event.increaseGroups.some((group) =>
        group.effectInstanceIds.some((id) => id.includes("periodic-damage"))
      )) activeRounds.push(round);
      state = resolved.stateAfter;
    }
    expect(activeRounds).toEqual([5, 6, 9, 10]);
  });

  it("11. checks Natalia Wild Roar exactly once per round", () => {
    const random = countedRandom([.1]);
    const result = roundWithHero(
      { heroId: NATALIA, position: "leader" },
      "rallyAttack",
      random,
    );
    const traces = result.trace.heroSkills.filter(
      (trace) => trace.skillId === "hero-skill.nataliya.wild-roar",
    );
    expect(random.calls()).toBe(1);
    expect(traces).toEqual([expect.objectContaining({
      round: 1,
      probability: .4,
      rngRoll: .1,
      triggered: true,
      damageIncrease: 0,
    })]);
    expect(attack(result, "B", "shield").reductionGroups).toEqual(
      expect.arrayContaining([expect.objectContaining({ summedValue: .5 })]),
    );
  });

  it("12. checks Molly Snow Command exactly once per round", () => {
    const random = countedRandom([.1]);
    const result = roundWithHero({
      heroId: MOLLY,
      position: "member",
      selectedMemberSkillId: "hero-skill.moli.snow-command",
    }, "rallyAttack", random);
    expect(random.calls()).toBe(1);
    expect(result.trace.heroSkills.filter(
      (trace) => trace.skillId === "hero-skill.moli.snow-command",
    )).toHaveLength(1);
  });

  it("13. checks Molly Ice Field independently for three troop attacks", () => {
    const random = countedRandom([.9, .1, .8, .2]);
    const result = roundWithHero(
      { heroId: MOLLY, position: "leader" },
      "rallyAttack",
      random,
    );
    const traces = result.trace.heroSkills.filter(
      (trace) => trace.skillId === "hero-skill.moli.ice-field",
    );
    expect(traces.map((trace) => [trace.sourceTroop, trace.rngRoll, trace.triggered]))
      .toEqual([
        ["shield", .1, true],
        ["lancer", .8, false],
        ["marksman", .2, true],
      ]);
  });

  it("14. reuses the marksman Ice Field result for Rapid Fire's second shot", () => {
    const random = countedRandom([.9, .1, .05]);
    const sideA = makeSide({ marksman: 100 }, {
      maxHpPerUnit: hugeHp,
      skillStates: {
        marksman: createConfirmedTroopSkillLoadout("marksman", "T7"),
      },
    });
    const state = createBattleState({
      battleContext: "rallyAttack",
      sideA: {
        ...sideA,
        heroStates: createConfirmedHeroFormation([{ heroId: MOLLY, position: "leader" }]),
      },
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        randomSource: random,
      }),
      heroSkillSystem: heroSystem(random),
    });
    expect(result.trace.heroSkills.filter(
      (trace) => trace.skillId === "hero-skill.moli.ice-field",
    )).toHaveLength(1);
    const shots = result.trace.damageEvents.filter(
      (event) => event.sourceSide === "A" && event.sourceTroop === "marksman",
    );
    expect(shots).toHaveLength(3);
    const normal = shots.find((event) => event.damageType === "normalAttack")!;
    const extra = shots.find((event) => event.sourceSkillId === "hero-skill.moli.ice-field")!;
    expect(shots.some(e=>e.sourceSkillId === "marksman-rapid-fire")).toBe(true);
    expect(normal.appliedIncreaseEffects.some((effect) =>
      effect.effectId === "hero-effect.moli.ice-field"
    )).toBe(false);
    expect(extra).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage", parentEventId: normal.id });
    expect(extra.baseDamage).toBeCloseTo(normal.baseDamage * .5);
  });

  it("15. applies Zinman defense/life before the Round 1 snapshot", () => {
    const result = resolveRound(heroBattleState(
      { heroId: ZINMAN, position: "leader" },
      "rallyAttack",
      { shield: 100 },
      1_000,
    ), { heroSkillSystem: heroSystem() });
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_100);
    expect(result.snapshot.sideA.troops.shield.frontUnitHp).toBeCloseTo(1_100);
    expect(attack(result, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1.1);
  });

  it("16. excludes Zinman's non-combat architecture skill from PVP", () => {
    const hero = createConfirmedHeroFormation([{ heroId: ZINMAN, position: "leader" }])[0]!;
    expect(hero.skillStates.map((runtime) => runtime.skillId)).not.toContain(
      "expedition.jinman.architectural-art",
    );
    expect(() => createConfirmedHeroFormation([{
      heroId: ZINMAN,
      position: "member",
      selectedMemberSkillId: "expedition.jinman.architectural-art",
    }])).toThrow(/only select|combat-relevant/);
  });

  it("17. activates Jeronimo/Natalia weapon buffs in rallyAttack", () => {
    const jeronimo = attack(roundWithHero(
      { heroId: JERONIMO, position: "leader", weaponLevel: 9 },
      "rallyAttack",
    ), "A", "shield");
    const natalia = attack(roundWithHero(
      { heroId: NATALIA, position: "leader", weaponLevel: 9 },
      "rallyAttack",
      countedRandom([.9]),
    ), "A", "shield");
    expect(attributeGroup(jeronimo, "attack", "buffAttack")).toBeDefined();
    expect(attributeGroup(natalia, "penetration", "buffPenetration")).toBeDefined();
  });

  it("18. does not activate Molly/Zinman defense buffs in rallyAttack", () => {
    const molly = attack(roundWithHero(
      { heroId: MOLLY, position: "leader", weaponLevel: 9 },
      "rallyAttack",
      countedRandom([.9, .9, .9, .9]),
    ), "A", "lancer");
    const zinman = attack(roundWithHero(
      { heroId: ZINMAN, position: "leader", weaponLevel: 9 },
      "rallyAttack",
    ), "A", "marksman");
    expect(attributeGroup(molly, "penetration", "buffPenetration")).toBeUndefined();
    expect(attributeGroup(zinman, "attack", "buffAttack")).toBeUndefined();
  });

  it("19. activates Molly/Zinman buffs in rally and garrison defense", () => {
    const molly = attack(roundWithHero(
      { heroId: MOLLY, position: "leader", weaponLevel: 9 },
      "rallyDefense",
      countedRandom([.9, .9, .9, .9]),
    ), "A", "lancer");
    const zinman = attack(roundWithHero(
      { heroId: ZINMAN, position: "leader", weaponLevel: 9 },
      "garrisonDefense",
    ), "A", "marksman");
    expect(attributeGroup(molly, "penetration", "buffPenetration")?.summedValue)
      .toBe(.125);
    expect(attributeGroup(zinman, "attack", "buffAttack")?.summedValue)
      .toBe(.125);
  });

  it("20. includes weapon penetration/life in heroStatCorrection deltas", () => {
    const correction = calculateHeroStatCorrection(
      [{ heroId: JERONIMO, weaponLevel: 5 }],
      [{ heroId: JERONIMO, weaponLevel: 9 }],
    );
    expect(correction.reportWeaponContribution.shield).toMatchObject({
      penetration: .3125,
      life: .3125,
    });
    expect(correction.simulationWeaponContribution.shield).toMatchObject({
      penetration: .5625,
      life: .5625,
    });
    expect(correction.delta.shield.penetration).toBeCloseTo(.25);
    expect(correction.delta.shield.life).toBeCloseTo(.25);
  });

  it("21. multiplies panel attack by independent skill and weapon groups", () => {
    const event = attack(roundWithHero(
      { heroId: JERONIMO, position: "leader", weaponLevel: 9 },
      "rallyAttack",
    ), "A", "shield");
    const resolution = event.attributeResolutions!.find(
      (row) => row.attribute === "attack",
    )!;
    expect(resolution.finalAttribute).toBeCloseTo(1.25 * 1.125 - 1);
    expect(attributeGroup(event, "attack", "heroAttackBonus")?.operation)
      .toBe("multiplyAttributeFactor");
    expect(attributeGroup(event, "attack", "buffAttack")?.operation)
      .toBe("addToExternalBuff");
  });

  it("22. multiplies panel penetration by independent skill and weapon groups", () => {
    const event = attack(roundWithHero(
      { heroId: NATALIA, position: "leader", weaponLevel: 9 },
      "rallyAttack",
      countedRandom([.9]),
    ), "A", "shield");
    const resolution = event.attributeResolutions!.find(
      (row) => row.attribute === "penetration",
    )!;
    expect(resolution.finalAttribute).toBeCloseTo(1.25 * 1.125 - 1);
    expect(attributeGroup(event, "penetration", "heroPenetrationBonus")?.operation)
      .toBe("multiplyAttributeFactor");
    expect(attributeGroup(event, "penetration", "buffPenetration")?.operation)
      .toBe("addToExternalBuff");
  });

  it("23. excludes Jeronimo's exploration/body weapon skill from PVP", () => {
    const hero = createConfirmedHeroFormation([
      { heroId: JERONIMO, position: "leader", weaponLevel: 10 },
    ])[0]!;
    expect(hero.skillStates.map((runtime) => runtime.skillId)).not.toContain(
      "hero-weapon-skill.heluonimo.sword-shield",
    );
  });

  it("24. excludes Natalia and Molly exploration/body weapon skills from PVP", () => {
    for (const [heroId, removedSkill] of [
      [NATALIA, "hero-weapon-skill.nataliya.unity"],
      [MOLLY, "hero-weapon-skill.moli.modified-launcher"],
    ] as const) {
      const hero = createConfirmedHeroFormation([
        { heroId, position: "leader", weaponLevel: 10 },
      ])[0]!;
      expect(hero.skillStates.map((runtime) => runtime.skillId)).not.toContain(removedSkill);
    }
  });

  it("25. excludes Zinman's exploration/body nailgun skill from PVP", () => {
    const hero = createConfirmedHeroFormation([
      { heroId: ZINMAN, position: "leader", weaponLevel: 10 },
    ])[0]!;
    expect(hero.skillStates.map((runtime) => runtime.skillId)).not.toContain(
      "hero-weapon-skill.jinman.overloaded-nailgun",
    );
  });

  it("26. leaves unknown weapon-skill-1 tiers inactive instead of interpolating", () => {
    const hero = createConfirmedHeroFormation([{
      heroId: JERONIMO,
      position: "leader",
      weaponLevel: 9,
    }])[0]!;
    expect(hero.skillStates.map((runtime) => runtime.skillId)).not.toContain(
      "hero-weapon-skill.heluonimo.sword-shield",
    );
    expect(hero.skillStates.map((runtime) => runtime.skillId)).toContain(
      "hero-weapon-skill.heluonimo.rally-attack",
    );
  });
});

function heroSystem(randomSource: RandomSource = countedRandom([.99])) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    randomSource,
  });
}

function heroBattleState(
  hero: HeroFormationInput,
  battleContext: BattleContext,
  counts: Partial<Record<TroopType, number>> = {
    shield: 100,
    lancer: 100,
    marksman: 100,
  },
  maxHpPerUnit = hugeHp,
): BattleState {
  return createBattleState({
    battleContext,
    sideA: {
      ...makeSide(counts, { maxHpPerUnit }),
      heroStates: createConfirmedHeroFormation([hero]),
    },
    sideB: makeSide(
      { shield: 100, lancer: 100, marksman: 100 },
      { maxHpPerUnit: hugeHp },
    ),
  });
}

function roundWithHero(
  hero: HeroFormationInput,
  battleContext: BattleContext = "rallyAttack",
  randomSource: RandomSource = countedRandom([.99]),
): ResolvedRound {
  return resolveRound(heroBattleState(hero, battleContext), {
    heroSkillSystem: heroSystem(randomSource),
  });
}

function attack(result: ResolvedRound, side: "A" | "B", troop: TroopType) {
  return result.trace.damageEvents.find(
    (event) => event.sourceSide === side && event.sourceTroop === troop,
  )!;
}

function attributeGroup(
  event: ReturnType<typeof attack>,
  attribute: "attack" | "penetration",
  group: string,
) {
  return event.attributeResolutions?.find(
    (resolution) => resolution.attribute === attribute,
  )?.modifierGroups.find((candidate) => candidate.group === group);
}

function countedRandom(values: readonly number[]): RandomSource & { calls(): number } {
  let index = 0;
  return {
    next() {
      const value = values[index % values.length]!;
      index += 1;
      return value;
    },
    calls: () => index,
  };
}
