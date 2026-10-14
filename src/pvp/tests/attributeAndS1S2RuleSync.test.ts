import { describe, expect, it } from "vitest";
import {
  ALONSO_SHARP_HARPOON,
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  createActiveEffect,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedTroopSkillLoadout,
  createHeroSkillSystem,
  createTroopSkillSystem,
  resolveRound,
  resolveTroopAttribute,
  simulateBattle,
  type HeroFormationInput,
  type HeroSkillTriggerOverrides,
  type TroopType,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

const highHp = 1_000_000_000;

function heroSystem(overrides: HeroSkillTriggerOverrides = {}) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    triggerOverrides: overrides,
    randomSource: { next: () => .99 },
  });
}

function attackOf(result: ReturnType<typeof resolveRound>, side: "A" | "B", troop: TroopType) {
  return result.trace.damageEvents.find((event) =>
    event.sourceSide === side && event.sourceTroop === troop &&
    event.damageType === "normalAttack" && event.parentEventId === undefined
  )!;
}

describe("global skill-attribute and S1/S2 final rules", () => {
  it("multiplies a 700% immutable attack panel by Jeronimo's 25% skill factor", () => {
    const sideA = makeSide({ shield: 1 }, { maxHpPerUnit: highHp });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, shield: { ...sideA.troops.shield, attack: 7 } },
        heroStates: createConfirmedHeroFormation([
          { heroId: "hero.s1.heluonimo", position: "leader" },
        ]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem() });
    const attack = attackOf(result, "A", "shield");
    expect(result.snapshot.sideA.troops.shield.attack).toBe(7);
    expect(attack.attributeResolutions?.find((row) => row.attribute === "attack")?.finalAttribute).toBe(9);
    expect(attack.baseDamage).toBeCloseTo(10 * 1.25); // Jeronimo also grants penetration.
  });

  it("adds Jeronimo +25% and Philly +15% within one attack-skill group before multiplying panel", () => {
    const sideA = makeSide({ shield: 1 }, { maxHpPerUnit: highHp });
    const heroes: readonly HeroFormationInput[] = [
      { heroId: "hero.s1.heluonimo", position: "leader" },
      { heroId: "hero.s2.feilande", position: "member", selectedMemberSkillId: "hero-skill.feilande.fitness-secret" },
    ];
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, shield: { ...sideA.troops.shield, attack: 7 } },
        heroStates: createConfirmedHeroFormation(heroes),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem() });
    const attack = attackOf(result, "A", "shield");
    const group = attack.attributeResolutions?.find((row) => row.attribute === "attack")
      ?.modifierGroups.find((row) => row.group === "heroAttackBonus");
    expect(group).toMatchObject({ summedValue: .4, operation: "multiplyAttributeFactor" });
    expect(attack.baseDamage).toBeCloseTo(8 * 1.4 * 1.25);
    expect(result.snapshot.sideA.troops.shield.attack).toBe(7);
  });

  it("adds Philly Lv2 defense 4% and Steel Guardian 10% into one /1.14 factor", () => {
    const sideA = makeSide({ shield: 1 }, {
      maxHpPerUnit: highHp,
      skillStates: { shield: createConfirmedTroopSkillLoadout("shield", "T7") },
    });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, shield: { ...sideA.troops.shield, defense: 7 } },
        heroStates: createConfirmedHeroFormation([{
          heroId: "hero.s2.feilande", position: "leader",
          skillLevels: { "hero-skill.feilande.fitness-secret": 2 },
        }]),
      },
      sideB: makeSide({ lancer: 1 }, { maxHpPerUnit: highHp }),
    }), {
      heroSkillSystem: heroSystem({
        "hero-skill.feilande.strengthening-potion": false,
        "hero-skill.feilande.stimulant": false,
      }),
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
      }),
    });
    const incoming = attackOf(result, "B", "lancer");
    expect(incoming.attributeResolutions?.find((entry) => entry.attribute === "defense")?.modifierGroups)
      .toEqual(expect.arrayContaining([expect.objectContaining({ group: "heroDefenseBonus", summedValue: .14 })]));
    expect(incoming.targetDefenseMultiplier).toBeCloseTo(8 * 1.14);
    expect(result.snapshot.sideA.troops.shield.defense).toBe(7);
  });

  it("adds Zinman defense 10% and Steel Guardian 10% into one /1.20 factor", () => {
    const sideA = makeSide({ shield: 1 }, {
      maxHpPerUnit: highHp,
      skillStates: { shield: createConfirmedTroopSkillLoadout("shield", "T7") },
    });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.s1.jinman", position: "leader" }]),
      },
      sideB: makeSide({ lancer: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem(), troopSkillSystem: createTroopSkillSystem({
      definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
    }) });
    const incoming = attackOf(result, "B", "lancer");
    expect(incoming.attributeResolutions?.find((entry) => entry.attribute === "defense")?.modifierGroups)
      .toEqual(expect.arrayContaining([expect.objectContaining({ group: "heroDefenseBonus", summedValue: .2 })]));
    expect(incoming.targetDefenseMultiplier).toBeCloseTo(1.2);
  });

  it.each([
    ["hero.s1.moli", "hero-skill.moli.ice-field"],
    ["hero.s2.alongsuo", "hero-skill.alongsuo.sharp-harpoon"],
  ] as const)("makes %s one extraDamage child per triggered troop main attack", (heroId, skillId) => {
    const result = resolveRound(createBattleState({
      sideA: {
        ...makeSide({ shield: 1, lancer: 1, marksman: 1 }, { maxHpPerUnit: highHp }),
        heroStates: createConfirmedHeroFormation([{ heroId, position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem({
      [skillId]: true,
      "hero-skill.moli.snow-command": false,
      "hero-skill.alongsuo.stormy-waves": false,
      "hero-skill.alongsuo.steel-will": false,
    }) });
    const children = result.trace.damageEvents.filter((event) => event.sourceSkillId === skillId);
    expect(children.map((event) => event.sourceTroop)).toEqual(["shield", "lancer", "marksman"]);
    for (const child of children) {
      const parent = attackOf(result, "A", child.sourceTroop);
      expect(child).toMatchObject({
        damageType: "skillDamage", damageSubtype: "extraDamage", parentEventId: parent.id,
        damageBasis: "parentBaseDamage",
      });
      expect(child.baseDamage).toBeCloseTo(parent.baseDamage * .5);
      expect(parent.increaseGroups.some((group) =>
        group.group === "iceFieldDamage" || group.group === "sharpHarpoonDamage"
      )).toBe(false);
    }
  });

  it("keeps Sharp Harpoon's Lv1-Lv5 extraDamage coefficients at 10/20/30/40/50%", () => {
    for (const [level, coefficient] of [[1, .1], [2, .2], [3, .3], [4, .4], [5, .5]] as const) {
      expect(ALONSO_SHARP_HARPOON.levelValues[level]?.effects[0]).toMatchObject({
        kind: "extraDamage", coefficient, basis: "parentBaseDamage",
      });
    }
  });

  it("keeps Molly's extraDamage outside a normalAttack-only +25% group", () => {
    const sideA = makeSide({ shield: 1 }, {
      maxHpPerUnit: highHp,
      armyEffects: [makeDamageEffect({
        id: "normal-only-25", kind: "damageIncrease",
        group: "normalAttackDamageIncrease", value: .25,
        scope: { damageTypes: ["normalAttack"] },
      })],
    });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.s1.moli", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem({
      "hero-skill.moli.snow-command": false,
      "hero-skill.moli.ice-field": true,
    }) });
    const normal = attackOf(result, "A", "shield");
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.moli.ice-field"
    )!;
    expect(normal.increaseGroups.some((group) => group.group === "normalAttackDamageIncrease")).toBe(true);
    expect(extra.increaseGroups.some((group) => group.group === "normalAttackDamageIncrease")).toBe(false);
    expect(extra.baseDamage).toBeCloseTo(normal.baseDamage * .5);
  });

  it("keeps Zinman defense in the event group and life in the HP multiplier", () => {
    const result = resolveRound(createBattleState({
      sideA: {
        ...makeSide({ shield: 1 }, { maxHpPerUnit: 1_000 }),
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.s1.jinman", position: "leader" }]),
      },
      sideB: makeSide({ lancer: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem() });
    expect(result.snapshot.sideA.troops.shield.life).toBe(0);
    expect(result.snapshot.sideA.troops.shield.defense).toBe(0);
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_100);
    expect(attackOf(result, "B", "lancer").targetDefenseMultiplier).toBeCloseTo(1.1);
  });

  it("keeps Jeronimo's periodic +30% damage on R5/6 and R9/10 only", () => {
    let state = createBattleState({
      sideA: {
        ...makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.s1.heluonimo", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
    });
    const system = heroSystem();
    for (let round = 1; round <= 10; round += 1) {
      const result = resolveRound(state, { heroSkillSystem: system });
      const active = attackOf(result, "A", "shield").increaseGroups.some(
        (group) => group.group === "commonDamageIncrease" && group.summedValue === .3,
      );
      expect(active, `R${round}`).toBe([5, 6, 9, 10].includes(round));
      state = result.stateAfter;
    }
  });

  it("applies S3+ legacy attribute labels as skill multipliers without rewriting their definition", () => {
    const sideA = makeSide({ shield: 1 }, { maxHpPerUnit: 1_000 });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, shield: { ...sideA.troops.shield, life: 2 } },
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.s3.luogen", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem() });
    expect(result.snapshot.sideA.troops.shield.life).toBe(2);
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_000 * 3 * 1.25);
  });

  it("uses separate attribute-reduction divisors for defense and life without changing panel values", () => {
    const effect = (id: string, kind: "attributeModifier" | "attributeReduction", value: number) =>
      createActiveEffect({
        identity: { sourceId: id, sourceSkillId: id, effectId: id },
        definition: kind === "attributeModifier"
          ? { id, name: id, kind, attribute: "life", group: "skillLifeBonus", value,
            operation: "multiplyAttributeFactor", ruleStatus: "supported" }
          : { id, name: id, kind, attribute: "life", group: "skillLifeReduction", value,
            ruleStatus: "supported" },
        appliedRound: 1,
      });
    const sideA = makeSide({ shield: 1 }, {
      armyEffects: [effect("buff-10", "attributeModifier", .1), effect("buff-15", "attributeModifier", .15), effect("reduction-10", "attributeReduction", .1)],
    });
    const state = createBattleState({
      sideA: { ...sideA, troops: { ...sideA.troops, shield: { ...sideA.troops.shield, life: 2 } } },
      sideB: makeSide({ shield: 1 }),
    });
    const resolved = resolveTroopAttribute(state.sideA, "shield", "life", 1, {
      targetTroop: "shield", damageType: "normalAttack",
    });
    expect(state.sideA.troops.shield.life).toBe(2);
    expect(resolved.multiplier).toBeCloseTo(3 * 1.25 / 1.1);
    expect(resolved.groups[0]).toMatchObject({ group: "skillLifeBonus", summedValue: .25 });
  });

  it("checks Natalia, Molly, and Philly round-start reductions once each and adds one denominator", () => {
    const heroes: readonly HeroFormationInput[] = [
      { heroId: "hero.s1.nataliya", position: "leader" },
      { heroId: "hero.s1.moli", position: "member", selectedMemberSkillId: "hero-skill.moli.snow-command" },
      { heroId: "hero.s2.feilande", position: "leader" },
    ];
    const ids = [
      "hero-skill.nataliya.wild-roar",
      "hero-skill.moli.snow-command",
      "hero-skill.feilande.stimulant",
    ];
    const result = resolveRound(createBattleState({
      sideA: {
        ...makeSide({ shield: 1, lancer: 1, marksman: 1 }, { maxHpPerUnit: highHp }),
        heroStates: createConfirmedHeroFormation(heroes),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
    }), { heroSkillSystem: heroSystem({
      ...Object.fromEntries(ids.map((id) => [id, true])),
      "hero-skill.feilande.strengthening-potion": false,
      "hero-skill.moli.ice-field": false,
    }) });
    for (const id of ids) {
      expect(result.trace.heroSkills.filter((entry) => entry.skillId === id)).toHaveLength(1);
    }
    expect(attackOf(result, "B", "shield").reductionGroups).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "receivedDamageReduction", summedValue: 1.5 }),
    ]));
    expect(attackOf(result, "B", "shield").reductionMultiplier).toBeCloseTo(2.5);
    expect(attackOf(result, "B", "shield").targetDefenseMultiplier).toBeCloseTo(1.1);
  });

  it("checks Philly potion exactly 1500 times over 1500 three-troop rounds", () => {
    let checks = 0;
    const state = createBattleState({
      sideA: {
        ...makeSide({ shield: 1, lancer: 1, marksman: 1 }, { maxHpPerUnit: 1_000_000_000_000 }),
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.s2.feilande", position: "leader" }]),
      },
      sideB: makeSide({ shield: 1, lancer: 1, marksman: 1 }, { maxHpPerUnit: 1_000_000_000_000 }),
    });
    const simulation = simulateBattle(state, {
      maxRounds: 1_500,
      traceMode: "summary",
      heroSkillSystem: createHeroSkillSystem({
        definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
        randomSource: { next: () => .99 },
        recordTrace: false,
        onProbabilityDecision(decision) {
          if (decision.skillId === "hero-skill.feilande.strengthening-potion") checks += 1;
        },
      }),
    });
    expect(simulation.roundCount).toBe(1_500);
    expect(checks).toBe(4_500);
  });

  it.each([
    ["hero.sr.baxiti", "hero-skill.baxiti.unstable-field", .5],
    ["hero.s1.moli", "hero-skill.moli.ice-field", .5],
    ["hero.s2.alongsuo", "hero-skill.alongsuo.sharp-harpoon", .5],
    ["hero.s2.feilande", "hero-skill.feilande.strengthening-potion", 1],
  ] as const)("attributes %s extraDamage to skill and troop while counting one total casualty", (heroId, skillId, coefficient) => {
    const sideA = makeSide({ shield: 1 }, { maxHpPerUnit: highHp });
    const result = resolveRound(createBattleState({
      sideA: {
        ...sideA,
        troops: { ...sideA.troops, shield: { ...sideA.troops.shield, damageCoefficient: 100 } },
        heroStates: createConfirmedHeroFormation([{ heroId, position: "leader" }]),
      },
      sideB: makeSide({ shield: 1 }, { maxHpPerUnit: 150 }),
    }), { heroSkillSystem: heroSystem({
      [skillId]: true,
      "hero-skill.nataliya.wild-roar": false,
      "hero-skill.moli.snow-command": false,
      "hero-skill.alongsuo.stormy-waves": false,
      "hero-skill.alongsuo.steel-will": false,
      "hero-skill.feilande.stimulant": false,
    }) });
    const normal = attackOf(result, "A", "shield");
    const extra = result.trace.damageEvents.find((event) => event.sourceSkillId === skillId)!;
    expect(extra).toMatchObject({
      sourceTroop: "shield", damageType: "skillDamage", damageSubtype: "extraDamage",
      parentEventId: normal.id,
    });
    if (heroId !== "hero.s2.feilande") expect(extra.baseDamage).toBeCloseTo(normal.baseDamage * coefficient);
    expect(result.stateAfter.sideB.troops.shield.aliveCount).toBe(0);
    expect(result.casualties.filter((row) => row.targetSide === "B" && row.targetTroop === "shield")
      .reduce((sum, row) => sum + row.casualties, 0)).toBe(1);
  });
});
