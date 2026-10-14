import { describe, expect, it } from "vitest";
import { createBattleState, createHeroStateFromDefinitions, createHeroSkillSystem, resolveRound,
  CONFIRMED_HERO_SKILL_DEFINITIONS, type BattleContext, type HeroSkillDefinition } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createOptimizationContext, auditOptimizationRoleState, skillRoleApplicability } from "../optimizer/optimizationContext";
import { enumerateBodyCombinations, enumeratePreprocessedBodyPool, generateBodyEnumerationDomain,
  type BodyEnumerationDomain } from "../optimizer/criterion/bodyEnumeration";
import { makeSide } from "./helpers";
import { createConfirmedHeroState } from "../heroSkills";
import { stateBindings } from "../optimizer/criterion/signatures";
import { createBodyMarginalModel, prepareBodyMarginalContext, roughBodyMarginalScore } from "../optimizer/criterion/bodyPreprocess";

const context = (side: "A" | "B", scenarioType = "RALLY" as "RALLY" | "SINGLE") =>
  createOptimizationContext({ scenarioType, battleContext: scenarioType === "RALLY" ? "rally" : "challenge" }, side);
const skill = (id: string, contexts?: readonly BattleContext[]): HeroSkillDefinition => ({
  id, heroId: id, name: id, trigger: "passive", activationTiming: "immediate",
  positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: 1, allowedPositions: ["leader", "member"] },
  ...(contexts ? { battleContexts: contexts } : {}),
  levelValues: { 5: { effects: [{ id: `${id}.effect`, name: id, kind: "attributeModifier", recipient: "selfArmy",
    attribute: id==="defense"?"defense":id==="garrison"?"life":id==="universal"?"penetration":"attack", operation: "multiplyAttributeFactor", group: `hero${id}Bonus`, value: .1,
    scope: { source: "army", target: "all", damageType: "all" } }] } },
  metadata: { ruleStatus: "supported", source: "role applicability regression" } });
const attack = skill("attack", ["rallyAttack"]), defense = skill("defense", ["rallyDefense"]),
  garrison = skill("garrison", ["garrisonDefense"]), universal = skill("universal");

