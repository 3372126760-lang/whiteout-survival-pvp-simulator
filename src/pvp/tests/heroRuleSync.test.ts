import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  EXPEDITION_HERO_DATA,
  HENDRIK_DEFENSE_REDUCTION_S8,
  TROOP_HP_COEFFICIENTS,
  calculateHeroStatCorrection,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedHeroState,
  createConfirmedTroopSkillLoadout,
  createHeroSkillSystem,
  createTroopSkillSystem,
  getExpeditionHeroData,
  getTroopConstant,
  resolveRound,
  runPureTroopBattleScenario,
  type HeroFormationInput,
  type RandomSource,
  type SideId,
  type TroopType,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

const hugeHp = 1_000_000_000;

describe("confirmed expedition hero rule synchronization", () => {
  it("1. reads every R expedition attack/defense stat as 90.07%", () => {
    const heroes = EXPEDITION_HERO_DATA.filter((hero) => hero.rarity === "R");
    expect(heroes).toHaveLength(4);
    expect(heroes.every((hero) =>
      hero.stats.attackBonus === .9007 && hero.stats.defenseBonus === .9007
    )).toBe(true);
  });

  it("2. reads ordinary SR expedition attack/defense stats as 140.11%", () => {
    const hero = getExpeditionHeroData("hero.sr.xieergai")!;
    expect(hero.stats.attackBonus).toBe(1.4011);
    expect(hero.stats.defenseBonus).toBe(1.4011);
  });

  it("3. keeps Gina's expedition attack/defense stats at 110.08%", () => {
    const hero = getExpeditionHeroData("hero.sr.jina")!;
    expect(hero.stats.attackBonus).toBe(1.1008);
    expect(hero.stats.defenseBonus).toBe(1.1008);
  });

  it("4. calculates report-to-simulation hero stat correction as a delta", () => {
    const correction = calculateHeroStatCorrection(
      ["hero.r.youjin"],
      ["hero.sr.xieergai"],
    );
    expect(correction.delta.shield.attack).toBeCloseTo(.5004);
    expect(correction.delta.shield.defense).toBeCloseTo(.5004);
    expect(correction.delta.lancer.attack).toBe(0);
  });

  it("5. produces zero correction for identical hero lineups", () => {
    const ids = ["hero.sr.xieergai", "hero.body.jiexi"];
    const correction = calculateHeroStatCorrection(ids, ids);
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(correction.delta[troop]).toEqual({
        attack: 0, defense: 0, penetration: 0, life: 0,
      });
    }
  });

  it("6. never puts non-combat expedition skills into PVP runtime state", () => {
    const leader = createConfirmedHeroState({
      heroId: "hero.r.youjin", position: "leader",
    });
    expect(leader.skillStates).toEqual([]);
  });

  it("7. rejects a non-combat expedition skill as a member selection", () => {
    expect(() => createConfirmedHeroState({
      heroId: "hero.r.youjin",
      position: "member",
      selectedMemberSkillId: "expedition.youjin.ancestral-craft",
    })).toThrow(/no PVP-selectable expedition skill 1/);
  });

  it("8. activates all combat-relevant expedition skills for a leader", () => {
    const leader = createConfirmedHeroState({
      heroId: "hero.sr.xieergai", position: "leader",
    });
    expect(leader.skillStates.map((skill) => skill.skillId)).toEqual([
      "hero-skill.xieergai.guardian-power",
      "hero-skill.xieergai.weakening-strike",
    ]);
  });

  it("9. activates only explicitly selected combat-relevant skill 1 for a member", () => {
    const member = createConfirmedHeroState({
      heroId: "hero.sr.xieergai",
      position: "member",
      selectedMemberSkillId: "hero-skill.xieergai.guardian-power",
    });
    expect(member.skillStates.map((skill) => skill.skillId)).toEqual([
      "hero-skill.xieergai.guardian-power",
    ]);
  });

  it("10. accepts at most four explicitly selected member combat skills", () => {
    const four = memberFormation().slice(0, 4);
    expect(createConfirmedHeroFormation(four).flatMap(
      (hero) => hero.skillStates,
    )).toHaveLength(4);
    expect(() => createConfirmedHeroFormation(memberFormation())).toThrow(
      /at most four member combat skills/,
    );
  });

  it("11. applies Sergei Guardian Power as received-damage reduction", () => {
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.xieergai", position: "leader" }],
    );
    const incoming = attack(result, "B", "shield");
    expect(incoming.reductionGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "receivedDamageReduction", summedValue: .20 }),
    ]));
  });

  it("12. applies Sergei Weakening Strike as enemyAttackReduction", () => {
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.xieergai", position: "leader" }],
    );
    const resolution = attributeResolution(attack(result, "B", "shield"), "attack");
    expect(resolution.reductionGroups).toEqual([
      expect.objectContaining({ group: "enemyAttackReduction", summedValue: .20, divisionFactor: 1.2 }),
    ]);
    expect(resolution.finalAttribute).toBeCloseTo(1 / 1.2 - 1);
  });

  it("13. applies Patrick's life bonus before round-one max HP is snapshotted", () => {
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.patelike", position: "leader" }],
      { shield: 1 },
    );
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBe(1_250);
    expect(result.snapshot.sideA.troops.shield.frontUnitHp).toBe(1_250);
  });

  it("14. applies Patrick's attack bonus through the attack attribute system", () => {
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.patelike", position: "leader" }],
    );
    expect(attributeResolution(attack(result, "A", "shield"), "attack").buffedAttribute)
      .toBeCloseTo(.25);
  });

  it("15. applies Bahiti Danger Sense as received-damage reduction", () => {
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.baxiti", position: "member", selectedMemberSkillId: "hero-skill.baxiti.danger-sense" }],
    );
    expect(attack(result, "B", "shield").reductionMultiplier).toBeCloseTo(1.2);
  });

  it("16. checks Bahiti Unstable Field independently for three source troops each round", () => {
    const random = countedRandom([.1, .8, .2]);
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.baxiti", position: "leader" }],
      { shield: 10, lancer: 10, marksman: 10 },
      random,
    );
    const traces = result.trace.heroSkills.filter(
      (entry) => entry.skillId === "hero-skill.baxiti.unstable-field",
    );
    expect(random.calls()).toBe(3);
    expect(traces.map((entry) => [entry.sourceTroop, entry.rngRoll, entry.triggered])).toEqual([
      ["shield", .1, true], ["lancer", .8, false], ["marksman", .2, true],
    ]);
  });

  it("17. emits one Bahiti child event for a Rapid Fire main attack without a second roll", () => {
    const random = countedRandom([.1]);
    const sideA = makeSide({ marksman: 100 }, {
      maxHpPerUnit: hugeHp,
      skillStates: {
        marksman: createConfirmedTroopSkillLoadout("marksman", "T7"),
      },
    });
    const state = createBattleState({
      sideA: {
        ...sideA,
        heroStates: createConfirmedHeroFormation([
          { heroId: "hero.sr.baxiti", position: "leader" },
        ]),
      },
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        triggerOverrides: { "A:marksman-rapid-fire": true },
      }),
      heroSkillSystem: heroSystem(random),
    });
    const shots = result.trace.damageEvents.filter(
      (event) => event.sourceSide === "A" && event.sourceTroop === "marksman" && event.damageType === "normalAttack",
    );
    expect(shots).toHaveLength(1);
    const extra = result.trace.damageEvents.filter((event) =>
      event.sourceSkillId === "hero-skill.baxiti.unstable-field"
    );
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({
      damageType: "skillDamage", damageSubtype: "extraDamage",
      sourceTroop: "marksman", parentEventId: shots[0]!.id,
    });
    // The trace's normal event includes Rapid Fire's internal second segment;
    // the child uses the original one-segment B, not the merged two-segment B.
    expect(extra[0]!.baseDamage).toBeCloseTo(shots[0]!.baseDamage * .25);
    expect(shots[0]!.increaseGroups.some((group) => group.group === "unstableFieldDamage"))
      .toBe(false);
    expect(shots[0]!.internalSegments).toHaveLength(1);
    expect(random.calls()).toBe(1);
  });

  it("emits three independent Bahiti children when all three main attacks trigger", () => {
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.baxiti", position: "leader" }],
      { shield: 10, lancer: 10, marksman: 10 },
      countedRandom([0]),
    );
    const extra = result.trace.damageEvents.filter((event) =>
      event.sourceSkillId === "hero-skill.baxiti.unstable-field"
    );
    expect(extra.map((event) => event.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
    expect(extra.every((event) => event.damageType === "skillDamage" &&
      event.damageSubtype === "extraDamage" && event.parentEventId !== undefined)).toBe(true);
    expect(result.trace.heroSkills.filter((entry) =>
      entry.skillId === "hero-skill.baxiti.unstable-field" && entry.triggered
    )).toHaveLength(3);
  });

  it("emits no Bahiti child on three failed checks", () => {
    const random = countedRandom([.9]);
    const result = roundWithHeroes(
      [{ heroId: "hero.sr.baxiti", position: "leader" }],
      { shield: 10, lancer: 10, marksman: 10 }, random,
    );
    expect(random.calls()).toBe(3);
    expect(result.trace.damageEvents.filter((event) =>
      event.sourceSkillId === "hero-skill.baxiti.unstable-field"
    )).toHaveLength(0);
  });

  it("keeps B=100 normal at 100 and Bahiti child at 50; normal-only +25% yields 125+50", () => {
    for (const normalBonus of [0, .25]) {
      const sideA = makeSide({ shield: 1 }, {
        maxHpPerUnit: hugeHp,
        armyEffects: normalBonus === 0 ? [] : [makeDamageEffect({
          id: "synthetic-reina-normal-25", kind: "damageIncrease",
          group: "normalAttackDamageIncrease", value: normalBonus,
          scope: { damageTypes: ["normalAttack"] },
        })],
      });
      const state = createBattleState({
        sideA: {
          ...sideA,
          troops: { ...sideA.troops, shield: { ...sideA.troops.shield, damageCoefficient: 100 } },
          heroStates: createConfirmedHeroFormation([{ heroId: "hero.sr.baxiti", position: "leader" }]),
        },
        sideB: makeSide({ shield: 1 }, { maxHpPerUnit: hugeHp }),
      });
      const result = resolveRound(state, { heroSkillSystem: heroSystem(countedRandom([0])) });
      const normal = result.trace.damageEvents.find((event) =>
        event.sourceSide === "A" && event.damageType === "normalAttack"
      )!;
      const extra = result.trace.damageEvents.find((event) =>
        event.sourceSkillId === "hero-skill.baxiti.unstable-field"
      )!;
      expect(normal.baseDamage).toBeCloseTo(100);
      expect(normal.modifiedDamage).toBeCloseTo(100 * (1 + normalBonus));
      expect(extra.baseDamage).toBeCloseTo(50);
      expect(extra.modifiedDamage).toBeCloseTo(50);
      expect(extra.parentEventId).toBe(normal.id);
    }
  });

  it("keeps formal Reina Lv5 normal-only +30% off Bahiti's child", () => {
    const sideA = makeSide({ lancer: 1 }, { maxHpPerUnit: hugeHp });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, lancer: { ...sideA.troops.lancer, damageCoefficient: 100 } },
        heroStates: createConfirmedHeroFormation([
          { heroId: "hero.sr.baxiti", position: "leader" },
          { heroId: "hero.s4.lingnai", position: "member", selectedMemberSkillId: "hero-skill.lingnai.assassin-instinct" },
        ]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: hugeHp }),
    }), { heroSkillSystem: heroSystem(countedRandom([0])) });
    const normal = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.damageType === "normalAttack"
    )!;
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.baxiti.unstable-field"
    )!;
    expect(normal.modifiedDamage).toBeCloseTo(130);
    expect(extra.baseDamage).toBeCloseTo(50);
    expect(extra.modifiedDamage).toBeCloseTo(50);
  });

  it("lets all/skill/extra effects and skill reduction match Bahiti, but not normal-only bonus", () => {
    const sideA = makeSide({ shield: 1 }, {
      maxHpPerUnit: hugeHp,
      armyEffects: [
        makeDamageEffect({ id: "all-plus", kind: "damageIncrease", group: "allPlus", value: .1 }),
        makeDamageEffect({ id: "skill-plus", kind: "damageIncrease", group: "skillPlus", value: .2, scope: { damageTypes: ["skillDamage"] } }),
        makeDamageEffect({ id: "extra-plus", kind: "damageIncrease", group: "extraPlus", value: .3, scope: { damageSubtypes: ["extraDamage"] } }),
        makeDamageEffect({ id: "normal-plus", kind: "damageIncrease", group: "normalAttackDamageIncrease", value: .25, scope: { damageTypes: ["normalAttack"] } }),
      ],
    });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, shield: { ...sideA.troops.shield, damageCoefficient: 100 } },
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.sr.baxiti", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: hugeHp, armyEffects: [
        makeDamageEffect({ id: "skill-reduction", kind: "damageReduction", group: "skillDamageReduction", value: .2, scope: { damageTypes: ["skillDamage"] } }),
      ] }),
    }), { heroSkillSystem: heroSystem(countedRandom([0])) });
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.baxiti.unstable-field"
    )!;
    expect(extra.increaseGroups.map((group) => group.group)).toEqual(["allPlus", "skillPlus", "extraPlus"]);
    expect(extra.reductionGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "skillDamageReduction", summedValue: .2 }),
    ]));
  });

  it("keeps a rapid-fire 25% normal-only bonus on both segments but not Bahiti", () => {
    const sideA = makeSide({ marksman: 1 }, {
      maxHpPerUnit: hugeHp,
      skillStates: { marksman: createConfirmedTroopSkillLoadout("marksman", "T7").filter(
        (skill) => skill.skillId === "marksman-rapid-fire",
      ) },
      armyEffects: [makeDamageEffect({
        id: "synthetic-reina-normal-25", kind: "damageIncrease",
        group: "normalAttackDamageIncrease", value: .25,
        scope: { damageTypes: ["normalAttack"] },
      })],
    });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, marksman: { ...sideA.troops.marksman, damageCoefficient: 100 } },
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.sr.baxiti", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: hugeHp }),
    }), {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        triggerOverrides: { "A:marksman-rapid-fire": true },
      }),
      heroSkillSystem: heroSystem(countedRandom([0])),
    });
    const normal = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.damageType === "normalAttack"
    )!;
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.baxiti.unstable-field"
    )!;
    expect(normal.modifiedDamage).toBeCloseTo(250);
    expect(normal.internalSegments).toHaveLength(1);
    expect(normal.internalSegments![0]!.modifiedDamage).toBeCloseTo(125);
    expect(extra.baseDamage).toBeCloseTo(50);
    expect(extra.modifiedDamage).toBeCloseTo(50);
    expect(result.trace.heroSkills.filter((entry) =>
      entry.skillId === "hero-skill.baxiti.unstable-field"
    )).toHaveLength(1);
  });

  it("lets Crimson Field check Bahiti's independent event separately from its parent", () => {
    const sideB = makeSide({ lancer: 1 }, { maxHpPerUnit: hugeHp });
    const result = resolveRound(createBattleState({
      sideA: {
        ...makeSide({ shield: 1 }, { maxHpPerUnit: hugeHp }),
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.sr.baxiti", position: "leader" }]),
      },
      sideB: {
        ...sideB,
        troops: { ...sideB.troops, lancer: {
          ...sideB.troops.lancer,
          troopLevel: "T10-FC8",
          skillStates: createConfirmedTroopSkillLoadout("lancer", "T10-FC8"),
        } },
      },
    }), {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        triggerOverrides: {
          "B:lancer-crimson-field": true,
          "B:lancer-ambush": false,
          "B:lancer-crystal-spear": false,
        },
      }),
      heroSkillSystem: heroSystem(countedRandom([0])),
    });
    const incoming = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    const checks = result.trace.troopSkills.filter((entry) =>
      entry.side === "B" && entry.skillId === "lancer-crimson-field"
    );
    expect(incoming).toHaveLength(2);
    expect(checks).toHaveLength(2);
    expect(incoming.map((event) => event.receivedDamageReductionDenominator)).toEqual([1.5, 1.5]);
  });

  it("adds Sergei and Jessie received-damage reductions inside one group", () => {
    const sideA = makeSide({ shield: 1 }, {
      armyEffects: [makeDamageEffect({
        id: "synthetic-jessie-barrier", kind: "damageReduction",
        group: "receivedDamageReduction", value: .2,
      })],
    });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.sr.xieergai", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: hugeHp }),
    }), { heroSkillSystem: heroSystem() });
    const incoming = attack(result, "B", "shield");
    expect(incoming.reductionGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "receivedDamageReduction", summedValue: .4 }),
    ]));
    expect(incoming.reductionMultiplier).toBeCloseTo(1.4);
  });

  it("attributes Bahiti's child to the source troop and skill without double-counting casualties", () => {
    const sideA = makeSide({ shield: 1 }, { maxHpPerUnit: hugeHp });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, shield: { ...sideA.troops.shield, damageCoefficient: 100 } },
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.sr.baxiti", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: 100 }),
    }), { heroSkillSystem: heroSystem(countedRandom([0])) });
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.baxiti.unstable-field"
    )!;
    expect(extra.sourceTroop).toBe("shield");
    expect(extra.sourceSkillId).toBe("hero-skill.baxiti.unstable-field");
    expect(result.stateAfter.sideB.troops.shield.aliveCount).toBe(0);
    expect(result.casualties.find((entry) =>
      entry.targetSide === "B" && entry.targetTroop === "shield"
    )?.casualties).toBe(1);
  });

  it("18. applies Jessie's expedition penetration bonus", () => {
    const result = roundWithHeroes([
      { heroId: "hero.body.jiexi", position: "member", selectedMemberSkillId: "hero-skill.jiexi.penetration" },
    ]);
    expect(attributeResolution(attack(result, "A", "shield"), "penetration").buffedAttribute)
      .toBeCloseTo(.25);
  });

  it("19. applies Jessie's Mechanical Barrier only when active as leader skill 2", () => {
    const result = roundWithHeroes([
      { heroId: "hero.body.jiexi", position: "leader" },
    ]);
    expect(attack(result, "B", "shield").reductionMultiplier).toBeCloseTo(1.2);
  });

  it("20. excludes Seo-yoon's non-combat expedition skill 2", () => {
    const leader = createConfirmedHeroState({
      heroId: "hero.body.shuyun", position: "leader",
    });
    expect(leader.skillStates.map((skill) => skill.skillId)).toEqual([
      "hero-skill.shuyun.attack",
    ]);
    expect(getExpeditionHeroData("hero.body.shuyun")!.expeditionSkills[1]?.combatRelevant).toBe(false);
  });

  it("21. excludes Jasser's non-combat expedition skill 2 while keeping penetration", () => {
    const leader = createConfirmedHeroState({
      heroId: "hero.body.jiesaier", position: "leader",
    });
    expect(leader.skillStates.map((skill) => skill.skillId)).toEqual([
      "hero-skill.jiesaier.penetration",
    ]);
  });

  it("22. applies Lum Pogen as enemyPenetrationReduction", () => {
    const result = roundWithHeroes([
      { heroId: "hero.sr.lumubogen", position: "member", selectedMemberSkillId: "hero-skill.lumubogen.penetration-reduction" },
    ]);
    const resolution = attributeResolution(attack(result, "B", "shield"), "penetration");
    expect(resolution.reductionGroups[0]).toEqual(expect.objectContaining({
      group: "enemyPenetrationReduction", summedValue: .20, divisionFactor: 1.2,
    }));
  });

  it("23. adds Sergei and Ling Shuang attack reductions before dividing once", () => {
    const result = roundWithHeroes([
      { heroId: "hero.sr.xieergai", position: "leader" },
      { heroId: "hero.sr.lingshuang", position: "member", selectedMemberSkillId: "hero-skill.lingshuang.attack-reduction" },
    ]);
    const resolution = attributeResolution(attack(result, "B", "shield"), "attack");
    expect(resolution.reductionGroups).toEqual([
      expect.objectContaining({ summedValue: .40, divisionFactor: 1.4 }),
    ]);
    expect(resolution.finalAttribute).toBeCloseTo(1 / 1.4 - 1);
  });

  it("24. keeps both Gina expedition skills out of combat", () => {
    expect(getExpeditionHeroData("hero.sr.jina")!.expeditionSkills.every(
      (skill) => !skill.combatRelevant,
    )).toBe(true);
    expect(createConfirmedHeroState({
      heroId: "hero.sr.jina", position: "leader",
    }).skillStates).toEqual([]);
  });

  it("25. keeps Hendrik defense reduction separate from vulnerability", () => {
    const result = roundWithHeroes([
      { heroId: HENDRIK_DEFENSE_REDUCTION_S8.heroId, position: "member", selectedMemberSkillId: HENDRIK_DEFENSE_REDUCTION_S8.id },
    ]);
    const event = attack(result, "A", "shield");
    expect(event.attributeResolutions?.find((entry) => entry.attribute === "defense")
      ?.reductionGroups).toEqual([
      expect.objectContaining({ group: "enemyDefenseReduction", summedValue: .25 }),
    ]);
    expect(event.defenseReductionGroups).toEqual([]);
    expect(event.increaseGroups).toEqual([]);
    expect(event.appliedIncreaseEffects).toEqual([]);
  });

  it("26. traces hero stat correction and enemy attribute reduction", () => {
    const result = runPureTroopBattleScenario({
      id: "hero-rule-trace",
      sideA: scenarioSide([
        { heroId: "hero.sr.xieergai", position: "leader" },
        { heroId: "hero.sr.lingshuang", position: "member", selectedMemberSkillId: "hero-skill.lingshuang.attack-reduction" },
      ], ["hero.r.youjin"]),
      sideB: scenarioSide([], []),
      maxRounds: 1,
    });
    expect(result.simulation.trace.heroStatCorrections?.A?.delta.shield.attack)
      .toBeCloseTo(.5004);
    expect(result.readableTrace).toContain("=== HeroStatCorrection A ===");
    expect(result.readableTrace).toContain("Attribute attack");
    expect(result.readableTrace).toContain("enemyAttackReduction{sum=0.4,divideBy=1.4}");
  });

  it("uses the confirmed shield/lancer/marksman HP coefficient table", () => {
    expect(TROOP_HP_COEFFICIENTS).toEqual({ shield: 300, lancer: 100, marksman: 75 });
  });
});

