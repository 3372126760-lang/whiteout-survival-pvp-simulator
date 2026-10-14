import { describe, expect, it } from "vitest";
import type { HeroSkillDefinition, HeroSkillEffect } from "../heroSkills";
import { enumerateBodyCombinations, type BodyEnumerationDomain } from "../optimizer/criterion/bodyEnumeration";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { generateBodyFormations, generateFormations } from "../optimizer/candidateGenerator";
import { getValidationCatalog } from "../validationUi";
const attribute = (stat: "attack" | "defense" | "penetration" | "life", value: number): HeroSkillEffect => ({
  id: stat, name: stat, kind: "attributeModifier", attribute: stat, recipient: "selfArmy",
  group: `hero${stat[0]!.toUpperCase()}${stat.slice(1)}Bonus` as "heroAttackBonus",
  operation: "multiplyAttributeFactor", value, scope: { source: "army", target: "all", damageType: "all" } });
const skill = (id: string, stat: "attack" | "defense" | "penetration" | "life", value = .25, probability = 1): HeroSkillDefinition => ({
  id, name: id, heroId: id, positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: 1, allowedPositions: ["member"] },
  trigger: probability < 1 ? "roundStart" : "passive", probability, activationTiming: "immediate",
  levelValues: { 5: { effects: [attribute(stat, value)] } }, metadata: { ruleStatus: "supported", source: "synthetic enumeration regression" } });
const definitions = [skill("A", "attack"), skill("B", "defense"), skill("C", "penetration"), skill("D", "life")];
const domain = (defs = definitions): BodyEnumerationDomain => ({ sources: defs.map((s) => ({ heroId: s.heroId, skillId: s.id, effectKey: s.id })),
  fixedMemberSkillIds: [], fixedBodyExact: false, requiredBodyHeroIds: [], allowDuplicateMembers: true,
  equivalentMemberPositions: false, disabledSkillIds: [], levelForSlot: () => 5 });

