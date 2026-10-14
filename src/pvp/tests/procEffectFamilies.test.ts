import { describe, expect, it } from "vitest";
import { MIA_DOOM_ENTANGLEMENT, createBattleState, createConfirmedHeroState,
  createHeroSkillSystem, createHeroStateFromDefinitions, resolveRound, simulateBattle,
  createSeededRandomSource, type HeroSkillDefinition } from "../../pvp";
import { makeSide } from "./helpers";
import { validateProcEffectFamily } from "../heroSkills/procEffectFamily";

const skill = MIA_DOOM_ENTANGLEMENT;
function state(count: number, unrelated = false) {
  const { procEffectFamilyId: _family, ...withoutFamily } = skill; void _family;
  const other: HeroSkillDefinition = { ...withoutFamily, id: "test.unrelated-vulnerability",
    heroId: "test.other",
    levelValues: { 5: { effects: skill.levelValues[5]!.effects.map((effect) =>
      ({ ...effect, id: "test.other.effect", ...("value" in effect ? { value: .25 } : {}) })) } } };
  return { initial: createBattleState({
    sideA: makeSide({ shield: 100 }, { maxHpPerUnit: 1e9 }),
    sideB: { ...makeSide({ shield: 100 }, { maxHpPerUnit: 1e9 }),
      heroStates: [...Array.from({ length: count }, (_, index) => createConfirmedHeroState({
        heroId: skill.heroId, position: "member", selectedMemberSkillId: skill.id,
        runtimeInstanceId: `B-body-${index + 1}` })),
      ...(unrelated ? [createHeroStateFromDefinitions({ heroId: other.heroId, position: "member",
        runtimeInstanceId: "B-other" }, [other])] : [])] } }),
    definitions: unrelated ? [skill, other] : [skill] };
}
describe("confirmed identical proc families", () => {
  it("requires explicit confirmed membership and rejects different values/timing", () => {
    expect(() => validateProcEffectFamily(skill)).not.toThrow();
    expect(() => validateProcEffectFamily({ ...skill, metadata: { ...skill.metadata, ruleStatus: "TENTATIVE" } }))
      .toThrow(/Unconfirmed/);
    expect(() => validateProcEffectFamily({ ...skill, levelValues: { 5: { effects: skill.levelValues[5]!.effects.map((effect) =>
      ({ ...effect, ...("value" in effect ? { value: .25 } : {}) })) } } })).toThrow(/does not match/);
  });
  it.each([[1, .5], [2, .75], [3, .875], [4, .9375]])(
    "%i independent sources have combined probability %f and one +50% effect", (count, probability) => {
      const fixture = state(count); let draws = 0;
      const result = resolveRound(fixture.initial, { heroSkillSystem: createHeroSkillSystem({
        definitions: fixture.definitions, randomSource: { next: () => { draws++; return .2; } } }) });
      expect(draws).toBe(count);
      expect(result.trace.procEffectFamilies).toHaveLength(1);
      expect(result.trace.procEffectFamilies![0]).toMatchObject({ familyCombinedProbability: probability,
        familyProcResult: true, generatedEffectValue: .5 });
      expect(result.trace.procEffectFamilies![0]!.familySources).toHaveLength(count);
      const effects = result.stateAfterActionPhase.sideA.troops.shield.debuffs;
      expect(effects).toHaveLength(1); expect(effects[0]!.stackCount).toBe(1);
      expect(effects[0]!.definition).toMatchObject({ group: "vulnerability", value: .5 });
      expect(result.stateAfter.sideB.heroStates.map((hero) => hero.runtimeInstanceId))
        .toEqual(Array.from({ length: count }, (_, i) => `B-body-${i + 1}`));
      expect(result.stateAfter.sideB.heroStates.map((hero) => hero.skillStates[0]!.triggerCount))
        .toEqual(Array(count).fill(1));
    });
  it("rolls failures independently, succeeds if any succeeds, and generates nothing if all fail", () => {
    for (const rolls of [[.9, .1], [.9, .9]]) {
      const fixture = state(2); let next = 0;
      const result = resolveRound(fixture.initial, { heroSkillSystem: createHeroSkillSystem({
        definitions: [skill], randomSource: { next: () => rolls[next++]! } }) });
      expect(next).toBe(2);
      expect(result.trace.procEffectFamilies![0]!.familySources.map((source) => source.procRoll)).toEqual(rolls);
      expect(result.trace.procEffectFamilies![0]!.generatedEffectValue).toBe(rolls[1] === .1 ? .5 : 0);
      expect(result.stateAfter.sideB.heroStates.map((hero) => hero.skillStates[0]!.triggerCount))
        .toEqual(rolls.map((roll) => roll < .5 ? 1 : 0));
    }
  });
  it("refreshes the same target without stacking or erasing the current-round effect", () => {
    const fixture = state(2);
    const result = simulateBattle(fixture.initial, { maxRounds: 4,
      heroSkillSystem: createHeroSkillSystem({ definitions: [skill], randomSource: { next: () => .1 } }) });
    expect(result.trace.rounds.map((round) => round.damageEvents.find((event) => event.sourceSide === "B")!
      .increaseGroups.find((group) => group.group === "vulnerability")?.summedValue ?? 0))
      .toEqual([0, .5, .5, .5]);
    expect(result.finalState.sideA.troops.shield.debuffs.every((effect) => effect.stackCount === 1)).toBe(true);
  });
  it("does not merge unrelated +25% vulnerability or unconfirmed reused templates", () => {
    const fixture = state(2, true);
    const result = simulateBattle(fixture.initial, { maxRounds: 2,
      heroSkillSystem: createHeroSkillSystem({ definitions: fixture.definitions,
        randomSource: { next: () => .1 } }) });
    expect(result.trace.rounds[1]!.damageEvents.find((event) => event.sourceSide === "B")!
      .increaseGroups.find((group) => group.group === "vulnerability")!.summedValue).toBe(.75);
  });
  it("keeps fixed-seed outcomes and per-source rolls reproducible", () => {
    const fixture = state(4);
    const run = () => simulateBattle(fixture.initial, { maxRounds: 5,
      heroSkillSystem: createHeroSkillSystem({ definitions: [skill], randomSource: createSeededRandomSource(91) }) });
    expect(run()).toEqual(run());
  });
  it("preserves RNG order across three troop main attacks and binds one family effect per target", () => {
    const fixture = state(2);
    const initial = createBattleState({ sideA: makeSide({ shield: 100, lancer: 100, marksman: 100 }, { maxHpPerUnit: 1e9 }),
      sideB: { ...makeSide({ shield: 100, lancer: 100, marksman: 100 }, { maxHpPerUnit: 1e9 }),
        heroStates: fixture.initial.sideB.heroStates } });
    const { procEffectFamilyId: _family, ...legacy } = skill; void _family;
    const rolls = [.1, .9, .2, .3, .8, .7];
    const run = (definition: HeroSkillDefinition) => {
      let next = 0;
      const result = resolveRound(initial, { heroSkillSystem: createHeroSkillSystem({ definitions: [definition],
        randomSource: { next: () => rolls[next++]! } }) });
      return { result, next, sources: result.trace.heroSkills.map((entry) =>
        [entry.runtimeInstanceId, entry.sourceTroop, entry.targetTroop, entry.procRoll, entry.procResult]) };
    };
    const current = run(skill), previous = run(legacy);
    expect(current.next).toBe(6); expect(current.sources).toEqual(previous.sources);
    expect(current.result.trace.procEffectFamilies).toHaveLength(3);
    expect(current.result.trace.procEffectFamilies!.map((family) => family.familyCombinedProbability))
      .toEqual([.75, .75, .75]);
    expect(current.result.stateAfterActionPhase.sideA.troops.shield.debuffs).toHaveLength(1);
  });
});
