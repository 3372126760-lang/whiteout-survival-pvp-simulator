import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  GREG_LAW_DETERRENCE,
  GREG_SWORD_OF_JUSTICE,
  MIA_DOOM_ENTANGLEMENT,
  calculateExclusiveWeaponBaseStats,
  calculateHeroStatCorrection,
  createActiveEffect,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedHeroState,
  createConfirmedTroopSkillLoadout,
  createHeroSkillSystem,
  createTroopSkillSystem,
  getExpeditionHeroData,
  resolveRound,
  simulateBattle,
  type ActiveEffect,
  type BattleContext,
  type BattleState,
  type HeroSkillTriggerOverrides,
  type RandomSource,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const LOGAN = "hero.s3.luogen";
const MIA = "hero.s3.miya";
const GREG = "hero.s3.gelaige";
const DOOM = MIA_DOOM_ENTANGLEMENT.id;
const LUCKY = "hero-skill.miya.lucky-blessing";
const SECRET = "hero-skill.miya.secret-interpretation";
const SWORD = GREG_SWORD_OF_JUSTICE.id;
const LAW = GREG_LAW_DETERRENCE.id;
const hugeHp = 1_000_000_000;

describe("S3 expedition heroes", () => {
  it("1. records S3 expedition attack/defense as 290.23%", () => {
    for (const [heroId, troopType] of [
      [LOGAN, "shield"], [MIA, "lancer"], [GREG, "marksman"],
    ] as const) {
      expect(getExpeditionHeroData(heroId)?.stats).toMatchObject({
        troopType, attackBonus: 2.9023, defenseBonus: 2.9023,
      });
    }
  });

  it("2. calculates S3 exclusive-weapon base penetration/life linearly", () => {
    expect(calculateExclusiveWeaponBaseStats(LOGAN, 0)).toEqual({
      level: 0, penetrationBonus: 0, lifeBonus: 0,
    });
    expect(calculateExclusiveWeaponBaseStats(MIA, 5)).toEqual({
      level: 5, penetrationBonus: .35, lifeBonus: .35,
    });
    expect(calculateExclusiveWeaponBaseStats(GREG, 10)).toEqual({
      level: 10, penetrationBonus: .70, lifeBonus: .70,
    });
  });

  it("3. defaults every ordinary S3 expedition skill to Lv5", () => {
    for (const heroId of [LOGAN, MIA, GREG]) {
      const hero = createConfirmedHeroState({ heroId, position: "leader" });
      expect(hero.skillStates.filter((runtime) =>
        !runtime.skillId.startsWith("hero-weapon-skill.")
      ).every((runtime) => runtime.level === 5)).toBe(true);
    }
  });

  it("4. applies Logan enemyAttackReduction to the whole enemy army", () => {
    const result = roundWithHero(LOGAN);
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(attributeGroup(normalAttack(result, "B", troop), "attack", "enemyAttackReduction"))
        .toEqual(expect.objectContaining({ summedValue: .20, divisionFactor: 1.2 }));
    }
  });

  it("5. applies Logan receivedDamageReduction to the whole friendly army", () => {
    const result = roundWithHero(LOGAN);
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(normalAttack(result, "B", troop).reductionGroups).toContainEqual(
        expect.objectContaining({ group: "receivedDamageReduction", summedValue: .20 }),
      );
    }
  });

  it("6. applies Logan's prebattle army life +25%", () => {
    const result = roundWithHero(LOGAN, "rallyAttack", {}, 0, 1_000);
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBe(1_250);
    expect(result.snapshot.sideA.troops.lancer.maxHpPerUnit).toBe(1_250);
    expect(result.snapshot.sideA.troops.marksman.maxHpPerUnit).toBe(1_250);
  });

  it("7. applies Logan weapon as buffDefense only in defense/garrison scenes", () => {
    const rallyDefense = roundWithHero(LOGAN, "rallyDefense", {}, 10, 1_000);
    const garrison = roundWithHero(LOGAN, "garrisonDefense", {}, 10, 1_000);
    const rallyAttack = roundWithHero(LOGAN, "rallyAttack", {}, 10, 1_000);
    expect(rallyDefense.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_250);
    expect(garrison.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_250);
    expect(rallyAttack.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_250);
    expect(normalAttack(rallyDefense, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1.15);
    expect(normalAttack(garrison, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1.15);
    expect(normalAttack(rallyAttack, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1);
    expect(rallyDefense.snapshot.sideA.armyEffects).toContainEqual(expect.objectContaining({
      definition: expect.objectContaining({
        attribute: "defense", operation: "multiplyAttributeFactor",
        group: "buffDefense", value: .15,
      }),
    }));
  });

  it("8. adds multiple buffDefense sources inside the group before multiplying", () => {
    const result = roundWithHero(
      LOGAN,
      "rallyDefense",
      {},
      10,
      1_000,
      [attributeBuff("test.buff-defense", "defense", "buffDefense", .05)],
    );
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_250);
    expect(normalAttack(result, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1.20);
  });

  it("9. checks Mia's Doom independently for shield/lancer/marksman", () => {
    const result = roundWithHero(MIA, "rallyAttack", {
      ...allOff(MIA),
      [`1:A:shield:${DOOM}`]: true,
      [`1:A:lancer:${DOOM}`]: false,
      [`1:A:marksman:${DOOM}`]: true,
    });
    expect(result.trace.heroSkills.filter((trace) => trace.skillId === DOOM)
      .map((trace) => [trace.sourceTroop, trace.triggered])).toEqual([
      ["shield", true], ["lancer", false], ["marksman", true],
    ]);
  });

  it("10. puts Mia's vulnerability only on the actually hit target troop", () => {
    const result = roundWithHero(MIA, "rallyAttack", {
      ...allOff(MIA),
      [`1:A:shield:${DOOM}`]: true,
    });
    expect(result.stateAfterActionPhase.sideB.troops.shield.debuffs).toContainEqual(
      expect.objectContaining({
        definition: expect.objectContaining({
          kind: "incomingDamageIncrease", group: "vulnerability", value: .50,
        }),
      }),
    );
    expect(result.stateAfterActionPhase.sideB.troops.lancer.debuffs).toHaveLength(0);
    expect(result.stateAfterActionPhase.sideB.troops.marksman.debuffs).toHaveLength(0);
  });

  it("11. activates Mia's Doom next round for one round only", () => {
    const simulation = simulateBattle(stateWithHero(MIA), {
      maxRounds: 3,
      heroSkillSystem: heroSystem({
        ...allOff(MIA),
        [`1:A:shield:${DOOM}`]: true,
      }),
    });
    const vulnerable = simulation.trace.rounds.map((round) =>
      normalAttackFromTrace(round.damageEvents, "A", "shield").increaseGroups.some(
        (group) => group.group === "vulnerability",
      )
    );
    expect(vulnerable).toEqual([false, true, false]);
    expect(simulation.trace.rounds[0]!.heroSkills.find((trace) =>
      trace.skillId === DOOM && trace.sourceTroop === "shield"
    )).toMatchObject({
      targetTroop: "shield",
      appliedDebuffTargetTroop: "shield",
      effectiveFromRound: 2,
      expiresAfterRound: 2,
    });
  });

  it("12. does not reroll Mia's Doom for Rapid Fire's second shot", () => {
    const result = rapidFireRound(MIA, {
      ...allOff(MIA),
      [`1:A:marksman:${DOOM}`]: true,
    });
    expect(result.trace.heroSkills.filter((trace) =>
      trace.skillId === DOOM && trace.sourceTroop === "marksman"
    )).toHaveLength(1);
  });

  it("12b. keeps the current Mia vulnerability while a retrigger schedules its replacement", () => {
    const simulation = simulateBattle(stateWithHero(MIA), {
      maxRounds: 3,
      heroSkillSystem: heroSystem({
        ...allOff(MIA),
        [`1:A:shield:${DOOM}`]: true,
        [`2:A:shield:${DOOM}`]: true,
      }),
    });
    expect(simulation.trace.rounds.map((round) =>
      normalAttackFromTrace(round.damageEvents, "A", "shield").increaseGroups.find(
        (group) => group.group === "vulnerability",
      )?.summedValue ?? 0
    )).toEqual([0, .50, .50]);
  });

  it("13. applies Mia's Lucky Blessing as per-troop main-attack extra damage", () => {
    const simulation = simulateBattle(stateWithHero(MIA), {
      maxRounds: 2,
      heroSkillSystem: heroSystem({
        ...allOff(MIA),
        [`1:A:${LUCKY}`]: true,
      }),
    });
    expect(simulation.trace.rounds.map((round) => round.damageEvents.filter(
      (event) => event.sourceSide === "A" && event.sourceSkillId === LUCKY &&
        event.damageSubtype === "extraDamage",
    ).length)).toEqual([3, 0]);
    for (const round of simulation.trace.rounds) {
      for (const troop of ["shield", "lancer", "marksman"] as const) {
        const main = normalAttackFromTrace(round.damageEvents, "A", troop);
        expect(main.increaseGroups.some((group) => group.group === "commonDamageIncrease"))
          .toBe(false);
        const extra = round.damageEvents.find((event) =>
          event.sourceSkillId === LUCKY && event.parentEventId === main.id
        );
        if (round.round === 1) {
          expect(extra?.baseDamage).toBeCloseTo(main.baseDamage * .50, 12);
          expect(extra?.damageType).toBe("skillDamage");
          expect(extra?.targetTroop).toBe(main.targetTroop);
        } else {
          expect(extra).toBeUndefined();
        }
      }
    }
    expect(simulation.trace.rounds[0]!.heroSkills.filter(
      (trace) => trace.skillId === LUCKY,
    ).map((trace) => trace.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
  });

  it("14. applies Mia's Secret Interpretation to received damage for one round", () => {
    const result = roundWithHero(MIA, "rallyAttack", {
      ...allOff(MIA),
      [`1:A:${SECRET}`]: true,
    });
    expect(normalAttack(result, "B", "shield").reductionGroups).toContainEqual(
      expect.objectContaining({ group: "receivedDamageReduction", summedValue: .50 }),
    );
  });

  it("15. applies Mia weapon buffAttack only for rally attack", () => {
    const attack = roundWithHero(MIA, "rallyAttack", allOff(MIA), 10);
    const defense = roundWithHero(MIA, "rallyDefense", allOff(MIA), 10);
    expect(attributeGroup(normalAttack(attack, "A", "shield"), "attack", "buffAttack"))
      .toEqual(expect.objectContaining({ summedValue: .15 }));
    expect(attributeGroup(normalAttack(defense, "A", "shield"), "attack", "buffAttack"))
      .toBeUndefined();
  });

  it("16. applies Greg's Sword of Justice immediately for three rounds", () => {
    const simulation = simulateBattle(stateWithHero(GREG), {
      maxRounds: 4,
      heroSkillSystem: heroSystem({
        ...allOff(GREG),
        [`1:A:${SWORD}`]: true,
      }),
    });
    expect(simulation.trace.rounds.map((round) =>
      normalAttackFromTrace(round.damageEvents, "A", "shield").increaseGroups.some(
        (group) => group.group === "commonDamageIncrease" && group.summedValue === .40,
      )
    )).toEqual([true, true, true, false]);
  });

  it("17. replaces Greg's repeated Sword status and restarts three-round timing", () => {
    const simulation = simulateBattle(stateWithHero(GREG), {
      maxRounds: 5,
      heroSkillSystem: heroSystem({
        ...allOff(GREG),
        [`1:A:${SWORD}`]: true,
        [`2:A:${SWORD}`]: true,
      }),
    });
    expect(simulation.trace.rounds.map((round) =>
      normalAttackFromTrace(round.damageEvents, "A", "shield").increaseGroups.find(
        (group) => group.group === "commonDamageIncrease",
      )?.summedValue ?? 0
    )).toEqual([.40, .40, .40, .40, 0]);
    const effect = simulation.rounds[1]!.stateAfterActionPhase.sideA.armyEffects.find(
      (candidate) => candidate.definition.id === "hero-effect.gelaige.sword-of-justice",
    );
    expect(effect).toMatchObject({ appliedRound: 2, stackCount: 1, remainingRounds: 3 });
  });

  it("18. checks Greg's Law Deterrence per troop and only affects the hit stack", () => {
    const result = roundWithHero(GREG, "rallyAttack", {
      ...allOff(GREG),
      [`1:A:shield:${LAW}`]: true,
      [`1:A:lancer:${LAW}`]: false,
      [`1:A:marksman:${LAW}`]: false,
    });
    expect(result.trace.heroSkills.filter((trace) => trace.skillId === LAW)
      .map((trace) => [trace.sourceTroop, trace.triggered])).toEqual([
      ["shield", true], ["lancer", false], ["marksman", false],
    ]);
    expect(result.stateAfterActionPhase.sideB.troops.shield.debuffs).toHaveLength(1);
    expect(result.stateAfterActionPhase.sideB.troops.lancer.debuffs).toHaveLength(0);
    expect(result.stateAfterActionPhase.sideB.troops.marksman.debuffs).toHaveLength(0);
    expect(normalAttack(result, "B", "shield").attributeResolutions?.find(
      (entry) => entry.attribute === "penetration")?.divisionFactor).toBe(1.5);
  });

  it("19. replaces repeated Greg Law status and restarts its two-round timing", () => {
    const simulation = simulateBattle(stateWithHero(GREG, { shield: 100 }), {
      maxRounds: 4,
      heroSkillSystem: heroSystem({
        ...allOff(GREG),
        [`1:A:shield:${LAW}`]: true,
        [`2:A:shield:${LAW}`]: true,
      }),
    });
    expect(simulation.trace.rounds.map((round) =>
      normalAttackFromTrace(round.damageEvents, "B", "shield").attributeResolutions?.find(
        (entry) => entry.attribute === "penetration")?.divisionFactor === 1.5
    )).toEqual([true, true, true, false]);
    const effect = simulation.rounds[1]!.stateAfterActionPhase.sideB.troops.shield.debuffs[0];
    expect(effect).toMatchObject({ appliedRound: 2, stackCount: 1, remainingRounds: 2 });
  });

  it("20. does not reroll Greg's Law Deterrence for Rapid Fire's second shot", () => {
    const result = rapidFireRound(GREG, {
      ...allOff(GREG),
      [`1:A:marksman:${LAW}`]: true,
    });
    expect(result.trace.heroSkills.filter((trace) =>
      trace.skillId === LAW && trace.sourceTroop === "marksman"
    )).toHaveLength(1);
  });

  it("21. applies Greg's prebattle life and rallyAttack buffLife multiplicatively", () => {
    const result = roundWithHero(GREG, "rallyAttack", allOff(GREG), 10, 1_000);
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_437.5);
    expect(result.snapshot.sideA.armyEffects).toContainEqual(expect.objectContaining({
      definition: expect.objectContaining({
        attribute: "life", operation: "multiplyAttributeFactor",
        group: "buffLife", value: .15,
      }),
    }));
  });

  it("22. adds multiple buffLife sources inside the group before multiplying", () => {
    const result = roundWithHero(
      GREG,
      "rallyAttack",
      allOff(GREG),
      10,
      1_000,
      [attributeBuff("test.buff-life", "life", "buffLife", .05)],
    );
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_500);
  });

  it("23. supports S3 heroes in HeroStatCorrection including Lv10 weapon stats", () => {
    const correction = calculateHeroStatCorrection([], [
      { heroId: LOGAN, weaponLevel: 10 },
      { heroId: MIA, weaponLevel: 10 },
      { heroId: GREG, weaponLevel: 10 },
    ]);
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(correction.delta[troop]).toEqual({
        attack: 2.9023, defense: 2.9023, penetration: .70, life: .70,
      });
    }
  });
});

