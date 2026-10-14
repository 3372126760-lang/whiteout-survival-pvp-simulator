import { describe, expect, it } from "vitest";
import {
  calculateTroopHp,
  getTroopConstant,
  runPureTroopBattleScenario,
  type PureTroopScenarioSideInput,
} from "../../pvp";

function scenarioSide(
  shield: number,
  lancer: number,
  marksman: number,
): PureTroopScenarioSideInput {
  const troop = (
    count: number,
    damageCoefficient: number,
  ) => ({
    count,
    attack: 0.2,
    penetration: 0.1,
    defense: 0.25,
    life: 0.2,
    troopLevel: "T6",
    troopConstant: getTroopConstant("T6"),
    damageCoefficient,
  });
  return {
    shield: troop(shield, 1),
    lancer: troop(lancer, 3),
    marksman: troop(marksman, 4),
  };
}

describe("no-hero pure troop scenario and BattleTrace", () => {
  it("separates base HP from effective HP", () => {
    const hp = calculateTroopHp({
      troopConstant: 10,
      troopHpCoefficient: 20,
      defense: 0.25,
      life: 0.2,
    });

    expect(hp.baseHpPerUnit).toBe(200);
    expect(hp.effectiveHpPerUnit).toBe(240);
    expect(hp.factors.defenseMultiplier).toBe(1);
    expect(hp.factors.lifeMultiplier).toBe(1.2);
  });

  it("runs without heroes and produces an auditable structured/text trace", () => {
    const result = runPureTroopBattleScenario({
      id: "trace-test",
      sideA: scenarioSide(10, 5, 5),
      sideB: scenarioSide(8, 6, 6),
      maxRounds: 2,
      ambushTriggered: false,
    });

    expect(result.initialState.fixedInitialMinTroops).toBe(20);
    expect(result.initialState.sideA.heroStates).toEqual([]);
    expect(result.initialState.sideB.heroStates).toEqual([]);
    const expectedBaseHp = getTroopConstant("T6") * 300;
    const expectedMaxHp = expectedBaseHp * 1.2;
    expect(result.initialState.sideA.troops.shield.baseHpPerUnit).toBeCloseTo(expectedBaseHp);
    expect(result.initialState.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(expectedMaxHp);

    const resolvedRound = result.simulation.rounds[0]!;
    const trace = result.simulation.trace.rounds[0]!;
    expect(trace.roundStart.fixedInitialMinTroops).toBe(20);
    expect(trace.roundStart.sides.A.shield.aliveCount).toBe(10);
    expect(trace.roundStart.sides.A.shield.frontUnitHp).toBeCloseTo(expectedMaxHp);
    expect(trace.roundStart.sides.A.shield.maxHpPerUnit).toBeCloseTo(expectedMaxHp);
    expect(trace.damageEvents.map((event) => event.id)).toEqual(
      resolvedRound.stateAfterActionPhase.pendingDamageEvents.map(
        (event) => event.id,
      ),
    );

    const damageToBShield = trace.damageEvents
      .filter(
        (event) =>
          event.targetSide === "B" && event.targetTroop === "shield",
      )
      .reduce((sum, event) => sum + event.finalDamage, 0);
    const bShieldEnd = trace.roundEnd.troops.find(
      (troop) => troop.side === "B" && troop.troop === "shield",
    )!;
    expect(bShieldEnd.receivedDamage).toBeCloseTo(damageToBShield);
    expect(bShieldEnd.casualties).toBe(
      trace.roundStart.sides.B.shield.aliveCount - bShieldEnd.aliveCount,
    );
    expect(bShieldEnd.frontUnitHp).toBe(
      resolvedRound.stateAfter.sideB.troops.shield.frontUnitHp,
    );

    expect(result.readableTrace).toContain("=== Round 1 Start | N0=20 ===");
    expect(result.readableTrace).toContain("-- DamageEvents --");
    expect(result.readableTrace).toContain("-- RoundEnd --");
    expect(result.simulation.rounds.length).toBeGreaterThan(0);
    expect(result.simulation.rounds.length).toBeLessThanOrEqual(2);
  });
});
