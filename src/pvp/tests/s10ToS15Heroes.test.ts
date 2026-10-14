import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  ELIF_BROCADE_VEIL,
  GATOT_KINGS_GIFT,
  LYNN_LION_SONG,
  calculateExclusiveWeaponBaseStats,
  calculateHeroStatCorrection,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedHeroState,
  createHeroSkillSystem,
  formatValidationHeroOption,
  getExpeditionHeroData,
  getValidationCatalog,
  resolveRound,
  simulateBattle,
  type BattleContext,
  type BattleState,
  type HeroSkillTriggerOverrides,
  type RoundBattleTrace,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const HEROES = [
  ["hero.s10.gregory", "格里高利", "shield", 10, 11.1088, 2.775],
  ["hero.s10.freya", "芙蕾雅", "lancer", 10, 11.1088, 2.775],
  ["hero.s10.blanchette", "布兰琪", "marksman", 10, 11.1088, 2.775],
  ["hero.s11.eleonora", "埃莱奥诺拉", "shield", 11, 12.8102, 3.20],
  ["hero.s11.lloyd", "劳埃德", "lancer", 11, 12.8102, 3.20],
  ["hero.s11.rufus", "鲁弗斯", "marksman", 11, 12.8102, 3.20],
  ["hero.s12.hervor", "赫尔薇尔", "shield", 12, 14.5116, 3.625],
  ["hero.s12.karol", "加罗尔", "lancer", 12, 14.5116, 3.625],
  ["hero.s12.ligeia", "丽姬娅", "marksman", 12, 14.5116, 3.625],
  ["hero.s13.gisela", "吉塞拉", "shield", 13, 16.2129, 4.05],
  ["hero.s13.flora", "弗洛拉", "lancer", 13, 16.2129, 4.05],
  ["hero.s13.vulcanus", "乌尔卡努斯", "marksman", 13, 16.2129, 4.05],
  ["hero.s14.elif", "艾丽芙", "shield", 14, 17.9143, 4.475],
  ["hero.s14.dominic", "多米尼克", "lancer", 14, 17.9143, 4.475],
  ["hero.s14.cara", "卡拉", "marksman", 14, 17.9143, 4.475],
  ["hero.s15.hank", "汉克", "shield", 15, 19.6151, 4.90],
  ["hero.s15.estrella", "艾丝黛拉", "lancer", 15, 19.6151, 4.90],
  ["hero.s15.viveca", "维薇卡", "marksman", 15, 19.6151, 4.90],
] as const;
const hugeHp = 1_000_000_000;

