import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createValidationPreviewState } from "../validationUi";
import type { HeroSkillDefinition } from "../heroSkills";
import { applyEffectSignature, createEffectSignature } from "../optimizer/criterion/signatures";
import { createBodyComboSignature, createBodySkillSignature, createBodyMarginalModel, prepareBodyMarginalContext,
  roughBodyMarginalScore } from "../optimizer/criterion/bodyPreprocess";
const skill = (id: string, attribute: "attack" | "life", value: number, source: "army" | "shield"): HeroSkillDefinition => ({
  id, name: id, heroId: id, trigger: "passive", probability: 1, activationTiming: "immediate",
  positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: 1, allowedPositions: ["member"] },
  levelValues: { 5: { effects: [{ id, name: id, kind: "attributeModifier", attribute, value, recipient: "selfArmy",
    operation: "multiplyAttributeFactor", group: attribute === "attack" ? "heroAttackBonus" : "heroLifeBonus",
    scope: { source, target: "all", damageType: "all" } }] } }, metadata: { ruleStatus: "supported", source: "closed-form marginal fixture" } });
const body = () => {
  const definitions = [skill("shield", "attack", .25, "shield"), skill("shield", "attack", .25, "shield"),
    skill("life", "life", .25, "army"), skill("life", "life", .25, "army")], ids = definitions.map((s) => s.id);
  const signature = createEffectSignature(definitions.map((definition, index) => ({ skill: definition, level: 5, runtimeId: `body-${index}` })), "cache-fixture");
  return { ids, signature, semantic: createBodyComboSignature(ids, definitions.map((definition) => createBodySkillSignature(definition)), signature) };
};

describe("body marginal seven-coefficient cache", () => {
  it("matches closed-form scoped Δlog across ratios and shares one prepared vector", () => {
    const row = body(), model = createBodyMarginalModel([row]), state = createValidationPreviewState(createDefaultValidationInput());
    const mixed = prepareBodyMarginalContext(state, { shield: 55, lancer: 5, marksman: 40 }, model);
    const shield = prepareBodyMarginalContext(state, { shield: 100, lancer: 0, marksman: 0 }, model);
    const rear = prepareBodyMarginalContext(state, { shield: 0, lancer: 0, marksman: 100 }, model);
    expect(roughBodyMarginalScore(row.semantic, mixed)).toBeCloseTo(mixed.ownOutput[0] * Math.log(1.5) + Math.log(1.5), 12);
    const vector = model.scoreVectors.get(row.semantic);
    expect(roughBodyMarginalScore(row.semantic, shield)).toBeCloseTo(2 * Math.log(1.5), 12);
    expect(roughBodyMarginalScore(row.semantic, rear)).toBeCloseTo(Math.log(1.5), 12);
    expect(model.scoreVectors.get(row.semantic)).toBe(vector);
  });
  it("drops the prior head cache and recomputes true stacked-group marginal when switching heads", () => {
    const row = body(), model = createBodyMarginalModel([row]), state = createValidationPreviewState(createDefaultValidationInput());
    const ratios = { shield: 100, lancer: 0, marksman: 0 };
    const first = prepareBodyMarginalContext(state, ratios, model);
    expect(roughBodyMarginalScore(row.semantic, first)).toBeCloseTo(2 * Math.log(1.5), 12);
    const oldCache = model.scoreVectors;
    const head = createEffectSignature([{ skill: skill("head", "attack", 10, "shield"), level: 5, runtimeId: "head" }], "head");
    const stacked = prepareBodyMarginalContext(applyEffectSignature(state, head, "A"), ratios, model);
    expect(roughBodyMarginalScore(row.semantic, stacked)).toBeCloseTo(Math.log(11.5 / 11) + Math.log(1.5), 12);
    expect(model.scoreVectors).not.toBe(oldCache);
    expect(roughBodyMarginalScore(row.semantic, first)).toBeCloseTo(2 * Math.log(1.5), 12);
    expect(model.scoreHead).toBe(first.head);
  });
});
