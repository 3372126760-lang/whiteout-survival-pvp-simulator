import { describe, expect, it } from "vitest";
import type { HeroSkillDefinition, HeroSkillEffect } from "../heroSkills";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createValidationPreviewState } from "../validationUi";
import { applyEffectSignature, createEffectSignature } from "../optimizer/criterion/signatures";
import { bodyPrimaryEffectFamily, hasLegalBodyEffectFamilies, createBodySkillSignature, createBodyComboSignature,
  dominatesBodySkill, dominatesBodyCombo, preprocessBodyCombinations, createBodyMarginalModel,
  prepareBodyMarginalContext, roughBodyMarginalScore, optimisticBodyPotential } from "../optimizer/criterion/bodyPreprocess";
const attack = (value: number, source: "army" | "shield" = "army"): HeroSkillEffect => ({ id: "attack", name: "attack", kind: "attributeModifier",
  attribute: "attack", recipient: "selfArmy", group: "heroAttackBonus", operation: "multiplyAttributeFactor", value, scope: { source, target: "all", damageType: "all" } });
const penetration = (value: number): HeroSkillEffect => ({ ...attack(value), attribute: "penetration", group: "heroPenetrationBonus" } as HeroSkillEffect);
const life = (value: number): HeroSkillEffect => ({ ...attack(value), attribute: "life", group: "heroLifeBonus" } as HeroSkillEffect);
const reduction = (value: number): HeroSkillEffect => ({ id: "reduction", name: "reduction", kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value, scope: { source: "army", target: "all", damageType: "all" } });
const damage = (value: number, source: "army" | "shield" = "army"): HeroSkillEffect => ({ id: "damage", name: "damage", kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value, scope: { source, target: "all", damageType: "all" } });
const skill = (id: string, effects: readonly HeroSkillEffect[], probability = 1): HeroSkillDefinition => ({ id, name: id, heroId: id,
  positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: 1, allowedPositions: ["member"] }, trigger: probability < 1 ? "roundStart" : "passive",
  probability, activationTiming: "immediate", levelValues: { 5: { effects } }, metadata: { ruleStatus: "supported", source: "synthetic mathematical regression" } });
const row = (...skills: HeroSkillDefinition[]) => ({ memberSkillIds: skills.map((value) => value.id) });
const compile = (definitions: readonly HeroSkillDefinition[]) => {
  const ids = definitions.map((definition) => definition.id), descriptors = definitions.map((definition) => createBodySkillSignature(definition));
  const signature = createEffectSignature(definitions.map((definition, index) => ({ skill: definition, level: 5, runtimeId: `body-${index}` })), ids.join("|"));
  return { ids, signature, semantic: createBodyComboSignature(ids, descriptors, signature) };
};
const state = () => createValidationPreviewState(createDefaultValidationInput());
const ratios = { shield: 100, lancer: 0, marksman: 0 };

