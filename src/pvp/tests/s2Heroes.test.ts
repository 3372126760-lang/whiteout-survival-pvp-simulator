import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  PHILLY_STRENGTHENING_POTION,
  calculateExclusiveWeaponBaseStats,
  createActiveEffect,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedTroopSkillLoadout,
  createHeroSkillSystem,
  createTroopSkillSystem,
  getExpeditionHeroData,
  resolveRound,
  simulateBattle,
  type BattleContext,
  type BattleState,
  type HeroSkillTriggerOverrides,
  type RandomSource,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const FLINT = "hero.head.fulinte";
const PHILLY = "hero.s2.feilande";
const ALONSO = "hero.s2.alongsuo";
const POTION = PHILLY_STRENGTHENING_POTION.id;
const STEEL_WILL = "hero-skill.alongsuo.steel-will";
const hugeHp = 1_000_000_000;

describe("S2 expedition heroes and synchronized hit-target rules", () => {
  it("1. records all S2 expedition attack/defense as 240.19%", () => {
    for (const [heroId, troopType] of [
      [FLINT, "shield"], [PHILLY, "lancer"], [ALONSO, "marksman"],
    ] as const) {
      expect(getExpeditionHeroData(heroId)?.stats).toMatchObject({
        troopType, attackBonus: 2.4019, defenseBonus: 2.4019,
      });
    }
  });

  it("2. computes S2 Lv10 weapon penetration/life as 60%", () => {
    expect(calculateExclusiveWeaponBaseStats(FLINT, 10)).toEqual({
      level: 10, penetrationBonus: .60, lifeBonus: .60,
    });
  });

  it("3. computes S2 Lv9 weapon penetration/life as 54%", () => {
    const stats = calculateExclusiveWeaponBaseStats(ALONSO, 9);
    expect(stats.level).toBe(9);
    expect(stats.penetrationBonus).toBeCloseTo(.54);
    expect(stats.lifeBonus).toBeCloseTo(.54);
  });

  it("4. applies Flint shield damage +100%", () => {
    const result = roundWithHero(FLINT);
    expect(normalAttack(result, "A", "shield").increaseGroups).toContainEqual(
      expect.objectContaining({ group: "commonDamageIncrease", summedValue: 1 }),
    );
  });

  it("5. applies Flint army attack +25%", () => {
    const event = normalAttack(roundWithHero(FLINT), "A", "lancer");
    expect(attributeGroup(event, "attack", "heroAttackBonus")?.summedValue).toBe(.25);
  });

  it("6. applies Flint army penetration +25%", () => {
    const event = normalAttack(roundWithHero(FLINT), "A", "marksman");
    expect(attributeGroup(event, "penetration", "heroPenetrationBonus")?.summedValue).toBe(.25);
  });

  it("7. activates Flint weapon buffAttack only in defense/garrison contexts", () => {
    const defense = normalAttack(roundWithHero(FLINT, "rallyDefense", {}, 10), "A", "shield");
    const attack = normalAttack(roundWithHero(FLINT, "rallyAttack", {}, 10), "A", "shield");
    expect(attributeGroup(defense, "attack", "buffAttack")?.summedValue).toBe(.15);
    expect(attributeGroup(attack, "attack", "buffAttack")).toBeUndefined();
  });

  it("8. applies Philly army attack +15% and defense +10%", () => {
    const result = roundWithHero(PHILLY, "rallyAttack", allOff(PHILLY));
    const event = normalAttack(result, "A", "shield");
    expect(attributeGroup(event, "attack", "heroAttackBonus")?.summedValue).toBe(.15);
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBe(hugeHp);
    expect(normalAttack(result, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1.1);
  });

  it("9. judges Strengthening Potion once per round and preserves per-troop parentRawDamage", () => {
    const overrides: HeroSkillTriggerOverrides = {
      [`1:A:${POTION}`]: true,
      "A:hero-skill.feilande.stimulant": false,
    };
    const result = roundWithHero(PHILLY, "rallyAttack", overrides);
    const traces = result.trace.heroSkills.filter((entry) => entry.skillId === POTION);
    expect(traces).toHaveLength(3);
    expect(traces.map((trace) => trace.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
    expect(traces.every((trace) => trace.triggered)).toBe(true);
    expect(result.trace.damageEvents.filter((event) => event.sourceSkillId === POTION)
      .map((event) => event.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
  });

  it("10. emits Lv5 Strengthening Potion as a 100% independent extraDamage event", () => {
    const result = roundWithHero(PHILLY, "rallyAttack", {
      [POTION]: true,
      "A:hero-skill.feilande.stimulant": false,
    });
    const primary = normalAttack(result, "A", "shield");
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === POTION && event.sourceTroop === "shield"
    )!;
    expect(extra).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage" });
    expect(extra.rawDamage).toBe(primary.rawDamage);
  });

  it("11. judges Philly Stimulant once per round", () => {
    const random = countedRandom([.1, .9, .9, .9]);
    roundWithHero(PHILLY, "rallyAttack", {}, 0, random);
    expect(random.calls()).toBe(4);
  });

  it("12. gives Alonso Stormy Waves the confirmed current-round penetration behavior", () => {
    const result = roundWithHero(ALONSO, "rallyAttack", {
      "A:hero-skill.alongsuo.stormy-waves": true,
      [STEEL_WILL]: false,
      "hero-skill.alongsuo.sharp-harpoon": false,
    });
    const event = normalAttack(result, "A", "shield");
    expect(attributeGroup(event, "penetration", "heroPenetrationBonus")?.summedValue).toBe(.50);
  });

  it("13. judges Steel Will and Sharp Harpoon once for each living troop action", () => {
    const result = roundWithHero(ALONSO, "rallyAttack", {
      "hero-skill.alongsuo.stormy-waves": false,
      [STEEL_WILL]: false,
      "hero-skill.alongsuo.sharp-harpoon": false,
    });
    for (const skillId of [STEEL_WILL, "hero-skill.alongsuo.sharp-harpoon"]) {
      expect(result.trace.heroSkills.filter((entry) => entry.skillId === skillId)
        .map((entry) => entry.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
    }
  });

  it("14. emits Sharp Harpoon as 50% parent-base extraDamage", () => {
    const result = roundWithHero(ALONSO, "rallyAttack", {
      "hero-skill.alongsuo.stormy-waves": false,
      [STEEL_WILL]: false,
      "hero-skill.alongsuo.sharp-harpoon": true,
    });
    const normal = normalAttack(result, "A", "shield");
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.alongsuo.sharp-harpoon" && event.sourceTroop === "shield"
    )!;
    expect(normal.increaseGroups.some((group) => group.group === "sharpHarpoonDamage")).toBe(false);
    expect(extra).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage", parentEventId: normal.id });
    expect(extra.baseDamage).toBeCloseTo(normal.baseDamage * .5);
  });

  it("15. does not reroll Potion for Rapid Fire's second shot", () => {
    const sideA = withHeroAndTroopSkills(PHILLY, "marksman", "T7");
    const result = resolveRound(createBattleState({
      sideA, sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
    }), {
      heroSkillSystem: heroSystem({
        [POTION]: true,
        "hero-skill.feilande.stimulant": false,
      }),
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        triggerOverrides: { "A:marksman-rapid-fire": true },
      }),
    });
    expect(result.trace.damageEvents.filter((event) => event.sourceSkillId === POTION)).toHaveLength(1);
    expect(result.trace.heroSkills.filter((entry) =>
      entry.skillId === POTION
    )).toHaveLength(1);
  });

  it("16. activates Alonso weapon buffPenetration only for rally attack", () => {
    const attack = normalAttack(roundWithHero(ALONSO, "rallyAttack", {
      "hero-skill.alongsuo.stormy-waves": false, [STEEL_WILL]: false,
      "hero-skill.alongsuo.sharp-harpoon": false,
    }, 10), "A", "marksman");
    const defense = normalAttack(roundWithHero(ALONSO, "rallyDefense", {
      "hero-skill.alongsuo.stormy-waves": false, [STEEL_WILL]: false,
      "hero-skill.alongsuo.sharp-harpoon": false,
    }, 10), "A", "marksman");
    expect(attributeGroup(attack, "penetration", "buffPenetration")?.summedValue).toBe(.15);
    expect(attributeGroup(defense, "penetration", "buffPenetration")).toBeUndefined();
  });

  it("17. Steel Will does not reduce penetration in its trigger round", () => {
    const result = steelWillRound({ [`1:A:shield:${STEEL_WILL}`]: true });
    const bShield = normalAttack(result, "B", "shield");
    expect(bShield.attributeResolutions?.find((row) => row.attribute === "penetration")
      ?.reductionGroups).toEqual([]);
    expect(bShield.reductionGroups.some((row) => row.group === "enemyOutgoingDamageReduction")).toBe(false);
  });

  it("18. Steel Will triggered at R10 applies only during R11 and R12", () => {
    const state = steelWillState();
    const simulation = simulateBattle(state, {
      maxRounds: 13,
      heroSkillSystem: heroSystem({
        [STEEL_WILL]: false,
        [`10:A:shield:${STEEL_WILL}`]: true,
        "hero-skill.alongsuo.stormy-waves": false,
        "hero-skill.alongsuo.sharp-harpoon": false,
      }),
    });
    const reductions = simulation.trace.rounds.map((round) =>
      round.damageEvents.find((event) =>
        event.sourceSide === "B" && event.sourceTroop === "shield" && event.parentEventId === undefined
      )!.attributeResolutions?.find((row) => row.attribute === "penetration")
        ?.reductionGroups.some((group) => group.group === "enemyPenetrationReduction") ?? false
    );
    expect(reductions.slice(9)).toEqual([false, true, true, false]);
  });

  it("19. attaches Steel Will only to the actually hit B.shield stack", () => {
    const result = steelWillRound({ [`1:A:shield:${STEEL_WILL}`]: true });
    const debuffs = result.stateAfterActionPhase.sideB.troops;
    expect(debuffs.shield.debuffs.map((effect) => effect.definition.id)).toContain(
      "hero-effect.alongsuo.steel-will.penetration-reduction",
    );
    expect(debuffs.shield.debuffs[0]?.definition).toMatchObject({
      kind: "attributeReduction", attribute: "penetration", group: "enemyPenetrationReduction",
    });
    expect(debuffs.lancer.debuffs).toHaveLength(0);
    expect(debuffs.marksman.debuffs).toHaveLength(0);
  });

  it("20. independently attaches Steel Will to another hit target troop", () => {
    const sideB = makeSide({ marksman: 100 }, { maxHpPerUnit: hugeHp });
    const result = resolveRound(steelWillState(sideB), {
      heroSkillSystem: heroSystem({
        [STEEL_WILL]: false,
        [`1:A:shield:${STEEL_WILL}`]: true,
        "hero-skill.alongsuo.stormy-waves": false,
        "hero-skill.alongsuo.sharp-harpoon": false,
      }),
    });
    expect(result.stateAfterActionPhase.sideB.troops.marksman.debuffs).toHaveLength(1);
    expect(result.stateAfterActionPhase.sideB.troops.shield.debuffs).toHaveLength(0);
  });

  it("21. repeated Steel Will on one target does not stack its 50% magnitude", () => {
    const result = steelWillRound({ [STEEL_WILL]: true });
    const effects = result.stateAfterActionPhase.sideB.troops.shield.debuffs;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ stackCount: 1, remainingRounds: 3, activeFromRound: 2 });
  });

  it("22. preserves explicit enemyArmy skills", () => {
    const result = roundWithHero("hero.sr.xieergai");
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(normalAttack(result, "B", troop).attributeResolutions?.find(
        (entry) => entry.attribute === "attack",
      )?.reductionGroups).toContainEqual(
        expect.objectContaining({ group: "enemyAttackReduction", summedValue: .20 }),
      );
    }
  });

  it("23. audits Steel Will source/target and active interval", () => {
    const trace = steelWillRound({ [`1:A:shield:${STEEL_WILL}`]: true })
      .trace.heroSkills.find((entry) =>
        entry.skillId === STEEL_WILL && entry.sourceTroop === "shield"
      );
    expect(trace).toMatchObject({
      sourceTroop: "shield", targetTroop: "shield", triggered: true,
      appliedDebuffTargetTroop: "shield", effectiveFromRound: 2, expiresAfterRound: 3,
    });
  });

  it("retriggering Steel Will replaces magnitude and restarts the next-round two-round interval", () => {
    const simulation = simulateBattle(steelWillState(), {
      maxRounds: 14,
      heroSkillSystem: heroSystem({
        [STEEL_WILL]: false,
        [`10:A:shield:${STEEL_WILL}`]: true,
        [`11:A:shield:${STEEL_WILL}`]: true,
        "hero-skill.alongsuo.stormy-waves": false,
        "hero-skill.alongsuo.sharp-harpoon": false,
      }),
    });
    const values = simulation.trace.rounds.map((round) =>
      round.damageEvents.find((event) =>
        event.sourceSide === "B" && event.sourceTroop === "shield" && event.parentEventId === undefined
      )!.attributeResolutions?.find((row) => row.attribute === "penetration")
        ?.reductionGroups.find((group) => group.group === "enemyPenetrationReduction")?.summedValue ?? 0
    );
    expect(values.slice(9)).toEqual([0, .5, .5, .5, 0]);
    expect(simulation.trace.rounds.flatMap((round) => round.heroSkills).filter((entry) =>
      entry.skillId === STEEL_WILL && entry.triggered
    ).map((entry) => [entry.effectiveFromRound, entry.expiresAfterRound])).toEqual([[11, 12], [12, 13]]);
  });

  it("reduces only the hit target's penetration factor, adding with same-group reduction without changing panel", () => {
    const sideB = makeSide({ shield: 100, lancer: 100, marksman: 100 }, {
      maxHpPerUnit: hugeHp,
      armyEffects: [createActiveEffect({
        identity: { sourceId: "other", sourceSkillId: "other", effectId: "other-penetration" },
        definition: { id: "other-penetration", name: "other-penetration", kind: "attributeReduction",
          attribute: "penetration", group: "enemyPenetrationReduction", value: .2, ruleStatus: "supported" },
        appliedRound: 1,
      })],
    });
    const withPanel = {
      ...sideB,
      troops: Object.fromEntries(Object.entries(sideB.troops).map(([troop, setup]) =>
        [troop, { ...setup, penetration: 2 }]
      )) as typeof sideB.troops,
    };
    const system = heroSystem({
      [STEEL_WILL]: false,
      [`1:A:shield:${STEEL_WILL}`]: true,
      "hero-skill.alongsuo.stormy-waves": false,
      "hero-skill.alongsuo.sharp-harpoon": false,
    });
    const first = resolveRound(steelWillState(withPanel), { heroSkillSystem: system });
    const second = resolveRound(first.stateAfter, { heroSkillSystem: system });
    expect(first.snapshot.sideB.troops.shield.penetration).toBe(2);
    expect(second.snapshot.sideB.troops.shield.penetration).toBe(2);
    const shield = normalAttack(second, "B", "shield");
    const lancer = normalAttack(second, "B", "lancer");
    const marksman = normalAttack(second, "B", "marksman");
    expect(shield.attributeResolutions?.find((row) => row.attribute === "penetration")?.reductionGroups)
      .toContainEqual(expect.objectContaining({ group: "enemyPenetrationReduction", summedValue: .7 }));
    expect(shield.attributeResolutions?.find((row) => row.attribute === "penetration")?.finalAttribute)
      .toBeCloseTo(3 / 1.7 - 1);
    for (const event of [lancer, marksman]) {
      expect(event.attributeResolutions?.find((row) => row.attribute === "penetration")?.reductionGroups)
        .toContainEqual(expect.objectContaining({ group: "enemyPenetrationReduction", summedValue: .2 }));
      expect(event.attributeResolutions?.find((row) => row.attribute === "penetration")?.finalAttribute)
        .toBeCloseTo(3 / 1.2 - 1);
    }
  });

  it("checks Steel Will separately for two living main attackers on every round", () => {
    let checks = 0;
    const sideA = makeSide({ shield: 100, lancer: 100 }, { maxHpPerUnit: hugeHp });
    const simulation = simulateBattle(createBattleState({
      sideA: {
        ...sideA,
        heroStates: createConfirmedHeroFormation([{ heroId: ALONSO, position: "leader" }]),
      },
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
    }), {
      maxRounds: 1_500,
      traceMode: "summary",
      heroSkillSystem: createHeroSkillSystem({
        definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
        triggerOverrides: {
          "hero-skill.alongsuo.stormy-waves": false,
          "hero-skill.alongsuo.sharp-harpoon": false,
        },
        randomSource: countedRandom([.99]),
        recordTrace: false,
        onProbabilityDecision(decision) {
          if (decision.skillId === STEEL_WILL) checks += 1;
        },
      }),
    });
    expect(simulation.roundCount).toBe(1_500);
    expect(checks).toBe(3_000);
  });

  it("24. supports shield/lancer/marksman leaders together", () => {
    const formation = createConfirmedHeroFormation([
      { heroId: FLINT, position: "leader" },
      { heroId: PHILLY, position: "leader" },
      { heroId: ALONSO, position: "leader" },
    ]);
    expect(formation).toHaveLength(3);
  });

  it("25. rejects two leaders of the same troop type", () => {
    expect(() => createConfirmedHeroFormation([
      { heroId: FLINT, position: "leader" },
      { heroId: "hero.s1.heluonimo", position: "leader" },
    ])).toThrow(/one shield leader/);
  });

  it("26. applies Philly's defense/garrison weapon in the independent buffLife group", () => {
    const withoutWeapon = roundWithHero(PHILLY, "garrisonDefense", allOff(PHILLY));
    const withWeapon = roundWithHero(PHILLY, "garrisonDefense", allOff(PHILLY), 10);
    expect(withWeapon.snapshot.sideA.troops.shield.maxHpPerUnit)
      .toBeCloseTo(withoutWeapon.snapshot.sideA.troops.shield.maxHpPerUnit * 1.15);
    expect(withWeapon.snapshot.sideA.armyEffects).toContainEqual(expect.objectContaining({
      definition: expect.objectContaining({
        kind: "attributeModifier", attribute: "life",
        operation: "multiplyAttributeFactor", group: "buffLife", value: .15,
      }),
    }));
  });
});

