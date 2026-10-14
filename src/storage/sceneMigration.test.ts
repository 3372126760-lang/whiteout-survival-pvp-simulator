import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../ui/defaultInput";
import { createDefaultInnerEarthConfig, normalizeInnerEarthInput } from "../pvp/innerEarth";
import { createPersistedEnvelope, restorePersistedConfig } from "./configCodec";
import { CURRENT_CONFIG_SCHEMA_VERSION } from "./storageTypes";

const base = () => ({ ...createDefaultValidationInput(), scenarioType: "SINGLE" as const });
function earth(subMode: Parameters<typeof createDefaultInnerEarthConfig>[1]) {
  const input = base();
  return normalizeInnerEarthInput({ ...input, scenarioType: "INNER_EARTH",
    innerEarth: createDefaultInnerEarthConfig(input, subMode) });
}

describe("scene migration and Inner Earth persistence", () => {
  it("migrates old IceFire to its dedicated scene without sharing queue attributes", () => {
    const input = { ...base(), scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const, threeQueueMode: "ICE_FIRE_LEAGUE" as const };
    const old = JSON.parse(JSON.stringify(createPersistedEnvelope(input, 100)));
    old.schemaVersion = 3;
    old.data.input.sideA.threeQueues[1].attributes.shield.attack = 714;
    const restored = restorePersistedConfig(old);
    expect(restored.input.scenarioType).toBe("ICE_FIRE_LEAGUE");
    expect(restored.input.threeQueueMode).toBe("ICE_FIRE_LEAGUE");
    expect(restored.input.sideA.troops).toEqual(input.sideA.troops);
    expect(restored.input.sideA.threeQueues?.[1].attributes?.shield.attack).toBe(714);
    expect(restored.sceneMigrated).toBe(true);
    expect(restored.sceneMigrationWarnings?.join(" ")).toContain("冰火战歌");
  });

  it("migrates legacy random challenges with a retained snapshot and explicit shared-enemy notice", () => {
    const input = { ...base(), scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const };
    const old = JSON.parse(JSON.stringify(createPersistedEnvelope(input, 100)));
    old.schemaVersion = 3;
    old.data.input.sideB.threeQueues[1].attributes.shield.attack = 9876;
    const restored = restorePersistedConfig(old);
    expect(restored.input.scenarioType).toBe("INNER_EARTH");
    expect(restored.input.innerEarth?.subMode).toBe("HEART_OF_EARTH");
    expect(restored.input.innerEarth?.enemy.shared.troopRatioPreset).toBe("BALANCED");
    expect(restored.input.legacySceneMigration?.originalSideB.threeQueues?.[1].attributes
      ?.shield.attack).toBe(9876);
    expect(restored.sceneMigrationWarnings?.join(" ")).toContain("共享属性取旧 B1");
    const saved = createPersistedEnvelope(restored.input, 100);
    expect(saved.schemaVersion).toBe(CURRENT_CONFIG_SCHEMA_VERSION);
    const again = restorePersistedConfig(saved);
    expect(again.input.legacySceneMigration).toEqual(restored.input.legacySceneMigration);
    expect(again.sceneMigrationWarnings).toEqual(restored.sceneMigrationWarnings);
  });

  it.each(["HEART_OF_EARTH", "HERO_LAND", "BEAST_CAVE", "GEM_MINE",
    "UNDERGROUND_LAB", "EQUIPMENT_FORGE"] as const)("roundtrips %s with its locked rule config", (mode) => {
    const input = earth(mode);
    const restored = restorePersistedConfig(createPersistedEnvelope(input, 100));
    expect(restored.input.innerEarth).toEqual(input.innerEarth);
    expect(restored.input.attributeInputMode).toBe(input.attributeInputMode);
  });

  it("rejects illegal enemy presets, over-level laboratory skills and an incompatible input mode", () => {
    const envelope = createPersistedEnvelope(earth("UNDERGROUND_LAB"), 100);
    const preset = JSON.parse(JSON.stringify(envelope));
    preset.data.input.innerEarth.enemy.shared.troopRatioPreset = "CUSTOM";
    expect(() => restorePersistedConfig(preset)).toThrow(/troopRatioPreset/);
    const skill = JSON.parse(JSON.stringify(envelope));
    skill.data.input.innerEarth.ally.t12SkillLevels.shield = 4;
    expect(() => restorePersistedConfig(skill)).toThrow(/t12SkillLevels/);
    const mode = JSON.parse(JSON.stringify(envelope));
    mode.data.input.attributeInputMode = "prediction";
    expect(() => restorePersistedConfig(mode)).toThrow();
  });
});