describe("optimization side identity and scenario applicability", () => {
  it("has symmetric SINGLE A/B identities without implicit attacker or defender roles", () => {
    expect(context("A", "SINGLE")).toMatchObject({ battleScenario: "single", candidateSide: "A", rallyRole: null,
      fixedOpponentSide: "B", optimizationObjective: "candidateSideWinRate" });
    expect(context("B", "SINGLE")).toMatchObject({ battleScenario: "single", candidateSide: "B", rallyRole: null,
      fixedOpponentSide: "A", optimizationObjective: "candidateSideWinRate" });
    expect(skillRoleApplicability(attack, 5, context("A", "SINGLE")).reason).toBe("inactiveInCurrentScenario");
    expect(skillRoleApplicability(attack, 5, context("B", "SINGLE")).reason).toBe("inactiveInCurrentScenario");
  });

  it("reuses the formal A rallyAttack / B rallyDefense-or-garrison mapping without swapping input", () => {
    expect(context("A").rallyRole).toBe("attacker");
    expect(context("B").rallyRole).toBe("defender");
    for (const side of ["A", "B"] as const) {
      const definitions = [attack, defense, garrison, universal];
      const heroes = definitions.map((definition, index) => createHeroStateFromDefinitions({ heroId: definition.heroId,
        position: "member", runtimeInstanceId: `${side}-body-${index}`, selectedMemberSkillId: definition.id }, definitions));
      const state = createBattleState({ sideA: { ...makeSide({ shield: 100 }), ...(side === "A" ? { heroStates: heroes } : {}) },
        sideB: { ...makeSide({ shield: 100 }), ...(side === "B" ? { heroStates: heroes } : {}) }, battleContext: "rally" });
      const official = resolveRound(state, { heroSkillSystem: createHeroSkillSystem({ definitions }) });
      for (const definition of definitions) {
        const applicability = skillRoleApplicability(definition, 5, context(side));
        const trace = official.trace.heroSkills.find((row) => row.side === side && row.skillId === definition.id)!;
        expect(trace).toBeDefined();
        expect(trace.triggered).toBe(applicability.activeInCurrentRole);
        if (!applicability.activeInCurrentRole) expect(trace.reason).toBe("battleContextMismatch");
      }
      const audit = auditOptimizationRoleState(state, context(side), definitions);
      expect(audit.bodyEffectsActiveByRole).toEqual(side === "A" ? ["attack.effect", "universal.effect"] :
        ["defense.effect", "garrison.effect", "universal.effect"]);
      expect(audit.bodyEffectsInactiveByRole).toEqual(side === "A" ? ["defense.effect", "garrison.effect"] : ["attack.effect"]);
    }
  });

  it("preserves explicit garrison formal contexts for the same applicability helper", () => {
    expect(skillRoleApplicability(garrison, 5, context("B"), true, "garrisonDefense").activeInCurrentRole).toBe(true);
    expect(skillRoleApplicability(attack, 5, context("B"), true, "garrisonDefense").activeInCurrentRole).toBe(false);
    expect(skillRoleApplicability(defense, 5, context("B"), true, "garrisonDefense").activeInCurrentRole).toBe(false);
  });

  it("filters completely role-inactive body skills before body materialization and audits them separately", () => {
    const definitions = [attack, defense, garrison, universal];
    const domain: BodyEnumerationDomain = { sources: definitions.map((definition) => ({ heroId: definition.heroId,
      skillId: definition.id, effectKey: definition.id })), fixedMemberSkillIds: [], fixedBodyExact: false,
      requiredBodyHeroIds: [], allowDuplicateMembers: true, equivalentMemberPositions: false, disabledSkillIds: [],
      levelForSlot: () => 5, optimizationContext: context("B") };
    const result = enumerateBodyCombinations(domain, { definitions });
    expect(result.rows.flatMap((row) => row.memberSkillIds)).not.toContain("attack");
    expect(result.audit.bodiesRejectedAsInactiveInCurrentRole).toBe(1);
    expect(result.audit.bodyEffectsInactiveByRole).toEqual(["attack.effect"]);
    expect(result.audit.bodyCombinationsRejectedAsInactiveInCurrentRole).toBeGreaterThan(0);
    // Role pruning is not misreported as strict skill dominance.
    expect(result.audit.rejectedByStrictDominance).toBe(0);
  });

  it("uses candidate B's skill levels and runtime IDs while retaining SR bodies at S11", () => {
    const base = createDefaultValidationInput(), id = "hero-skill.shuyun.attack";
    const input = { ...base, scenarioType: "RALLY" as const, serverStage: "s11" as const,
      rallyBodyPoolIds: ["hero.body.shuyun", "hero.body.jiexi", "hero.sr.patelike", "hero.sr.xieergai"],
      sideB: { ...base.sideB, bodySkills: [{ heroId: "hero.sr.shuyun", skillId: id,
        expeditionSkillSlot: 1 as const, skillLevel: 3 }] } };
    const domain = generateBodyEnumerationDomain(input, {}, {}, "B");
    expect(domain.sources.some((source) => source.skillId === id)).toBe(true);
    expect(domain.levelForSlot(id, 0)).toBe(3);
    const result = enumeratePreprocessedBodyPool(input, { fixedBodyExact: true,
      fixedMemberSkillIds: [id, "hero-skill.jiexi.penetration", "hero-skill.patelike.life", "hero-skill.xieergai.guardian-power"] }, {}, { candidateSide: "B" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.bodySlots.map((slot) => slot.runtimeInstanceId)).toEqual(["B-body-0", "B-body-1", "B-body-2", "B-body-3"]);
    expect(result.rows[0]!.bodySlots[0]!.level).toBe(3);
  });

  it("lists real exclusive weapon effects by role using the registry's unchanged values", () => {
    const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((row) => row.id === "hero-weapon-skill.heluonimo.rally-attack")!;
    expect(definition).toBeDefined();
    expect(skillRoleApplicability(definition, 5, context("A")).activeInCurrentRole).toBe(true);
    expect(skillRoleApplicability(definition, 5, context("B")).activeInCurrentRole).toBe(false);
    const heroes = ["hero.s1.heluonimo", "hero.s1.moli"].map((heroId) => createConfirmedHeroState({ heroId,
      position: "leader", weaponLevel: 10 }));
    const state = createBattleState({ sideA: { ...makeSide({ shield: 100, lancer: 100 }), heroStates: heroes },
      sideB: { ...makeSide({ shield: 100, lancer: 100 }), heroStates: heroes }, battleContext: "rally" });
    const attackBindings = stateBindings(state, "A"), defenseBindings = stateBindings(state, "B");
    expect(attackBindings.some((binding) => binding.skill.id === "hero-weapon-skill.heluonimo.rally-attack")).toBe(true);
    expect(attackBindings.some((binding) => binding.skill.id === "hero-weapon-skill.moli.defense-penetration")).toBe(false);
    expect(defenseBindings.some((binding) => binding.skill.id === "hero-weapon-skill.heluonimo.rally-attack")).toBe(false);
    expect(defenseBindings.some((binding) => binding.skill.id === "hero-weapon-skill.moli.defense-penetration")).toBe(true);
    const audit = auditOptimizationRoleState(state, context("B"));
    expect(audit.weaponEffectsActiveByRole.length).toBeGreaterThan(0);
    expect(audit.weaponEffectsInactiveByRole.length).toBeGreaterThan(0);
    expect(audit.roleEffectApplicability.find((row) => row.skillId === "hero-weapon-skill.heluonimo.rally-attack")!.reason)
      .toBe("inactiveInCurrentRallyRole");
  });

  it("keeps marginal same-group arithmetic and cache identity symmetric for candidate A/B", () => {
    const definitions = [universal], domain: BodyEnumerationDomain = { sources: [{ heroId: universal.heroId,
      skillId: universal.id, effectKey: universal.id }], fixedMemberSkillIds: [universal.id], fixedBodyExact: true,
      requiredBodyHeroIds: [], allowDuplicateMembers: true, equivalentMemberPositions: false, disabledSkillIds: [], levelForSlot: () => 5 };
    const bodies = enumerateBodyCombinations(domain, { definitions, preprocess: true }).bodies;
    const model = createBodyMarginalModel(bodies), state = createBattleState({ sideA: makeSide({ shield: 100 }),
      sideB: makeSide({ shield: 100 }), battleContext: "rally" });
    const ratios = { shield: 100, lancer: 0, marksman: 0 };
    const a = prepareBodyMarginalContext(state, ratios, model, undefined, "A"),
      b = prepareBodyMarginalContext(state, ratios, model, undefined, "B");
    expect(a.head).not.toBe(b.head);
    expect(roughBodyMarginalScore(bodies[0]!.semantic, a)).toBeCloseTo(roughBodyMarginalScore(bodies[0]!.semantic, b));
    expect(prepareBodyMarginalContext(state, ratios, model, undefined, "A").head).toBe(a.head);
    expect(prepareBodyMarginalContext(state, ratios, model, undefined, "B").head).toBe(b.head);
  });
});
