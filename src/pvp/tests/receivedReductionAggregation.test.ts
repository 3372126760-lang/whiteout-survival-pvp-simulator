import { describe, expect, it } from "vitest";
import {
  BAHITI_DANGER_SENSE, NORAH_CATCH_OFF_GUARD, WU_MING_WIND_SHELTER,
  createActiveEffect, createBattleState, createDamageEvent, createHeroSkillSystem,
  createHeroStateFromDefinitions, formatBattleTrace, resolveRound, TROOP_TYPES,
  type ActiveEffect, type DamageSubtype, type EffectScope, type TroopType,
} from "../../pvp";
import { compileCriterionTemplate, prepareCriterionState } from "../optimizer/criterion/compiler";
import { createExpectationProgram } from "../optimizer/theory/expectationProgram";
import { defaultTheoryOptions } from "../optimizer/theory/types";
import { makeDamageEffect, makeSide } from "./helpers";

const GENERAL = "receivedDamageReduction";
const NORMAL = "receivedNormalAttackReduction";
const SKILL = "receivedSkillDamageReduction";

function reduction(group: string, value: number, scope?: EffectScope): ActiveEffect {
  return makeDamageEffect({ id: group, kind: "damageReduction", group, value,
    ...(scope === undefined ? {} : { scope }) });
}

function received(general = .20, normal = .10, skill = .12): ActiveEffect[] {
  return [
    reduction(GENERAL, general),
    reduction(NORMAL, normal, { damageTypes: ["normalAttack"] }),
    reduction(SKILL, skill, { damageTypes: ["skillDamage"] }),
  ];
}

function state(incoming: readonly ActiveEffect[], outgoing: readonly ActiveEffect[] = []) {
  return createBattleState({
    sideA: makeSide({ shield: 100 }, { armyEffects: outgoing }),
    sideB: makeSide({ shield: 100, lancer: 100, marksman: 100 }, { armyEffects: incoming }),
  });
}

function hit(subtype: DamageSubtype, incoming: readonly ActiveEffect[],
  outgoing: readonly ActiveEffect[] = [], target: TroopType = "shield") {
  return createDamageEvent({ id: "received-reduction", round: 1, actionOrder: 0,
    sourceSide: "A", sourceTroop: "shield", targetSide: "B", targetTroop: target,
    damageType: subtype === "normalAttack" ? "normalAttack" : "skillDamage",
    damageSubtype: subtype, baseDamage: 1000 }, state(incoming, outgoing));
}

