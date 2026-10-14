import { describe, expect, it } from "vitest";
import {
  FRED_ACID_SOLUTION, GWEN_AERIAL_SUPPRESSION, GWEN_EAGLE_VISION,
  createActiveEffect, createBattleState, createDamageEvent, createHeroSkillSystem,
  createHeroStateFromDefinitions, resolveRound,
  type ActiveEffect, type DamageSubtype, type EffectScope, type TroopType,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

const EAGLE = GWEN_EAGLE_VISION.id;
const EAGLE_EFFECT = "hero-effect.gewen.eagle-vision.vulnerability";
const AERIAL = GWEN_AERIAL_SUPPRESSION.id;
const AERIAL_EFFECT = "hero-effect.gewen.aerial-suppression.vulnerability";
const OVERRIDE = "aerialSuppressionOverride";

function incoming(sourceSkillId: string, effectId: string, value: number,
  group = "vulnerability", scope?: EffectScope): ActiveEffect {
  return createActiveEffect({
    identity: { sourceId: `test:${sourceSkillId}`, sourceSkillId, effectId },
    definition: { id: effectId, name: effectId, kind: "incomingDamageIncrease", group, value,
      ruleStatus: "supported", ...(scope === undefined ? {} : { scope }) }, appliedRound: 1,
  });
}

const eagle = () => incoming(EAGLE, EAGLE_EFFECT, .25);
const fred = () => incoming(FRED_ACID_SOLUTION.id, "hero-effect.fuleide.acid-solution", .20,
  "vulnerability", { targetTroops: ["shield"] });
const token = (scope?: EffectScope) => incoming(AERIAL, AERIAL_EFFECT, .15, OVERRIDE, scope);

function hit(effects: readonly ActiveEffect[], consumed?: ActiveEffect,
  subtype: DamageSubtype = "normalAttack", target: TroopType = "shield",
  outgoing: readonly ActiveEffect[] = []) {
  const state = createBattleState({
    sideA: makeSide({ shield: 100 }, { armyEffects: outgoing }),
    sideB: makeSide({ shield: 100, marksman: 100 }, { armyEffects: effects }),
  });
  return createDamageEvent({ id: `test:${subtype}:${target}`, round: 1, actionOrder: 0,
    sourceSide: "A", sourceTroop: "shield", targetSide: "B", targetTroop: target,
    damageType: subtype === "normalAttack" ? "normalAttack" : "skillDamage",
    damageSubtype: subtype, baseDamage: 1000 }, state,
  { transientEffects: consumed === undefined ? [] : [consumed] });
}

const definitions = [GWEN_EAGLE_VISION, GWEN_AERIAL_SUPPRESSION, FRED_ACID_SOLUTION];
const system = () => createHeroSkillSystem({ definitions, randomSource: { next: () => .99 } });

function battle(withFred = false, counts: Partial<Record<TroopType, number>> = { shield: 100 },
  completedShieldAttacks = 0, startingEffects: readonly ActiveEffect[] = []) {
  const gwen = createHeroStateFromDefinitions({ heroId: GWEN_EAGLE_VISION.heroId, position: "leader" }, definitions);
  return createBattleState({
    sideA: { ...makeSide(counts, { maxHpPerUnit: 1_000_000_000 }), heroStates: [
      { ...gwen, skillStates: gwen.skillStates.map((runtime) => runtime.skillId === AERIAL
        ? { ...runtime, mainAttackCounts: { ...runtime.mainAttackCounts, shield: completedShieldAttacks } }
        : runtime) },
      ...(withFred ? [createHeroStateFromDefinitions({ heroId: FRED_ACID_SOLUTION.heroId, position: "leader" }, definitions)] : []),
    ] },
    sideB: makeSide({ shield: 100 }, { maxHpPerUnit: 1_000_000_000, armyEffects: startingEffects }),
  });
}

function rounds(withFred: boolean, count: number) {
  let state = battle(withFred);
  const options = { heroSkillSystem: system() };
  return Array.from({ length: count }, () => {
    const result = resolveRound(state, options);
    state = result.stateAfter;
    return result;
  });
}

const main = (round: ReturnType<typeof resolveRound>, troop: TroopType = "shield") =>
  round.trace.damageEvents.find((event) => event.sourceSide === "A" && event.sourceTroop === troop &&
    event.damageSubtype === "normalAttack")!;
const hasToken = (round: ReturnType<typeof resolveRound>) => round.stateAfter.sideB.troops.shield.debuffs.some(
  (effect) => effect.definition.kind === "oneUseIncomingDamageIncrease" && effect.identity.sourceSkillId === AERIAL);

describe("Gwen's aerial token selectively replaces Eagle Vision", () => {
  it("keeps Eagle Vision at 25%, starting next round", () => {
    const result = rounds(false, 2);
    expect(main(result[0]!).increaseMultiplier).toBe(1);
    expect(main(result[1]!).increaseMultiplier).toBe(1.25);
  });

  it("uses 1.25, then one 1.15 hit, then restores 1.25 with only Gwen", () => {
    const result = rounds(false, 8);
    expect(main(result[5]!).increaseMultiplier).toBe(1.25);
    expect(hasToken(result[5]!)).toBe(true);
    expect(main(result[6]!).increaseMultiplier).toBe(1.15);
    expect(hasToken(result[6]!)).toBe(false);
    expect(main(result[7]!).increaseMultiplier).toBe(1.25);
    expect(main(result[7]!).appliedIncreaseEffects.some((effect) => effect.group === OVERRIDE)).toBe(false);
  });

  it("adds actual Fred 20% and Gwen 25% to 1.45 in a normal hit", () => {
    const result = rounds(true, 2);
    expect(main(result[0]!).increaseMultiplier).toBe(1.20);
    expect(main(result[1]!).increaseMultiplier).toBe(1.45);
    expect(main(result[1]!).appliedIncreaseEffects.map((effect) => effect.sourceSkillId))
      .toEqual(expect.arrayContaining([EAGLE, FRED_ACID_SOLUTION.id]));
  });

  it("keeps Fred's 20% during the one-use 15% replacement, then restores 1.45", () => {
    const result = rounds(true, 8);
    const consumed = main(result[6]!);
    expect(main(result[5]!).increaseMultiplier).toBe(1.45);
    expect(consumed.increaseMultiplier).toBeCloseTo(1.35, 12);
    expect(consumed.increaseMultiplier).not.toBe(1.15);
    expect(consumed.modifiedDamage).toBeCloseTo(consumed.rawDamage * 1.35, 10);
    expect(consumed.appliedIncreaseEffects.map((effect) => effect.sourceSkillId))
      .toEqual(expect.arrayContaining([FRED_ACID_SOLUTION.id, AERIAL]));
    expect(consumed.appliedIncreaseEffects.some((effect) => effect.sourceSkillId === EAGLE)).toBe(false);
    expect(consumed.increaseGroups.map((group) => group.group)).toEqual(expect.arrayContaining(["vulnerability", OVERRIDE]));
    expect(hasToken(result[6]!)).toBe(false);
    expect(main(result[7]!).increaseMultiplier).toBe(1.45);
  });

  it.each([
    { source: "hero-skill.miya.doom-entanglement", effect: "hero-effect.miya.doom-entanglement", value: .50 },
    { source: "hero-skill.rufus.armor-breaking-strike", effect: "hero-effect.rufus.armor-breaking-strike.vulnerability", value: .25 },
  ])("preserves $source in the same vulnerability group", ({ source, effect, value }) => {
    const effects = [eagle(), incoming(source, effect, value)];
    expect(hit(effects).increaseMultiplier).toBeCloseTo(1 + value + .25, 12);
    const consumed = hit(effects, token());
    expect(consumed.increaseMultiplier).toBeCloseTo(1 + value + .15, 12);
    expect(consumed.appliedIncreaseEffects.some((applied) => applied.sourceSkillId === source)).toBe(true);
  });

  it.each(["normalAttack", "skillDamage", "extraDamage"] as const)(
    "uses the source-specific replacement when a %s event consumes the token", (subtype) => {
      const consumed = hit([eagle(), fred()], token(), subtype);
      expect(consumed.increaseMultiplier).toBeCloseTo(1.35, 12);
      expect(consumed.modifiedDamage).toBeCloseTo(1350, 10);
      expect(consumed.damageType).toBe(subtype === "normalAttack" ? "normalAttack" : "skillDamage");
    });

  it.each(["skill identity", "definition effect identity", "canonical effect identity"])(
    "identifies only Eagle Vision through %s", (identity) => {
      let effect = incoming(identity === "skill identity" ? EAGLE : "imported:unknown",
        identity === "definition effect identity" ? EAGLE_EFFECT : "imported:alias", .25);
      if (identity === "canonical effect identity") {
        effect = { ...effect, identity: { ...effect.identity, effectId: EAGLE_EFFECT } };
      }
      const consumed = hit([effect, fred()], token());
      expect(consumed.increaseMultiplier).toBeCloseTo(1.35, 12);
      expect(consumed.appliedIncreaseEffects.some((applied) => applied.instanceId === effect.instanceId)).toBe(false);
    });

  it("retains unrelated incoming groups and outgoing increase multipliers", () => {
    const independent = incoming("other:incoming", "other:incoming", .30, "independentIncomingGroup");
    const outgoing = makeDamageEffect({ id: "outgoing", kind: "damageIncrease", group: "commonDamageIncrease", value: .20 });
    const effects = [eagle(), fred(), independent];
    expect(hit(effects, undefined, "normalAttack", "shield", [outgoing]).increaseMultiplier)
      .toBeCloseTo(1.45 * 1.30 * 1.20, 12);
    const consumed = hit(effects, token(), "normalAttack", "shield", [outgoing]);
    expect(consumed.increaseMultiplier).toBeCloseTo(1.35 * 1.30 * 1.20, 12);
    expect(consumed.appliedIncreaseEffects.map((effect) => effect.effectId)).toEqual(
      expect.arrayContaining(["other:incoming", "outgoing"]));
  });

  it("adds the token to Fred without requiring an Eagle Vision contribution", () => {
    expect(hit([fred()], token()).increaseMultiplier).toBeCloseTo(1.35, 12);
  });

  it("only replaces Eagle Vision when the consumed token matches this target", () => {
    const scopedToken = token({ targetTroops: ["marksman"] });
    expect(hit([eagle(), fred()], scopedToken).increaseMultiplier).toBe(1.45);
    expect(hit([eagle(), fred()], scopedToken, "normalAttack", "marksman").increaseMultiplier).toBe(1.15);
  });

  it("does not treat an unconsumed marker as an incoming damage increase", () => {
    const converted = token();
    if (converted.definition.kind !== "incomingDamageIncrease") throw new Error("Expected an incoming token.");
    const marker = { ...converted, definition: { ...converted.definition, kind: "oneUseIncomingDamageIncrease" as const } };
    expect(hit([eagle(), fred(), marker]).increaseMultiplier).toBe(1.45);
  });

  it("keeps originRoot main and extra unchanged; the next independent hit consumes once", () => {
    const result = resolveRound(battle(true, { shield: 100, lancer: 100, marksman: 100 }, 5, [eagle()]),
      { heroSkillSystem: system() });
    const root = main(result);
    const extra = result.trace.damageEvents.find((event) => event.sourceSide === "A" && event.sourceSkillId === AERIAL)!;
    expect(extra.rootEventId).toBe(root.rootEventId);
    expect(extra.damageSubtype).toBe("extraDamage");
    expect(extra.damageType).toBe("skillDamage");
    expect(extra.baseDamage).toBeCloseTo(root.baseDamage, 10);
    for (const event of [root, extra]) {
      expect(event.increaseMultiplier).toBe(1.45);
      expect(event.appliedIncreaseEffects.some((effect) => effect.group === OVERRIDE)).toBe(false);
    }
    const next = main(result, "lancer");
    expect(next.rootEventId).not.toBe(root.rootEventId);
    expect(next.increaseMultiplier).toBeCloseTo(1.35, 12);
    expect(main(result, "marksman").increaseMultiplier).toBe(1.45);
    expect(hasToken(result)).toBe(false);
  });

  it("does not change another hero's token with the reused override group", () => {
    const otherToken = incoming("hero-skill.vulcanus.rifting-blade", "hero-effect.vulcanus.rifting-blade.2", .15, OVERRIDE);
    expect(hit([eagle(), fred()], otherToken).increaseMultiplier).toBe(1.15);
  });
});
