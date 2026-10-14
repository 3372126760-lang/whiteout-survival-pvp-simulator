import { describe, expect, it } from "vitest";
import {
  CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  EXPEDITION_HERO_DATA,
  HENDRIK_DEFENSE_REDUCTION_S8,
  createBattleState,
  createConfirmedHeroState,
  createConfirmedTroopSkillLoadout,
  createHeroSkillSystem,
  createHeroStateFromDefinitions,
  createTroopSkillSystem,
  formatBattleTrace,
  resolveRound,
  type HeroSkillDefinition,
  type HeroSkillEffect,
} from "../../pvp";
import { makeSide } from "./helpers";

const highHp = 1_000_000_000;

describe("PVP hero skill integration", () => {
  it("registers only catalog-backed combat skills", () => {
    const catalogHeroIds = new Set(EXPEDITION_HERO_DATA.map((hero) => hero.id));
    expect(CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS.every(
      (definition) => catalogHeroIds.has(definition.heroId),
    )).toBe(true);
  });

  it("activates every confirmed expedition skill for a leader", () => {
    const hero = createConfirmedHeroState({
      heroId: "hero.head.fulinte",
      position: "leader",
    });
    expect(hero.skillStates).toHaveLength(3);
    expect(hero.skillStates.every((skill) => skill.level === 5)).toBe(true);
  });

  it("uses the global first-expedition-skill rule for a member", () => {
    const hero = createConfirmedHeroState({
      heroId: "hero.head.fulinte",
      position: "member",
      selectedMemberSkillId: "hero-skill.fulinte.wildfire",
    });
    expect(hero.skillStates.map((skill) => skill.skillId)).toEqual([
      "hero-skill.fulinte.wildfire",
    ]);
  });

  it("activates all combat-relevant expedition skills for a catalog leader", () => {
    const hero = createConfirmedHeroState({
      heroId: "hero.body.jiexi",
      position: "leader",
    });
    expect(hero.skillStates.map((skill) => skill.skillId)).toEqual([
      "hero-skill.jiexi.penetration",
      "hero-skill.jiexi.mechanical-barrier",
    ]);
  });

  it("applies a hero attack bonus through the attack attribute resolver", () => {
    const result = roundWithHero("hero.body.shuyun", "member", { shield: 100 });
    const attack = attackFrom(result, "A", "shield");
    expect(attack.baseDamageAttributeEffects).toEqual([
      expect.objectContaining({
        attribute: "attack",
        group: "heroAttackBonus",
        effectiveValue: 0.25,
      }),
    ]);
  });

  it("applies a hero penetration bonus through the penetration attribute resolver", () => {
    const result = roundWithHero("hero.body.jiexi", "member", { lancer: 100 });
    const attack = attackFrom(result, "A", "lancer");
    expect(attack.baseDamageAttributeEffects).toEqual([
      expect.objectContaining({
        attribute: "penetration",
        group: "heroPenetrationBonus",
        effectiveValue: 0.25,
      }),
    ]);
  });

  it("stacks hero defense and Steel Guardian in the target defense attribute", () => {
    const defenseSkill = simpleSkill(
      "hero.synthetic.defender",
      "hero-skill.synthetic.defense",
      {
        id: "hero-effect.synthetic.defense",
        name: "synthetic defense",
        kind: "attributeModifier",
        recipient: "selfArmy",
        attribute: "defense",
        operation: "multiplyAttributeFactor",
        group: "heroDefenseBonus",
        value: 0.2,
        scope: { source: "shield", target: "all", damageType: "all" },
      },
    );
    const defenderBase = makeSide({ shield: 100 }, {
      maxHpPerUnit: highHp,
      skillStates: {
        shield: createConfirmedTroopSkillLoadout("shield", "T7"),
      },
    });
    const state = createBattleState({
      sideA: makeSide({ lancer: 100 }, { maxHpPerUnit: highHp }),
      sideB: {
        ...defenderBase,
        heroStates: [createHeroStateFromDefinitions({
          heroId: defenseSkill.heroId,
          position: "member",
        }, [defenseSkill])],
      },
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
      }),
      heroSkillSystem: createHeroSkillSystem({ definitions: [defenseSkill] }),
    });
    const attack = attackFrom(result, "A", "lancer");
    expect(attack.attributeResolutions?.find((entry) => entry.attribute === "defense")?.modifierGroups
      .find((group) => group.group === "heroDefenseBonus")?.summedValue).toBeCloseTo(.3);
    expect(attack.targetDefenseMultiplier).toBeCloseTo(1.3);
  });

  it("keeps Hendrik's formal defense reduction in its explicit group", () => {
    const reduction = roundWithHero(
      HENDRIK_DEFENSE_REDUCTION_S8.heroId,
      "member",
      { shield: 100 },
    );
    const event = attackFrom(reduction, "A", "shield");
    expect(event.attributeResolutions?.find((entry) => entry.attribute === "defense")
      ?.reductionGroups).toEqual([
      expect.objectContaining({ group: "enemyDefenseReduction", summedValue: .25 }),
    ]);
  });

  it("keeps Reina's formal Assassin Instinct on normal attacks", () => {
    const result = roundWithHero("hero.s4.lingnai", "member", { lancer: 100 });
    expect(attackFrom(result, "A", "lancer").increaseGroups).toEqual([
      expect.objectContaining({ group: "normalAttackDamageIncrease", summedValue: .30 }),
    ]);
  });

  it("keeps Cara's formal Mechanical Pet on normal attacks", () => {
    const result = roundWithHero("hero.s14.cara", "leader", { shield: 100 });
    expect(attackFrom(result, "A", "shield").increaseGroups).toEqual([
      expect.objectContaining({ group: "normalAttackDamageIncrease", summedValue: .30 }),
    ]);
  });

  it("lets hero and troop effects coexist on one DamageEvent", () => {
    const attacker = makeSide({ marksman: 100 }, {
      maxHpPerUnit: highHp,
      skillStates: {
        marksman: createConfirmedTroopSkillLoadout("marksman", "T1"),
      },
    });
    const state = createBattleState({
      sideA: {
        ...attacker,
        heroStates: [createConfirmedHeroState({
          heroId: "hero.s5.nuola",
          position: "member",
          selectedMemberSkillId: "hero-skill.nuola.multi-troop-combat",
        })],
      },
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
      }),
      heroSkillSystem: heroSystem(),
    });
    const groups = attackFrom(result, "A", "marksman").increaseGroups;
    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ group: "troopCounterDamage", summedValue: 0.1 }),
      expect.objectContaining({ group: "commonDamageIncrease", summedValue: 0.15 }),
    ]));
  });

  it("honors per-skill activationTiming", () => {
    const timed = simpleSkill(
      "hero.synthetic.timed",
      "hero-skill.synthetic.next-round",
      {
        id: "hero-effect.synthetic.next-round",
        name: "next round damage",
        kind: "damageIncrease",
        recipient: "selfArmy",
        group: "timedHeroDamage",
        value: 0.4,
        scope: { source: "army", target: "all", damageType: "all" },
      },
      "nextRound",
    );
    const state = stateWithCustomHero(timed);
    const system = createHeroSkillSystem({ definitions: [timed] });
    const round1 = resolveRound(state, { heroSkillSystem: system });
    const round2 = resolveRound(round1.stateAfter, { heroSkillSystem: system });
    expect(attackFrom(round1, "A", "shield").increaseGroups).toEqual([]);
    expect(attackFrom(round2, "A", "shield").increaseGroups).toEqual([
      expect.objectContaining({ group: "timedHeroDamage", summedValue: 0.4 }),
    ]);
  });

  it("supports static hero life modifiers without hiding them in damage reduction", () => {
    const life = simpleSkill(
      "hero.synthetic.life",
      "hero-skill.synthetic.life",
      {
        id: "hero-effect.synthetic.life",
        name: "life bonus",
        kind: "attributeModifier",
        recipient: "selfArmy",
        attribute: "life",
        operation: "addToAttribute",
        group: "heroLifeBonus",
        value: 0.25,
        scope: { source: "army", target: "all", damageType: "all" },
      },
    );
    const result = resolveRound(stateWithCustomHero(life), {
      heroSkillSystem: createHeroSkillSystem({ definitions: [life] }),
    });
    expect(result.snapshot.sideA.troops.shield.maxHpPerUnit).toBe(1_250);
    expect(result.snapshot.sideA.troops.shield.frontUnitHp).toBe(1_250);
  });

  it("separates troop and hero skill records in structured and readable trace", () => {
    const attacker = makeSide({ shield: 100 }, {
      maxHpPerUnit: highHp,
      skillStates: {
        shield: createConfirmedTroopSkillLoadout("shield", "T1"),
      },
    });
    const state = createBattleState({
      sideA: {
        ...attacker,
        heroStates: [createConfirmedHeroState({
          heroId: "hero.body.shuyun",
          position: "member",
          selectedMemberSkillId: "hero-skill.shuyun.attack",
        })],
      },
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
      }),
      heroSkillSystem: heroSystem(),
    });
    expect(result.trace.troopSkills.some(
      (skill) => skill.skillId === "shield-dense-formation",
    )).toBe(true);
    expect(result.trace.heroSkills).toEqual([
      expect.objectContaining({
        heroId: "hero.body.shuyun",
        skillLevel: 5,
        position: "member",
        activationTiming: "immediate",
        groups: ["heroAttackBonus"],
      }),
    ]);
    const readable = formatBattleTrace({
      rounds: [result.trace],
      endReason: "roundLimit",
      finalStatus: result.trace.roundEnd.battleStatus,
    });
    expect(readable).toContain("-- TroopSkills --");
    expect(readable).toContain("-- HeroSkills --");
    expect(readable).toContain("hero.body.shuyun position=member");
  });
});

