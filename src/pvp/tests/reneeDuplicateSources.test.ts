import { describe, expect, it } from "vitest";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, CONFIRMED_TROOP_SKILL_DEFINITIONS, createActiveEffect, createBattleState, createConfirmedHeroFormation,
  createHeroSkillSystem, createTroopSkillSystem, createSeededRandomSource, resolveRound, simulateBattle, type BattleState } from "../../pvp";
import { summarizeBattleSkills } from "../validationUi/skillSummary";
import { makeSide } from "./helpers";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { defaultOptimizationConfig } from "../optimizer";
import { createEffectSignature, stateBindings } from "../optimizer/criterion/signatures";
import { createBodySkillSignature, createBodyComboSignature } from "../optimizer/criterion/bodyPreprocess";
import { compileCriterionTemplate, prepareCriterionState } from "../optimizer/criterion/compiler";
import { createJointCoefficientTable, combineJointCoefficients } from "../optimizer/jointPipeline/coefficients";
import { createExpectationProgram } from "../optimizer/theory/expectationProgram";
import { defaultTheoryOptions } from "../optimizer/theory";
import { resolveBodySkillConfigs } from "../validationUi";
import { controlledReneeChainState, reneeDecapitationReference } from "./fixtures/reneeDecapitationChain";

const MARK = "hero-skill.ruini.dream-mark", CATCH = "hero-skill.ruini.dream-catcher", FRAGMENT = "hero-skill.ruini.dream-fragment";
function battle(m: number, bonuses = false): BattleState {
  const heroes = createConfirmedHeroFormation(Array.from({ length: m }, (_, i) => ({
    heroId: "hero.s6.ruini", position: i === 0 ? "leader" as const : "member" as const,
    runtimeInstanceId: `A-renee-${i}`, ...(i === 0 ? {} : { selectedMemberSkillId: MARK }),
  }))).map((hero) => ({ ...hero, skillStates: hero.skillStates.map((s) => ({ ...s,
    enabled: s.skillId === MARK || bonuses && (s.skillId === CATCH || s.skillId === FRAGMENT),
  })) }));
  return createBattleState({ sideA: { ...makeSide({ lancer: 100, marksman: 100 }, { maxHpPerUnit: 1e12 }), heroStates: heroes },
    sideB: makeSide({ shield: 100, marksman: 100 }, { maxHpPerUnit: 1e12 }) });
}
function system() { return createHeroSkillSystem({ definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
  randomSource: { next() { throw new Error("DreamMark must not consume RNG"); } } }); }