describe("S10-S15 expedition heroes", () => {
  it("1. registers 18 heroes, 54 expedition skills and 18 weapon scene skills", () => {
    const heroIds = new Set<string>(HEROES.map(([id]) => id));
    for (const [heroId, name, troopType, generation, stat, weaponStat] of HEROES) {
      expect(getExpeditionHeroData(heroId)).toMatchObject({
        name,
        generation,
        stats: { troopType, attackBonus: stat, defenseBonus: stat },
        exclusiveWeapon: {
          maxPenetrationBonus: weaponStat,
          maxLifeBonus: weaponStat,
        },
      });
      expect(calculateExclusiveWeaponBaseStats(heroId, 10)).toMatchObject({
        penetrationBonus: weaponStat,
        lifeBonus: weaponStat,
      });
    }
    const definitions = CONFIRMED_HERO_SKILL_DEFINITIONS.filter((definition) =>
      heroIds.has(definition.heroId)
    );
    expect(definitions.filter((definition) =>
      definition.positionRule.kind === "expeditionSkillSlot"
    )).toHaveLength(54);
    expect(definitions.filter((definition) =>
      definition.positionRule.kind === "exclusiveWeapon"
    )).toHaveLength(18);
    expect(definitions.filter((definition) =>
      definition.metadata.ruleStatus === "RULE_UNKNOWN"
    )).toHaveLength(0);
  });

  it("2. exposes S10-S15 labels and combat-relevant skill1 member sources in UI", () => {
    const catalog = getValidationCatalog();
    for (const [heroId, name, , generation] of HEROES) {
      const hero = catalog.leaderHeroes.find((candidate) => candidate.heroId === heroId)!;
      expect(formatValidationHeroOption(hero)).toBe(`${name}（S${generation}）`);
      expect(catalog.reportHeroes).toContainEqual(hero);
      expect(catalog.memberSkills.some((option) =>
        option.sourceHeroIds.includes(heroId)
      )).toBe(true);
    }
  });

  it("3. reuses Wayne's 25% x2 critical semantics for Gregory", () => {
    const skillId = "hero-skill.gregory.steel-phalanx";
    const round = roundWithHero("hero.s10.gregory", { [skillId]: true });
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(group(round.trace, "A", troop, "increase", "criticalNormalAttack"))
        .toBeCloseTo(1);
      expect(normalAttack(round.trace, "A", troop).increaseMultiplier).toBeGreaterThanOrEqual(2);
    }
    expect(skillEvents(round.trace, skillId)).toHaveLength(0);
    expect(round.trace.heroSkills.filter((trace) =>
      trace.skillId === skillId && trace.triggered
    )).toHaveLength(3);
  });

  it("4. creates Freya 1B only after a successful lancer normal hit", () => {
    const skillId = "hero-skill.freya.crescent-scythe";
    const round = roundWithHero("hero.s10.freya", { [skillId]: true });
    const events = skillEvents(round.trace, skillId);
    expect(events).toHaveLength(1);
    for (const event of events) {
      expect(event.baseDamage).toBeCloseTo(
        normalAttack(round.trace, "A", "lancer").baseDamage,
      );
      expect(event.sourceTroop).toBe("lancer");
    }
    const runtime = round.stateAfter.sideA.heroStates[0]!.skillStates.find(
      (candidate) => candidate.skillId === skillId,
    )!;
    expect(runtime.mainAttackCounts).toEqual({ shield: 0, lancer: 0, marksman: 0 });
  });

  it("5. activates Eleonora every-five buff first on R6/R7", () => {
    const simulation = simulate("hero.s11.eleonora", 7);
    expect(group(simulation.trace.rounds[4]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBe(0);
    for (const round of [6, 7]) {
      expect(group(simulation.trace.rounds[round - 1]!, "A", "shield", "increase", "commonDamageIncrease"))
        .toBeCloseTo(.25);
      expect(group(simulation.trace.rounds[round - 1]!, "B", "shield", "reduction", "receivedDamageReduction"))
        .toBeCloseTo(.35);
    }
  });

  it("6. reuses the Lynn/Alonso penetration proc for Lloyd and keeps the R3 periodic window", () => {
    const skillId = "hero-skill.lloyd.endless-ingenuity";
    const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find(
      (candidate) => candidate.id === skillId,
    )!;
    expect(definition.trigger).toBe(LYNN_LION_SONG.trigger);
    expect(definition.probability).toBe(LYNN_LION_SONG.probability);
    const simulation = simulate("hero.s11.lloyd", 3, { [skillId]: true });
    expect(attributeGroup(simulation.trace.rounds[0]!, "A", "shield", "penetration", "heroPenetrationBonus"))
      .toBeCloseTo(.50);
    expect(group(simulation.trace.rounds[2]!, "A", "lancer", "increase", "commonDamageIncrease"))
      .toBeCloseTo(1.50);
    expect(attributeReductionGroup(simulation.trace.rounds[2]!, "B", "shield", "penetration", "enemyPenetrationReduction"))
      .toBeCloseTo(.50);
  });

  it("7. checks Rufus independently for all troops and binds one 50% debuff to hitTarget", () => {
    const skillId = "hero-skill.rufus.violent-blast";
    const round = roundWithHero("hero.s11.rufus", { [skillId]: true });
    expect(round.trace.heroSkills.filter((trace) =>
      trace.skillId === skillId && trace.triggered
    ).map((trace) => trace.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
    expect(attributeReductionGroup(round.trace, "B", "shield", "penetration", "enemyPenetrationReduction"))
      .toBeCloseTo(.50);
    expect(attributeReductionGroup(round.trace, "B", "lancer", "penetration", "enemyPenetrationReduction"))
      .toBe(0);
    expect(attributeReductionGroup(round.trace, "B", "marksman", "penetration", "enemyPenetrationReduction"))
      .toBe(0);
  });

  it("8. triggers both Ligeia every-two skills on R2 and both target statuses on R3", () => {
    const simulation = simulate("hero.s12.ligeia", 3);
    expect(skillEvents(simulation.trace.rounds[1]!, "hero-skill.ligeia.disintegrating-poison"))
      .toHaveLength(1);
    expect(simulation.trace.rounds[1]!.damageEvents.filter((event) =>
      event.sourceTroop === "marksman" && event.damageSubtype === "extraDamage"
    )).toMatchObject([{ skillCoefficient: 2 }]);
    expect(group(simulation.trace.rounds[2]!, "A", "marksman", "increase", "vulnerability"))
      .toBeCloseTo(.25);
    expect(group(simulation.trace.rounds[2]!, "B", "shield", "reduction", "enemyOutgoingDamageReduction"))
      .toBeCloseTo(.20);
    expect(group(simulation.trace.rounds[2]!, "B", "lancer", "reduction", "enemyOutgoingDamageReduction"))
      .toBe(0);
  });

  it("9. applies Gisela defense immediately and checks Prototype Shield once per round", () => {
    const fort = "hero-skill.gisela.temporary-fortification";
    const prototype = "hero-skill.gisela.prototype-shield";
    const round = roundWithHero("hero.s13.gisela", {
      [fort]: true,
      [prototype]: true,
    });
    expect(normalAttack(round.trace, "B", "shield").targetDefenseMultiplier)
      .toBeCloseTo(1.80);
    expect(group(round.trace, "B", "shield", "reduction", "receivedDamageReduction"))
      .toBeCloseTo(.50);
    expect(round.trace.heroSkills.filter((trace) =>
      trace.skillId === prototype
    )).toHaveLength(1);
  });

  it("10. produces the same hit-target vulnerability lifecycle for Flora and Mia", () => {
    const flora = simulate("hero.s13.flora", 2, {
      "hero-skill.flora.thorn-vine-dance": true,
    });
    const mia = simulate("hero.s3.miya", 2, {
      "hero-skill.miya.doom-entanglement": true,
    });
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(group(flora.trace.rounds[1]!, "A", troop, "increase", "vulnerability"))
        .toBeCloseTo(group(mia.trace.rounds[1]!, "A", troop, "increase", "vulnerability"));
    }
  });

  it("11. arms Vulcanus on R6, skips its own extraDamage, then consumes one 15% token on R7", () => {
    const skillId = "hero-skill.vulcanus.rifting-blade";
    const simulation = simulate(
      "hero.s13.vulcanus",
      7,
      {},
      { marksman: 100 },
      { shield: 100 },
    );
    const extra = skillEvents(simulation.trace.rounds[5]!, skillId);
    expect(extra).toHaveLength(1);
    expect(extra[0]!.increaseGroups.some((group) =>
      group.group === "aerialSuppressionOverride"
    )).toBe(false);
    expect(group(simulation.trace.rounds[6]!, "A", "marksman", "increase", "aerialSuppressionOverride"))
      .toBeCloseTo(.15);
    expect(simulation.finalState.sideB.troops.shield.debuffs.some((effect) =>
      effect.definition.kind === "oneUseIncomingDamageIncrease"
    )).toBe(false);
  });

  it("12. removes an unused Vulcanus token when its bound target dies", () => {
    const hero = createConfirmedHeroState({
      heroId: "hero.s13.vulcanus", position: "leader",
    });
    const armedHero = {
      ...hero,
      skillStates: hero.skillStates.map((runtime) =>
        runtime.skillId === "hero-skill.vulcanus.rifting-blade"
          ? {
              ...runtime,
              mainAttackCounts: { ...runtime.mainAttackCounts, marksman: 5 },
            }
          : runtime
      ),
    };
    const state = createBattleState({
      sideA: {
        ...makeSide({ marksman: 100 }, { maxHpPerUnit: hugeHp }),
        heroStates: [armedHero],
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: 1 }),
    });
    const round = resolveRound(state, { heroSkillSystem: heroSystem({}) });
    expect(round.stateAfter.sideB.troops.shield.aliveCount).toBe(0);
    expect(round.stateAfter.sideB.troops.shield.debuffs.some((effect) =>
      effect.definition.kind === "oneUseIncomingDamageIncrease"
    )).toBe(false);
  });

  it("13. reuses Gatot's report-attack shield for Elif with provisional evidence", () => {
    const gatot = roundWithHero("hero.s8.jiatuo");
    const elif = roundWithHero("hero.s14.elif");
    const gatotTrace = gatot.trace.heroSkills.find((trace) =>
      trace.skillId === GATOT_KINGS_GIFT.id
    )!;
    const elifTrace = elif.trace.heroSkills.find((trace) =>
      trace.skillId === ELIF_BROCADE_VEIL.id
    )!;
    expect(elifTrace.generatedShieldHp).toBeCloseTo(gatotTrace.generatedShieldHp!);
    expect(elifTrace.gatotShield?.calculatedAttackX).toBeCloseTo(gatotTrace.gatotShield!.calculatedAttackX);
    expect(gatotTrace.generatedShieldHp).toBeCloseTo(gatotTrace.gatotShield!.calculatedAttackX * .30);
    expect(gatotTrace.rawDamageBasis).toBeUndefined();
    expect(ELIF_BROCADE_VEIL.metadata.templateSource).toBe(GATOT_KINGS_GIFT.id);
    expect(GATOT_KINGS_GIFT.metadata.ruleStatus).toBe("supported");
    expect(elifTrace.temporaryShieldRuleStatus).toBe("TENTATIVE");
  });

  it("14. allows only lancer main attacks to trigger Dominic Rose Thrust", () => {
    const skillId = "hero-skill.dominic.rose-thrust";
    const round = roundWithHero("hero.s14.dominic");
    const events = skillEvents(round.trace, skillId);
    expect(events).toHaveLength(1);
    expect(events[0]!.sourceTroop).toBe("lancer");
    expect(events[0]!.parentEventId).toBe(normalAttack(round.trace, "A", "lancer").id);
  });

  it("15. applies Cara normal-attack-only damage and R2 off-target events", () => {
    const simulation = simulate("hero.s14.cara", 2);
    expect(group(simulation.trace.rounds[0]!, "A", "marksman", "increase", "normalAttackDamageIncrease"))
      .toBeCloseTo(.30);
    const events = skillEvents(simulation.trace.rounds[1]!, "hero-skill.cara.witch-assault");
    expect(events.map((event) => event.targetTroop).sort()).toEqual(["lancer", "marksman"]);
    expect(events.every((event) =>
      !event.increaseGroups.some((group) => group.group === "normalAttackDamageIncrease")
    )).toBe(true);
  });

  it("16. activates Hank every-five buff first on R6/R7", () => {
    const simulation = simulate("hero.s15.hank", 7);
    expect(group(simulation.trace.rounds[4]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBe(0);
    expect(group(simulation.trace.rounds[5]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.25);
    expect(group(simulation.trace.rounds[6]!, "A", "shield", "increase", "commonDamageIncrease"))
      .toBeCloseTo(.25);
  });

  it("17. creates one Viveca 100% event per living enemy troop on a successful proc", () => {
    const skillId = "hero-skill.viveca.shadow-vision";
    const round = roundWithHero("hero.s15.viveca", { [skillId]: true });
    const events = skillEvents(round.trace, skillId);
    expect(events.map((event) => event.targetTroop).sort()).toEqual([
      "lancer", "marksman", "shield",
    ]);
    const parent = normalAttack(round.trace, "A", "marksman");
    expect(events.every((event) => event.baseDamage === parent.baseDamage)).toBe(true);
  });

  it("18. smoke-tests every S10-S15 hero as a complete leader", () => {
    for (const [heroId] of HEROES) {
      const state = stateWithHero(heroId);
      expect(() => resolveRound(state, {
        heroSkillSystem: heroSystem({}),
      })).not.toThrow();
      expect(state.sideA.heroStates[0]!.skillStates.filter((runtime) =>
        !runtime.skillId.startsWith("hero-weapon-skill.")
      )).toHaveLength(3);
    }
  });

  it("19. produces zero HeroStatCorrection for identical S10-S15 lineups", () => {
    const lineup = HEROES.map(([heroId], index) => ({
      heroId,
      weaponLevel: index % 11,
    }));
    const correction = calculateHeroStatCorrection(lineup, lineup);
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(correction.delta[troop]).toEqual({
        attack: 0, defense: 0, penetration: 0, life: 0,
      });
    }
  });

  it("20. marks every S12-S15 rule provisional while preserving S10-S11 status", () => {
    const heroIds = new Set<string>(HEROES.map(([heroId]) => heroId));
    const definitions = CONFIRMED_HERO_SKILL_DEFINITIONS.filter((definition) =>
      heroIds.has(definition.heroId)
    );
    expect(definitions.some((definition) =>
      definition.metadata.ruleStatus === "RULE_UNKNOWN"
    )).toBe(false);
    expect(definitions.filter((definition) =>
      definition.heroId.startsWith("hero.s1") &&
      definition.metadata.ruleStatus === "TENTATIVE"
    ).every((definition) => definition.metadata.verificationStatus === "inferredFromPriorGenerations"))
      .toBe(true);
    expect(ELIF_BROCADE_VEIL.metadata.templateSource).toBe(GATOT_KINGS_GIFT.id);
  });
});

function roundWithHero(
  heroId: string,
  overrides: HeroSkillTriggerOverrides = {},
  battleContext: BattleContext = "challenge",
) {
  return resolveRound(stateWithHero(heroId, undefined, undefined, battleContext), {
    heroSkillSystem: heroSystem(overrides),
  });
}

function simulate(
  heroId: string,
  rounds: number,
  overrides: HeroSkillTriggerOverrides = {},
  counts?: Partial<Record<TroopType, number>>,
  enemyCounts?: Partial<Record<TroopType, number>>,
) {
  return simulateBattle(stateWithHero(heroId, counts, enemyCounts), {
    maxRounds: rounds,
    heroSkillSystem: heroSystem(overrides),
  });
}

function stateWithHero(
  heroId: string,
  counts: Partial<Record<TroopType, number>> = {
    shield: 100, lancer: 100, marksman: 100,
  },
  enemyCounts: Partial<Record<TroopType, number>> = {
    shield: 100, lancer: 100, marksman: 100,
  },
  battleContext: BattleContext = "challenge",
): BattleState {
  return createBattleState({
    battleContext,
    sideA: {
      ...makeSide(counts, { maxHpPerUnit: hugeHp }),
      heroStates: createConfirmedHeroFormation([
        { heroId, position: "leader" },
      ]),
    },
    sideB: makeSide(enemyCounts, { maxHpPerUnit: hugeHp }),
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