function heroSystem() {
  return createHeroSkillSystem({
    definitions: CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS,
  });
}

function roundWithHero(
  heroId: string,
  position: "leader" | "member",
  counts: Partial<Record<"shield" | "lancer" | "marksman", number>>,
) {
  const side = makeSide(counts, { maxHpPerUnit: highHp });
  return resolveRound(createBattleState({
    sideA: {
      ...side,
      heroStates: [createConfirmedHeroState({
        heroId,
        position,
        ...(position === "member" && CATALOG_MEMBER_SKILLS[heroId] !== undefined
          ? { selectedMemberSkillId: CATALOG_MEMBER_SKILLS[heroId] }
          : {}),
      })],
    },
    sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
  }), { heroSkillSystem: heroSystem() });
}

const CATALOG_MEMBER_SKILLS: Readonly<Record<string, string>> = {
  "hero.body.jiexi": "hero-skill.jiexi.penetration",
  "hero.body.shuyun": "hero-skill.shuyun.attack",
  "hero.body.jiesaier": "hero-skill.jiesaier.penetration",
  "hero.s8.hengdelike": "hero-skill.s8.hengdelike.defense-reduction",
  "hero.s4.lingnai": "hero-skill.lingnai.assassin-instinct",
  "hero.s5.nuola": "hero-skill.nuola.multi-troop-combat",
};

