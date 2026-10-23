import { COMMON_HERO_ART, COMMON_SKILL_ART } from "./data/commonHeroArtData";
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
    expect(renderHeroPortrait("hero.sr.xieergai")).toContain("sergey.png");
    expect(renderHeroPortrait(null)).toBe("");
    expect(renderSkillArt("unknown")).toBe("");
  });
});

describe("R/SR artwork", () => {
 it("matches each expedition slot and runtime skill to verified local WosGift images", () => {
  expect(Object.keys(COMMON_HERO_ART)).toHaveLength(13);
  const manifest = JSON.parse(readFileSync("public/assets/heroes-common/manifest.json", "utf8")) as {path:string;name:string;sha256:string}[];
  expect(manifest).toHaveLength(39);
  for (const art of manifest) expect(createHash("sha256").update(readFileSync(`public/${art.path}`)).digest("hex")).toBe(art.sha256);
  for (const hero of EXPEDITION_HERO_DATA.filter(h => COMMON_HERO_ART[h.id])) {
   expect(renderHeroPortrait(hero.id)).toContain(COMMON_HERO_ART[hero.id]!.portrait);
   expect(renderWeaponArt(hero.id)).toBe("");
   for (const skill of hero.expeditionSkills) {
    const path = COMMON_HERO_ART[hero.id]!.skills[skill.expeditionSkillSlot - 1];
    expect(COMMON_SKILL_ART[skill.id]?.path).toBe(path);
    expect(manifest.find(a => a.path === path)?.name).toBe(hero.id === "hero.sr.lumubogen" && skill.expeditionSkillSlot === 2 ? "彩虹桥勇士" : skill.name);
    if (skill.combatSkillDefinitionId) expect(renderSkillArt(skill.combatSkillDefinitionId)).toContain(path);
   }
  }
 });
});

it("renders the troop skills in combat statistics from verified local files",()=>{
 const manifest=JSON.parse(readFileSync("public/assets/troop-skills/manifest.json","utf8")) as Record<string,{path:string;sha256:string}>;
 expect(Object.keys(manifest)).toHaveLength(12);
 for(const [id,art] of Object.entries(manifest)) {
  expect(renderSkillArt(id)).toContain(art.path);
  expect(createHash("sha256").update(readFileSync(`public/${art.path}`)).digest("hex")).toBe(art.sha256);
 }
 expect(renderSkillArt("shield-immortal-wall-t12")).toContain("t12-shield-skill.png");
});
