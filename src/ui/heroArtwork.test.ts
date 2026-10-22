import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { HERO_ART, SKILL_ART } from "./data/heroArtData";
import { renderHeroPortrait, renderWeaponArt, renderSkillArt, renderHeroExpeditionArt } from "./heroArtwork";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, EXPEDITION_HERO_DATA } from "../pvp/heroSkills";

describe("local hero artwork", () => {
  it("verifies every bundled image and its recorded source", () => {
    const manifest = JSON.parse(readFileSync("public/assets/heroes/manifest.json","utf8"));
    expect(Object.keys(HERO_ART)).toHaveLength(49);
    const assets = new Map<string, {path:string;sha256:string;source:string}>();
    type Asset = { path:string; sha256:string; source:string };
    for (const hero of Object.values(manifest.heroes) as { portrait:Asset; weapon:Asset; expeditionSkills:Asset[]; weaponSkill:Asset }[]) {
      for (const art of [hero.portrait,hero.weapon,...hero.expeditionSkills,hero.weaponSkill]) assets.set(art.path,art);
    }
    expect(assets.size).toBe(294);
    for (const art of assets.values()) {
      const file=readFileSync(`public/${art.path}`);
      expect(file.subarray(8,12).toString()).toBe("WEBP");
      expect(createHash("sha256").update(file).digest("hex")).toBe(art.sha256);
      expect(art.source).toMatch(/^https:\/\/wos\.h5joy-games\.com\/games\//);
    }
  });
  it("maps expedition slots without exploration icons or numerical rule changes", () => {
    for (const hero of EXPEDITION_HERO_DATA.filter(h=>HERO_ART[h.id])) {
      for (const skill of hero.expeditionSkills) {
        expect(SKILL_ART[skill.id]?.path).toBe(HERO_ART[hero.id]!.skills[skill.expeditionSkillSlot-1]);
      }
      for (const skill of CONFIRMED_HERO_SKILL_DEFINITIONS.filter(s=>s.heroId===hero.id)) {
        if(skill.positionRule.kind === "expeditionSkillSlot") expect(SKILL_ART[skill.id]?.path).toBe(HERO_ART[hero.id]!.skills[skill.positionRule.expeditionSkillSlot-1]);
      }
    }
    expect(renderHeroExpeditionArt("hero.s16.sigel")).toContain("armor_of_night");
    expect(renderHeroExpeditionArt("hero.s16.sigel")).not.toContain("spike_guard");
  });
  it("renders local assets and leaves unsupported heroes with existing placeholders", () => {
    expect(renderHeroPortrait("hero.s16.sigel")).toContain("/assets/heroes/icon_hero_avatar_seigel.webp");
    expect(renderWeaponArt("hero.s16.sigel")).toContain("blacklight_halberd");
    expect(renderSkillArt("hero-skill.sigel.night-vanguard")).toContain("vanguard_of_eternity");
    expect(renderHeroPortrait("hero.sr.xieergai")).toBe("");
    expect(renderHeroPortrait(null)).toBe("");
    expect(renderSkillArt("unknown")).toBe("");
  });
});
