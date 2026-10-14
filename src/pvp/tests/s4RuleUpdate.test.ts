import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderBodySkillSelect } from "../../ui/bodySkillSelectView";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedTroopSkillLoadout,
  createHeroSkillSystem,
  createSeededRandomSource,
  createTroopSkillSystem,
  resolveRoundCompact,
  resolveTroopAttribute,
  previewExpectedReportBonuses,
  resolveRound,
  simulateBattle,
  type BattleState,
  type HeroFormationInput,
  type HeroSkillTriggerOverrides,
  type TroopSkillTriggerOverrides,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const hp = 1_000_000_000_000;

function battle(
  attacker: TroopType,
  heroesA: readonly HeroFormationInput[],
  heroesB: readonly HeroFormationInput[] = [],
  troopLevel = "T1",
): BattleState {
  const a = makeSide({ [attacker]: 100 }, { maxHpPerUnit: hp });
  return createBattleState({
    sideA: {
      ...a,
      heroStates: createConfirmedHeroFormation(heroesA),
      troops: {
        ...a.troops,
        [attacker]: {
          ...a.troops[attacker],
          skillStates: createConfirmedTroopSkillLoadout(attacker, troopLevel),
        },
      },
    },
    sideB: {
      ...makeSide({ shield: 100 }, { maxHpPerUnit: hp }),
      heroStates: createConfirmedHeroFormation(heroesB),
    },
  });
}

function systems(
  heroOverrides: HeroSkillTriggerOverrides = {},
  troopOverrides: TroopSkillTriggerOverrides = {},
) {
  return {
    heroSkillSystem: createHeroSkillSystem({
      definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
      randomSource: { next: () => .99 },
      triggerOverrides: heroOverrides,
    }),
    troopSkillSystem: createTroopSkillSystem({
      definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
      randomSource: { next: () => .99 },
      triggerOverrides: troopOverrides,
    }),
  };
}

const ahmose = { heroId: "hero.s4.ahemosi", position: "leader" } as const;
const reina = { heroId: "hero.s4.lingnai", position: "leader" } as const;
const lynn = { heroId: "hero.s4.linen", position: "leader" } as const;