describe("optimizer Body semantic hard preprocessing", () => {
  it("rejects family x3/x4 while allowing x2, including different heroes with identical effects", () => {
    const shuyun = "hero-skill.shuyun.attack";
    const actualBradley = CONFIRMED_HERO_SKILL_DEFINITIONS.find((definition) => definition.heroId === "hero.s7.buladeli" && definition.positionRule.expeditionSkillSlot === 1)!;
    expect(actualBradley).toBeDefined();
    expect(bodyPrimaryEffectFamily(shuyun)).toBe(bodyPrimaryEffectFamily(actualBradley.id));
    expect(hasLegalBodyEffectFamilies([shuyun, shuyun])).toBe(true);
    expect(hasLegalBodyEffectFamilies([shuyun, shuyun, actualBradley.id])).toBe(false);
    expect(hasLegalBodyEffectFamilies([shuyun, actualBradley.id, shuyun, actualBradley.id])).toBe(false);
  });
  it("keeps Wuming x2 + Nora x2 legal and available after preprocessing", () => {
    const ids = ["hero-skill.wuming.wind-shelter", "hero-skill.wuming.wind-shelter", "hero-skill.nuola.multi-troop-combat", "hero-skill.nuola.multi-troop-combat"];
    expect(hasLegalBodyEffectFamilies(ids)).toBe(true);
    const result = preprocessBodyCombinations([{ memberSkillIds: ids }], () => [5, 5, 5, 5]);
    expect(result.bodies).toHaveLength(1); expect(result.audit.preprocessedBodyCount).toBe(1);
    expect(result.bodies[0]!.semantic.normalReceivedReduction).toBeCloseTo(.5);
    expect(result.bodies[0]!.semantic.skillReceivedReduction).toBeCloseTo(.6);
    expect(result.bodies[0]!.semantic.ordinaryReductionDenominators.shield).toBeCloseTo(1.3);
    expect(result.bodies[0]!.semantic.ordinaryReductionDenominators.lancer).toBe(1);
  });
  it("probability .4 x penetration .5 is strictly below permanent .2 or .25 at identical scope/group", () => {
    const probability = createBodySkillSignature(skill("prob", [penetration(.5)], .4));
    expect(probability.penetrationBuff).toBeCloseTo(.2);
    expect(dominatesBodySkill(probability, createBodySkillSignature(skill("permanent20", [penetration(.2)])))).toBe("probabilityDominance");
    expect(dominatesBodySkill(probability, createBodySkillSignature(skill("permanent25", [penetration(.25)])))).toBe("probabilityDominance");
  });
  it("probability ordinary reduction is expectedReduction .2 then denominator1.2", () => {
    const probability = createBodySkillSignature(skill("prob", [reduction(.5)], .4)), permanent = createBodySkillSignature(skill("permanent", [reduction(.2)]));
    expect(probability.ordinaryReceivedReduction).toBeCloseTo(.2);
    expect(probability.ordinaryReductionDenominator).toBeCloseTo(1.2);
    expect(permanent.ordinaryReductionDenominator).toBeCloseTo(1.2);
    expect(dominatesBodySkill(probability, permanent)).toBe("probabilityDominance");
    expect(compile([probability.definition]).signature.effects[0]!.effect.definition).toMatchObject({ kind: "damageReduction", value: .2 });
  });
  it("prunes probability and numeric dominated skill lanes before rough search", () => {
    const probability = skill("prob", [penetration(.5)], .4), permanent = skill("permanent", [penetration(.2)]), weak = skill("weak", [attack(.1)]), strong = skill("strong", [attack(.25)]), hp = skill("hp", [life(.2)]);
    const definitions = [probability, permanent, weak, strong, hp];
    const result = preprocessBodyCombinations([row(probability, probability, hp, hp), row(permanent, permanent, hp, hp), row(weak, weak, hp, hp), row(strong, strong, hp, hp)], () => [5, 5, 5, 5], [], { definitions });
    expect(result.audit.rejectedByProbabilityDominance).toBe(1);
    expect(result.audit.rejectedBySkillDominance).toBe(1);
    expect(result.bodies).toHaveLength(2);
    expect(result.bodies.flatMap((body) => body.ids)).not.toContain("prob");
    expect(result.bodies.flatMap((body) => body.ids)).not.toContain("weak");
  });
  it("does not hard-delete an equal permanent skill identity", () => {
    expect(dominatesBodySkill(createBodySkillSignature(skill("a", [attack(.25)])), createBodySkillSignature(skill("b", [attack(.25)])))).toBeUndefined();
  });
  it("does not cross scopes, groups, targets, contexts or extra mechanisms for strict proof", () => {
    const a = createBodySkillSignature(skill("a", [attack(.2, "shield")]));
    expect(dominatesBodySkill(a, createBodySkillSignature(skill("all", [attack(.3)])))).toBeUndefined();
    const extra: HeroSkillEffect = { id: "extra", name: "extra", kind: "extraDamage", recipient: "selfArmy", coefficient: .1, basis: "parentBaseDamage", scope: { source: "army", target: "currentTarget", damageType: "skillDamage" } };
    expect(dominatesBodySkill(createBodySkillSignature(skill("extra", [attack(.1), extra])), createBodySkillSignature(skill("strong", [attack(.25)])))).toBeUndefined();
    expect(dominatesBodySkill(createBodySkillSignature({ ...skill("context", [attack(.1)]), battleContexts: ["garrisonDefense"] }), createBodySkillSignature(skill("strong", [attack(.25)])))).toBeUndefined();
  });
  it("globally rejects strict Pareto dominated combo before any marginal rough score", () => {
    const weak = skill("weak", [attack(.1)]), strong = skill("strong", [attack(.25)]), hp = skill("hp", [life(.2)]);
    const a = compile([weak, weak, hp, hp]), b = compile([strong, strong, hp, hp]);
    expect(dominatesBodyCombo(a.semantic, b.semantic)).toBe(true);
    const result = preprocessBodyCombinations([row(weak, weak, hp, hp), row(strong, strong, hp, hp)], () => [5, 5, 5, 5], [], { definitions: [weak, strong, hp], protectedSkillIds: ["weak", "strong"] });
    expect(result.audit.rejectedByParetoDominance).toBe(1); expect(result.bodies.map((body) => body.ids)).toEqual([b.ids]);
  });
  it("does not globally remove shield damage100% because of average value", () => {
    const shield = skill("shield100", [damage(1, "shield")]), all = skill("all", [damage(.3)]), hp = skill("hp", [life(.2)]);
    const result = preprocessBodyCombinations([row(shield, shield, hp, hp), row(all, all, hp, hp)], () => [5, 5, 5, 5], [], { definitions: [shield, all, hp] });
    expect(result.bodies.map((body) => body.ids.join("|"))).toContain(row(shield, shield, hp, hp).memberSkillIds.join("|"));
  });
  it("does not delete a locked lane if the alleged superior replacement is unavailable", () => {
    const weak = skill("weak", [attack(.1)]), strong = skill("strong", [attack(.25)]), hp = skill("hp", [life(.2)]), pen = skill("pen", [penetration(.2)]);
    const result = preprocessBodyCombinations([row(weak, weak, hp, hp), row(strong, strong, pen, pen)], () => [5, 5, 5, 5], [], { definitions: [weak, strong, hp, pen] });
    expect(result.audit.rejectedBySkillDominance).toBe(0); expect(result.bodies).toHaveLength(2);
  });
  it("proves replacement using the effective level in each slot rather than another slot's Lv5", () => {
    const weak = skill("weak", [attack(.1)]), strong = { ...skill("strong", [attack(.25)]), levelValues: { 1: { effects: [attack(.05)] }, 5: { effects: [attack(.25)] } } };
    const hp = skill("hp", [life(.2)]), pen = skill("pen", [penetration(.2)]);
    const result = preprocessBodyCombinations([row(weak, weak, hp, hp), row(strong, strong, hp, hp), row(pen, pen, strong, strong)], (ids) => ids.map((id, index) => id === "strong" && index < 2 ? 1 : 5), [], { definitions: [weak, strong, hp, pen] });
    expect(result.bodies.some((body) => body.ids[0] === "weak")).toBe(true);
    expect(result.skillDominance.some((proof) => proof.skillId === "weak" && proof.dominatedBy === "strong")).toBe(true);
  });
});
describe("head-specific marginal Body scoring", () => {
  it("uses true same-group Δlog at B10 and favours useful independent multiplier groups", () => {
    const a = skill("a", [attack(.25)]), compound = skill("compound", [life(.01), attack(.2)]), pen = skill("pen", [penetration(.2)]), reduce = skill("reduce", [reduction(.2)]);
    const stacked = compile([a, a, compound, compound]), cross = compile([pen, pen, reduce, reduce]);
    const model = createBodyMarginalModel([stacked, cross]), initial = state(), baseEffect = createEffectSignature([{ skill: skill("base", [attack(10)]), level: 5, runtimeId: "head" }], "head");
    const high = applyEffectSignature(initial, baseEffect, "A"), context = prepareBodyMarginalContext(high, ratios, model);
    expect(roughBodyMarginalScore(stacked.semantic, context)).toBeCloseTo(Math.log((1 + 10 + .9) / (1 + 10)) + Math.log(1.02), 10);
    expect(roughBodyMarginalScore(stacked.semantic, context)).toBeLessThan(roughBodyMarginalScore(cross.semantic, context) * .25);
    const lowContext = prepareBodyMarginalContext(initial, ratios, model);
    expect(roughBodyMarginalScore(stacked.semantic, lowContext)).toBeGreaterThan(roughBodyMarginalScore(stacked.semantic, context));
  });
  it("caches the head group baseline while ratios change troop-sensitive weights", () => {
    const shield = compile([skill("shield", [damage(1, "shield")])]), model = createBodyMarginalModel([shield]), initial = state();
    const a = prepareBodyMarginalContext(initial, ratios, model), b = prepareBodyMarginalContext(initial, { shield: 0, lancer: 0, marksman: 100 }, model);
    expect(a.head).toBe(b.head); expect(roughBodyMarginalScore(shield.semantic, a)).toBeCloseTo(Math.log(2));
    expect(roughBodyMarginalScore(shield.semantic, b)).toBe(0);
  });
  it("includes independent extra channels in the optimistic body envelope", () => {
    const extra: HeroSkillEffect = { id: "extra", name: "extra", kind: "extraDamage", recipient: "selfArmy", coefficient: .5, basis: "parentBaseDamage", scope: { source: "army", target: "currentTarget", damageType: "skillDamage" } };
    const body = compile([skill("extra", [extra])]), model = createBodyMarginalModel([body]), context = prepareBodyMarginalContext(state(), ratios, model);
    expect(optimisticBodyPotential(context, model)).toBeGreaterThan(0);
    expect(optimisticBodyPotential(context, model)).toBeGreaterThanOrEqual(roughBodyMarginalScore(body.semantic, context));
  });
  it("keeps holder-bound head buffs scoped to that troop when computing marginal B", () => {
    const body = compile([skill("body", [attack(.2)])]), model = createBodyMarginalModel([body]), initial = state();
    const effect = createEffectSignature([{ skill: skill("head", [attack(10)]), level: 5, runtimeId: "head" }], "head").effects[0]!.effect;
    const shieldOnly = { ...initial, sideA: { ...initial.sideA, troops: { ...initial.sideA.troops, shield: { ...initial.sideA.troops.shield, buffs: [effect] } } } };
    expect(roughBodyMarginalScore(body.semantic, prepareBodyMarginalContext(shieldOnly, ratios, model))).toBeCloseTo(Math.log(11.2 / 11));
    expect(roughBodyMarginalScore(body.semantic, prepareBodyMarginalContext(shieldOnly, { shield: 0, lancer: 100, marksman: 0 }, model))).toBeCloseTo(Math.log(1.2));
  });
});
