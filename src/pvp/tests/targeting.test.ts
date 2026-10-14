import { describe, expect, it } from "vitest";
import {
  createActivatedLancerSurpriseEffect,
  createBattleState,
  createRoundStartSnapshot,
  runActionPhase,
  selectTarget,
} from "../../pvp";
import { makeSide } from "./helpers";

describe("target selection", () => {
  it("uses shield -> lancer -> marksman by default", () => {
    const withShield = createBattleState({
      sideA: makeSide({ lancer: 1 }),
      sideB: makeSide({ shield: 1, marksman: 1, lancer: 1 }),
    });
    expect(selectTarget("lancer", withShield, "B").targetTroop).toBe(
      "shield",
    );

    const withoutShield = createBattleState({
      sideA: makeSide({ lancer: 1 }),
      sideB: makeSide({ shield: 0, marksman: 1, lancer: 1 }),
    });
    const result = selectTarget("lancer", withoutShield, "B");
    expect(result.targetTroop).toBe("lancer");
    expect(result.priority).toEqual(["shield", "lancer", "marksman"]);
  });

  it("uses marksman -> shield -> lancer for an activated lancer surprise", () => {
    const battle = createBattleState({
      sideA: makeSide({ lancer: 1 }),
      sideB: makeSide({ shield: 1, marksman: 1, lancer: 1 }),
    });
    const surprise = createActivatedLancerSurpriseEffect(
      "test-source",
      "test-surprise",
      1,
    );
    const result = selectTarget("lancer", battle, "B", [surprise]);

    expect(result.targetTroop).toBe("marksman");
    expect(result.priority).toEqual(["marksman", "shield", "lancer"]);
  });

  it("offers an explicit ambushTriggered true/false action interface", () => {
    const battle = createBattleState({
      sideA: makeSide({ lancer: 1 }),
      sideB: makeSide({ shield: 1, marksman: 1, lancer: 1 }),
    });
    const snapshot = createRoundStartSnapshot(battle);
    const actionOrder = [{ side: "A" as const, troop: "lancer" as const }];
    const normal = runActionPhase(battle, snapshot, {
      actionOrder,
      ambushTriggered: false,
    });
    const ambush = runActionPhase(battle, snapshot, {
      actionOrder,
      ambushTriggered: true,
    });

    expect(normal.generatedEvents[0]?.targetTroop).toBe("shield");
    expect(ambush.generatedEvents[0]?.targetTroop).toBe("marksman");
  });
});