describe("S4 confirmed attack-attempt and dodge order", () => {
  it("counts 1200 completed shield mains and 300 skipped slots over 1500 rounds", () => {
    const result = simulateBattle(battle("shield", [ahmose]), {
      ...systems(), maxRounds: 1500, traceMode: "summary",
    });
    expect(result.roundCount).toBe(1500);
    const runtimes = result.finalState.sideA.heroStates[0]!.skillStates;
    const viper = runtimes.find((runtime) => runtime.skillId === "hero-skill.ahemosi.viper-phalanx")!;
    expect(viper.mainAttackCounts.shield).toBe(1200);
    expect(viper.triggerCount).toBe(300);
  });

  it("skips the fifth shield event and its Light Forged Blade child, then restores both", () => {
    let state = battle("shield", [ahmose]);
    const options = systems();
    for (let round = 1; round <= 6; round += 1) {
      const result = resolveRound(state, options);
      const shieldEvents = result.trace.damageEvents.filter((event) =>
        event.sourceSide === "A" && event.sourceTroop === "shield");
      expect(shieldEvents.length).toBe(round === 5 ? 0 : 2);
      if (round === 5) {
        const skip = result.trace.heroSkills.find((entry) =>
          entry.skillId === "hero-skill.ahemosi.viper-phalanx" && entry.skippedMainAttack);
        expect(skip?.triggered).toBe(true);
        expect(result.trace.heroSkills.some((entry) =>
          entry.skillId === "hero-skill.ahemosi.light-forged-blade" && entry.triggered)).toBe(false);
      }
      state = result.stateAfter;
    }
  });

  it("applies Viper Phalanx reduction in the skipped round and next round only", () => {
    let state = battle("shield", [ahmose]);
    const options = systems();
    for (let round = 1; round <= 7; round += 1) {
      const result = resolveRound(state, options);
      const incoming = result.trace.damageEvents.find((event) =>
        event.sourceSide === "B" && event.targetSide === "A" &&
        event.targetTroop === "shield")!;
      expect(incoming.reductionGroups.some((group) =>
        group.group === "viperPhalanxShieldReduction")).toBe(round === 5 || round === 6);
      state = result.stateAfter;
    }
  });

  it("emits Light Forged Blade immediately but activates its target vulnerability next round", () => {
    const state = { ...battle("shield", [ahmose]), round: 10 };
    const options = systems();
    const r10 = resolveRound(state, options);
    const child = r10.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.ahemosi.light-forged-blade")!;
    expect(child).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage" });
    expect(child.finalDamage).toBeGreaterThan(0);
    expect(child.increaseGroups.some((group) => group.group === "vulnerability")).toBe(false);
    const mark = r10.trace.heroSkills.find((entry) =>
      entry.skillId === "hero-skill.ahemosi.light-forged-blade" && entry.triggered)!;
    expect(mark.appliedDebuffTargetTroop).toBe("shield");
    expect(mark.effectiveFromRound).toBe(11);
    const r11 = resolveRound(r10.stateAfter, options);
    expect(r11.trace.damageEvents.some((event) =>
      event.sourceSide === "A" && event.increaseGroups.some((group) =>
        group.group === "vulnerability"))).toBe(true);
  });

  it("keeps Fire Blessing in shield commonDamageIncrease rather than normal-only attack", () => {
    const skill = CONFIRMED_HERO_SKILL_DEFINITIONS.find((definition) =>
      definition.id === "hero-skill.ahemosi.fire-blessing")!;
    expect(skill.levelValues[5]?.effects[0]).toMatchObject({
      kind: "damageIncrease", group: "commonDamageIncrease", value: 1,
      scope: { source: "shield", damageType: "all" },
    });
  });

  it("settles Shadow Blade before-dodge proc while cancelling only the lancer main", () => {
    const state = battle("lancer", [reina], [reina]);
    const result = resolveRound(state, systems({
      "A:lancer:hero-skill.lingnai.shadow-blade": true,
      "B:lancer:hero-skill.lingnai.swift-shadow-dance": true,
    }));
    const main = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.sourceTroop === "lancer" &&
      event.parentEventId === undefined)!;
    const shadow = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "hero-skill.lingnai.shadow-blade")!;
    expect(main.finalDamage).toBe(0);
    expect(shadow.finalDamage).toBeGreaterThan(0);
    expect(shadow.baseDamage).toBeCloseTo(main.rawDamage * 2);
    expect(shadow.increaseGroups.some((group) =>
      group.group === "normalAttackDamageIncrease")).toBe(false);
    expect(result.trace.heroSkills.filter((entry) =>
      entry.side === "B" && entry.skillId === "hero-skill.lingnai.swift-shadow-dance")).toHaveLength(1);
  });

  it("does not check post-dodge Bahiti or Crystal Spear on a dodged lancer main", () => {
    const state = battle("lancer", [
      { heroId: "hero.sr.baxiti", position: "leader" },
    ], [reina], "T10-FC5");
    const result = resolveRound(state, systems({
      "B:lancer:hero-skill.lingnai.swift-shadow-dance": true,
    }, { "A:lancer-ambush": false }));
    expect(result.trace.heroSkills.filter((entry) =>
      entry.skillId === "hero-skill.baxiti.unstable-field")).toHaveLength(0);
    expect(result.trace.troopSkills.filter((entry) =>
      entry.skillId === "lancer-crystal-spear")).toHaveLength(0);
  });

  it("checks post-dodge Bahiti and Crystal Spear if the normal main is not dodged", () => {
    const state = battle("lancer", [
      { heroId: "hero.sr.baxiti", position: "leader" },
    ], [reina], "T10-FC5");
    const result = resolveRound(state, systems({
      "B:lancer:hero-skill.lingnai.swift-shadow-dance": false,
      "A:lancer:hero-skill.baxiti.unstable-field": true,
    }, { "A:lancer-ambush": false, "A:lancer-crystal-spear": true }));
    expect(result.trace.heroSkills.find((entry) =>
      entry.skillId === "hero-skill.baxiti.unstable-field")?.triggered).toBe(true);
    expect(result.trace.troopSkills.find((entry) =>
      entry.skillId === "lancer-crystal-spear")?.triggered).toBe(true);
  });

  it("keeps rapid fire and crystal powder after a dodged marksman main", () => {
    const state = battle("marksman", [], [reina], "T10-FC5");
    const result = resolveRound(state, systems({
      "B:marksman:hero-skill.lingnai.swift-shadow-dance": true,
    }, {
      "A:marksman-rapid-fire": true,
      "A:marksman-crystal-powder": true,
    }));
    const main = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.sourceTroop === "marksman" &&
      event.parentEventId === undefined)!;
    const powder = result.trace.damageEvents.find((event) =>
      event.sourceSkillId === "marksman-crystal-powder")!;
    expect(main.internalSegments).toHaveLength(1);
    expect(main.mainHitCancelled).toBe(true);
    expect(main.primaryRoundedDamage).toBe(0);
    expect(main.finalDamage - main.internalSegments![0]!.roundedDamage).toBe(0);
    expect(main.finalDamage).toBeGreaterThan(0);
    expect(powder.finalDamage).toBeGreaterThan(0);
    expect(result.trace.heroSkills.filter((entry) =>
      entry.side === "B" && entry.skillId === "hero-skill.lingnai.swift-shadow-dance")).toHaveLength(1);
    expect(result.trace.troopSkills.filter((entry) =>
      entry.skillId === "marksman-rapid-fire")).toHaveLength(1);
  });

  it("uses Lv2 8% dodge probability and preserves the Lv5 20% value", () => {
    const lv2 = { heroId: reina.heroId, position: "leader", skillLevels: {
      "hero-skill.lingnai.swift-shadow-dance": 2,
    } } as const;
    const state = battle("shield", [], [lv2]);
    const at = (roll: number) => resolveRound(state, {
      heroSkillSystem: createHeroSkillSystem({
        definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
        randomSource: { next: () => roll },
      }),
    }).trace.heroSkills.find((entry) =>
      entry.skillId === "hero-skill.lingnai.swift-shadow-dance" && entry.side === "B")!;
    expect(at(.079)).toMatchObject({ probability: .08, triggered: true });
    expect(at(.081)).toMatchObject({ probability: .08, triggered: false });
    expect(CONFIRMED_HERO_SKILL_DEFINITIONS.find((definition) =>
      definition.id === "hero-skill.lingnai.swift-shadow-dance")?.probability).toBe(.20);
  });

  it("preserves the non-Reina defensive-before-rapid RNG order", () => {
    const source = battle("marksman", [], [], "T10-FC5");
    const state: BattleState = {
      ...source,
      sideB: {
        ...source.sideB,
        troops: {
          ...source.sideB.troops,
          shield: {
            ...source.sideB.troops.shield,
            skillStates: createConfirmedTroopSkillLoadout("shield", "T10-FC5"),
          },
        },
      },
    };
    const rolls = [.31, .32, .33, .34, .35, .36];
    let index = 0;
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        randomSource: { next: () => rolls[index++] ?? .99 },
      }),
    });
    const first = (skillId: string) => result.trace.troopSkills.find((entry) =>
      entry.skillId === skillId)?.rngRoll;
    expect(first("shield-crystal-shield")).toBe(.31);
    expect(first("marksman-rapid-fire")).toBe(.32);
    expect(first("marksman-crystal-powder")).toBe(.33);
  });

  it("binds Shadow Blade to lancer attempts and preserves confirmed Lv4/Lv5 values", () => {
    const lv4 = createConfirmedHeroFormation([{
      heroId: reina.heroId, position: "leader",
      skillLevels: { "hero-skill.lingnai.shadow-blade": 4 },
    }]);
    expect(lv4[0]?.skillStates.find((runtime) =>
      runtime.skillId === "hero-skill.lingnai.shadow-blade")?.level).toBe(4);
    const skill = CONFIRMED_HERO_SKILL_DEFINITIONS.find((definition) =>
      definition.id === "hero-skill.lingnai.shadow-blade")!;
    expect(skill.trigger).toBe("afterNormalAttack");
    expect(skill.levelValues[4]?.effects[0]).toMatchObject({ coefficient: 1.8, scope: { source: "lancer" } });
    expect(skill.levelValues[5]?.effects[0]).toMatchObject({ coefficient: 2, scope: { source: "lancer" } });
    const baseState = battle("lancer", [{
      heroId: reina.heroId, position: "leader",
      skillLevels: { "hero-skill.lingnai.shadow-blade": 4 },
    }]);
    const lv4Round = resolveRound(baseState, systems({
      "A:lancer:hero-skill.lingnai.shadow-blade": true,
    }));
    const lv4Main = lv4Round.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.parentEventId === undefined)!;
    const lv4Child = lv4Round.trace.damageEvents.find((event) =>
      event.sourceSkillId === skill.id)!;
    expect(lv4Child.baseDamage).toBeCloseTo(lv4Main.rawDamage * 1.8);
    const result = resolveRound(battle("shield", [reina]), systems({
      "hero-skill.lingnai.shadow-blade": true,
    }));
    expect(result.trace.heroSkills.filter((entry) =>
      entry.skillId === skill.id && entry.eligible)).toHaveLength(0);
  });

  it("adds Lynn marksman attack stacks without a three-stack cap", () => {
    let state = battle("marksman", [lynn]);
    const options = systems({ "hero-skill.linen.lion-song": false });
    for (let round = 1; round <= 16; round += 1) {
      const groups = resolveTroopAttribute(state.sideA, "marksman", "attack",
        state.round, { targetTroop: "shield", damageType: "normalAttack" }).groups;
      const stack = groups.find((group) => group.group === "heroMarksmanAttackStack");
      expect(stack?.summedValue ?? 0).toBeCloseTo(
        Math.floor((round - 1) / 3) * .05,
      );
      const result = resolveRound(state, options);
      const proc = result.trace.heroSkills.find((entry) =>
        entry.skillId === "hero-skill.linen.onaihua" && entry.triggered);
      expect(proc !== undefined).toBe(round % 3 === 0);
      state = result.stateAfter;
    }
  });

  it("uses Lynn's penetration buff and enemy penetration reduction as separate factors", () => {
    const result = resolveRound(battle("marksman", [lynn]), systems({
      "hero-skill.linen.lion-song": true,
    }));
    const outgoing = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.sourceTroop === "marksman" &&
      event.parentEventId === undefined)!;
    const incoming = result.trace.damageEvents.find((event) =>
      event.sourceSide === "B" && event.sourceTroop === "shield")!;
    expect(outgoing.baseDamageFormula?.penetrationMultiplier).toBeCloseTo(1.5);
    expect(incoming.attributeResolutions?.find((entry) =>
      entry.attribute === "penetration")?.divisionFactor).toBeCloseTo(1.2);
  });

  it("attributes only explicit extraDamage casualties without adding them to total exits", () => {
    const a = makeSide({ lancer: 10 }, { maxHpPerUnit: hp });
    const b = makeSide({ shield: 10 }, { maxHpPerUnit: 15 });
    const state = createBattleState({
      sideA: { ...a, troops: { ...a.troops, lancer: {
        ...a.troops.lancer,
        skillStates: createConfirmedTroopSkillLoadout("lancer", "T10-FC5"),
      } } },
      sideB: b,
    });
    const result = resolveRoundCompact(state, systems({}, {
      "A:lancer-ambush": false,
      "A:lancer-crystal-spear": true,
    }));
    const actualExited = 10 - result.stateAfter.sideB.troops.shield.aliveCount;
    expect(actualExited).toBeGreaterThan(0);
    expect(result.skillCasualtiesBySide.A["lancer-crystal-spear"]).toBeGreaterThan(0);
    expect(result.skillCasualtiesBySide.A["lancer-crystal-spear"]).toBeLessThanOrEqual(actualExited);
  });

  it("keeps seeded full and summary outcomes identical through the S4 dodge chain", () => {
    const state = battle("lancer", [reina], [reina], "T10-FC5");
    const optionsForSeed = () => {
      const randomSource = createSeededRandomSource(42_424);
      return {
        maxRounds: 5,
        troopSkillSystem: createTroopSkillSystem({
          definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS, randomSource,
        }),
        heroSkillSystem: createHeroSkillSystem({
          definitions: CONFIRMED_HERO_SKILL_DEFINITIONS, randomSource,
        }),
      };
    };
    const full = simulateBattle(state, { ...optionsForSeed(), traceMode: "full" });
    const summary = simulateBattle(state, { ...optionsForSeed(), traceMode: "summary" });
    expect(summary.endReason).toBe(full.endReason);
    expect(summary.roundCount).toBe(full.rounds.length);
    for (const side of ["sideA", "sideB"] as const) {
      for (const troop of ["shield", "lancer", "marksman"] as const) {
        expect(summary.finalState[side].troops[troop].aliveCount).toBe(
          full.finalState[side].troops[troop].aliveCount,
        );
        expect(summary.finalState[side].troops[troop].frontUnitHp).toBe(
          full.finalState[side].troops[troop].frontUnitHp,
        );
      }
    }
    expect(summary.totalDamage.A).toBe(full.trace.rounds.flatMap((round) =>
      round.damageEvents).filter((event) => event.sourceSide === "A")
      .reduce((sum, event) => sum + event.finalDamage, 0));
  });

  it("shows leader weapon controls beside selectors and keeps body slots weapon free", () => {
    const source = readFileSync(fileURLToPath(new URL("../../ui/main.ts", import.meta.url)), "utf8");
    expect(source).toContain("renderSelectedHeroWeapon(scope, sideId, side, selected)");
    expect(source).not.toContain("renderSelectedHeroWeapon(\"member\"");
    const bodyHtml = renderBodySkillSelect({ side: "A", index: 0, stage: "s11",
      selectedSkillId: "hero-skill.shuyun.attack", selectedLevel: 5, query: "" });
    expect(bodyHtml).toContain('value="hero-skill.shuyun.attack" selected');
    expect(bodyHtml).toContain("远征一技能：征伐的战鼓");
    expect(bodyHtml).not.toContain('data-scope="simulation-weapon"');
    expect(bodyHtml).not.toContain('data-scope="report-weapon"');
    expect(source).toContain("getExclusiveWeaponSkillTier(level)");
    expect(source).not.toContain('renderSideSection("专武等级"');
    expect(source).toContain("meanSkillCasualties");
    expect(source).not.toContain("期望退出盾兵");
  });

  it("keeps ordinary hero skills out of external report-bonus columns while preserving engine values", () => {
    const base = createDefaultValidationInput();
    const input = {
      ...base,
      attributeInputMode: "prediction" as const,
      sideA: {
        ...base.sideA,
        leaderHeroIds: { ...base.sideA.leaderHeroIds, lancer: "hero.sr.patelike" },
      },
      sideB: {
        ...base.sideB,
        leaderHeroIds: { ...base.sideB.leaderHeroIds, marksman: lynn.heroId },
      },
    };
    const preview = previewExpectedReportBonuses(input);
    expect(preview.A.breakdown.lancer.attack.ownBuffRate).toBeCloseTo(0);
    expect(preview.A.breakdown.lancer.attack.lineupCorrection).toBeGreaterThan(0);
    expect(preview.A.troops.lancer.attack).toBeGreaterThan(
      preview.A.breakdown.lancer.attack.finalBonus,
    );
    expect(preview.A.breakdown.lancer.penetration.enemyDebuffRate).toBe(0);
    expect(preview.B.inflictedEnemyDebuffs.penetration).toBe(0);
  });

  it("shows scenario-eligible weapon attribute buffs but not ordinary hero skills", () => {
    const base = createDefaultValidationInput();
    const input = {
      ...base,
      attributeInputMode: "prediction" as const,
      battleContext: "rally" as const,
      sideA: {
        ...base.sideA,
        leaderHeroIds: { ...base.sideA.leaderHeroIds, lancer: "hero.s3.miya" },
        simulationWeaponLevels: { "hero.s3.miya": 10 },
      },
    };
    const rally = previewExpectedReportBonuses(input);
    expect(rally.A.breakdown.lancer.attack.ownBuffRate).toBeCloseTo(.15);
    const challenge = previewExpectedReportBonuses({ ...input, battleContext: "challenge" });
    expect(challenge.A.breakdown.lancer.attack.ownBuffRate).toBeCloseTo(0);
  });
});
