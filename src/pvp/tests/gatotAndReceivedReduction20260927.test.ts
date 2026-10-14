import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  calculateGatotShield,
  createBattleState,
  createConfirmedHeroFormation,
  createConfirmedTroopSkillLoadout,
  createDamageEvent,
  createHeroSkillSystem,
  createTroopSkillSystem,
  formatBattleTrace,
  resolveRound,
  type BattleSideSetup,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

const GATOT = "hero.s8.jiatuo";
const GIFT = "hero-skill.jiatuo.kings-gift";
const SHUYUN = "hero.body.shuyun";
const CT = 14.1324;
const REPORT_ATTACK = 6.519;

function gatotSide(count: number, reportAttack: number, level: 4 | 5 = 5,
  withShuyun = false): BattleSideSetup {
  const base = makeSide({ shield: count }, { troopConstant: CT,
    maxHpPerUnit: 1_000_000_000 });
  return {
    ...base,
    troops: { ...base.troops, shield: { ...base.troops.shield,
      attack: reportAttack } },
    heroStates: createConfirmedHeroFormation([
      { heroId: GATOT, position: "leader",
        ...(level === 5 ? {} : { skillLevels: { [GIFT]: level } }) },
      ...(withShuyun ? [{ heroId: SHUYUN, position: "member" as const,
        selectedMemberSkillId: "hero-skill.shuyun.attack" }] : []),
    ]),
  };
}

function gatotRound(count: number, reportAttack = REPORT_ATTACK,
  level: 4 | 5 = 5, withShuyun = false) {
  return resolveRound(createBattleState({
    sideA: gatotSide(count, reportAttack, level, withShuyun),
    sideB: makeSide({ shield: 10 }, { maxHpPerUnit: 1_000_000_000 }),
  }), { heroSkillSystem: createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    randomSource: { next: () => .99 },
  }) });
}

describe("2026-09-27 Gatot report-attack shield", () => {
  it("uses the confirmed Ct=14.1324, n=1, +651.9% example at Lv5 and Lv4", () => {
    const input = { troopConstant: CT, currentShieldCount: 1,
      reportAttackBonus: REPORT_ATTACK };
    const five = calculateGatotShield({ ...input, skillLevel: 5 });
    const four = calculateGatotShield({ ...input, skillLevel: 4 });
    expect(five.calculatedAttackX).toBeCloseTo(10626.15156, 7);
    expect(five.generatedShield).toBeCloseTo(3187.845468, 7);
    expect(four.generatedShield).toBeCloseTo(2550.2763744, 7);
    expect(gatotRound(1).trace.heroSkills.find((entry) => entry.skillId === GIFT)
      ?.generatedShieldHp).toBeCloseTo(five.generatedShield, 7);
    expect(gatotRound(1, REPORT_ATTACK, 4).trace.heroSkills.find((entry) =>
      entry.skillId === GIFT)?.generatedShieldHp).toBeCloseTo(four.generatedShield, 7);
  });

  it("doubles X and shield when current shield count grows from 1 to 4", () => {
    const one = gatotRound(1).trace.heroSkills.find((entry) => entry.skillId === GIFT)!;
    const four = gatotRound(4).trace.heroSkills.find((entry) => entry.skillId === GIFT)!;
    expect(four.gatotShield!.calculatedAttackX / one.gatotShield!.calculatedAttackX).toBeCloseTo(2);
    expect(four.generatedShieldHp! / one.generatedShieldHp!).toBeCloseTo(2);
    expect(four.gatotShield!.currentShieldCount).toBe(4);
  });

  it("lets Shuyun change attack damage without changing Gatot X or shield", () => {
    const plain = gatotRound(1);
    const buffed = gatotRound(1, REPORT_ATTACK, 5, true);
    const normal = (round: typeof plain) => round.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.sourceTroop === "shield" &&
      event.damageType === "normalAttack")!;
    const shield = (round: typeof plain) => round.trace.heroSkills.find((entry) =>
      entry.skillId === GIFT)!;
    expect(normal(buffed).rawDamage / normal(plain).rawDamage).toBeCloseTo(1.25);
    expect(shield(buffed).gatotShield!.calculatedAttackX).toBeCloseTo(
      shield(plain).gatotShield!.calculatedAttackX);
    expect(shield(buffed).generatedShieldHp).toBeCloseTo(shield(plain).generatedShieldHp!);
  });

  it("responds to the final report attack value without multiplying external buffs again", () => {
    const changed = gatotRound(1, 7.519).trace.heroSkills.find((entry) =>
      entry.skillId === GIFT)!;
    expect(changed.gatotShield!.reportAttackFactor).toBeCloseTo(8.519);
    expect(changed.gatotShield!.calculatedAttackX).toBeCloseTo(100 * CT * 8.519);
    expect(changed.generatedShieldHp).toBeCloseTo(30 * CT * 8.519);
  });

  it("has no shield against an enemy attack before Gatot's first main attack", () => {
    const result = resolveRound(createBattleState({
      sideA: makeSide({ shield: 1 }, { maxHpPerUnit: 1_000_000_000 }),
      sideB: gatotSide(1, REPORT_ATTACK),
    }), { heroSkillSystem: createHeroSkillSystem({
      definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
      randomSource: { next: () => .99 },
    }) });
    const first = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.targetSide === "B")!;
    expect(first.actionOrder).toBe(0);
    expect(first.temporaryShieldAbsorbed).toBe(0);
    expect(first.temporaryShield).toHaveLength(0);
    expect(result.trace.heroSkills.find((entry) => entry.side === "B" &&
      entry.skillId === GIFT)?.gatotShield?.generatedShield).toBeGreaterThan(0);
  });

  it("prints every Gatot formula input and refresh value in BattleTrace", () => {
    const result = gatotRound(1);
    const readable = formatBattleTrace({ rounds: [result.trace],
      endReason: "roundLimit", finalStatus: result.stateAfter.status });
    for (const field of ["gatotShield: skillLevel=5", "troopConstant=14.1324",
      "currentShieldCount=1", "sqrtCurrentShieldCount=1", "reportAttackBonus=6.519",
      "reportAttackFactor=7.519", "calculatedAttackX=10626.15156",
      "shieldRatio=0.3", "previousShield=0", "refreshedShield=3187.845468"]) {
      expect(readable).toContain(field);
    }
  });
});

