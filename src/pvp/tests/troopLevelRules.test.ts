import { describe, expect, it } from "vitest";
import {
  CONFIRMED_INITIAL_RATIO_CEILING,
  NEXT_AVAILABLE_TROOP_LEVEL,
  SUPPORTED_TROOP_LEVELS,
  TROOP_LEVEL_DATA,
  TROOP_TYPE_DATA,
  TROOP_TYPES,
  applyDamageToTroopStack,
  cloneBattleTemplate,
  createBattleState,
  createTroopState,
  getAvailableTroopLevels,
  getTroopConstant,
  parseTroopProgression,
  resolvePostBattleCasualties,
  type TroopSetup,
} from "../../pvp";
import { makeSide } from "./helpers";

const setup = (level: string, count = 100): TroopSetup => ({
  troopLevel: level, count, troopConstant: 999,
  attack: .2, defense: .3, life: .4, penetration: .5,
  damageCoefficient: 999, troopHpCoefficient: 999,
});

describe("final troop level and mixed-level rules", () => {
  it("has exactly 32 levels and only id/Cn in level records", () => {
    expect(SUPPORTED_TROOP_LEVELS).toHaveLength(32);
    expect(TROOP_LEVEL_DATA.map((row) => row.id)).toEqual(SUPPORTED_TROOP_LEVELS);
    for (const row of TROOP_LEVEL_DATA) expect(Object.keys(row)).toEqual(["id", "troopConstant"]);
  });

  it("uses enumeration successors across the T11 and T12 gaps", () => {
    expect(NEXT_AVAILABLE_TROOP_LEVEL["T10-FC10"]).toBe("T11-FC3");
    expect(NEXT_AVAILABLE_TROOP_LEVEL["T11-FC10"]).toBe("T12-FC7");
    expect(NEXT_AVAILABLE_TROOP_LEVEL["T12-FC10"]).toBeNull();
    for (const level of ["T11", "T11-FC1", "T11-FC2", "T12", "T12-FC1", "T12-FC6"]) {
      expect(parseTroopProgression(level)).toBeNull();
      expect(() => createTroopState("shield", setup(level))).toThrow(/Unsupported troop level/);
      expect(() => createTroopState("shield", { ...setup(level),
        levelComposition: [{ level: "T10", aliveCount: 100 }] })).toThrow(/Unsupported troop level/);
    }
  });

  it("keeps fixed type coefficients and report attributes for EVERY legal level", () => {
    for (const level of SUPPORTED_TROOP_LEVELS) for (const type of TROOP_TYPES) {
      const troop = createTroopState(type, setup(level));
      const data = TROOP_TYPE_DATA[type];
      expect(troop.damageCoefficient).toBe(data.damageCoefficient);
      expect(troop.troopHpCoefficient).toBe(data.lifeCoefficient);
      expect(troop.baseHpPerUnit).toBeCloseTo(getTroopConstant(level) * data.lifeCoefficient);
      expect(troop).toMatchObject({ attack: .2, defense: .3, life: .4, penetration: .5 });
    }
  });

  it("offers all real T12 checkpoints only at T12-capable stages", () => {
    for (const level of ["T12-FC7", "T12-FC8", "T12-FC9", "T12-FC10"]) {
      expect(getAvailableTroopLevels("s10_t12")).toContain(level);
      expect(getAvailableTroopLevels("s9_fc10")).not.toContain(level);
    }
    expect(getAvailableTroopLevels("s4_t11")).toEqual(expect.arrayContaining(["T11-FC3", "T11-FC4", "T11-FC5"]));
    expect(getAvailableTroopLevels("s4_t11")).not.toContain("T10-FC6");
  });

  it("retains initial weights across sequential damage without Cn/HP rounding drift", () => {
    const initial = [{ level: "T10", aliveCount: 40 }, { level: "T11-FC3", aliveCount: 60 }];
    let troop = createTroopState("shield", { ...setup("T11-FC3"), levelComposition: initial });
    const originalC = troop.troopConstant;
    const originalHp = troop.maxHpPerUnit;
    for (let round = 0; round < 7; round += 1) {
      troop = applyDamageToTroopStack(troop, troop.maxHpPerUnit * 7).troop;
      expect(troop.initialLevelComposition).toEqual(initial);
      expect(troop.troopConstant).toBe(originalC);
      expect(troop.maxHpPerUnit).toBe(originalHp);
      expect(troop.levelComposition.reduce((sum, row) => sum + row.aliveCount, 0)).toBe(troop.aliveCount);
    }
  });

  it("ceil splits deaths and survivors while exposing the independent rounding difference", () => {
    const result = CONFIRMED_INITIAL_RATIO_CEILING.allocate([
      { level: "T10", aliveCount: 4 }, { level: "T11-FC3", aliveCount: 6 },
    ], 1);
    expect(result.allocations.map((row) => row.ceilingDeaths)).toEqual([1, 1]);
    expect(result.allocations.map((row) => row.ceilingAliveCountAfter)).toEqual([4, 6]);
    expect(result.roundingDifference).toEqual({ deaths: 1, survivors: 1 });
    expect(result.levelCompositionAfter.reduce((sum, row) => sum + row.aliveCount, 0)).toBe(9);
  });

  it("uses original rather than current proportions and never resurrects exhausted grades", () => {
    const original = [{ level: "T10", aliveCount: 40 }, { level: "T11-FC3", aliveCount: 60 }];
    const result = CONFIRMED_INITIAL_RATIO_CEILING.allocate([
      { level: "T10", aliveCount: 1 }, { level: "T11-FC3", aliveCount: 2 },
    ], 2, original);
    expect(result.allocations.map((row) => row.exactProportionalDeaths)).toEqual([.8, 1.2]);
    const exhausted = CONFIRMED_INITIAL_RATIO_CEILING.allocate([
      { level: "T10", aliveCount: 0 }, { level: "T11-FC3", aliveCount: 2 },
    ], 1, original);
    expect(exhausted.allocations[0]).toMatchObject({ deaths: 0, ceilingDeaths: 0, aliveCountAfter: 0 });
  });

  it("splits ALL four final categories by the original 40/60 ratio", () => {
    const result = resolvePostBattleCasualties(
      { shield: 10_000, lancer: 0, marksman: 0 },
      { shield: 3_000, lancer: 0, marksman: 0 }, "FURNACE", {
        shield: [{ level: "T10", initial: 4_000, survivors: 1_100 },
          { level: "T11-FC3", initial: 6_000, survivors: 1_900 }], lancer: [], marksman: [],
      });
    for (const category of ["loss", "injured", "lightlyWounded", "survivors"] as const) {
      const total = result.byTroop.shield[category];
      expect(result.byGrade!.shield.map((row) => row[category])).toEqual([total * .4, total * .6]);
      expect(result.gradeRoundingDifference!.shield[category]).toBe(0);
    }
  });

  it("ceil rounds 3333.2 to 3334 without changing conserved battle totals", () => {
    const result = resolvePostBattleCasualties(
      { shield: 10_000, lancer: 0, marksman: 0 },
      { shield: 8_333, lancer: 0, marksman: 0 }, "NORMAL", {
        shield: [{ level: "T10", initial: 4_000, survivors: 3_333 },
          { level: "T11-FC3", initial: 6_000, survivors: 5_000 }], lancer: [], marksman: [],
      });
    expect(result.byGrade!.shield.map((row) => row.survivors)).toEqual([3_334, 5_000]);
    expect(result.gradeRoundingDifference!.shield.survivors).toBe(1);
    expect(result.total.survivors).toBe(8_333);
    expect(result.total.exited + result.total.survivors).toBe(10_000);
  });

  it("clones original composition independently for optimizer battle templates", () => {
    const state = createBattleState({ sideA: makeSide({ shield: 10 }), sideB: makeSide({ shield: 10 }) });
    const clone = cloneBattleTemplate(state);
    expect(clone.sideA.troops.shield.initialLevelComposition).toEqual(state.sideA.troops.shield.initialLevelComposition);
    expect(clone.sideA.troops.shield.initialLevelComposition).not.toBe(state.sideA.troops.shield.initialLevelComposition);
  });
});
