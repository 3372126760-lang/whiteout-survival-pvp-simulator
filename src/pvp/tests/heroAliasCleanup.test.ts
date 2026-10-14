import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  EXPEDITION_HERO_DATA,
} from "../../pvp";

describe("hero registry without historical independent definitions", () => {
  it("contains only catalog heroes and keeps the formal registered skill count", () => {
    const catalogHeroIds = new Set(EXPEDITION_HERO_DATA.map((hero) => hero.id));
    expect(CONFIRMED_HERO_SKILL_DEFINITIONS).toHaveLength(204);
    expect(CONFIRMED_HERO_SKILL_DEFINITIONS.every(
      (definition) => catalogHeroIds.has(definition.heroId),
    )).toBe(true);
    expect(CONFIRMED_TROOP_SKILL_DEFINITIONS).toHaveLength(15);
    const heroEffects = CONFIRMED_HERO_SKILL_DEFINITIONS.reduce((total, definition) =>
      total + new Set(Object.values(definition.levelValues)
        .flatMap((level) => level.effects.map((effect) => effect.id))).size, 0);
    const troopEffects = CONFIRMED_TROOP_SKILL_DEFINITIONS.reduce((total, definition) =>
      total + new Set(Object.values(definition.levelValues)
        .flatMap((level) => level.effects.map((effect) => effect.id))).size, 0);
    expect(heroEffects).toBe(264);
    expect(troopEffects).toBe(18);
  });

  it("keeps the machine-readable inventory free of legacyAlias entries", () => {
    const path = fileURLToPath(new URL("../../../docs/pvp-skill-inventory.json", import.meta.url));
    const inventory = JSON.parse(readFileSync(path, "utf8")) as {
      readonly stats: { readonly registeredHeroSkillCount: number; readonly totalRegisteredEffectCount: number };
      readonly entries: readonly { readonly sourceType: string }[];
    };
    expect(inventory.entries.some((entry) => entry.sourceType === "legacyAlias")).toBe(false);
    // This JSON is the historical 2026-09-25 snapshot; current definitions include S16.
    expect(inventory.stats.registeredHeroSkillCount).toBe(195);
    expect(inventory.stats.totalRegisteredEffectCount).toBe(266);
  });
});