describe("Renee duplicate-source damage is separate from report activation count", () => {
  it.each([1, 2, 3, 4, 5])("m=%d merges to m+1 B, one mark, and 750*m report activations", (m) => {
    const run = simulateBattle(battle(m), { maxRounds: 1500, heroSkillSystem: system() });
    expect(run.trace.rounds).toHaveLength(1500);
    expect(summarizeBattleSkills(run.trace).find((s) => s.side === "A" && s.skillId === MARK)?.actualActivationCount).toBe(750 * m);
    expect(summarizeBattleSkills(run.trace).find((s) => s.side === "A" && s.skillId === MARK)?.activationByTargetTroop.shield).toBe(750 * m);
    const extras = run.trace.rounds.flatMap((r) => r.damageEvents.filter((e) => e.sourceSkillId === MARK));
    expect(extras).toHaveLength(749);
    expect(extras.every((e) => e.skillCoefficient === m + 1 && e.damageType === "skillDamage" && e.damageSubtype === "extraDamage")).toBe(true);
    expect(extras.every((e) => e.roundedDamage === Math.round(e.modifiedDamage))).toBe(true);
    const r2 = run.rounds[1]!;
    const marks = r2.stateAfterActionPhase.sideB.troops.shield.debuffs.filter((e) => e.definition.kind === "targetBoundMark");
    expect(marks).toHaveLength(1); expect(marks[0]!.stackCount).toBe(1);
    const payload = run.trace.rounds[2]!.heroSkills.find((s) => s.reason === "targetBoundMarkDamage");
    expect(payload).toMatchObject({ dreamMarkSourceCount: m, dreamMarkDamageCoefficient: m + 1, dreamMarkStackingStatus: "PROVISIONAL" });
    for (const hero of run.finalState.sideA.heroStates) expect(hero.skillStates.find((s) => s.skillId === MARK))
      .toMatchObject({ triggerCount: 750, mainAttackCounts: { lancer: 1500 } });
  });
  it.each([1, 2, 3, 4, 5])("m=%d does not multiply the marked-target second/third skills", (m) => {
    let state = battle(m, true); const heroSkillSystem = system();
    state = resolveRound(state, { heroSkillSystem }).stateAfter;
    state = resolveRound(state, { heroSkillSystem }).stateAfter;
    const round = resolveRound(state, { heroSkillSystem });
    const lancer = round.trace.damageEvents.find((e) => e.sourceSide === "A" && e.sourceTroop === "lancer" && e.damageType === "normalAttack")!;
    const marksman = round.trace.damageEvents.find((e) => e.sourceSide === "A" && e.sourceTroop === "marksman" && e.damageType === "normalAttack")!;
    expect(lancer.increaseGroups.find((g) => g.group === "dreamMarkDamage")?.summedValue).toBe(2.25);
    expect(marksman.increaseGroups.find((g) => g.group === "dreamMarkDamage")?.summedValue).toBe(.75);
  });
  it("keeps next-round payloads bound to yesterday's target even when today's main targets shield", () => {
    const heroSkillSystem = system();
    let state = resolveRound(battle(2), { heroSkillSystem }).stateAfter;
    const second = resolveRound(state, { heroSkillSystem, ambushTriggered: { A: true } });
    state = second.stateAfter;
    const third = resolveRound(state, { heroSkillSystem, ambushTriggered: { A: false } });
    expect(second.trace.damageEvents.find((e) => e.sourceSide === "A" && e.sourceTroop === "lancer")?.targetTroop).toBe("marksman");
    expect(third.trace.damageEvents.find((e) => e.sourceSkillId === MARK)).toMatchObject({ targetTroop: "marksman", skillCoefficient: 3 });
    const dead = { ...state, sideB: { ...state.sideB, troops: { ...state.sideB.troops,
      marksman: { ...state.sideB.troops.marksman, aliveCount: 0, frontUnitHp: 0,
        levelComposition: state.sideB.troops.marksman.levelComposition.map((entry) => ({ ...entry, aliveCount: 0 })) } } } };
    expect(resolveRound(dead, { heroSkillSystem, ambushTriggered: { A: false } }).trace.damageEvents.some((e) => e.sourceSkillId === MARK)).toBe(false);
  });
  it("keeps the same seed reproducible and adds no RNG draws when adding four mark sources", () => {
    const run = (m: number) => {
      const base = battle(m), greg = createConfirmedHeroFormation([{ heroId: "hero.s3.gelaige", position: "leader" }])[0]!;
      const state = { ...base, sideA: { ...base.sideA, heroStates: [...base.sideA.heroStates, greg] } };
      const source = createSeededRandomSource(502926396); let draws = 0;
      const result = simulateBattle(state, { maxRounds: 8, heroSkillSystem: createHeroSkillSystem({ definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
        randomSource: { next() { draws++; return source.next(); } } }) });
      return { result, draws };
    };
    expect(run(2)).toEqual(run(2)); expect(run(1).draws).toBe(run(5).draws);
  });
  it("keeps duplicate marks and delayed skill damage when normal attacks are dodged", () => {
    const base = battle(2), dodge = "hero-skill.lingnai.swift-shadow-dance";
    const run = simulateBattle({ ...base, sideB: { ...base.sideB,
      heroStates: createConfirmedHeroFormation([{ heroId: "hero.s4.lingnai", position: "leader" }]) } },
    { maxRounds: 3, heroSkillSystem: createHeroSkillSystem({ definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
      randomSource: { next: () => .99 }, triggerOverrides: { [dodge]: true } }) });
    expect(run.trace.rounds[1]!.damageEvents.find((e) => e.sourceSide === "A" && e.sourceTroop === "lancer")?.mainHitCancelled).toBe(true);
    expect(run.trace.rounds[2]!.damageEvents.find((e) => e.sourceSkillId === MARK)).toMatchObject({ skillCoefficient: 3, damageType: "skillDamage" });
  });
  it("does not advance any duplicate mark counter while the lancer action is stunned", () => {
    const base = battle(2), stun = createActiveEffect({ identity: { sourceId: "test", sourceSkillId: "test", effectId: "stun" },
      definition: { id: "stun", name: "stun", kind: "skipNextRoundAction", ruleStatus: "supported",
        lifecycle: { durationRounds: 1, activationTiming: "immediate", refreshMode: "replace" } }, appliedRound: 1, holderScope: "lancer" });
    const first = resolveRound({ ...base, sideA: { ...base.sideA, troops: { ...base.sideA.troops,
      lancer: { ...base.sideA.troops.lancer, debuffs: [stun] } } } }, { heroSkillSystem: system() });
    for (const hero of first.stateAfter.sideA.heroStates) expect(hero.skillStates.find((s) => s.skillId === MARK)?.mainAttackCounts.lancer).toBe(0);
    expect(first.trace.heroSkills.some((s) => s.skillId === MARK)).toBe(false);
    const second = resolveRound(first.stateAfter, { heroSkillSystem: system() });
    const third = resolveRound(second.stateAfter, { heroSkillSystem: system() });
    expect(third.trace.heroSkills.filter((s) => s.skillId === MARK && s.triggered)).toHaveLength(2);
    expect(third.trace.damageEvents.some((e) => e.sourceSkillId === MARK)).toBe(false);
  });
  it.each([1, 2, 3, 4, 5])("m=%d uses m+1 in features, Criterion and round Theory", (m) => {
    const state = battle(m), bindings = stateBindings(state, "A"), signature = createEffectSignature(bindings, "renee");
    const features = bindings.map((b) => createBodySkillSignature(b.skill as typeof CONFIRMED_HERO_SKILL_DEFINITIONS[number], 5));
    const combo = createBodyComboSignature(Array(m).fill(MARK), features, signature);
    expect(combo.delayedSkillCoefficient).toBe(m + 1); expect(combo.averageDelayedSkillPerAttack).toBe((m + 1) / 2);
    const head = prepareCriterionState(battle(1));
    const body = createEffectSignature(bindings.slice(1), "bodies");
    const criterion = compileCriterionTemplate(head, body).a;
    expect(criterion.channels.filter((c) => c.kind === "skillDamage" && c.source === 1).reduce((sum, c) => sum + c.coefficient, 0)).toBe((m + 1) / 2);
    const options = defaultTheoryOptions(), counts = [[100, 100, 100], [100, 100, 100]];
    const program = createExpectationProgram(state, options, new Set()), baseline = createExpectationProgram(state, options, new Set([MARK]));
    const runtime = program.createRuntime(), baselineRuntime = baseline.createRuntime();
    for (let round = 1; round <= 2; round++) {
      expect(program.runRound(round, counts, 1, runtime).damage).toEqual(baseline.runRound(round, counts, 1, baselineRuntime).damage);
    }
    const third = program.runRound(3, counts, 1, runtime), normal = baseline.runRound(3, counts, 1, baselineRuntime);
    // Unit lancer B=3, sqrt(n)=10; one independent locked-target event at R3.
    expect(third.damage[1]![0]! - normal.damage[1]![0]!).toBeCloseTo(30 * (m + 1));
  });
  it.each([false, true])("J merges Head and Body jointly (Head Renee=%s), including two Bodies", (headRenee) => {
    const base = createDefaultValidationInput(), m = 2;
    const bodies = resolveBodySkillConfigs([MARK, MARK], [], "s12");
    const input = { ...base, serverStage: "s12" as const, scenarioType: "RALLY" as const, battleContext: "rally" as const,
      attributeInputMode: "prediction" as const,
      disabledSkillIds: [...CONFIRMED_HERO_SKILL_DEFINITIONS, ...CONFIRMED_TROOP_SKILL_DEFINITIONS].filter((s) => s.id !== MARK).map((s) => s.id),
      sideA: { ...base.sideA, leaderHeroIds: {}, bodySkills: [], selectedMemberSkillIds: [] },
      sideB: { ...base.sideB, leaderHeroIds: {}, bodySkills: [], selectedMemberSkillIds: [] } };
    const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((s) => s.id === MARK)!;
    const signature = createEffectSignature(bodies.map((b) => ({ skill: definition, level: 5, runtimeId: b.runtimeInstanceId! })), "body");
    const semantic = createBodyComboSignature([MARK, MARK], bodies.map(() => createBodySkillSignature(definition)), signature);
    const table = createJointCoefficientTable(input, defaultOptimizationConfig(),
      [{ leaderHeroIds: headRenee ? { lancer: "hero.s6.ruini" } : {}, memberSkillIds: [] }], [{ ids: [MARK, MARK], signature, semantic }]);
    const s = new Float64Array(3), o = new Float64Array(3);
    combineJointCoefficients(table, 0, 0, s, o, new Float64Array(12));
    // Retains J's existing 20-round horizon: procs R2,4,...18 settle R3,5,...19 (9 events).
    expect(table.bodyChannels[4]).toBeCloseTo((m + 1) * 9 / 20);
    expect(o[1]! / table.headBase[4]! - 1).toBeCloseTo((m + (headRenee ? 1 : 0) + 1) * 9 / 20);
  });
  it("preserves the controlled R20 ambush / double mark → R21 3B burst chain", () => {
    const sword = "hero-skill.gelaige.sword-of-justice", law = "hero-skill.gelaige.law-deterrence";
    const overrides = Object.fromEntries(CONFIRMED_HERO_SKILL_DEFINITIONS.filter((s) => s.probability !== undefined).map((s) => [s.id, false]));
    const heroSkillSystem = createHeroSkillSystem({ definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
      randomSource: createSeededRandomSource(reneeDecapitationReference.seed),
      triggerOverrides: { ...overrides, [`19:A:${sword}`]: true, [`20:A:lancer:${law}`]: true } });
    const troopSkillSystem = createTroopSkillSystem({ definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS });
    let state = controlledReneeChainState();
    for (let round = 1; round <= 21; round++) {
      const result = resolveRound(state, { heroSkillSystem, troopSkillSystem, ambushTriggered: { A: round === 20, B: false } });
      if (round === 20) {
        const marks = result.trace.heroSkills.filter((s) => s.skillId === MARK && s.side === "A" && s.reason === "deterministic" && s.triggered);
        expect(marks).toHaveLength(2); expect(marks.every((s) => s.dreamMarkTarget === "marksman")).toBe(true);
        expect(result.trace.heroSkills.find((s) => s.skillId === law && s.sourceTroop === "lancer")).toMatchObject({ triggered: true, targetTroop: "marksman" });
      }
      if (round === 21) {
        const payload = result.trace.damageEvents.find((e) => e.sourceSkillId === MARK)!;
        expect(payload).toMatchObject({ targetTroop: "marksman", skillCoefficient: 3, damageType: "skillDamage" });
        expect(payload.increaseGroups.find((g) => g.group === "commonDamageIncrease")?.summedValue).toBeCloseTo(1.9);
        expect(payload.increaseGroups.find((g) => g.group === "troopCounterDamage")?.summedValue).toBeCloseTo(.1);
        expect(payload.attributeResolutions?.find((r) => r.attribute === "defense")?.reductionGroups.find((g) => g.group === "enemyDefenseReduction")?.summedValue).toBe(.25);
      }
      state = result.stateAfter;
    }
  });
});
