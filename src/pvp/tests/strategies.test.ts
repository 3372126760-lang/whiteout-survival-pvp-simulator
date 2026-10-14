import { describe, expect, it } from "vitest";
import {
  CONFIRMED_DISCARD_OVERFLOW,
  CONFIRMED_INTEGER_DAMAGE_ROUNDING,
  applyDamageToTroopStack,
  createBattleState,
  type CasualtyRoundingStrategy,
} from "../../pvp";
import { makeSide } from "./helpers";

describe("confirmed damage resolution policies", () => {
  it("marks integer damage and discarded overflow as confirmed", () => {
    expect(CONFIRMED_INTEGER_DAMAGE_ROUNDING).toMatchObject({
      provisional: false,
      ruleStatus: "supported",
    });
    expect(CONFIRMED_DISCARD_OVERFLOW).toMatchObject({
      provisional: false,
      ruleStatus: "supported",
    });
  });

  it("allows the casualty rounding policy to be replaced", () => {
    const ceilCasualties: CasualtyRoundingStrategy = {
      id: "test-ceil-casualties",
      ruleStatus: "supported",
      provisional: false,
      normalizeIncomingDamage: (damage) => damage,
      resolveFullUnitCasualties: (context) =>
        Math.min(
          context.remainingAliveCount,
          Math.ceil(context.exactFullUnitCasualties),
        ),
    };
    const battle = createBattleState({
      sideA: makeSide({ shield: 2 }),
      sideB: makeSide({ shield: 2 }),
    });
    const result = applyDamageToTroopStack(
      battle.sideA.troops.shield,
      1_500,
      ceilCasualties,
    );

    expect(result.resolvedDamage).toBe(1_500);
    expect(result.casualties).toBe(2);
    expect(result.troop.frontUnitHp).toBe(0);
  });
});
