import { describe, expect, it } from "vitest";
import {
  SUPPORTED_TROOP_LEVELS,
  TROOP_LEVEL_CONSTANTS,
  calculateBaseTroopDamage,
  calculateTroopHp,
  createPureTroopBattleState,
  getTroopConstant,
  resolveTroopConstant,
  type PureTroopScenarioSideInput,
} from "../../pvp";

describe("confirmed troop-level constants", () => {
  it.each([
    ["T2", 1.5],
    ["T3", 2.1],
    ["T4", 2.73],
    ["T9", 6.3514],
    ["T10", 7.4947],
    ["T10-FC8", 10.8632],
    ["T11-FC5", 11.1796],
    ["T11-FC10", 14.1324],
    ["T12-FC10", 16.6763],
  ] as const)("maps %s to C=%s", (level, expected) => {
    expect(getTroopConstant(level)).toBe(expected);
  });

  it("mirrors every currently confirmed constant from the bear model", () => {
    expect(TROOP_LEVEL_CONSTANTS).toEqual({
      T1: 1, T2: 1.5, T3: 2.1, T4: 2.73, T5: 3.276,
      T6: 3.8657, T7: 4.5615, T8: 5.3826, T9: 6.3514,
      T10: 7.4947,
      "T10-FC1": 7.7945, "T10-FC2": 8.1842,
      "T10-FC3": 8.5934, "T10-FC4": 9.0231,
      "T10-FC5": 9.4742, "T10-FC6": 9.8532,
      "T10-FC7": 10.3459, "T10-FC8": 10.8632,
      "T10-FC9": 11.4063, "T10-FC10": 11.9766,
      "T11-FC3": 10.1402, "T11-FC4": 10.6472,
      "T11-FC5": 11.1796, "T11-FC6": 11.6268,
      "T11-FC7": 12.2081, "T11-FC8": 12.8185,
      "T11-FC9": 13.4595, "T11-FC10": 14.1324,
      "T12-FC7": 14.4056,
      "T12-FC8": 15.1259, "T12-FC9": 15.8822,
      "T12-FC10": 16.6763,
    });
  });

  it("changes C across fire-crystal suffixes", () => {
    expect(getTroopConstant("T10-FC1")).not.toBe(getTroopConstant("T10"));
    expect(getTroopConstant("T10-FC8")).not.toBe(getTroopConstant("T10-FC1"));
    expect(getTroopConstant("T11-FC10")).not.toBe(getTroopConstant("T11-FC5"));
  });

  it.each([
    "T11", "T11-FC1", "T11-FC2", "T12", "T12-FC1", "T12-FC2", "T12-FC3",
    "T12-FC4", "T12-FC5", "T12-FC6",
  ])("rejects the nonexistent game level %s", (level) => {
    expect(() => getTroopConstant(level)).toThrow(
      `Unsupported troop level: ${level}.`,
    );
    expect(() => resolveTroopConstant(level, 12)).toThrow(
      `Unsupported troop level: ${level}.`,
    );
  });

  it("rejects an explicit fallback when a standard scenario receives unknown T12", () => {
    expect(() => createPureTroopBattleState({
      id: "unknown-t12-constant",
      sideA: sideAt("T12", 12),
      sideB: sideAt("T10", 999),
      maxRounds: 1,
    })).toThrow("Unsupported troop level: T12.");
  });

  it("ignores a supplied fallback for a confirmed standard scenario level", () => {
    const state = createPureTroopBattleState({
      id: "confirmed-level-overrides-fallback",
      sideA: sideAt("T10", 999),
      sideB: sideAt("T10", 999),
      maxRounds: 1,
    });
    expect(state.sideA.troops.shield.troopConstant).toBe(getTroopConstant("T10"));
    expect(state.sideB.troops.marksman.troopConstant).toBe(getTroopConstant("T10"));
  });

  it("uses the same confirmed C in both base damage and max HP", () => {
    const troopConstant = getTroopConstant("T10-FC8");
    const damage = calculateBaseTroopDamage({
      fixedInitialMinTroops: 1,
      aliveCount: 1,
      damageCoefficient: 1,
      troopConstant,
      penetration: 0,
      attack: 0,
    });
    const hp = calculateTroopHp({
      troopConstant,
      troopHpCoefficient: 100,
      defense: 0,
      life: 0,
    });
    expect(damage.damage).toBe(troopConstant);
    expect(damage.factors.troopConstant).toBe(troopConstant);
    expect(hp.baseHpPerUnit).toBeCloseTo(troopConstant * 100);
    expect(hp.factors.troopConstant).toBe(troopConstant);
    expect(getTroopConstant("T10")).toBe(7.4947);
    expect(getTroopConstant("T11-FC10")).toBe(14.1324);
  });

  it("exposes exactly the real game levels in the validation catalog", () => {
    expect(SUPPORTED_TROOP_LEVELS).toEqual([
      "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10",
      "T10-FC1", "T10-FC2", "T10-FC3", "T10-FC4", "T10-FC5",
      "T10-FC6", "T10-FC7", "T10-FC8", "T10-FC9", "T10-FC10",
      "T11-FC3", "T11-FC4", "T11-FC5", "T11-FC6", "T11-FC7", "T11-FC8", "T11-FC9", "T11-FC10",
      "T12-FC7", "T12-FC8", "T12-FC9", "T12-FC10",
    ]);
  });
});

function sideAt(
  troopLevel: string,
  troopConstant: number,
): PureTroopScenarioSideInput {
  const troop = (damageCoefficient: number) => ({
    count: 1,
    attack: 0,
    penetration: 0,
    defense: 0,
    life: 0,
    troopLevel,
    troopConstant,
    damageCoefficient,
  });
  return {
    shield: troop(1),
    lancer: troop(3),
    marksman: troop(4),
  };
}