function roundWithHero(
  heroId: string,
  battleContext: BattleContext = "rallyAttack",
  overrides: HeroSkillTriggerOverrides = {},
  weaponLevel = 0,
  maxHpPerUnit = hugeHp,
  armyEffects: readonly ActiveEffect[] = [],
) {
  return resolveRound(stateWithHero(
    heroId,
    { shield: 100, lancer: 100, marksman: 100 },
    battleContext,
    weaponLevel,
    maxHpPerUnit,
    armyEffects,
  ), { heroSkillSystem: heroSystem(overrides) });
}

function stateWithHero(
  heroId: string,
  counts: Partial<Record<TroopType, number>> = {
    shield: 100, lancer: 100, marksman: 100,
  },
  battleContext: BattleContext = "rallyAttack",
  weaponLevel = 0,
  maxHpPerUnit = hugeHp,
  armyEffects: readonly ActiveEffect[] = [],
): BattleState {
  return createBattleState({
    battleContext,
    sideA: {
      ...makeSide(counts, { maxHpPerUnit, armyEffects }),
      heroStates: createConfirmedHeroFormation([
        { heroId, position: "leader", weaponLevel },
      ]),
    },
    sideB: makeSide(
      { shield: 100, lancer: 100, marksman: 100 },
      { maxHpPerUnit: hugeHp },
    ),
  });
}