describe("conditional received reduction shares one divisor", () => {
  it.each([
    { label: "no reduction", subtype: "normalAttack", effects: [], denominator: 1 },
    { label: "general 20% alone", subtype: "normalAttack", effects: [reduction(GENERAL, .20)], denominator: 1.20 },
    { label: "normal 10% alone", subtype: "normalAttack", effects: [reduction(NORMAL, .10)], denominator: 1.10 },
    { label: "general 20% + normal 10%", subtype: "normalAttack", effects: received(), denominator: 1.30 },
    { label: "general 20% + skill 12%", subtype: "skillDamage", effects: received(), denominator: 1.32 },
    { label: "general 20% + extra skill 12%", subtype: "extraDamage", effects: received(), denominator: 1.32 },
  ] as const)("uses $label for $subtype", ({ subtype, effects, denominator }) => {
    const event = hit(subtype, effects);
    expect(event.reductionMultiplier).toBeCloseTo(denominator, 12);
    expect(event.modifiedDamage).toBeCloseTo(1000 / denominator, 10);
    expect(event.receivedDamageReductionDenominator).toBeCloseTo(denominator, 12);
    expect(event.receivedDamageReductionTotal).toBeCloseTo(denominator - 1, 12);
    expect(event.damageBeforeReceivedReduction).toBeCloseTo(1000, 10);
    expect(event.damageAfterReceivedReduction).toBe(event.modifiedDamage);
    if (effects.length === 3) {
      const conditional = subtype === "normalAttack" ? NORMAL : SKILL;
      const excluded = subtype === "normalAttack" ? SKILL : NORMAL;
      expect(event.receivedDamageReductionSources.map((effect) => effect.group)).toEqual([GENERAL, conditional]);
      expect(event.reductionGroups.map((group) => group.group)).toEqual([GENERAL, conditional]);
      expect(event.appliedReductionEffects.some((effect) => effect.group === excluded)).toBe(false);
      expect(event.modifiedDamage).not.toBeCloseTo(1000 / (1.20 * (subtype === "normalAttack" ? 1.10 : 1.12)), 6);
    }
  });

  it.each(["normalAttack", "skillDamage", "extraDamage"] as const)(
    "does not apply the other conditional group to %s, even without a redundant scope", (subtype) => {
      const excluded = subtype === "normalAttack" ? SKILL : NORMAL;
      const event = hit(subtype, [reduction(excluded, .50)]);
      expect(event.reductionMultiplier).toBe(1);
      expect(event.modifiedDamage).toBe(1000);
      expect(event.appliedReductionEffects).toEqual([]);
      expect(event.receivedDamageReductionSources).toEqual([]);
    });

  it("keeps enemy outgoing 20% separate from received 20% + normal 10%", () => {
    const outgoing = makeDamageEffect({ id: "outgoing", kind: "outgoingDamageReduction",
      group: "enemyOutgoingDamageReduction", value: .20 });
    const event = hit("normalAttack", received(), [outgoing]);
    expect(event.reductionMultiplier).toBeCloseTo(1.30 * 1.20, 12);
    expect(event.modifiedDamage).toBeCloseTo(1000 / 1.30 / 1.20, 10);
    expect(event.modifiedDamage).not.toBeCloseTo(1000 / 1.50, 6);
    expect(event.receivedDamageReductionTotal).toBeCloseTo(.30, 12);
    expect(event.damageBeforeReceivedReduction).toBeCloseTo(1000 / 1.20, 10);
    expect(event.reductionGroups.find((group) => group.group === "enemyOutgoingDamageReduction")?.multiplier).toBe(1.20);
  });

  it.each([
    "poisonOutgoingDamageReduction", "gordonMarksmanOutgoingReduction", "gordonPeriodicOutgoingReduction",
    "viperPhalanxShieldReduction", "viperPhalanxOtherReduction", "unconfirmedIndependentReduction",
  ])("keeps %s in its existing separate divisor", (group) => {
    const outgoing = group.toLowerCase().includes("outgoing");
    const other = makeDamageEffect({ id: group, group, value: .20,
      kind: outgoing ? "outgoingDamageReduction" : "damageReduction" });
    const event = hit("normalAttack", outgoing ? received() : [...received(), other], outgoing ? [other] : []);
    expect(event.reductionMultiplier).toBeCloseTo(1.30 * 1.20, 12);
    expect(event.modifiedDamage).toBeCloseTo(1000 / 1.30 / 1.20, 10);
    expect(event.receivedDamageReductionSources.map((effect) => effect.group)).toEqual([GENERAL, NORMAL]);
    expect(event.reductionGroups.find((entry) => entry.group === group)?.multiplier).toBe(1.20);
  });

  it.each(TROOP_TYPES)("still filters received sources by the actual %s target", (target) => {
    const event = hit("normalAttack", [reduction(GENERAL, .20),
      reduction(NORMAL, .10, { targetTroops: ["shield"], damageTypes: ["normalAttack"] })], [], target);
    const denominator = target === "shield" ? 1.30 : 1.20;
    expect(event.reductionMultiplier).toBeCloseTo(denominator, 12);
    expect(event.modifiedDamage).toBeCloseTo(1000 / denominator, 10);
  });

  it("adds stacks and separate sources before constructing the shared divisor", () => {
    const general = reduction(GENERAL, .05);
    const normal = reduction(NORMAL, .05);
    const event = hit("normalAttack", [{ ...general, stackCount: 2 },
      { ...normal, stackCount: 2 }, makeDamageEffect({ id: "other-general",
        kind: "damageReduction", group: GENERAL, value: .10 })]);
    expect(event.reductionMultiplier).toBeCloseTo(1.30, 12);
    expect(event.modifiedDamage).toBeCloseTo(1000 / 1.30, 10);
    expect(event.receivedDamageReductionSources.map((effect) => effect.effectiveValue)).toEqual([.10, .10, .10]);
  });

  it("does not pool a received effect that has not activated yet", () => {
    const future = { ...reduction(NORMAL, .10), activeFromRound: 2 };
    const event = hit("normalAttack", [reduction(GENERAL, .20), future]);
    expect(event.reductionMultiplier).toBe(1.20);
    expect(event.receivedDamageReductionSources).toHaveLength(1);
  });

  it("leaves vulnerability, base-defense and direct cancellation separate", () => {
    const incoming = [...received(),
      createActiveEffect({ identity: { sourceId: "defense", sourceSkillId: "defense", effectId: "defense" },
        definition: { id: "defense", name: "defense", kind: "baseDefenseMultiplier",
          group: "baseDefenseMultiplier", value: .40, ruleStatus: "supported" }, appliedRound: 1 }),
      createActiveEffect({ identity: { sourceId: "cancel", sourceSkillId: "cancel", effectId: "cancel" },
        definition: { id: "cancel", name: "cancel", kind: "directDamageCancellation",
          group: "directDamageCancellation", value: .20, ruleStatus: "supported" }, appliedRound: 1 }),
      createActiveEffect({ identity: { sourceId: "vulnerability", sourceSkillId: "vulnerability", effectId: "vulnerability" },
        definition: { id: "vulnerability", name: "vulnerability", kind: "incomingDamageIncrease",
          group: "vulnerability", value: .50, ruleStatus: "supported" }, appliedRound: 1 }),
    ];
    const event = hit("normalAttack", incoming);
    expect(event.reductionMultiplier).toBeCloseTo(1.30 * 1.40, 12);
    expect(event.directCancellationMultiplier).toBe(.80);
    expect(event.increaseMultiplier).toBe(1.50);
    expect(event.modifiedDamage).toBeCloseTo(1000 * 1.50 / 1.30 / 1.40 * .80, 10);
    expect(event.receivedDamageReductionTotal).toBeCloseTo(.30, 12);
  });
});

