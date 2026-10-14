import { describe, expect, it } from "vitest";
import { candidateToInput, createBattleState, createConfirmedHeroFormation,
  createConfirmedHeroState, createHeroSkillSystem, createHeroStateFromDefinitions,
  createValidationPreviewState, generateFormations, resolveBodySkillConfigs,
  resolveRound, runValidationBattle, type HeroSkillDefinition } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { makeSide } from "./helpers";

const HERO = "hero.body.shuyun";
const SKILL = "hero-skill.shuyun.attack";
function input() {
  const base = createDefaultValidationInput();
  return { ...base, scenarioType: "RALLY" as const, battleContext: "rally" as const,
    attributeInputMode: "prediction" as const, maxRounds: 2,
    sideA: { ...base.sideA, leaderHeroId: null, leaderHeroIds: {},
      selectedMemberSkillIds: [SKILL, SKILL, SKILL, SKILL],
      bodySkills: resolveBodySkillConfigs([SKILL, SKILL, SKILL, SKILL], [], "s16"),
      rallyDeployment: { totalTroops: 10000, ratios: { shield: 100, lancer: 0, marksman: 0 } } } };
}

describe("rally definition and runtime identity", () => {
  it("runs Shuyun x4 with stable slot IDs and four separate passive sources", () => {
    const configured = input(), result = runValidationBattle(configured);
    const heroes = result.initialState.sideA.heroStates;
    expect(heroes.map((hero) => hero.heroDefinitionId)).toEqual([HERO, HERO, HERO, HERO]);
    expect(heroes.map((hero) => hero.runtimeInstanceId)).toEqual(
      ["A-body-0", "A-body-1", "A-body-2", "A-body-3"]);
    expect(createValidationPreviewState(configured).sideA.heroStates).toEqual(heroes);
    const sources = result.trace.rounds[0]!.heroSkills.filter((entry) =>
      entry.side === "A" && entry.skillId === SKILL && entry.triggered);
    expect(new Set(sources.map((entry) => entry.runtimeInstanceId)).size).toBe(4);
    expect(new Set(sources.flatMap((entry) => entry.producedActiveEffectIds)).size).toBe(4);
  });
  it("rejects true duplicate or empty instance IDs while retaining leader definition rules", () => {
    const member = createConfirmedHeroState({ heroId: HERO, position: "member",
      selectedMemberSkillId: SKILL, runtimeInstanceId: "duplicate" });
    expect(() => createBattleState({ sideA: { ...makeSide({ shield: 100 }),
      heroStates: [member, member] }, sideB: makeSide({ shield: 100 }) }))
      .toThrow(/runtimeInstanceId.*unique/);
    expect(() => createBattleState({ sideA: { ...makeSide({ shield: 100 }),
      heroStates: [{ ...member, runtimeInstanceId: " " }] }, sideB: makeSide({ shield: 100 }) }))
      .toThrow(/runtimeInstanceId/);
    expect(() => createConfirmedHeroFormation([
      { heroId: HERO, position: "leader", runtimeInstanceId: "leader-1" },
      { heroId: HERO, position: "leader", runtimeInstanceId: "leader-2" }]))
      .toThrow(/Duplicate hero/);
  });
  it("isolates per-action proc counts, cooldowns and buff owners between same-definition instances", () => {
    const definition: HeroSkillDefinition = { id: "synthetic.member.proc", heroId: "synthetic.member",
      name: "proc", positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: 1,
        allowedPositions: ["member"] }, trigger: "beforeAttack", activationTiming: "immediate",
      levelValues: { 5: { probability: .5, cooldownRounds: 2, effects: [{
        id: "synthetic.proc.damage", name: "proc damage", kind: "damageIncrease",
        group: "normalDamageIncrease", value: .1, recipient: "selfArmy",
        scope: { source: "shield", damageType: "normalAttack" } }] } },
      metadata: { ruleStatus: "supported", source: "test", tags: ["criticalNormalAttack"] } };
    const heroes = [0, 1, 2, 3].map((slot) => createHeroStateFromDefinitions({
      heroId: definition.heroId, position: "member", runtimeInstanceId: `A-body-${slot}` }, [definition]));
    const rolls = [.1, .9, .2, .8]; let next = 0;
    const result = resolveRound(createBattleState({
      sideA: { ...makeSide({ shield: 100 }, { maxHpPerUnit: 1e9 }), heroStates: heroes },
      sideB: makeSide({ shield: 100 }, { maxHpPerUnit: 1e9 }) }), {
      heroSkillSystem: createHeroSkillSystem({ definitions: [definition],
        randomSource: { next: () => rolls[next++]! } }) });
    expect(next).toBe(4);
    expect(result.stateAfter.sideA.heroStates.map((hero) => hero.skillStates[0]!.triggerCount))
      .toEqual([1, 0, 1, 0]);
    expect(result.stateAfter.sideA.heroStates.map((hero) => hero.skillStates[0]!.cooldown))
      .toEqual([2, 0, 2, 0]);
    expect(result.stateAfter.sideA.heroStates.map((hero) => hero.skillStates[0]!.ownerRuntimeInstanceId))
      .toEqual(["A-body-0", "A-body-1", "A-body-2", "A-body-3"]);
  });
  it("migrates heroId-only body configs and preserves reproducible IDs across save/restore", () => {
    const configured = input(), saved = createPersistedEnvelope(configured, 1000);
    const legacy = JSON.parse(JSON.stringify(saved));
    for (const body of legacy.data.input.sideA.bodySkills) {
      delete body.heroDefinitionId; delete body.runtimeInstanceId;
    }
    const restored = restorePersistedConfig(legacy).input;
    expect(restored.sideA.bodySkills?.map((body) => body.runtimeInstanceId)).toEqual(
      ["A-body-0", "A-body-1", "A-body-2", "A-body-3"]);
    expect(runValidationBattle(restored).trace).toEqual(runValidationBattle(configured).trace);
    const again = restorePersistedConfig(createPersistedEnvelope(restored, 1000)).input;
    expect(again.sideA.bodySkills).toEqual(restored.sideA.bodySkills);
  });
  it("supports definitionId in saved bodies and generates B's own stable slots", () => {
    const configured = input(), saved = JSON.parse(JSON.stringify(createPersistedEnvelope(configured, 1000)));
    saved.data.input.sideB.bodySkills = saved.data.input.sideA.bodySkills.map((body: Record<string, unknown>) => {
      const { heroId: _legacy, runtimeInstanceId: _oldSlot, ...rest } = body;
      void _legacy; void _oldSlot; return rest;
    });
    const restored = restorePersistedConfig(saved).input;
    expect(createValidationPreviewState(restored).sideB.heroStates.filter((hero) => hero.position === "member")
      .map((hero) => hero.runtimeInstanceId)).toEqual(["B-body-0", "B-body-1", "B-body-2", "B-body-3"]);
  });
  it("rejects optimizer same-effect x4 while preserving manually configured runtime identities", () => {
    const configured = input();
    expect(generateFormations(configured, { fixedMemberSkillIds: [SKILL, SKILL, SKILL, SKILL],
      fixedBodyExact: true }, 8)).toHaveLength(0);
    const candidate = candidateToInput(configured, { leaderHeroIds: {}, memberSkillIds: [SKILL, SKILL, SKILL, SKILL],
      ratios: { shield: 100, lancer: 0, marksman: 0 } });
    expect(new Set(candidate.sideA.bodySkills?.map((body) => body.runtimeInstanceId)).size).toBe(4);
    expect(() => createValidationPreviewState(candidate)).not.toThrow();
  });
});
