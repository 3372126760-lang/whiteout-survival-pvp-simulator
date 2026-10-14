import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  LANCER_AMBUSH_SKILL_DEFINITION,
  LANCER_CRIMSON_FIELD,
  LANCER_CRYSTAL_SPEAR,
  LANCER_RADIANT_FORMATION,
  MARKSMAN_CRYSTAL_POWDER,
  MARKSMAN_RAPID_FIRE,
  SHIELD_CRYSTAL_SHIELD,
  SHIELD_IMMORTAL_WALL,
  SHIELD_LIGHTFORGED_BODY,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedTroopSkillLoadout,
  createDamageEvent,
  createHeroSkillSystem,
  createSequenceRandomSource,
  createTroopSkillSystem,
  formatBattleTrace,
  getTroopConstant,
  resolveRound,
  simulateBattle,
  type BattleSideSetup,
  type SideId,
  type TroopSkillTriggerOverrides,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const highHp = 1_000_000_000;

function confirmedSide(
  troopType: TroopType,
  troopLevel: string,
  counts: Partial<Record<TroopType, number>>,
  contributorCount = 0,
): BattleSideSetup {
  const base = makeSide(counts, { maxHpPerUnit: highHp });
  return {
    ...base,
    troops: {
      ...base.troops,
      [troopType]: {
        ...base.troops[troopType],
        troopLevel,
        skillStates: createConfirmedTroopSkillLoadout(
          troopType,
          troopLevel,
          Math.min(24, contributorCount * 3),
        ),
      },
    },
  };
}

function system(options: {
  readonly rolls?: readonly number[];
  readonly overrides?: TroopSkillTriggerOverrides;
} = {}) {
  return createTroopSkillSystem({
    definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
    ...(options.rolls === undefined
      ? {}
      : { randomSource: createSequenceRandomSource(options.rolls) }),
    ...(options.overrides === undefined
      ? {}
      : { triggerOverrides: options.overrides }),
  });
}

function findAttack(
  result: ReturnType<typeof resolveRound>,
  sourceSide: SideId,
  sourceTroop: TroopType,
) {
  return result.trace.damageEvents.find(
    (event) =>
      event.sourceSide === sourceSide && event.sourceTroop === sourceTroop,
  )!;
}