function attackFrom(
  result: ReturnType<typeof resolveRound>,
  sourceSide: "A" | "B",
  sourceTroop: "shield" | "lancer" | "marksman",
) {
  return result.trace.damageEvents.find(
    (event) => event.sourceSide === sourceSide && event.sourceTroop === sourceTroop,
  )!;
}

function simpleSkill(
  heroId: string,
  id: string,
  effect: HeroSkillEffect,
  activationTiming: HeroSkillDefinition["activationTiming"] = "immediate",
): HeroSkillDefinition {
  return {
    id,
    heroId,
    name: id,
    positionRule: {
      kind: "expeditionSkillSlot",
      expeditionSkillSlot: 1,
      allowedPositions: ["member"],
    },
    trigger: "passive",
    activationTiming,
    levelValues: { 5: { effects: [effect] } },
    metadata: { ruleStatus: "supported", source: "test" },
  };
}

function stateWithCustomHero(definition: HeroSkillDefinition) {
  const side = makeSide({ shield: 1 }, { maxHpPerUnit: 1_000 });
  return createBattleState({
    sideA: {
      ...side,
      heroStates: [createHeroStateFromDefinitions({
        heroId: definition.heroId,
        position: "member",
      }, [definition])],
    },
    sideB: makeSide({ shield: 1 }, { maxHpPerUnit: highHp }),
  });
}
