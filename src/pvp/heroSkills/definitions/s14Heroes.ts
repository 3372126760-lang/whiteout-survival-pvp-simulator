import type { HeroSkillDefinition } from "../types";
import { WAYNE_FLANKING_STRIKE } from "./s6Heroes";
import { GATOT_KINGS_GIFT } from "./s8Heroes";
import { FREYA_AGILE_STRIKE } from "./s10Heroes";
import { RUFUS_ARMOR_BREAKING_STRIKE } from "./s11Heroes";
import {
  attributeModifier,
  attributeReduction,
  damageModifier,
  generationSceneWeapon,
  levelFiveGenerationSkill,
  reuseLevelFiveTemplate,
} from "./generationHeroBuilders";

const SOURCE = "2026-09-27 S14 rules inferred from earlier generations; PVP battle report unavailable";
const ELIF = "hero.s14.elif";
const DOMINIC = "hero.s14.dominic";
const CARA = "hero.s14.cara";

export const ELIF_LIGHT_VEIL_BINDING = levelFiveGenerationSkill({
  source: SOURCE, generation: 14,
  id: "hero-skill.elif.light-veil-binding", heroId: ELIF,
  name: "艾丽芙·轻纱之缚", slot: 1,
  effects: [attributeReduction(
    "hero-effect.elif.light-veil-binding", "attack", "enemyAttackReduction", .25,
  )],
});

export const ELIF_THOUSAND_BLADE_FORMATION = levelFiveGenerationSkill({
  source: SOURCE, generation: 14,
  id: "hero-skill.elif.thousand-blade-formation", heroId: ELIF,
  name: "艾丽芙·千刃之阵", slot: 2,
  effects: [
    attributeModifier("hero-effect.elif.attack", "attack", .15, "heroAttackBonus"),
    attributeModifier("hero-effect.elif.defense", "defense", .10, "heroDefenseBonus"),
  ],
});

export const ELIF_BROCADE_VEIL = reuseLevelFiveTemplate(GATOT_KINGS_GIFT, {
  source: SOURCE, generation: 14,
  id: "hero-skill.elif.brocade-veil", heroId: ELIF,
  name: "艾丽芙·绫绮之幕", slot: 3,
});

export const DOMINIC_SHAPESHIFTING_MECHANISM = levelFiveGenerationSkill({
  source: SOURCE, generation: 14,
  id: "hero-skill.dominic.shapeshifting-mechanism", heroId: DOMINIC,
  name: "多米尼克·幻形机巧", slot: 1,
  effects: [damageModifier({
    id: "hero-effect.dominic.shapeshifting-mechanism",
    kind: "damageIncrease", recipient: "selfArmy",
    group: "commonDamageIncrease", value: .20,
  })],
});

export const DOMINIC_ROSE_THRUST = reuseLevelFiveTemplate(RUFUS_ARMOR_BREAKING_STRIKE, {
  source: SOURCE, generation: 14,
  id: "hero-skill.dominic.rose-thrust", heroId: DOMINIC,
  name: "多米尼克·玫瑰突刺", slot: 2, sourceTroop: "lancer",
});

export const DOMINIC_MIRROR_MAZE = reuseLevelFiveTemplate(FREYA_AGILE_STRIKE, {
  source: SOURCE, generation: 14,
  id: "hero-skill.dominic.mirror-maze", heroId: DOMINIC,
  name: "多米尼克·魔镜迷宫", slot: 3,
});

export const CARA_HEAVY_MIST = levelFiveGenerationSkill({
  source: SOURCE, generation: 14,
  id: "hero-skill.cara.heavy-mist", heroId: CARA,
  name: "卡拉·迷雾重重", slot: 1,
  effects: [attributeReduction(
    "hero-effect.cara.heavy-mist", "penetration", "enemyPenetrationReduction", .20,
  )],
});

export const CARA_MECHANICAL_PET = levelFiveGenerationSkill({
  source: SOURCE, generation: 14,
  id: "hero-skill.cara.mechanical-pet", heroId: CARA,
  name: "卡拉·机械魔宠", slot: 2,
  effects: [damageModifier({
    id: "hero-effect.cara.mechanical-pet", kind: "damageIncrease",
    recipient: "selfArmy", group: "normalAttackDamageIncrease", value: .30,
    damageType: "normalAttack",
  })],
});

export const CARA_WITCH_ASSAULT = reuseLevelFiveTemplate(WAYNE_FLANKING_STRIKE, {
  source: SOURCE, generation: 14,
  id: "hero-skill.cara.witch-assault", heroId: CARA,
  name: "卡拉·魔女的强袭", slot: 3,
  tags: ["wayneFlankingTemplate"],
});

export const S14_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 14,
    id: "hero-weapon-skill.elif.defense-defense", heroId: ELIF,
    name: "艾丽芙专武·卫戍之恩", attribute: "defense", group: "buffDefense",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 14,
    id: "hero-weapon-skill.dominic.rally-penetration", heroId: DOMINIC,
    name: "多米尼克专武·宏大幻想", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyAttack"] }),
  generationSceneWeapon({ source: SOURCE, generation: 14,
    id: "hero-weapon-skill.cara.defense-penetration", heroId: CARA,
    name: "卡拉专武·迷雾避难所", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S14_HERO_SKILL_DEFINITIONS = [
  ELIF_LIGHT_VEIL_BINDING, ELIF_THOUSAND_BLADE_FORMATION, ELIF_BROCADE_VEIL,
  DOMINIC_SHAPESHIFTING_MECHANISM, DOMINIC_ROSE_THRUST, DOMINIC_MIRROR_MAZE,
  CARA_HEAVY_MIST, CARA_MECHANICAL_PET, CARA_WITCH_ASSAULT,
  ...S14_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
