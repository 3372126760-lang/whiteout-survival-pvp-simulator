import type { HeroSkillDefinition } from "../types";
import { NORAH_CATCH_OFF_GUARD } from "./s5Heroes";
import { MAGNUS_ICE_SEA_TACTICS } from "./s9Heroes";
import { ELEONORA_SOARING_FLAME } from "./s11Heroes";
import { FLORA_AROMATIC_MIST, FLORA_THORN_BUSH } from "./s13Heroes";
import {
  attributeModifier,
  attributeReduction,
  generationSceneWeapon,
  levelFiveGenerationSkill,
  reuseLevelFiveTemplate,
} from "./generationHeroBuilders";

const SOURCE = "2026-09-27 S15 rules inferred from earlier generations; PVP battle report unavailable";
const HANK = "hero.s15.hank";
const ESTRELLA = "hero.s15.estrella";
const VIVECA = "hero.s15.viveca";

export const HANK_ROARING_FURY = levelFiveGenerationSkill({
  source: SOURCE, generation: 15,
  id: "hero-skill.hank.roaring-fury", heroId: HANK,
  name: "汉克·轰鸣的怒火", slot: 1,
  effects: [attributeModifier(
    "hero-effect.hank.penetration", "penetration", .25, "heroPenetrationBonus",
  )],
});

export const HANK_SPARKS_FLY = reuseLevelFiveTemplate(ELEONORA_SOARING_FLAME, {
  source: SOURCE, generation: 15,
  id: "hero-skill.hank.sparks-fly", heroId: HANK,
  name: "汉克·火花四溅", slot: 2,
});

export const HANK_BERSERK_POWER = reuseLevelFiveTemplate(FLORA_AROMATIC_MIST, {
  source: SOURCE, generation: 15,
  id: "hero-skill.hank.berserk-power", heroId: HANK,
  name: "汉克·狂暴之力", slot: 3,
});

export const ESTRELLA_ECLIPSE_SORROW = levelFiveGenerationSkill({
  source: SOURCE, generation: 15,
  id: "hero-skill.estrella.eclipse-sorrow", heroId: ESTRELLA,
  name: "艾丝黛拉·月蚀哀色", slot: 1,
  effects: [attributeReduction("hero-effect.estrella.defense-reduction", "defense", "enemyDefenseReduction", .25)],
});

export const ESTRELLA_DAWN_CANVAS = levelFiveGenerationSkill({
  source: SOURCE, generation: 15,
  id: "hero-skill.estrella.dawn-canvas", heroId: ESTRELLA,
  name: "艾丝黛拉·黎明画卷", slot: 2,
  effects: [
    attributeModifier("hero-effect.estrella.attack", "attack", .15, "heroAttackBonus"),
    attributeModifier("hero-effect.estrella.defense", "defense", .10, "heroDefenseBonus"),
  ],
});

export const ESTRELLA_COLORFUL_SCENE = reuseLevelFiveTemplate(FLORA_THORN_BUSH, {
  source: SOURCE, generation: 15,
  id: "hero-skill.estrella.colorful-scene", heroId: ESTRELLA,
  name: "艾丝黛拉·浮彩盛景", slot: 3,
});

export const VIVECA_DARK_NIGHT_LEGION = levelFiveGenerationSkill({
  source: SOURCE, generation: 15,
  id: "hero-skill.viveca.dark-night-legion", heroId: VIVECA,
  name: "维薇卡·暗夜军团", slot: 1,
  effects: [attributeModifier(
    "hero-effect.viveca.attack", "attack", .25, "heroAttackBonus",
  )],
});

export const VIVECA_SHADOW_VISION: HeroSkillDefinition = {
  ...reuseLevelFiveTemplate(NORAH_CATCH_OFF_GUARD, {
  source: SOURCE, generation: 15,
  id: "hero-skill.viveca.shadow-vision", heroId: VIVECA,
  name: "维薇卡·暗影视界", slot: 2, sourceTroop: "marksman",
  forceParentBaseDamage: true,
  }),
  triggerTiming: "successfulNormalAttackHit",
};

export const VIVECA_CHILD_OF_MIST = reuseLevelFiveTemplate(MAGNUS_ICE_SEA_TACTICS, {
  source: SOURCE, generation: 15,
  id: "hero-skill.viveca.child-of-mist", heroId: VIVECA,
  name: "维薇卡·迷雾之子", slot: 3,
});

export const S15_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 15,
    id: "hero-weapon-skill.hank.defense-life", heroId: HANK,
    name: "汉克专武·绝望之墙", attribute: "life", group: "buffLife",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 15,
    id: "hero-weapon-skill.estrella.defense-attack", heroId: ESTRELLA,
    name: "艾丝黛拉专武·家园守护", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 15,
    id: "hero-weapon-skill.viveca.rally-penetration", heroId: VIVECA,
    name: "维薇卡专武·破晓之歌", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyAttack"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S15_HERO_SKILL_DEFINITIONS = [
  HANK_ROARING_FURY, HANK_SPARKS_FLY, HANK_BERSERK_POWER,
  ESTRELLA_ECLIPSE_SORROW, ESTRELLA_DAWN_CANVAS, ESTRELLA_COLORFUL_SCENE,
  VIVECA_DARK_NIGHT_LEGION, VIVECA_SHADOW_VISION, VIVECA_CHILD_OF_MIST,
  ...S15_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