function roundWithHero(
  heroId: string,
  battleContext: BattleContext = "rallyAttack",
  overrides: HeroSkillTriggerOverrides = {},
  weaponLevel = 0,
  randomSource: RandomSource = countedRandom([.99]),
) {
  const state = createBattleState({
    battleContext,
    sideA: {
      ...makeSide({ shield: 100, lancer: 100, marksman: 100 }, { maxHpPerUnit: hugeHp }),
      heroStates: createConfirmedHeroFormation([{ heroId, position: "leader", weaponLevel }]),
    },
    sideB: makeSide({ shield: 100, lancer: 100, marksman: 100 }, { maxHpPerUnit: hugeHp }),
  });
  return resolveRound(state, { heroSkillSystem: heroSystem(overrides, randomSource) });
}

function heroSystem(
  triggerOverrides: HeroSkillTriggerOverrides,
  randomSource: RandomSource = countedRandom([.99]),
) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    triggerOverrides,
    randomSource,
  });
}

function steelWillState(sideB = makeSide(
  { shield: 100, lancer: 100, marksman: 100 },
  { maxHpPerUnit: hugeHp },
)): BattleState {
  return createBattleState({
    sideA: {
      ...makeSide({ shield: 100, lancer: 100, marksman: 100 }, { maxHpPerUnit: hugeHp }),
      heroStates: createConfirmedHeroFormation([{ heroId: ALONSO, position: "leader" }]),
    },
    sideB,
  });
}

