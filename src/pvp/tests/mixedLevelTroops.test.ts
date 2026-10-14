import { describe, expect, it } from "vitest";
import {
  CONFIRMED_INITIAL_RATIO_CEILING,
  calculateBaseTroopDamage,
  calculateEffectiveTroopConstant,
  createBattleState,
  createRoundStartSnapshot,
  getTroopConstant,
  resolveRound,
  runActionPhase,
  type BattleSideSetup,
  type TroopSetup,
  type TroopType,
} from "../../pvp";

const mixedComposition = [
  { level: "T3", aliveCount: 255 },
  { level: "T4", aliveCount: 65 },
] as const;
const expectedMixedC = (255 * getTroopConstant("T3") + 65 * getTroopConstant("T4")) / 320;

describe("same-troop mixed-level composition", () => {
  it("1. normalizes a single-level input into one composition entry", () => {
    const state = createBattleState({
      sideA: makeSide(singleTroop("shield", 12, "T3")),
      sideB: makeSide(singleTroop("shield", 12, "T3")),
    });

    expect(state.sideA.troops.shield.levelComposition).toEqual([
      { level: "T3", aliveCount: 12 },
    ]);
  });

  it("2. derives mixed aliveCount from a strictly matching composition", () => {
    const state = createMixedBattle();
    expect(state.sideA.troops.shield.aliveCount).toBe(320);
    expect(state.sideA.troops.shield.levelComposition.reduce(
      (sum, entry) => sum + entry.aliveCount,
      0,
    )).toBe(320);
    expect(() => createBattleState({
      sideA: makeSide(mixedTroop(319)),
      sideB: makeSide(singleTroop("shield", 320, "T3")),
    })).toThrow(/sum exactly/);
  });

  it("3. calculates effective C as an alive-count weighted average", () => {
    const result = calculateEffectiveTroopConstant(mixedComposition);
    expect(result.totalAliveCount).toBe(320);
    expect(result.weightedConstantNumerator).toBeCloseTo(712.95);
    expect(result.effectiveTroopConstant).toBeCloseTo(expectedMixedC);
  });

  it("4. stores the confirmed T3/T4 weighted C on the troop stack", () => {
    expect(createMixedBattle().sideA.troops.shield.troopConstant)
      .toBeCloseTo(expectedMixedC);
  });

  it("5. emits only one normal attack for the whole mixed stack", () => {
    const state = createMixedBattle();
    const action = runActionPhase(state, createRoundStartSnapshot(state), {
      actionOrder: [{ side: "A", troop: "shield" }],
    });

    expect(action.generatedEvents).toHaveLength(1);
    expect(action.generatedEvents[0]).toMatchObject({
      sourceSide: "A",
      sourceTroop: "shield",
      damageType: "normalAttack",
    });
  });

  it("6. never emits separate T3 and T4 attacks", () => {
    const state = createMixedBattle();
    const action = runActionPhase(state, createRoundStartSnapshot(state));
    const attacks = action.generatedEvents.filter(
      (event) => event.sourceSide === "A" && event.sourceTroop === "shield",
    );

    expect(attacks).toHaveLength(1);
    expect(attacks[0]?.id).not.toMatch(/T3|T4/);
  });

  it("7. uses effective C in the unchanged damage formula", () => {
    const state = createMixedBattle();
    const action = runActionPhase(state, createRoundStartSnapshot(state), {
      actionOrder: [{ side: "A", troop: "shield" }],
    });
    const expected = calculateBaseTroopDamage({
      fixedInitialMinTroops: 320,
      aliveCount: 320,
      damageCoefficient: 1,
      troopConstant: expectedMixedC,
      penetration: 0,
      attack: 0,
    });

    expect(action.generatedEvents[0]?.baseDamage).toBeCloseTo(expected.damage);
    expect(action.generatedEvents[0]?.baseDamageFormula?.troopConstant)
      .toBeCloseTo(expectedMixedC);
  });

  it("8. uses effective C in max HP with the confirmed shield coefficient", () => {
    const shield = createMixedBattle().sideA.troops.shield;
    expect(shield.baseHpPerUnit).toBeCloseTo(expectedMixedC * 300);
    expect(shield.maxHpPerUnit).toBeCloseTo(expectedMixedC * 300);
  });

  it("9. keeps the RoundStart effective C fixed for all actions in that round", () => {
    const round = resolveCasualtyRound();
    const attackAfterPendingDamage = round.stateAfterActionPhase.pendingDamageEvents
      .find((event) => event.sourceSide === "A");

    expect(round.snapshot.sideA.troops.shield.troopConstant)
      .toBeCloseTo(expectedMixedC);
    expect(attackAfterPendingDamage?.baseDamageFormula?.troopConstant)
      .toBeCloseTo(expectedMixedC);
  });

  it("10. keeps the original-ratio C after integer casualty bookkeeping", () => {
    const round = resolveCasualtyRound();
    const after = round.stateAfter.sideA.troops.shield;
    const nextSnapshot = createRoundStartSnapshot(round.stateAfter);

    expect(after.aliveCount).toBe(95);
    expect(after.levelComposition).toEqual([
      { level: "T3", aliveCount: 76 },
      { level: "T4", aliveCount: 19 },
    ]);
    expect(after.troopConstant).toBeCloseTo(expectedMixedC);
    expect(nextSnapshot.sideA.troops.shield.troopConstant)
      .toBeCloseTo(after.troopConstant);
    expect(after.initialLevelComposition).toEqual(mixedComposition);
  });

  it("11. conserves total casualties across all levels", () => {
    const result = CONFIRMED_INITIAL_RATIO_CEILING.allocate(
      mixedComposition,
      225,
    );
    expect(result.allocations.reduce((sum, entry) => sum + entry.deaths, 0))
      .toBe(225);
    expect(result.levelCompositionAfter.reduce(
      (sum, entry) => sum + entry.aliveCount,
      0,
    )).toBe(95);
  });

  it("12. never allocates more deaths than a level has alive", () => {
    const result = CONFIRMED_INITIAL_RATIO_CEILING.allocate(
      mixedComposition,
      320,
    );
    expect(result.allocations.every(
      (entry) => entry.deaths >= 0 && entry.deaths <= entry.aliveCountBefore,
    )).toBe(true);
    expect(result.levelCompositionAfter.every((entry) => entry.aliveCount === 0))
      .toBe(true);
  });

  it("13. keeps the 65/255, 225-death split close to report proportions", () => {
    const result = CONFIRMED_INITIAL_RATIO_CEILING.allocate(
      mixedComposition,
      225,
    );
    const t3 = result.allocations.find((entry) => entry.level === "T3")!;
    const t4 = result.allocations.find((entry) => entry.level === "T4")!;

    expect(t3.deaths).toBe(179);
    expect(t4.deaths).toBe(46);
    expect(Math.abs(t3.deaths - 180)).toBeLessThanOrEqual(1);
    expect(Math.abs(t4.deaths - 45)).toBeLessThanOrEqual(1);
  });

  it("14. records mixed-level RoundStart and RoundEnd audit fields", () => {
    const trace = resolveCasualtyRound().trace;
    const start = trace.roundStart.sides.A.shield;
    const end = trace.roundEnd.troops.find(
      (entry) => entry.side === "A" && entry.troop === "shield",
    )!;

    expect(start.totalAliveCount).toBe(320);
    expect(start.effectiveTroopConstant).toBeCloseTo(expectedMixedC);
    expect(start.weightedConstantNumerator).toBeCloseTo(expectedMixedC * 320);
    expect(start.levelCompositionAtRoundStart).toEqual(mixedComposition);
    expect(end.totalDeaths).toBe(225);
    expect(end.casualtyAllocationStrategy)
      .toBe("confirmed-initial-ratio-ceiling");
    expect(end.casualtyAllocationRuleUnknown)
      .toBeUndefined();
    expect(end.casualtyAllocationByLevel.reduce(
      (sum, entry) => sum + entry.deaths,
      0,
    )).toBe(end.totalDeaths);
    expect(end.levelCompositionAtRoundEnd).toEqual(
      resolveCasualtyRound().stateAfter.sideA.troops.shield.levelComposition,
    );
  });
});

