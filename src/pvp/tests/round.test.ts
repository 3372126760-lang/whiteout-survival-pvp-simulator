import { describe, expect, it } from "vitest";
import {
  calculateBaseTroopDamage,
  createBattleState,
  createRoundStartSnapshot,
  resolveRound,
  resolveRoundEnd,
  runActionPhase,
} from "../../pvp";
import { makeSide } from "./helpers";

describe("round snapshots and simultaneous casualty resolution", () => {
  it("fixes N0 to the smaller initial total for the entire battle", () => {
    const initial = createBattleState({
      sideA: makeSide(
        { shield: 100, lancer: 50 },
        { troopConstant: 2, maxHpPerUnit: 100 },
      ),
      sideB: makeSide(
        { shield: 80, marksman: 20 },
        { troopConstant: 2, maxHpPerUnit: 100 },
      ),
    });
    expect(initial.sideA.initialTotalCount).toBe(150);
    expect(initial.sideB.initialTotalCount).toBe(100);
    expect(initial.fixedInitialMinTroops).toBe(100);

    const round1 = resolveRound(initial);
    const round2 = resolveRound(round1.stateAfter);
    expect(
      round1.stateAfter.sideA.troops.shield.aliveCount +
        round1.stateAfter.sideA.troops.lancer.aliveCount,
    ).toBeLessThan(initial.sideA.initialTotalCount);
    expect(round1.stateAfter.fixedInitialMinTroops).toBe(100);
    expect(round2.snapshot.fixedInitialMinTroops).toBe(100);
    expect(round2.stateAfter.fixedInitialMinTroops).toBe(100);
  });

  it("uses the real alive count at the next round start", () => {
    const initial = createBattleState({
      sideA: makeSide(
        { shield: 100 },
        { troopConstant: 20, maxHpPerUnit: 1_000 },
      ),
      sideB: makeSide(
        { shield: 100 },
        { troopConstant: 20, maxHpPerUnit: 1_000 },
      ),
    });
    const round1 = resolveRound(initial);
    expect(round1.stateAfter.sideA.troops.shield.aliveCount).toBe(98);

    const snapshot2 = createRoundStartSnapshot(round1.stateAfter);
    const action2 = runActionPhase(round1.stateAfter, snapshot2);
    const event = action2.generatedEvents.find(
      (candidate) =>
        candidate.sourceSide === "A" && candidate.sourceTroop === "shield",
    );
    const expected = calculateBaseTroopDamage({
      fixedInitialMinTroops: 100,
      aliveCount: 98,
      damageCoefficient: 1,
      troopConstant: 20,
      attack: 0,
      penetration: 0,
    }).damage;
    expect(event?.baseDamage).toBeCloseTo(expected);
  });

  it("does not let pending lethal damage lower a later action's output", () => {
    const initial = createBattleState({
      sideA: makeSide(
        { shield: 100 },
        { troopConstant: 1, maxHpPerUnit: 1_000 },
      ),
      sideB: makeSide(
        { shield: 100 },
        { troopConstant: 100, maxHpPerUnit: 1_000 },
      ),
    });
    const snapshot = createRoundStartSnapshot(initial);
    const action = runActionPhase(initial, snapshot, {
      actionOrder: [
        { side: "B", troop: "shield" },
        { side: "A", troop: "shield" },
      ],
    });
    const laterAttack = action.generatedEvents[1]!;

    expect(action.state.sideA.troops.shield.aliveCount).toBe(100);
    expect(laterAttack.sourceSide).toBe("A");
    expect(laterAttack.baseDamage).toBeCloseTo(100);
    expect(action.state.pendingDamageEvents).toHaveLength(2);
  });

  it("updates deaths only in RoundEnd Resolution", () => {
    const initial = createBattleState({
      sideA: makeSide(
        { shield: 100 },
        { troopConstant: 1, maxHpPerUnit: 1_000 },
      ),
      sideB: makeSide(
        { shield: 100 },
        { troopConstant: 100, maxHpPerUnit: 1_000 },
      ),
    });
    const snapshot = createRoundStartSnapshot(initial);
    const action = runActionPhase(initial, snapshot, {
      actionOrder: [{ side: "B", troop: "shield" }],
    });

    expect(action.state.sideA.troops.shield.aliveCount).toBe(100);
    expect(action.state.pendingDamageEvents).toHaveLength(1);

    const end = resolveRoundEnd(action.state);
    expect(end.state.sideA.troops.shield.aliveCount).toBe(90);
    expect(end.state.pendingDamageEvents).toHaveLength(0);
  });

  it("carries front HP across round boundaries", () => {
    const initial = createBattleState({
      sideA: makeSide(
        { shield: 10 },
        { troopConstant: 1, maxHpPerUnit: 1_000 },
      ),
      sideB: makeSide(
        { shield: 10 },
        { troopConstant: 30, maxHpPerUnit: 1_000 },
      ),
    });
    const actionOrder = [{ side: "B" as const, troop: "shield" as const }];
    const round1 = resolveRound(initial, { actionOrder });
    const round2 = resolveRound(round1.stateAfter, { actionOrder });

    expect(round1.stateAfter.sideA.troops.shield.aliveCount).toBe(10);
    expect(round1.stateAfter.sideA.troops.shield.frontUnitHp).toBeCloseTo(700);
    expect(round2.snapshot.sideA.troops.shield.frontUnitHp).toBeCloseTo(700);
    expect(round2.stateAfter.sideA.troops.shield.frontUnitHp).toBeCloseTo(400);
  });

  it("uses the round-start target snapshot despite pending lethal damage", () => {
    const initial = createBattleState({
      sideA: makeSide(
        { shield: 1, lancer: 1, marksman: 1 },
        { troopConstant: 100, maxHpPerUnit: 100 },
      ),
      sideB: makeSide(
        { shield: 1, lancer: 1, marksman: 1 },
        { troopConstant: 1, maxHpPerUnit: 100 },
      ),
    });
    const snapshot = createRoundStartSnapshot(initial);
    const action = runActionPhase(initial, snapshot, {
      actionOrder: [
        { side: "A", troop: "shield" },
        { side: "A", troop: "lancer" },
        { side: "A", troop: "marksman" },
      ],
    });

    expect(action.generatedEvents.map((event) => event.targetTroop)).toEqual([
      "shield",
      "shield",
      "shield",
    ]);
    expect(action.state.sideB.troops.shield.aliveCount).toBe(1);
    expect(resolveRoundEnd(action.state).state.sideB.troops.shield.aliveCount).toBe(
      0,
    );
  });
});