describe("confirmed troop skill rules", () => {
  it("puts all three base counters in troopCounterDamage", () => {
    const counterEffects = CONFIRMED_TROOP_SKILL_DEFINITIONS.flatMap(
      (skill) => Object.values(skill.levelValues).flatMap((level) =>
        level.effects.filter(
          (effect) =>
            effect.kind === "damageIncrease" &&
            effect.group === "troopCounterDamage",
        ),
      ),
    );
    expect(counterEffects).toHaveLength(3);
    expect(counterEffects.map((effect) =>
      effect.kind === "damageIncrease" ? effect.value : Number.NaN,
    )).toEqual([0.1, 0.1, 0.1]);
    expect(counterEffects.map((effect) => effect.scope.target).sort()).toEqual([
      "lancer",
      "marksman",
      "shield",
    ]);
  });

  it("applies Steel Guardian only when shield receives lancer damage", () => {
    const result = resolveRound(
      createBattleState({
        sideA: makeSide({ lancer: 100, marksman: 100 }, { maxHpPerUnit: highHp }),
        sideB: confirmedSide("shield", "T7", { shield: 100 }),
      }),
      { troopSkillSystem: system() },
    );
    const lancer = findAttack(result, "A", "lancer");
    const marksman = findAttack(result, "A", "marksman");
    expect(lancer.attributeResolutions?.find((entry) => entry.attribute === "defense")?.modifierGroups)
      .toEqual(expect.arrayContaining([expect.objectContaining({ group: "heroDefenseBonus", summedValue: .1 })]));
    expect(lancer.targetDefenseMultiplier).toBeCloseTo(1.1);
    expect(marksman.targetDefenseMultiplier).toBeCloseTo(1);
  });

  it("uses T7, 20%, once-per-round ambush before lancer attacks", () => {
    expect(LANCER_AMBUSH_SKILL_DEFINITION).toMatchObject({
      probability: 0.2,
      trigger: "beforeAttack",
      unlockCondition: { requiredLevel: "T7" },
    });
    const simulation = simulateBattle(
      createBattleState({
        sideA: confirmedSide("lancer", "T7", { lancer: 100 }),
        sideB: makeSide({ shield: 100, marksman: 100 }, { maxHpPerUnit: highHp }),
      }),
      {
        maxRounds: 2,
        troopSkillSystem: system({ rolls: [0.1, 0.9] }),
      },
    );
    const attacks = simulation.trace.rounds.map((round) =>
      round.damageEvents.find(
        (event) => event.sourceSide === "A" && event.sourceTroop === "lancer",
      )!,
    );
    expect(attacks.map((event) => event.targetTroop)).toEqual([
      "marksman",
      "shield",
    ]);
    expect(simulation.trace.rounds.map((round) =>
      round.troopSkills.filter((entry) => entry.skillId === "lancer-ambush").length,
    )).toEqual([1, 1]);
  });

  it("keeps rapid fire inside one main normal-attack event", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T7", { marksman: 100 }),
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      { troopSkillSystem: system({ overrides: { "A:marksman-rapid-fire": true } }) },
    );
    const attacks = result.trace.damageEvents.filter(
      (event) => event.sourceSide === "A" && event.damageType === "normalAttack",
    );
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.internalSegments).toEqual([expect.objectContaining({ sourceSkillId: MARKSMAN_RAPID_FIRE.id })]);
  });

  it("does not let rapid fire's second shot trigger powder or another rapid fire", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T10-FC3", { marksman: 100 }),
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      {
        troopSkillSystem: system({ overrides: {
          "A:marksman-rapid-fire": true,
          "A:marksman-crystal-powder": true,
        } }),
      },
    );
    const fromA = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(fromA.filter((event) => event.damageType === "normalAttack")).toHaveLength(1);
    expect(fromA[0]?.internalSegments).toHaveLength(1);
    expect(fromA.filter((event) => event.sourceSkillId === MARKSMAN_CRYSTAL_POWDER.id)).toHaveLength(1);
    expect(result.trace.troopSkills.filter(
      (entry) => entry.skillId === MARKSMAN_RAPID_FIRE.id,
    )).toHaveLength(1);
  });

  it("keeps rapid fire's second shot on the original target", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T7", { marksman: 100 }),
        sideB: makeSide({ shield: 1, marksman: 100 }, { maxHpPerUnit: 1 }),
      }),
      { troopSkillSystem: system({ overrides: { "A:marksman-rapid-fire": true } }) },
    );
    const attacks = result.trace.damageEvents.filter(
      (event) => event.sourceSide === "A" && event.damageType === "normalAttack",
    );
    expect(attacks.map((event) => event.targetTroop)).toEqual(["shield"]);
    expect(attacks[0]?.internalSegments).toHaveLength(1);
  });

  it("reuses Crystal Shield's first judgment for rapid fire's second shot", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T7", { marksman: 100 }),
        sideB: confirmedSide("shield", "T10-FC3", { shield: 100 }),
      }),
      { troopSkillSystem: system({ overrides: {
        "A:marksman-rapid-fire": true,
        "B:shield-crystal-shield": true,
      } }) },
    );
    const attacks = result.trace.damageEvents.filter(
      (event) => event.sourceSide === "A" && event.damageType === "normalAttack",
    );
    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.receivedDamageReductionDenominator).toBeCloseTo(1.36);
    expect(result.trace.troopSkills.filter(
      (entry) => entry.skillId === SHIELD_CRYSTAL_SHIELD.id,
    )).toHaveLength(1);
  });

  it("reuses Crimson Field's first judgment for rapid fire's second shot", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T7", { marksman: 100 }),
        sideB: confirmedSide("lancer", "T12-FC8", { lancer: 100 }),
      }),
      { troopSkillSystem: system({ overrides: {
        "A:marksman-rapid-fire": true,
        "B:lancer-crimson-field": true,
        "B:lancer-ambush": false,
        "B:lancer-crystal-spear": false,
      } }) },
    );
    const attacks = result.trace.damageEvents.filter(
      (event) => event.sourceSide === "A" && event.damageType === "normalAttack",
    );
    expect(attacks.map((event) => event.receivedDamageReductionDenominator)).toEqual([1.5]);
    expect(result.trace.troopSkills.filter(
      (entry) => entry.skillId === LANCER_CRIMSON_FIELD.id,
    )).toHaveLength(1);
  });

  it("stores confirmed Crystal Shield Lv1/Lv2 probabilities", () => {
    expect(SHIELD_CRYSTAL_SHIELD.levelValues[1]?.probability).toBe(0.25);
    expect(SHIELD_CRYSTAL_SHIELD.levelValues[2]?.probability).toBe(0.375);
  });

  it("adds Lightforged Body's linked value to Crystal Shield's received reduction", () => {
    const run = (level: "T12-FC8" | "T12-FC10") => resolveRound(
      createBattleState({
        sideA: makeSide({ marksman: 100 }, { maxHpPerUnit: highHp }),
        sideB: confirmedSide("shield", level, { shield: 100 }),
      }),
      { troopSkillSystem: system({ overrides: { "B:shield-crystal-shield": true } }) },
    );
    const fc8 = findAttack(run("T12-FC8"), "A", "marksman");
    const fc10 = findAttack(run("T12-FC10"), "A", "marksman");
    expect(fc8.receivedDamageReductionDenominator).toBeCloseTo(1.46);
    expect(fc10.receivedDamageReductionDenominator).toBeCloseTo(1.51);
    expect(fc8.appliedDefenseEffects[0]?.effectiveValue).toBe(0.04);
    expect(fc10.appliedDefenseEffects[0]?.effectiveValue).toBe(0.06);
  });

  it("creates Crystal Spear as one independent 100% skillDamage/extraDamage event", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("lancer", "T10-FC3", { lancer: 100 }),
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      { troopSkillSystem: system({ overrides: {
        "A:lancer-ambush": false,
        "A:lancer-crystal-spear": true,
      } }) },
    );
    const attack = findAttack(result, "A", "lancer");
    const extraEvents = result.trace.damageEvents.filter(
      (event) => event.sourceSkillId === LANCER_CRYSTAL_SPEAR.id,
    );
    expect(LANCER_CRYSTAL_SPEAR).toMatchObject({ trigger: "beforeAttack" });
    expect(LANCER_CRYSTAL_SPEAR.levelValues[2]?.effects).toEqual([
      expect.objectContaining({
        kind: "extraDamage",
        coefficient: 1,
        basis: "parentBaseDamage",
        scope: expect.objectContaining({ damageType: "skillDamage" }),
      }),
    ]);
    expect(attack.increaseGroups.some(
      (group) => group.group === "crystalSpearWholeAttack",
    )).toBe(false);
    expect(extraEvents).toHaveLength(1);
    expect(extraEvents[0]).toMatchObject({
      damageType: "skillDamage",
      damageSubtype: "extraDamage",
      baseDamage: attack.baseDamage,
      parentEventId: attack.id,
      rootEventId: attack.id,
      depth: 1,
    });
    const spearTrace = result.trace.troopSkills.filter(
      (entry) => entry.skillId === LANCER_CRYSTAL_SPEAR.id,
    );
    expect(spearTrace).toHaveLength(1);
    expect(spearTrace[0]).toMatchObject({
      checked: true,
      triggered: true,
      parentEventId: attack.id,
      producedDamageEventIds: [extraEvents[0]!.id],
    });
  });

  it("does not let Crystal Spear count or recurse and excludes Reina normal-only damage", () => {
    const reinaSide = confirmedSide("lancer", "T10-FC5", { lancer: 100 });
    const result = resolveRound(
      createBattleState({
        sideA: {
          ...reinaSide,
          heroStates: createConfirmedHeroFormation([
            {
              heroId: "hero.s4.lingnai",
              position: "leader",
            },
            {
              heroId: "hero.s6.ruini",
              position: "member",
              selectedMemberSkillId: "hero-skill.ruini.dream-mark",
            },
          ]),
        },
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      {
        troopSkillSystem: system({ overrides: {
          "A:lancer-ambush": false,
          "A:lancer-crystal-spear": true,
        } }),
        heroSkillSystem: createHeroSkillSystem({
          definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
          randomSource: { next: () => 0.99 },
          triggerOverrides: {
            "hero-skill.lingnai.shadow-blade": true,
          },
        }),
      },
    );
    const attack = findAttack(result, "A", "lancer");
    const spearEvents = result.trace.damageEvents.filter(
      (event) => event.sourceSkillId === LANCER_CRYSTAL_SPEAR.id,
    );
    const shadowBladeEvents = result.trace.damageEvents.filter(
      (event) => event.sourceSkillId === "hero-skill.lingnai.shadow-blade",
    );
    expect(result.trace.damageEvents.filter(
      (event) =>
        event.sourceSide === "A" &&
        event.sourceTroop === "lancer" &&
        event.damageSubtype === "normalAttack" &&
        event.parentEventId === undefined,
    )).toHaveLength(1);
    expect(attack.increaseGroups.find(
      (group) => group.group === "normalAttackDamageIncrease",
    )?.summedValue).toBeCloseTo(0.3);
    expect(spearEvents).toHaveLength(1);
    expect(spearEvents[0]!.baseDamage).toBeCloseTo(attack.baseDamage);
    expect(spearEvents[0]!.increaseGroups.some(
      (group) => group.group === "normalAttackDamageIncrease",
    )).toBe(false);
    expect(shadowBladeEvents).toHaveLength(1);
    expect(shadowBladeEvents[0]).toMatchObject({
      damageType: "skillDamage",
      damageSubtype: "extraDamage",
    });
    expect(shadowBladeEvents[0]!.baseDamage).toBeCloseTo(attack.rawDamage * 2);
    expect(result.trace.troopSkills.filter(
      (entry) => entry.skillId === LANCER_CRYSTAL_SPEAR.id,
    )).toHaveLength(1);
    expect(result.trace.troopSkills.filter(
      (entry) => entry.skillId === LANCER_AMBUSH_SKILL_DEFINITION.id,
    )).toHaveLength(1);
    const attackCountRuntime = result.stateAfter.sideA.heroStates[1]?.skillStates.find(
      (runtime) => runtime.skillId === "hero-skill.ruini.dream-mark",
    );
    expect(attackCountRuntime?.mainAttackCounts.lancer).toBe(1);
  });

  it("makes Crimson Field divide incoming damage by 1.50", () => {
    const result = resolveRound(
      createBattleState({
        sideA: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
        sideB: confirmedSide("lancer", "T12-FC8", { lancer: 100 }),
      }),
      { troopSkillSystem: system({ overrides: {
        "B:lancer-crimson-field": true,
        "B:lancer-ambush": false,
        "B:lancer-crystal-spear": false,
      } }) },
    );
    expect(findAttack(result, "A", "shield").receivedDamageReductionDenominator).toBe(1.5);
  });

  it("selects only the highest unlocked fire-crystal version", () => {
    const shield = createConfirmedTroopSkillLoadout("shield", "T12-FC10");
    const lancer = createConfirmedTroopSkillLoadout("lancer", "T12-FC10");
    expect(shield.filter((state) => state.skillId === SHIELD_CRYSTAL_SHIELD.id)).toEqual([
      expect.objectContaining({ level: 2 }),
    ]);
    expect(shield.filter((state) => state.skillId === SHIELD_LIGHTFORGED_BODY.id)).toEqual([
      expect.objectContaining({ level: 2 }),
    ]);
    expect(lancer.filter((state) => state.skillId === LANCER_CRIMSON_FIELD.id)).toEqual([
      expect.objectContaining({ level: 2 }),
    ]);
  });

  it("keeps Crystal Powder extraDamage in skillDamage", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T10-FC3", { marksman: 100 }),
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      { troopSkillSystem: system({ overrides: {
        "A:marksman-rapid-fire": false,
        "A:marksman-crystal-powder": true,
      } }) },
    );
    const extra = result.trace.damageEvents.find(
      (event) => event.sourceSkillId === MARKSMAN_CRYSTAL_POWDER.id,
    )!;
    expect(extra).toMatchObject({
      damageType: "skillDamage",
      damageSubtype: "extraDamage",
    });
  });

  it("puts Flame Impact into base B and merges the FC10 powder damage", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T12-FC10", { marksman: 100 }),
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      { troopSkillSystem: system({ overrides: {
        "A:marksman-rapid-fire": false,
        "A:marksman-crystal-powder": true,
      } }) },
    );
    const normal = findAttack(result, "A", "marksman");
    const extras = result.trace.damageEvents.filter(
      (event) => event.sourceSkillId === MARKSMAN_CRYSTAL_POWDER.id,
    );
    expect(normal.baseDamageFormula?.baseDamageMultiplier).toBeCloseTo(1.06);
    expect(normal.increaseGroups.some(
      (group) => group.group === "normalAttackDamageIncrease",
    )).toBe(false);
    expect(extras).toHaveLength(1);
    expect(extras[0]!.baseDamage / normal.baseDamage).toBeCloseTo(0.875);
    expect(extras[0]!.damageType).toBe("skillDamage");
    expect(extras[0]!.damageSubtype).toBe("extraDamage");
  });

  it("carries Flame Impact base attack through normal, rapid-fire and powder", () => {
    const run = (level: "T10-FC7" | "T10-FC8") => resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", level, { marksman: 100 }),
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      { troopSkillSystem: system({ overrides: {
        "A:marksman-rapid-fire": true,
        "A:marksman-crystal-powder": true,
      } }) },
    ).trace.damageEvents.filter((event) => event.sourceSide === "A");
    const fc7 = run("T10-FC7");
    const fc8 = run("T10-FC8");
    const normals = (events: typeof fc8) => events.filter((event) => event.damageType === "normalAttack");
    const powder = (events: typeof fc8) => events.find((event) =>
      event.sourceSkillId === MARKSMAN_CRYSTAL_POWDER.id)!;
    expect(normals(fc7)).toHaveLength(1);
    expect(normals(fc8)).toHaveLength(1);
    const expectedBaseRatio = 1.04 * getTroopConstant("T10-FC8") / getTroopConstant("T10-FC7");
    expect(normals(fc8)[0]!.baseDamage / normals(fc7)[0]!.baseDamage).toBeCloseTo(expectedBaseRatio);
    expect(normals(fc8)[0]!.internalSegments![0]!.basis / normals(fc7)[0]!.internalSegments![0]!.basis).toBeCloseTo(expectedBaseRatio);
    expect(powder(fc7).baseDamage / (normals(fc7)[0]!.baseDamage / 2)).toBeCloseTo(0.5);
    expect(powder(fc8).baseDamage / (normals(fc8)[0]!.baseDamage / 2)).toBeCloseTo(0.75);
    expect(powder(fc8).baseDamage / 0.75 / powder(fc7).baseDamage * 0.5).toBeCloseTo(expectedBaseRatio);
    expect(fc8.filter((event) => event.sourceSkillId === MARKSMAN_CRYSTAL_POWDER.id)).toHaveLength(1);
  });

  it("applies Lightforged base defense to normal, extra and direct skill damage", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T10-FC5", { marksman: 100 }),
        sideB: confirmedSide("shield", "T10-FC8", { shield: 100 }),
      }),
      { troopSkillSystem: system({ overrides: {
        "A:marksman-rapid-fire": false,
        "A:marksman-crystal-powder": true,
        "B:shield-crystal-shield": false,
      } }) },
    );
    const normal = findAttack(result, "A", "marksman");
    const extra = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === MARKSMAN_CRYSTAL_POWDER.id)!;
    const directSkill = createDamageEvent({
      id: "direct-skill-probe", sourceSide: "A", sourceTroop: "marksman",
      targetSide: "B", targetTroop: "shield", damageType: "skillDamage",
      damageSubtype: "skillDamage", baseDamage: 1000, round: 1, actionOrder: 0,
    }, result.snapshot);
    for (const event of [normal, extra, directSkill]) {
      expect(event.reductionGroups.find((group) =>
        group.group === "lightforgedBaseDefense")?.multiplier).toBeCloseTo(1.04);
      expect(event.appliedDefenseEffects.some((effect) =>
        effect.effectKind === "baseDefenseMultiplier")).toBe(true);
    }
    expect(result.snapshot.sideB.troops.shield.defense).toBe(0);
  });

  it("checks Crystal Shield separately for every independent child DamageEvent", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("marksman", "T10-FC10", { marksman: 100 }),
        sideB: confirmedSide("shield", "T10-FC10", { shield: 100 }),
      }),
      {
        troopSkillSystem: system({ overrides: {
          "A:marksman-rapid-fire": true,
          "A:marksman-crystal-powder": true,
          "B:shield-crystal-shield": true,
        } }),
        additionalDamageGenerators: [{
          id: "skill-damage-probe",
          afterNormalAttack({ primaryDamageEvent: parent }) {
            if (parent.sourceSide !== "A") return [];
            return [{
              id: `${parent.id}:skill-damage-probe`,
              sourceSide: parent.sourceSide,
              sourceTroop: parent.sourceTroop,
              targetSide: parent.targetSide,
              targetTroop: parent.targetTroop,
              damageType: "skillDamage",
              damageSubtype: "extraDamage",
              baseDamage: parent.baseDamage,
              parentEventId: parent.id,
              rootEventId: parent.rootEventId,
              depth: parent.depth + 1,
              round: parent.round,
              actionOrder: parent.actionOrder,
            }];
          },
        }],
      },
    );
    const incoming = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(incoming).toHaveLength(3);
    expect(result.trace.troopSkills.filter((entry) =>
      entry.skillId === SHIELD_CRYSTAL_SHIELD.id)).toHaveLength(3);
    expect(incoming.map((event) => event.receivedDamageReductionDenominator))
      .toEqual([1.51, 1.51, 1.51]);
    expect(incoming.find((event) => event.damageSubtype === "extraDamage")
      ?.receivedDamageReductionSources.map((effect) => effect.effectId))
      .toEqual(["shield-crystal-shield-reduction"]);
  });

  it("checks Crystal Shield once for each enemy troop main attack", () => {
    const result = resolveRound(
      createBattleState({
        sideA: makeSide({ shield: 100, lancer: 100, marksman: 100 }, { maxHpPerUnit: highHp }),
        sideB: confirmedSide("shield", "T10-FC3", { shield: 100 }),
      }),
      { troopSkillSystem: system({ overrides: { "B:shield-crystal-shield": true } }) },
    );
    const checks = result.trace.troopSkills.filter((entry) =>
      entry.skillId === SHIELD_CRYSTAL_SHIELD.id);
    expect(checks.map((entry) => entry.parentEventId)).toEqual(
      result.trace.damageEvents.filter((event) =>
        event.sourceSide === "A" && event.parentEventId === undefined)
        .map((event) => event.id),
    );
    expect(checks).toHaveLength(3);
  });

  it("accepts final T12 level directly and rejects out-of-range input", () => {
    expect(createConfirmedTroopSkillLoadout("shield", "T12-FC10", 24)
      .find((entry) => entry.skillId === SHIELD_IMMORTAL_WALL.id)?.level).toBe(24);
    expect(() => createConfirmedTroopSkillLoadout("shield", "T12-FC10", 25)).toThrow();
  });

  it("keeps Immortal Wall active only in rounds 1-5", () => {
    const simulation = simulateBattle(
      createBattleState({
        sideA: confirmedSide("shield", "T12-FC10", { shield: 100 }, 8),
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      {
        maxRounds: 6,
        troopSkillSystem: system({ rolls: [.99] }),
      },
    );
    const active = simulation.trace.rounds.map((round) =>
      round.damageEvents.find((event) => event.sourceSide === "B")!
        .reductionGroups.some((group) => group.group === "enemyOutgoingDamageReduction"),
    );
    expect(active).toEqual([true, true, true, true, true, false]);
  });

  it("keeps Radiant Formation active only in rounds 1-5", () => {
    const simulation = simulateBattle(
      createBattleState({
        sideA: {
          ...confirmedSide("lancer", "T12-FC10", { lancer: 100 }, 8),
          troops: {
            ...confirmedSide("lancer", "T12-FC10", { lancer: 100 }, 8).troops,
            marksman: makeSide({ marksman: 100 }, { maxHpPerUnit: highHp }).troops.marksman,
          },
        },
        sideB: makeSide({ shield: 100 }, { maxHpPerUnit: highHp }),
      }),
      {
        maxRounds: 6,
        troopSkillSystem: system({
          rolls: [.99],
          overrides: { "A:lancer-ambush": false },
        }),
      },
    );
    const active = simulation.trace.rounds.map((round) =>
      round.damageEvents.some(
        (event) => event.sourceSide === "A" &&
          event.sourceTroop === "marksman" &&
          event.increaseGroups.some((group) =>
            group.group === "commonDamageIncrease"),
      ),
    );
    expect(active).toEqual([true, true, true, true, true, false]);
  });

  it("uses the confirmed T12 shield and lancer reduction groups", () => {
    const shieldEffect = SHIELD_IMMORTAL_WALL.levelValues[24]?.effects[0];
    expect(shieldEffect).toMatchObject({ group: "enemyOutgoingDamageReduction" });
    expect(shieldEffect?.kind === "damageReduction" ? shieldEffect.value : 0).toBeCloseTo(0.144);
    expect(LANCER_RADIANT_FORMATION.levelValues[24]?.effects[0]).toMatchObject({
      group: "receivedDamageReduction",
      value: 0.24,
    });
  });

  it("rounds every damage segment and exposes all audit stages", () => {
    const state = createBattleState({
      sideA: makeSide({ shield: 1 }),
      sideB: makeSide({ shield: 1 }),
    });
    const event = createDamageEvent({
      id: "rounding",
      sourceSide: "A",
      sourceTroop: "shield",
      targetSide: "B",
      targetTroop: "shield",
      damageType: "normalAttack",
      damageSubtype: "normalAttack",
      baseDamage: 10.6,
      round: 1,
      actionOrder: 0,
    }, state);
    expect(event).toMatchObject({
      rawDamage: 10.6,
      modifiedDamage: 10.6,
      roundedDamage: 11,
      finalDamage: 11,
    });
  });

  it("discards overflow without retargeting another troop", () => {
    const result = resolveRound(createBattleState({
      sideA: makeSide({ marksman: 10 }, { maxHpPerUnit: 1 }),
      sideB: makeSide({ shield: 1, marksman: 10 }, { maxHpPerUnit: 1 }),
    }));
    const attack = findAttack(result, "A", "marksman");
    expect(attack.overflowDiscarded).toBeGreaterThan(0);
    expect(result.stateAfter.sideB.troops.shield.aliveCount).toBe(0);
    expect(result.stateAfter.sideB.troops.marksman.aliveCount).toBe(10);
  });

  it("writes probability, version, aggregation, rounding, and overflow to BattleTrace", () => {
    const result = resolveRound(
      createBattleState({
        sideA: confirmedSide("shield", "T12-FC10", { shield: 100 }, 8),
        sideB: makeSide({ marksman: 100 }, { maxHpPerUnit: 1 }),
      }),
      { troopSkillSystem: system({ overrides: { "A:shield-crystal-shield": true } }) },
    );
    const crystalTrace = result.trace.troopSkills.find(
      (entry) => entry.skillId === SHIELD_CRYSTAL_SHIELD.id,
    );
    const t12Trace = result.trace.troopSkills.find(
      (entry) => entry.skillId === SHIELD_IMMORTAL_WALL.id,
    );
    expect(crystalTrace).toMatchObject({
      probability: 0.375,
      skillVersion: "Lv2 / FC5",
      triggered: true,
    });
    expect(t12Trace?.level).toBe(24);
    expect(result.trace.damageEvents[0]).toEqual(expect.objectContaining({
      rawDamage: expect.any(Number),
      modifiedDamage: expect.any(Number),
      roundedDamage: expect.any(Number),
      appliedDamage: expect.any(Number),
      overflowDiscarded: expect.any(Number),
    }));
    const humanReadable = formatBattleTrace({
      rounds: [result.trace],
      endReason: "roundLimit",
      finalStatus: result.trace.roundEnd.battleStatus,
    });
    expect(humanReadable).toContain("raw=");
    expect(humanReadable).toContain("-> modified=");
    expect(humanReadable).toContain("-> rounded=");
    expect(humanReadable).toContain("-> applied=");
    expect(humanReadable).toContain("probability=0.375");
    expect(humanReadable).toContain("version=Lv2 / FC5");
    expect(humanReadable).toContain("shield-immortal-wall-t12@24");
    expect(humanReadable).toContain("overflowDiscarded=");
  });
});
