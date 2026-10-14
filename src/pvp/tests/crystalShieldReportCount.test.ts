import { describe, expect, it, vi } from "vitest";
import {
  GWEN_DEMOLITION_SQUAD, LANCER_CRIMSON_FIELD, MARKSMAN_CRYSTAL_POWDER,
  MARKSMAN_RAPID_FIRE, SHIELD_CRYSTAL_SHIELD,
  createBattleState, createHeroSkillSystem, createHeroStateFromDefinitions,
  createTroopSkillRuntimeState, createTroopSkillSystem, formatBattleTrace, getBattleReportSkillTriggerCount,
  resolveRound, runBatchSimulation, runValidationBattle, summarizeBattleSkills,
  type AdditionalDamageGenerator, type BattleState, type BattleTrace,
  type TroopSkillReportActivation, type ValidationSideInput,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { makeSide } from "./helpers";

const CRYSTAL = SHIELD_CRYSTAL_SHIELD.id;
const RAPID = MARKSMAN_RAPID_FIRE.id;
const definitions = [SHIELD_CRYSTAL_SHIELD, MARKSMAN_RAPID_FIRE,
  MARKSMAN_CRYSTAL_POWDER, LANCER_CRIMSON_FIELD];
const hugeHp = 1_000_000_000;

function battle(counter = false, crimson = false, powder = false): BattleState {
  const defender = crimson ? LANCER_CRIMSON_FIELD : SHIELD_CRYSTAL_SHIELD;
  const sideA = makeSide({ marksman: 100 }, {
    maxHpPerUnit: hugeHp,
    skillStates: { marksman: [createTroopSkillRuntimeState(RAPID, 1),
      ...(powder ? [createTroopSkillRuntimeState(MARKSMAN_CRYSTAL_POWDER.id, 2)] : [])] },
  });
  return createBattleState({
    sideA: {
      ...sideA,
      troops: { ...sideA.troops, marksman: { ...sideA.troops.marksman, attack: .0044 } },
      heroStates: counter ? [createHeroStateFromDefinitions({
        heroId: GWEN_DEMOLITION_SQUAD.heroId, position: "leader",
      }, [GWEN_DEMOLITION_SQUAD])] : [],
    },
    sideB: makeSide({ [defender.troopType]: 100 }, {
      maxHpPerUnit: hugeHp,
      skillStates: { [defender.troopType]: [createTroopSkillRuntimeState(defender.id, 2)] },
    }),
  });
}

function system(rolls: readonly number[], rapid: boolean, recordTrace = true) {
  let cursor = 0;
  const next = vi.fn(() => {
    const roll = rolls[cursor++];
    if (roll === undefined) throw new Error("Unexpected extra RNG call.");
    return roll;
  });
  const onProbabilityDecision = vi.fn();
  const onReportActivation = vi.fn<(activation: TroopSkillReportActivation) => void>();
  return {
    next, onProbabilityDecision, onReportActivation,
    troopSkillSystem: createTroopSkillSystem({
      definitions, randomSource: { next }, recordTrace,
      triggerOverrides: { [RAPID]: rapid, [MARKSMAN_CRYSTAL_POWDER.id]: true },
      onProbabilityDecision, onReportActivation,
    }),
  };
}

function traceOf(rounds: readonly ReturnType<typeof resolveRound>[]): BattleTrace {
  return { rounds: rounds.map((round) => round.trace), endReason: "roundLimit", finalStatus: "ready" };
}
const main = (round: ReturnType<typeof resolveRound>) => round.trace.damageEvents.find(
  (event) => event.sourceSide === "A" && event.damageType === "normalAttack",
)!;
const report = (rounds: readonly ReturnType<typeof resolveRound>[], skillId = CRYSTAL) =>
  summarizeBattleSkills(traceOf(rounds)).find((entry) => entry.side === "B" && entry.skillId === skillId)!;

describe("Crystal Shield counts rapid-fire effect uses independently of combat proc state", () => {
  it.each([
    { success: true, rapid: false, expected: 1 },
    { success: false, rapid: false, expected: 0 },
    { success: true, rapid: true, expected: 2 },
    { success: false, rapid: true, expected: 0 },
  ])("success=$success, rapid=$rapid reports $expected activations with one Crystal roll", ({ success, rapid, expected }) => {
    const options = system([success ? .1 : .9], rapid);
    const afterNormalAttack = vi.fn<AdditionalDamageGenerator["afterNormalAttack"]>(() => []);
    const round = resolveRound(battle(true), {
      ...options,
      heroSkillSystem: createHeroSkillSystem({ definitions: [GWEN_DEMOLITION_SQUAD] }),
      additionalDamageGenerators: [{ id: "test:main-observer", afterNormalAttack }],
    });
    expect(options.next).toHaveBeenCalledTimes(1);
    expect(options.onProbabilityDecision.mock.calls.filter(([decision]) => decision.skillId === CRYSTAL))
      .toHaveLength(1);
    const crystal = round.trace.troopSkills.filter((entry) => entry.skillId === CRYSTAL);
    expect(crystal).toHaveLength(1);
    expect(crystal[0]).toMatchObject({ rngRoll: success ? .1 : .9, triggered: success });
    expect(report([round])).toMatchObject({
      probabilityCheckCount: 1, procSuccessCount: success ? 1 : 0,
      actualActivationCount: expected,
    });
    expect(round.stateAfter.sideB.troops.shield.skillStates[0]!.triggerCount).toBe(success ? 1 : 0);
    expect(round.stateAfter.sideA.heroStates[0]!.skillStates[0]!.mainAttackCounts)
      .toEqual({ shield: 0, lancer: 0, marksman: 1 });
    expect(afterNormalAttack.mock.calls.filter(([context]) => context.action.side === "A"))
      .toHaveLength(1);
    const event = main(round);
    const denominator = success ? 1.36 : 1;
    expect(event.receivedDamageReductionDenominator).toBeCloseTo(denominator);
    expect(event.targetTroop).toBe("shield");
    expect(event.internalSegments ?? []).toHaveLength(rapid ? 1 : 0);
    if (rapid) {
      const second = event.internalSegments![0]!;
      expect(second.modifiedDamage).toBeCloseTo(second.rawDamage / denominator, 12);
      expect(second.roundedDamage).toBe(Math.round(second.modifiedDamage));
      expect(event.primaryRoundedDamage).toBe(second.roundedDamage);
      expect(event.finalDamage).toBe(event.primaryRoundedDamage! + second.roundedDamage);
    }
    expect(options.onReportActivation).toHaveBeenCalledTimes(success && rapid ? 1 : 0);
    if (success && rapid) {
      expect(crystal[0]!.producedActiveEffectIds).toHaveLength(1);
      expect(crystal[0]!.reportActivationCount).toBe(2);
      expect(options.onReportActivation).toHaveBeenCalledWith(expect.objectContaining({
        side: "B", troop: "shield", skillId: CRYSTAL, count: 1,
        inheritedFromRootEventId: event.rootEventId,
      }));
      expect(formatBattleTrace(traceOf([round]))).toContain("reportActivationCount=2");
    }
  });

  it("keeps the existing per-segment Math.round damage: 295 + 295 = 590", () => {
    const round = resolveRound(battle(), system([.1], true));
    const event = main(round);
    const second = event.internalSegments![0]!;
    expect(second.basis).toBeCloseTo(401.76, 12);
    expect(second.modifiedDamage).toBeCloseTo(401.76 / 1.36, 12);
    expect(event.primaryRoundedDamage).toBe(295);
    expect(second.roundedDamage).toBe(295);
    expect(event.finalDamage).toBe(590);
    expect(Math.round(event.modifiedDamage)).toBe(591);
    expect(report([round]).actualActivationCount).toBe(2);
  });

  it("reports 40 successes plus 4 successful rapid segments as 44 over 100 main attacks", () => {
    let state = battle();
    const rounds: ReturnType<typeof resolveRound>[] = [];
    let rngCalls = 0;
    let inherited = 0;
    for (let index = 0; index < 100; index += 1) {
      const rapid = index < 4 || (index >= 40 && index < 46);
      const options = system([index < 40 ? .1 : .9], rapid);
      const round = resolveRound(state, options);
      rounds.push(round);
      state = round.stateAfter;
      rngCalls += options.next.mock.calls.length;
      inherited += options.onReportActivation.mock.calls.length;
    }
    expect(rngCalls).toBe(100);
    expect(inherited).toBe(4);
    expect(rounds.filter((round) => main(round).internalSegments?.length === 1)).toHaveLength(10);
    expect(report(rounds)).toMatchObject({
      probabilityCheckCount: 100, procSuccessCount: 40, actualActivationCount: 44,
      activationBySourceTroop: { shield: 44 },
    });
    expect(state.sideB.troops.shield.skillStates[0]!.triggerCount).toBe(40);
    expect(state.sideA.troops.marksman.skillStates[0]!.triggerCount).toBe(10);
  });

  it("does not change Crimson Field's inherited-segment report semantics", () => {
    const options = system([.1], true);
    const round = resolveRound(battle(false, true), options);
    expect(options.next).toHaveBeenCalledTimes(1);
    expect(options.onReportActivation).not.toHaveBeenCalled();
    expect(main(round).internalSegments).toHaveLength(1);
    expect(main(round).receivedDamageReductionDenominator).toBe(1.5);
    expect(report([round], LANCER_CRIMSON_FIELD.id)).toMatchObject({
      probabilityCheckCount: 1, procSuccessCount: 1, actualActivationCount: 1,
    });
    expect(getBattleReportSkillTriggerCount(report([round], LANCER_CRIMSON_FIELD.id))).toBe(1);
    expect(round.stateAfter.sideB.troops.lancer.skillStates[0]!.triggerCount).toBe(1);
  });

  it("keeps independent powder rolls separate from the inherited rapid segment", () => {
    const options = system([.1, .1], true);
    const round = resolveRound(battle(false, false, true), options);
    expect(options.next).toHaveBeenCalledTimes(2);
    expect(round.trace.troopSkills.filter((entry) => entry.skillId === CRYSTAL)).toHaveLength(2);
    expect(report([round])).toMatchObject({
      probabilityCheckCount: 2, procSuccessCount: 2, actualActivationCount: 3,
    });
    expect(options.onReportActivation).toHaveBeenCalledTimes(1);
    expect(round.stateAfter.sideB.troops.shield.skillStates[0]!.triggerCount).toBe(2);
  });

  it("reports the inherited activation with tracing disabled without adding a probability callback", () => {
    const options = system([.1], true, false);
    const round = resolveRound(battle(), options);
    expect(round.trace.troopSkills).toEqual([]);
    expect(options.next).toHaveBeenCalledTimes(1);
    expect(options.onProbabilityDecision.mock.calls.filter(([decision]) => decision.skillId === CRYSTAL))
      .toHaveLength(1);
    expect(options.onReportActivation).toHaveBeenCalledTimes(1);
    expect(round.stateAfter.sideB.troops.shield.skillStates[0]!.triggerCount).toBe(1);
  });

  it.each([true, false])("keeps full-trace and compact batch report counts consistent, success=%s", (success) => {
    const input = validationInput(success);
    const full = runValidationBattle(input);
    const single = full.skillSummary.find((entry) => entry.side === "B" && entry.skillId === CRYSTAL)!;
    expect(single).toMatchObject({ probabilityCheckCount: 1, procSuccessCount: success ? 1 : 0,
      actualActivationCount: success ? 2 : 0 });
    const batch = runBatchSimulation(input, 3);
    const statistics = batch.skillStatistics.find((entry) => entry.side === "B" && entry.skillId === CRYSTAL)!;
    expect(statistics).toMatchObject({
      probabilityCheckCount: 3, procSuccessCount: success ? 3 : 0,
      actualActivationCount: success ? 6 : 0, actualTriggerRate: success ? 1 : 0,
      theoreticalProbability: .375,
    });
    expect(getBattleReportSkillTriggerCount(statistics)).toBe(success ? 6 : 0);
  });
});

function validationInput(success: boolean) {
  const input = createDefaultValidationInput();
  const only = (side: ValidationSideInput, troop: "shield" | "marksman"): ValidationSideInput => ({
    ...side,
    troops: { ...side.troops,
      shield: { ...side.troops.shield, count: troop === "shield" ? 100_000 : 0 },
      lancer: { ...side.troops.lancer, count: 0 },
      marksman: { ...side.troops.marksman, count: troop === "marksman" ? 100_000 : 0 },
    },
  });
  return { ...input, maxRounds: 1, sideA: only(input.sideA, "marksman"), sideB: only(input.sideB, "shield"),
    triggerOverrides: { [`A:${RAPID}`]: "FORCE_TRIGGER" as const,
      [`A:${MARKSMAN_CRYSTAL_POWDER.id}`]: "FORCE_NOT_TRIGGER" as const,
      [`B:${CRYSTAL}`]: success ? "FORCE_TRIGGER" as const : "FORCE_NOT_TRIGGER" as const },
  };
}
