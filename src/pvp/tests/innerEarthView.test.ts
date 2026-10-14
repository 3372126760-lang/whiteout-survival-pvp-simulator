import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { changeInnerEarthMode, updateInnerEarthField } from "../../ui/innerEarthView";
import { normalizeInnerEarthInput, createDefaultInnerEarthConfig, assertInnerEarthInput } from "../innerEarth";

function fixture(mode: Parameters<typeof createDefaultInnerEarthConfig>[1] = "HEART_OF_EARTH") {
  const base = createDefaultValidationInput();
  return normalizeInnerEarthInput(base, createDefaultInnerEarthConfig(base, mode));
}
describe("Inner Earth editable form boundaries", () => {
  it("edits one queue's decimal attributes without changing the other queues or the source input", () => {
    const input = fixture(), before = structuredClone(input);
    const changed = updateInnerEarthField(input, { field: "compact-attribute", side: "ally", queue: "1", stat: "attack" }, "2612.80");
    expect(changed.innerEarth!.ally.queues[1].expectedReportStats.lancer.attack).toBe(2612.8);
    expect(changed.innerEarth!.ally.queues[0]).toEqual(before.innerEarth!.ally.queues[0]);
    expect(changed.innerEarth!.enemy).toEqual(before.innerEarth!.enemy);
    expect(input).toEqual(before);
  });
  it("keeps incomplete ratio drafts editable and validates their sum only at the configuration boundary", () => {
    const input = fixture();
    const changed = updateInnerEarthField(input, { field: "ratio", queue: "0", troop: "shield" }, "25.01");
    expect(changed.innerEarth!.ally.queues[0].ratio.shield).toBe(25.01);
    expect(() => assertInnerEarthInput(changed)).toThrow();
    expect(() => updateInnerEarthField(input, { field: "ratio", queue: "0", troop: "shield" }, "25.001")).toThrow(/两位/);
  });
  it("manual hero selection updates the report lineup baseline for that queue only", () => {
    const input = fixture();
    const changed = updateInnerEarthField(input, { field: "hero", side: "ally", queue: "1", troop: "shield" }, "hero.s11.eleonora");
    expect(changed.innerEarth!.ally.queues[1].heroes.shield).toBe("hero.s11.eleonora");
    expect(changed.innerEarth!.ally.queues[1].reportHeroes?.shield).toBe("hero.s11.eleonora");
    expect(changed.innerEarth!.ally.queues[0]).toEqual(input.innerEarth!.ally.queues[0]);
  });
  it("changing a laboratory T12 troop to T10 clears its T12 skill level", () => {
    const lab = fixture("UNDERGROUND_LAB");
    const t12 = updateInnerEarthField(lab, { field: "tier", troop: "shield" }, "LAB_T12");
    const trained = updateInnerEarthField(t12, { field: "t12", troop: "shield" }, "3");
    const t10 = updateInnerEarthField(trained, { field: "tier", troop: "shield" }, "T10");
    expect(t10.innerEarth!.ally.t12SkillLevels.shield).toBe(0);
    expect(() => assertInnerEarthInput(t10)).not.toThrow();
    expect(() => updateInnerEarthField(trained, { field: "t12", troop: "shield" }, "4")).toThrow(/最高3/);
  });
  it("returns to ordinary player levels after leaving the laboratory", () => {
    const lab = updateInnerEarthField(fixture("UNDERGROUND_LAB"), { field: "tier", troop: "shield" }, "LAB_T11");
    const heart = changeInnerEarthMode(lab, "HEART_OF_EARTH");
    expect(heart.innerEarth!.ally.troopTiers.shield).toBe("T10");
    expect(() => assertInnerEarthInput(heart)).not.toThrow();
  });
  it.each(["GEM_MINE", "EQUIPMENT_FORGE"] as const)("prevents editing the fixed enemy capacity in %s", (mode) => {
    expect(() => updateInnerEarthField(fixture(mode), { field: "enemy-capacity" }, "120000")).toThrow(/固定/);
  });
  it("rejects an invented enemy preset and disallowed pet edits", () => {
    expect(() => updateInnerEarthField(fixture(), { field: "enemy-preset" }, "CUSTOM")).toThrow(/两种/);
    expect(() => updateInnerEarthField(fixture("HERO_LAND"), { field: "pet", petField: "attackLevel" }, "5")).toThrow(/不使用宠物/);
  });
});