describe("optimizer family-limited body enumeration", () => {
  it("materializes four distinct heroes and AABC/AABB; rejects AAAB/AAAA during enumeration", () => {
    const result = enumerateBodyCombinations(domain(), { definitions });
    const keys = new Set(result.rows.map((row) => row.memberSkillIds.join("")));
    expect(keys.has("ABCD")).toBe(true); expect(keys.has("AABC")).toBe(true); expect(keys.has("AABB")).toBe(true);
    expect(keys.has("AAAB")).toBe(false); expect(keys.has("AAAA")).toBe(false);
    expect(result.audit.rawBodyCombinationCount).toBe(256);
    expect(result.audit.afterSameEffectMax2).toBe(204);
    expect(result.audit.rejectedDuringGenerationBySameEffectFamily).toBe(52);
    const four = result.rows.find((row) => row.memberSkillIds.join("") === "ABCD")!;
    expect(new Set(four.bodySlots.map((slot) => slot.heroDefinitionId)).size).toBe(4);
    expect(new Set(four.bodySlots.map((slot) => slot.runtimeInstanceId)).size).toBe(4);
    const duplicate = result.rows.find((row) => row.memberSkillIds.join("") === "AABB")!;
    expect(duplicate.bodySlots[0]!.heroDefinitionId).toBe(duplicate.bodySlots[1]!.heroDefinitionId);
    expect(duplicate.bodySlots[0]!.runtimeInstanceId).not.toBe(duplicate.bodySlots[1]!.runtimeInstanceId);
  });
  it("counts different hero identities with the same primary family together", () => {
    const defs = [...definitions, skill("A2", "attack")];
    const result = enumerateBodyCombinations(domain(defs), { definitions: defs });
    expect(result.rows.some((row) => row.memberSkillIds.join("|") === "A|A2|A|B")).toBe(false);
    expect(result.rows.some((row) => row.memberSkillIds.join("|") === "A|A2|B|C")).toBe(true);
    expect(result.rows.every((row) => row.bodySlots.filter((slot) => slot.effectFamily === result.rows.find((r) => r.memberSkillIds.includes("A"))!.bodySlots.find((s) => s.skillId === "A")!.effectFamily).length <= 2)).toBe(true);
  });
  it("ignores the deprecated false duplicate flag: two same-family identities remain legal", () => {
    const defs = [...definitions, skill("A2", "attack")];
    const base = domain(defs), old = { ...base, allowDuplicateMembers: false,
      sources: base.sources.map((source) => ({ ...source, effectKey: source.skillId === "A2" ? "A" : source.effectKey })) };
    const result = enumerateBodyCombinations(old, { definitions: defs });
    expect(result.rows.some((row) => row.memberSkillIds.join("|") === "A|A2|B|C")).toBe(true);
    expect(result.rows.some((row) => row.memberSkillIds.join("|") === "A|A2|A|B")).toBe(false);
    expect(result.audit).toEqual(enumerateBodyCombinations({ ...old, allowDuplicateMembers: true }, { definitions: defs }).audit);
  });
  it("accepts old false and absent flags in both production formation wrappers", () => {
    const input = { ...createDefaultValidationInput(), serverStage: "s11" as const };
    const leaders = Object.fromEntries(["shield", "lancer", "marksman"].map((troop) => [troop,
      getValidationCatalog().leaderHeroes.find((hero) => hero.troopType === troop && hero.generation === 11 && hero.rarity === "SSR")!.heroId]));
    const ids = ["hero-skill.shuyun.attack", "hero-skill.buladeli.veterans-pride", "hero-skill.jiexi.penetration", "hero-skill.patelike.life"];
    const constraints = { fixedBodyExact: true, fixedMemberSkillIds: ids, fixedLeaders: leaders };
    expect(generateBodyFormations(input, { ...constraints, allowDuplicateMembers: false }, leaders)).toHaveLength(1);
    expect(generateBodyFormations(input, constraints, leaders)).toHaveLength(1);
    expect(generateFormations(input, { ...constraints, allowDuplicateMembers: false }, 1)[0]?.memberSkillIds).toEqual(ids);
    expect(generateFormations(input, constraints, 1)[0]?.memberSkillIds).toEqual(ids);
  });
  it("filters strict and equal-expectation probability skills before materializing combination signatures", () => {
    const defs = [...definitions, skill("weak", "attack", .1), skill("prob", "penetration", .5, .4)];
    const result = enumerateBodyCombinations(domain(defs), { definitions: defs, preprocess: true });
    expect(result.audit.rejectedByStrictDominance).toBeGreaterThan(0);
    expect(result.audit.rejectedByProbabilityDominance).toBeGreaterThan(0);
    expect(result.rows.flatMap((row) => row.memberSkillIds)).not.toContain("weak");
    expect(result.rows.flatMap((row) => row.memberSkillIds)).not.toContain("prob");
    expect(result.audit.afterProbabilityDominance).toBe(204);
  });
  it("uses semantic aliases and commuting permanent permutations without calling equal identities dominated", () => {
    const defs = [...definitions, skill("alias", "attack")];
    const result = enumerateBodyCombinations(domain(defs), { definitions: defs, preprocess: true });
    expect(result.audit.rejectedBySkillDominance).toBe(0);
    expect(result.audit.rejectedByProbabilityDominance).toBe(0);
    expect(result.audit.rejectedBySemanticEquivalence).toBeGreaterThan(0);
    expect(result.audit.semanticBodyCombinationCount).toBe(19);
    expect(result.rows.some((row) => new Set(row.memberSkillIds).size === 4)).toBe(true);
  });
  it("keeps exact selected identities, fixed slots and required heroes out of alias rewriting", () => {
    const defs = [...definitions, skill("alias", "attack")];
    const fixed = { ...domain(defs), fixedMemberSkillIds: ["alias", "B", "C", "D"], fixedBodyExact: true };
    const result = enumerateBodyCombinations(fixed, { definitions: defs, preprocess: true });
    expect(result.rows.map((row) => row.memberSkillIds)).toEqual([["alias", "B", "C", "D"]]);
    const required = enumerateBodyCombinations({ ...domain(defs), requiredBodyHeroIds: ["alias"] }, { definitions: defs, preprocess: true });
    expect(required.rows.length).toBeGreaterThan(0);
    expect(required.rows.every((row) => row.memberSkillIds.includes("alias"))).toBe(true);
  });
  it("retains a protected complete body in its exact order and does not allow protected illegal families", () => {
    const result = enumerateBodyCombinations(domain(), { definitions, preprocess: true, protectedBodyKeys: ["D|C|B|A", "A|A|A|B"] });
    expect(result.rows.some((row) => row.memberSkillIds.join("|") === "D|C|B|A")).toBe(true);
    expect(result.rows.some((row) => row.memberSkillIds.join("|") === "A|A|A|B")).toBe(false);
  });
  it("does not prune a slot from a dominance proof at another slot's level", () => {
    const stronger = { ...skill("strong", "attack", .3), levelValues: { 1: { effects: [attribute("attack", .05)] }, 5: { effects: [attribute("attack", .3)] } } };
    const defs = [...definitions, stronger], fixed = { ...domain(defs), fixedMemberSkillIds: ["D"],
      levelForSlot: (id: string, index: number) => id === "strong" && index === 1 ? 1 : 5 };
    const result = enumerateBodyCombinations(fixed, { definitions: defs, preprocess: true });
    expect(result.skillDominance.some((proof) => proof.skillId === "A" && proof.dominatedBy === "strong" && proof.slot === 1)).toBe(false);
    expect(result.skillDominance.some((proof) => proof.skillId === "A" && proof.dominatedBy === "strong" && proof.slot === 2)).toBe(true);
  });
  it("preserves order-sensitive mechanisms and does not impose an arbitrary body count limit", () => {
    const redirect: HeroSkillEffect = { id: "redirect", name: "redirect", kind: "targetingOverride", recipient: "selfArmy",
      priority: ["marksman", "shield", "lancer"], scope: { source: "army", target: "all", damageType: "all" } };
    const extra = { ...skill("special", "attack"), levelValues: { 5: { effects: [redirect] } } };
    const defs = [...definitions, extra];
    const result = enumerateBodyCombinations(domain(defs), { definitions: defs, preprocess: true });
    expect(result.rows.some((row) => row.memberSkillIds[0] === "special")).toBe(true);
    expect(result.rows.some((row) => row.memberSkillIds[3] === "special")).toBe(true);
  });
});