describe("2026-09-27 received damage reduction", () => {
  it.each([
    ["crystal 51%", [.51], 0, 1.51],
    ["Bahiti 20% + crystal 51%", [.51, .20], 0, 1.71],
    ["lancer 50%", [.50], 0, 1.50],
    ["lancer 50% + Bahiti 20%", [.50, .20], 0, 1.70],
    ["crystal 51% + lancer 50% + Bahiti 20% arithmetic", [.51, .50, .20], 0, 2.21],
    ["crystal 51% + outgoing 30%", [.51], .30, 1.51],
  ] as const)("divides %s through scoped additive sources", (_name, values,
    outgoing, receivedDenominator) => {
    const received = values.map((value, index) => makeDamageEffect({
      id: `received-${index}`, kind: "damageReduction",
      group: "receivedDamageReduction", value,
    }));
    const attacker = outgoing === 0 ? [] : [makeDamageEffect({ id: "outgoing",
      kind: "outgoingDamageReduction", group: "enemyOutgoingDamageReduction",
      value: outgoing })];
    const state = createBattleState({
      sideA: makeSide({ shield: 1 }, { armyEffects: attacker }),
      sideB: makeSide({ shield: 1 }, { armyEffects: received }),
    });
    const event = createDamageEvent({ id: "reduction", sourceSide: "A",
      sourceTroop: "shield", targetSide: "B", targetTroop: "shield",
      damageType: "normalAttack", damageSubtype: "normalAttack", round: 1,
      actionOrder: 0, baseDamage: 1000 }, state);
    expect(event.receivedDamageReductionDenominator).toBeCloseTo(receivedDenominator);
    expect(event.receivedDamageReductionTotal).toBeCloseTo(receivedDenominator - 1);
    expect(event.modifiedDamage).toBeCloseTo(1000 / receivedDenominator / (1 + outgoing));
    expect(event.damageBeforeReceivedReduction / event.damageAfterReceivedReduction)
      .toBeCloseTo(receivedDenominator);
    expect(event.receivedDamageReductionSources).toHaveLength(values.length);
    expect(event.receivedDamageReductionSources.map((effect) => effect.effectiveValue))
      .toEqual(values);
    expect(event.directCancellationMultiplier).toBe(1);
    expect(event.appliedDirectCancellationEffects).toHaveLength(0);
  });

  it("adds actual Bahiti 20% and Crystal Shield 51% on the hit shield stack", () => {
    const defender = makeSide({ shield: 100 }, { maxHpPerUnit: 1_000_000_000 });
    const state = createBattleState({
      sideA: makeSide({ marksman: 100 }, { maxHpPerUnit: 1_000_000_000 }),
      sideB: { ...defender,
        troops: { ...defender.troops, shield: { ...defender.troops.shield,
          troopLevel: "T10-FC10",
          skillStates: createConfirmedTroopSkillLoadout("shield", "T10-FC10"),
        } },
        heroStates: createConfirmedHeroFormation([
          { heroId: "hero.sr.baxiti", position: "leader" },
        ]),
      },
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({
        definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
        triggerOverrides: { "B:shield-crystal-shield": true },
        randomSource: { next: () => .99 },
      }),
      heroSkillSystem: createHeroSkillSystem({
        definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
        randomSource: { next: () => .99 },
      }),
    });
    const hit = result.trace.damageEvents.find((event) =>
      event.sourceSide === "A" && event.targetTroop === "shield")!;
    expect(hit.receivedDamageReductionTotal).toBeCloseTo(.71);
    expect(hit.receivedDamageReductionDenominator).toBeCloseTo(1.71);
    expect(hit.receivedDamageReductionSources.map((effect) =>
      effect.sourceSkillId)).toEqual(expect.arrayContaining([
      "shield-crystal-shield", "hero-skill.baxiti.danger-sense",
    ]));
    expect(hit.directCancellationMultiplier).toBe(1);
  });
});