function steelWillRound(overrides: HeroSkillTriggerOverrides) {
  return resolveRound(steelWillState(), {
    heroSkillSystem: heroSystem({
      [STEEL_WILL]: false,
      "hero-skill.alongsuo.stormy-waves": false,
      "hero-skill.alongsuo.sharp-harpoon": false,
      ...overrides,
    }),
  });
}

function withHeroAndTroopSkills(heroId: string, troop: TroopType, troopLevel: string) {
  const side = makeSide({ [troop]: 100 }, { maxHpPerUnit: hugeHp });
  return {
    ...side,
    troops: {
      ...side.troops,
      [troop]: {
        ...side.troops[troop],
        troopLevel,
        skillStates: createConfirmedTroopSkillLoadout(troop, troopLevel),
      },
    },
    heroStates: createConfirmedHeroFormation([{ heroId, position: "leader" }]),
  };
}

function normalAttack(
  result: ReturnType<typeof resolveRound>,
  side: "A" | "B",
  troop: TroopType,
) {
  return result.trace.damageEvents.find((event) =>
    event.sourceSide === side && event.sourceTroop === troop &&
    event.damageType === "normalAttack" && event.parentEventId === undefined
  )!;
}

function attributeGroup(
  event: ReturnType<typeof normalAttack>,
  attribute: "attack" | "penetration",
  group: string,
) {
  return event.attributeResolutions?.find((row) => row.attribute === attribute)
    ?.modifierGroups.find((row) => row.group === group);
}

function allOff(heroId: string): HeroSkillTriggerOverrides {
  return Object.fromEntries(CONFIRMED_HERO_SKILL_DEFINITIONS
    .filter((definition) => definition.heroId === heroId && definition.probability !== undefined)
    .map((definition) => [definition.id, false]));
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