function rapidFireRound(
  heroId: string,
  overrides: HeroSkillTriggerOverrides,
) {
  const sideA = makeSide({ marksman: 100 }, {
    maxHpPerUnit: hugeHp,
    skillStates: {
      marksman: createConfirmedTroopSkillLoadout("marksman", "T7"),
    },
  });
  return resolveRound(createBattleState({
    sideA: {
      ...sideA,
      heroStates: createConfirmedHeroFormation([{ heroId, position: "leader" }]),
    },
    sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
  }), {
    heroSkillSystem: heroSystem(overrides),
    troopSkillSystem: createTroopSkillSystem({
      definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
      triggerOverrides: { "A:marksman-rapid-fire": true },
    }),
  });
}

function heroSystem(
  triggerOverrides: HeroSkillTriggerOverrides,
  randomSource: RandomSource = { next: () => .99 },
) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    triggerOverrides,
    randomSource,
  });
}

function normalAttack(
  result: ReturnType<typeof resolveRound>,
  side: "A" | "B",
  troop: TroopType,
) {
  return normalAttackFromTrace(result.trace.damageEvents, side, troop);
}

function normalAttackFromTrace(
  events: ReturnType<typeof resolveRound>["trace"]["damageEvents"],
  side: "A" | "B",
  troop: TroopType,
) {
  return events.find((event) =>
    event.sourceSide === side && event.sourceTroop === troop &&
    event.damageType === "normalAttack" && event.parentEventId === undefined
  )!;
}

function attributeGroup(
  event: ReturnType<typeof normalAttack>,
  attribute: "attack" | "penetration",
  group: string,
) {
  const resolution = event.attributeResolutions?.find(
    (entry) => entry.attribute === attribute,
  );
  return attribute === "attack" && group === "enemyAttackReduction"
    ? resolution?.reductionGroups.find((entry) => entry.group === group)
    : resolution?.modifierGroups.find((entry) => entry.group === group);
}

function allOff(heroId: string): HeroSkillTriggerOverrides {
  return Object.fromEntries(CONFIRMED_HERO_SKILL_DEFINITIONS
    .filter((definition) =>
      definition.heroId === heroId && definition.probability !== undefined
    )
    .map((definition) => [definition.id, false]));
}

function attributeBuff(
  id: string,
  attribute: "defense" | "life",
  group: "buffDefense" | "buffLife",
  value: number,
): ActiveEffect {
  return createActiveEffect({
    identity: { sourceId: id, sourceSkillId: id, effectId: id },
    definition: {
      id,
      name: id,
      kind: "attributeModifier",
      attribute,
      operation: "multiplyAttributeFactor",
      group,
      value,
      ruleStatus: "supported",
    },
    appliedRound: 1,
    holderScope: "army",
  });
}
