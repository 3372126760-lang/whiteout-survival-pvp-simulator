import { describe, expect, it } from "vitest";
import {
  allocateThreeThreeThree,
  getValidationCatalog,
  highestConfiguredTroopLevel,
  resolvePostBattleCasualties,
  runValidationBattle,
  toEngineScenario,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

describe("first scenario and post-battle phase", () => {
  it("keeps 333 capacity exact and chooses only a player-configured level", () => {
    expect(allocateThreeThreeThree(1_000_000)).toEqual({
      shield: 333_334, lancer: 333_333, marksman: 333_333,
    });
    expect(highestConfiguredTroopLevel(["T10-FC8", "T11-FC10", "T10-FC10"]))
      .toBe("T11-FC10");
    const base = createDefaultValidationInput();
    const sideA = { ...base.sideA, deploymentCapacity: 1_000_000,
      availableTroopLevels: ["T10-FC8", "T11-FC10"] };
    const scenario = toEngineScenario({ ...base, scenarioType: "THREE_THREE_THREE", sideA });
    expect([scenario.sideA.shield.count, scenario.sideA.lancer.count,
      scenario.sideA.marksman.count]).toEqual([333_334, 333_333, 333_333]);
    expect([scenario.sideA.shield.troopLevel, scenario.sideA.lancer.troopLevel,
      scenario.sideA.marksman.troopLevel]).toEqual([
      "T11-FC10", "T11-FC10", "T11-FC10",
    ]);
  });

  it("drops stale member heroes outside rally and includes them in rally", () => {
    const base = createDefaultValidationInput();
    const memberSkill = getValidationCatalog().memberSkills[0]!.skillId;
    const sideA = { ...base.sideA, selectedMemberSkillIds: [memberSkill] };
    for (const scenarioType of ["SINGLE", "THREE_THREE_THREE"] as const) {
      expect(toEngineScenario({ ...base, scenarioType, sideA }).sideA.heroes)
        .toEqual([]);
    }
    expect(toEngineScenario({ ...base, scenarioType: "RALLY", sideA })
      .sideA.heroes?.some((hero) => hero.position === "member")).toBe(true);
  });

  it("classifies normal and furnace casualties with the game's defeated definition", () => {
    const initial = { shield: 50_000, lancer: 30_000, marksman: 20_000 };
    const survivors = { shield: 0, lancer: 0, marksman: 0 };
    const normal = resolvePostBattleCasualties(initial, survivors, "NORMAL");
    expect(normal.total).toMatchObject({ exited: 100_000, loss: 0,
      injured: 35_000, lightlyWounded: 65_000, defeated: 35_000 });
    const furnace = resolvePostBattleCasualties(initial, survivors, "FURNACE");
    expect(furnace.total).toMatchObject({ exited: 100_000, loss: 35_000,
      injured: 10_000, lightlyWounded: 55_000, defeated: 45_000 });
    for (const category of ["loss", "injured", "lightlyWounded"] as const) {
      expect(Object.values(furnace.byTroop).reduce((sum, row) =>
        sum + row[category], 0)).toBe(furnace.total[category]);
    }
    for (const row of Object.values(furnace.byTroop)) {
      expect(row.loss + row.injured + row.lightlyWounded).toBe(row.exited);
    }
  });

  it("keeps tiny mixed populations integer and derives the result from one actual battle", () => {
    const tiny = resolvePostBattleCasualties(
      { shield: 1, lancer: 1, marksman: 1 },
      { shield: 0, lancer: 0, marksman: 0 }, "FURNACE");
    expect(tiny.total.loss + tiny.total.injured + tiny.total.lightlyWounded).toBe(3);
    expect(Object.values(tiny.byTroop).every((row) =>
      row.loss + row.injured + row.lightlyWounded === 1)).toBe(true);
    const input = { ...createDefaultValidationInput(), maxRounds: 1 };
    const battle = runValidationBattle(input);
    for (const side of ["A", "B"] as const) {
      const casualty = battle.postBattleCasualties[side];
      expect(casualty.total.exited).toBe(casualty.total.initial -
        Object.values(battle.summary.remaining[side]).reduce((sum, count) => sum + count, 0));
    }
  });

  it("uses initial grade weights with independent ceiling and explicit differences", () => {
    const initial = { shield: 7, lancer: 0, marksman: 0 };
    const survivors = { shield: 2, lancer: 0, marksman: 0 };
    const grades = {
      shield: [{ level: "T10", initial: 4, survivors: 0 },
        { level: "T11-FC3", initial: 3, survivors: 2 }],
      lancer: [], marksman: [],
    };
    const result = resolvePostBattleCasualties(initial, survivors, "FURNACE", grades);
    expect(result.byGrade?.shield.map((row) => row.exited)).toEqual([4, 3]);
    for (const category of ["loss", "injured", "lightlyWounded"] as const) {
      expect(result.byGrade?.shield.reduce((sum, row) => sum + row[category], 0))
        .toBe(result.byTroop.shield[category] + result.gradeRoundingDifference!.shield[category]);
    }
  });

  it("keeps the same single-battle engine trace across post-battle modes", () => {
    const base = { ...createDefaultValidationInput(), randomSeed: 12345, maxRounds: 3 };
    const normal = runValidationBattle({ ...base, postBattleCasualtyMode: "NORMAL" });
    const furnace = runValidationBattle({ ...base, postBattleCasualtyMode: "FURNACE" });
    expect(normal.simulation.finalState).toEqual(furnace.simulation.finalState);
    expect(normal.readableTrace).toBe(furnace.readableTrace);
    expect(normal.summary).toEqual(furnace.summary);
  });
});