function memberFormation(): readonly HeroFormationInput[] {
  return [
    { heroId: "hero.body.jiexi", position: "member", selectedMemberSkillId: "hero-skill.jiexi.penetration" },
    { heroId: "hero.body.shuyun", position: "member", selectedMemberSkillId: "hero-skill.shuyun.attack" },
    { heroId: "hero.body.jiesaier", position: "member", selectedMemberSkillId: "hero-skill.jiesaier.penetration" },
    { heroId: "hero.sr.lumubogen", position: "member", selectedMemberSkillId: "hero-skill.lumubogen.penetration-reduction" },
    { heroId: "hero.sr.lingshuang", position: "member", selectedMemberSkillId: "hero-skill.lingshuang.attack-reduction" },
  ];
}

function heroSystem(randomSource?: RandomSource) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    ...(randomSource === undefined ? {} : { randomSource }),
  });
}

function roundWithHeroes(
  heroes: readonly HeroFormationInput[],
  counts: Partial<Record<TroopType, number>> = { shield: 100 },
  randomSource?: RandomSource,
) {
  const sideA = makeSide(counts, { maxHpPerUnit: 1_000 });
  const state = createBattleState({
    sideA: { ...sideA, heroStates: createConfirmedHeroFormation(heroes) },
    sideB: makeSide({ shield: 100 }, { maxHpPerUnit: hugeHp }),
  });
  return resolveRound(state, { heroSkillSystem: heroSystem(randomSource) });
}

function attack(
  result: ReturnType<typeof resolveRound>,
  side: SideId,
  troop: TroopType,
) {
  return result.trace.damageEvents.find(
    (event) => event.sourceSide === side && event.sourceTroop === troop,
  )!;
}

function attributeResolution(
  event: ReturnType<typeof attack>,
  attribute: "attack" | "penetration",
) {
  return event.attributeResolutions!.find(
    (resolution) => resolution.attribute === attribute,
  )!;
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

function scenarioSide(
  heroes: readonly HeroFormationInput[],
  reportHeroIds: readonly string[],
) {
  const troop = (count: number, damageCoefficient: number) => ({
    count, attack: .2, penetration: .1, defense: .2, life: .1,
    troopLevel: "T6", troopConstant: getTroopConstant("T6"), damageCoefficient,
  });
  return {
    shield: troop(20, 1), lancer: troop(20, 3), marksman: troop(20, 4),
    heroes, reportHeroIds,
  };
}