const definitions = [BAHITI_DANGER_SENSE, WU_MING_WIND_SHELTER, NORAH_CATCH_OFF_GUARD];

function heroBattle() {
  return createBattleState({
    sideA: { ...makeSide({ lancer: 100 }), heroStates: [
      createHeroStateFromDefinitions({ heroId: NORAH_CATCH_OFF_GUARD.heroId, position: "leader" }, definitions),
    ] },
    sideB: { ...makeSide({ shield: 100 }), heroStates: [BAHITI_DANGER_SENSE, WU_MING_WIND_SHELTER].map((skill) =>
      createHeroStateFromDefinitions({ heroId: skill.heroId, position: "leader" }, definitions)),
    },
  });
}

function heroRound() {
  return resolveRound(heroBattle(), { heroSkillSystem: createHeroSkillSystem({
    definitions, randomSource: { next: () => 0 },
  }) });
}

describe("received reduction shared by the formal engine, Criterion and Theory", () => {
  it("pools actual Bahiti Lv5 + Wuming Lv5 while retaining original skill groups in the trace", () => {
    const result = heroRound();
    const events = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(events.map((event) => event.damageSubtype)).toEqual(["normalAttack", "extraDamage"]);
    for (const event of events) {
      const denominator = event.damageSubtype === "normalAttack" ? 1.45 : 1.50;
      expect(event.reductionMultiplier).toBeCloseTo(denominator, 12);
      expect(event.modifiedDamage).toBeCloseTo(event.rawDamage / denominator, 10);
      expect(event.receivedDamageReductionDenominator).toBeCloseTo(denominator, 12);
      expect(event.receivedDamageReductionSources.map((effect) => effect.sourceSkillId)).toEqual(
        expect.arrayContaining([BAHITI_DANGER_SENSE.id, WU_MING_WIND_SHELTER.id]));
    }
    const text = formatBattleTrace({ rounds: [result.trace], endReason: "roundLimit", finalStatus: result.stateAfter.status });
    expect(text).toContain("receivedDamageReductionDenominator=1.45");
    expect(text).toContain("receivedDamageReductionDenominator=1.5");
    expect(text).toContain(NORMAL);
    expect(text).toContain(SKILL);
  });

  it("compiles Criterion normal and extra coefficients with the same conditional divisor", () => {
    const template = compileCriterionTemplate(prepareCriterionState(heroBattle()));
    const events = heroRound().trace.damageEvents.filter((event) => event.sourceSide === "A");
    const scale = 100; // sqrt(N0=100) * sqrt(n=100)
    expect(template.a.normal[3]).toBeCloseTo(3 / 1.45, 12);
    expect(template.a.skill[3]).toBeCloseTo(3 / 1.50, 12);
    for (const event of events) {
      const unit = event.damageSubtype === "normalAttack" ? template.a.normal[3]! : template.a.skill[3]!;
      expect(event.modifiedDamage).toBeCloseTo(unit * scale, 10);
    }
  });

  it("uses the same normal and skill divisors in Theory expectation frames", () => {
    const initial = heroBattle();
    const program = createExpectationProgram(initial, defaultTheoryOptions(), new Set());
    const counts = [initial.sideA, initial.sideB].map((side) => TROOP_TYPES.map((troop) => side.troops[troop].aliveCount));
    const result = program.runRound(1, counts, Math.sqrt(initial.fixedInitialMinTroops), program.createRuntime());
    const formal = heroRound().trace.damageEvents.filter((event) => event.sourceSide === "A");
    const normal = formal.find((event) => event.damageSubtype === "normalAttack")!;
    const extra = formal.find((event) => event.damageSubtype === "extraDamage")!;
    // Nora has a 20% proc: Theory uses its expectation; the fixed RNG above triggers the formal event.
    expect(result.damage[1]![0]).toBeCloseTo(300 / 1.45 + .20 * 300 / 1.50, 10);
    expect(result.damage[1]![0]).toBeCloseTo(normal.modifiedDamage + .20 * extra.modifiedDamage, 10);
  });
});
