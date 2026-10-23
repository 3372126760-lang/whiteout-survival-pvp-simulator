import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  createActiveEffect,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedTroopSkillLoadout,
  createDamageEvent,
  createValidationPreviewState,
  createHeroSkillSystem,
  createTroopSkillSystem,
  formatBattleTrace,
  resolveRound,
  resolveValidationTroopCounts,
  simulateBattle,
  toEngineScenario,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { makeDamageEffect, makeSide } from "./helpers";

const durable = 1_000_000_000_000;

describe("latest PVP mathematical baseline", () => {
  it("uses the hit target's defense in damage and life only in HP", () => {
    const sideA = makeSide({ shield: 100 }, { maxHpPerUnit: 300 });
    const sideB = makeSide({ shield: 100 }, { maxHpPerUnit: 300 });
    const battle = createBattleState({
      sideA: { ...sideA, troops: { ...sideA.troops,
        shield: { ...sideA.troops.shield, defense: 4, life: .2 } } },
      sideB: { ...sideB, troops: { ...sideB.troops,
        shield: { ...sideB.troops.shield, defense: 1, life: .5 } } },
    });
    expect(battle.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(360);
    expect(battle.sideB.troops.shield.maxHpPerUnit).toBeCloseTo(450);
    const events = resolveRound(battle).trace.damageEvents;
    const aToB = events.find((event) => event.sourceSide === "A")!;
    const bToA = events.find((event) => event.sourceSide === "B")!;
    expect(aToB.targetDefenseMultiplier).toBe(2);
    expect(bToA.targetDefenseMultiplier).toBe(5);
    expect(aToB.modifiedDamage).toBeCloseTo(aToB.rawDamage / 2);
    expect(bToA.modifiedDamage).toBeCloseTo(bToA.rawDamage / 5);
  });

  it("adds scoped received reductions and multiplies outgoing reduction", () => {
    const received = (id: string, value: number, target?: "shield" | "lancer") =>
      makeDamageEffect({ id, kind: "damageReduction", group: "receivedDamageReduction",
        value, ...(target === undefined ? {} : { scope: { targetTroops: [target] } }) });
    const outgoing = createActiveEffect({
      identity: { sourceId: "enemy-outgoing", sourceSkillId: "enemy-outgoing", effectId: "outgoing" },
      definition: { id: "outgoing", name: "outgoing", kind: "outgoingDamageReduction",
        group: "enemyOutgoingDamageReduction", value: .3, ruleStatus: "supported" },
      appliedRound: 1,
    });
    const battle = createBattleState({
      sideA: makeSide({ shield: 100, lancer: 100 }, { maxHpPerUnit: durable,
        armyEffects: [outgoing] }),
      sideB: makeSide({ shield: 100, lancer: 100, marksman: 100 }, {
        maxHpPerUnit: durable,
        armyEffects: [received("all", .2), received("shield", .25, "shield"),
          received("lancer", .2, "lancer")],
      }),
    });
    const byTarget = (target: "shield" | "lancer" | "marksman") =>
      createDamageEvent({ id: `target:${target}`, sourceSide: "A", sourceTroop: "shield",
        targetSide: "B", targetTroop: target, damageType: "normalAttack",
        damageSubtype: "normalAttack", round: 1, actionOrder: 0, baseDamage: 100 }, battle);
    expect(byTarget("shield").reductionGroups.find((group) =>
      group.group === "receivedDamageReduction")?.summedValue).toBeCloseTo(.45);
    expect(byTarget("shield").reductionMultiplier).toBeCloseTo(1.45 * 1.30);
    expect(byTarget("lancer").reductionMultiplier).toBeCloseTo(1.40 * 1.30);
    expect(byTarget("marksman").reductionMultiplier).toBeCloseTo(1.20 * 1.30);
  });

  it("pools simultaneous crystal spear and Renee mark before one skill rounding", () => {
    const baseA = makeSide({ lancer: 100 }, { maxHpPerUnit: durable });
    const lancerSkills = createConfirmedTroopSkillLoadout("lancer", "T10-FC5");
    const battle = createBattleState({
      sideA: { ...baseA,
        troops: { ...baseA.troops, lancer: { ...baseA.troops.lancer,
          troopLevel: "T10-FC5", skillStates: lancerSkills } },
        heroStates: createConfirmedHeroFormation([{ heroId: "hero.s6.ruini", position: "leader" }]),
      },
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: durable }),
    });
    const simulation = simulateBattle(battle, {
      maxRounds: 3,
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        triggerOverrides: { "lancer-crystal-spear": true },
        randomSource: { next: () => .99 },
      }),
      heroSkillSystem: createHeroSkillSystem({
        definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
        randomSource: { next: () => .99 },
      }),
    });
    const round3 = simulation.trace.rounds[2]!;
    const skills = round3.damageEvents.filter(e=>e.sourceSide === "A" && e.sourceTroop === "lancer" && e.damageType === "skillDamage");
    expect(skills.map(e=>e.sourceSkillId)).toEqual(["hero-skill.ruini.dream-mark","lancer-crystal-spear"]);
    expect(skills.map(e=>e.skillCoefficient)).toEqual([2,.1e1]);
    expect(skills.every(e=>e.skillPoolComponents === undefined)).toBe(true);
  });

  it("uses final report attributes and counts without repeating external sources", () => {
    const base = createDefaultValidationInput();
    const sideA = { ...base.sideA,
      reportHeroIds: ["hero.s1.jinman"],
      leaderHeroIds: { ...base.sideA.leaderHeroIds, shield: "hero.s1.jinman" },
      simulationWeaponLevels: { ...base.sideA.simulationWeaponLevels, "hero.s1.jinman": 10 },
      externalBuffs: { ...base.sideA.externalBuffs!,
        town: { ...base.sideA.externalBuffs!.town, attack: "large" as const } },
      marchCapacityBonus: .2,
      troops: { ...base.sideA.troops,
        shield: { ...base.sideA.troops.shield, count: 120_000, attack: 100 } },
    };
    const final = toEngineScenario({ ...base, sideA, attributeInputMode: "finalReport" });
    expect(final.sideA.shield.count).toBe(120_000);
    expect(final.sideA.shield.attack).toBe(1);
    expect(final.sideA.attributeInputMode).toBe("finalReport");
    expect(createValidationPreviewState({ ...base, sideA,
      attributeInputMode: "finalReport" }).sideA.heroStates.find((hero) =>
      hero.heroId === "hero.s1.jinman")?.weaponLevel).toBe(0);
    const prediction = toEngineScenario({ ...base, sideA, attributeInputMode: "prediction" });
    expect(prediction.sideA.shield.count).toBe(144_000);
    expect(createValidationPreviewState({ ...base, sideA, attributeInputMode: "prediction" })
      .sideA.troops.shield.attack).toBeGreaterThan(1);
    expect(createValidationPreviewState({ ...base, sideA,
      attributeInputMode: "prediction" }).sideA.heroStates.find((hero) =>
      hero.heroId === "hero.s1.jinman")?.weaponLevel).toBe(10);
    expect(resolveValidationTroopCounts(sideA, "challenge", "finalReport").shield).toBe(120_000);
  });

  it("traces target defense, special sources, rounding, shields and HP damage separately", () => {
    const result = resolveRound(createBattleState({
      sideA: makeSide({ shield: 10 }, { maxHpPerUnit: 1_000 }),
      sideB: makeSide({ shield: 10 }, { maxHpPerUnit: 1_000 }),
    }));
    const event = result.trace.damageEvents[0]!;
    const readable = formatBattleTrace({
      rounds: [result.trace], endReason: "roundLimit", finalStatus: result.stateAfter.status,
    });
    expect(event.hpAppliedDamage).toBe(event.appliedDamage - event.temporaryShieldAbsorbed);
    expect(readable).toContain("targetDefenseMultiplier=");
    expect(readable).toContain("hpAppliedDamage=");
    expect(readable).toContain("formula N0=");
  });

  it("applies capacity before battle to N0 and n without a damage group", () => {
    const base = createDefaultValidationInput();
    const sideA = { ...base.sideA, marchCapacityBonus: .2,
      troops: { ...base.sideA.troops,
        shield: { ...base.sideA.troops.shield, count: 100_000 },
        lancer: { ...base.sideA.troops.lancer, count: 0 },
        marksman: { ...base.sideA.troops.marksman, count: 0 },
      },
    };
    const sideB = { ...base.sideB,
      troops: { ...base.sideB.troops,
        shield: { ...base.sideB.troops.shield, count: 200_000 },
        lancer: { ...base.sideB.troops.lancer, count: 0 },
        marksman: { ...base.sideB.troops.marksman, count: 0 },
      },
    };
    const final = createValidationPreviewState({ ...base, sideA, sideB,
      attributeInputMode: "finalReport" });
    const predicted = createValidationPreviewState({ ...base, sideA, sideB,
      attributeInputMode: "prediction" });
    expect(final.fixedInitialMinTroops).toBe(100_000);
    expect(predicted.fixedInitialMinTroops).toBe(120_000);
    expect(predicted.sideA.troops.shield.aliveCount).toBe(120_000);
    const event = resolveRound(predicted).trace.damageEvents.find((entry) =>
      entry.sourceSide === "A" && entry.sourceTroop === "shield")!;
    expect(event.baseDamageFormula?.fixedInitialMinTroops).toBe(120_000);
    expect(event.baseDamageFormula?.aliveCount).toBe(120_000);
    expect(event.increaseGroups.some((group) => group.group.includes("capacity"))).toBe(false);
  });
});