function resolveCasualtyRound() {
  const targetHp = expectedMixedC * 300;
  const attackerC = getTroopConstant("T3");
  const lethalCoefficient = 225 * targetHp / (320 * attackerC);
  const state = createBattleState({
    sideA: makeSide(mixedTroop(320)),
    sideB: makeSide({
      ...singleTroop("shield", 320, "T3"),
      attack: lethalCoefficient - 1,
    }),
  });
  return resolveRound(state, {
    actionOrder: [
      { side: "B", troop: "shield" },
      { side: "A", troop: "shield" },
    ],
  });
}

function createMixedBattle() {
  return createBattleState({
    sideA: makeSide(mixedTroop(320)),
    sideB: makeSide(singleTroop("shield", 320, "T3")),
  });
}

function mixedTroop(count: number): TroopSetup {
  return {
    ...singleTroop("shield", count, "T3"),
    levelComposition: mixedComposition,
  };
}

function singleTroop(
  type: TroopType,
  count: number,
  level: string,
): TroopSetup {
  return {
    count,
    troopLevel: level,
    troopConstant: getTroopConstant(level),
    damageCoefficient: type === "shield" ? 1 : type === "lancer" ? 3 : 4,
    attack: 0,
    penetration: 0,
    defense: 0,
    life: 0,
  };
}

function makeSide(shield: TroopSetup): BattleSideSetup {
  return {
    troops: {
      shield,
      lancer: singleTroop("lancer", 0, "T3"),
      marksman: singleTroop("marksman", 0, "T3"),
    },
  };
}
