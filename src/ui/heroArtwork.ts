import { TROOP_SKILL_ART } from "./data/troopSkillArtData";
/// <reference types="vite/client" />
import { COMMON_HERO_ART, COMMON_SKILL_ART } from "./data/commonHeroArtData";
import { HERO_ART, SKILL_ART } from "./data/heroArtData";

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const names = new Map(Object.values({ ...SKILL_ART, ...COMMON_SKILL_ART }).map(art => [art.path, art.name]));

/** Local display assets only. No hero data or battle configuration is modified. */
export function renderHeroPortrait(heroId: string | null | undefined, className = "hero-portrait-art"): string {
  const art = heroId ? HERO_ART[heroId] ?? COMMON_HERO_ART[heroId] : undefined;
  return art ? `<img class="${className}" src="${url(art.portrait)}" alt="" aria-hidden="true" width="64" height="64" loading="lazy" decoding="async">` : "";
}
export function renderWeaponArt(heroId: string): string {
  const art = HERO_ART[heroId];
  return art ? `<img class="hero-weapon-art" src="${url(art.weapon)}" alt="${escape(art.weaponName)}" title="${escape(art.weaponName)}" width="56" height="56" loading="lazy" decoding="async">` : "";
}
export function renderSkillArt(skillId: string): string {
  const art = SKILL_ART[skillId] ?? COMMON_SKILL_ART[skillId] ?? TROOP_SKILL_ART[skillId];
  return art ? `<img class="hero-skill-art" src="${url(art.path)}" alt="" aria-hidden="true" title="${escape(art.name)}" width="30" height="30" loading="lazy" decoding="async">` : "";
}
export function renderHeroExpeditionArt(heroId: string): string {
  const art = HERO_ART[heroId] ?? COMMON_HERO_ART[heroId];
  return art ? `<div class="hero-expedition-art" aria-label="远征技能">${art.skills.map((path, slot) => `<img class="hero-skill-art" src="${url(path)}" alt="远征技能${slot + 1}：${escape(names.get(path) ?? "")}" title="${escape(names.get(path) ?? `远征技能${slot+1}`)}" width="30" height="30" loading="lazy" decoding="async">`).join("")}</div>` : "";
}
