import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createDefaultInnerEarthConfig, normalizeInnerEarthInput } from "../innerEarth";
import { isThreeQueueBattleInput } from "../scenario/scenePolicy";
import { optimizerRoute } from "../../ui/optimizerRoute";

describe("public and internal scene routing", () => {
  it("routes IceFire to queue optimization and Inner Earth to its dedicated route", () => {
    expect(optimizerRoute("ICE_FIRE_LEAGUE")).toBe("threeQueue");
    expect(optimizerRoute("INNER_EARTH")).toBe("innerEarth");
  });

  it.each(["HEART_OF_EARTH", "HERO_LAND", "BEAST_CAVE", "GEM_MINE",
    "UNDERGROUND_LAB", "EQUIPMENT_FORGE"] as const)("detects queue routing from %s", (mode) => {
    const input = createDefaultValidationInput();
    const earth = normalizeInnerEarthInput({ ...input, scenarioType: "INNER_EARTH",
      innerEarth: createDefaultInnerEarthConfig(input, mode) });
    expect(isThreeQueueBattleInput(earth)).toBe(mode === "HEART_OF_EARTH" || mode === "HERO_LAND");
  });
});
