import type { HeroSkillDefinition } from "../types";
import { HENDRIK_HEIR_OF_FOREST } from "./s8Heroes";
import { HERVOR_IMMORTAL_ARMY, LIGEIA_DISINTEGRATING_POISON } from "./s12Heroes";
import {
  attributeModifier,
  attributeReduction,
  damageModifier,
  levelFiveGenerationSkill,
  reuseLevelFiveTemplate,
} from "./generationHeroBuilders";

const SOURCE = "2026-09-27 provisional S16 model inferred from earlier generations; PVP battle report unavailable";
const SIGEL = "hero.s16.sigel";
const URSA = "hero.s16.ursa";
const AISHILIN = "hero.s16.aishilin";
const EVEN_ROUNDS = { periodRounds: 2, firstActiveRound: 2, activeWindowRounds: 1 } as const;
const THIRD_ROUNDS = { periodRounds: 3, firstActiveRound: 3, activeWindowRounds: 1 } as const;

export const SIGEL_DARK_ARMOR = levelFiveGenerationSkill({
  source: SOURCE, generation: 16,
  id: "hero-skill.sigel.dark-armor", heroId: SIGEL,
  name: "西格尔·暗夜铠胄", slot: 1,
  effects: [attributeModifier("hero-effect.sigel.life", "life", .25, "heroLifeBonus")],
});

export const SIGEL_ETERNAL_FORTRESS = levelFiveGenerationSkill({
  source: SOURCE, generation: 16,
  id: "hero-skill.sigel.eternal-fortress", heroId: SIGEL,
  name: "西格尔·永夜坚城", slot: 2,
  effects: [
    attributeReduction("hero-effect.sigel.self-shield-attack", "attack", "selfAttackReduction", .20,
      { recipient: "selfArmy", source: "shield" }),
    attributeReduction("hero-effect.sigel.enemy-lancer-attack", "attack", "enemyAttackReduction", .35,
      { source: "lancer" }),
    attributeReduction("hero-effect.sigel.enemy-marksman-attack", "attack", "enemyAttackReduction", .35,
      { source: "marksman" }),
  ],
});

export const SIGEL_NIGHT_VANGUARD = reuseLevelFiveTemplate(HERVOR_IMMORTAL_ARMY, {
  source: SOURCE, generation: 16,
  id: "hero-skill.sigel.night-vanguard", heroId: SIGEL,
  name: "西格尔·极夜先锋", slot: 3,
});

export const URSA_MUSHROOM_MAZE = levelFiveGenerationSkill({
  source: SOURCE, generation: 16,
  id: "hero-skill.ursa.mushroom-maze", heroId: URSA,
  name: "乌尔撒·蕈林迷踪", slot: 1,
  effects: [attributeReduction("hero-effect.ursa.enemy-attack", "attack", "enemyAttackReduction", .25)],
});

export const URSA_ANCESTRAL_HORN = levelFiveGenerationSkill({
  source: SOURCE, generation: 16,
  id: "hero-skill.ursa.ancestral-horn", heroId: URSA,
  name: "乌尔撒·先祖号角", slot: 2,
  effects: [
    attributeModifier("hero-effect.ursa.lancer-penetration", "penetration", .30,
      "heroPenetrationBonus", "addToAttribute", "lancer", EVEN_ROUNDS),
    attributeModifier("hero-effect.ursa.marksman-penetration", "penetration", .30,
      "heroPenetrationBonus", "addToAttribute", "marksman", EVEN_ROUNDS),
    attributeReduction("hero-effect.ursa.enemy-defense", "defense", "enemyDefenseReduction", .30,
      { lifecycle: EVEN_ROUNDS }),
  ],
  tags: ["periodic", "naturalRoundOnly"],
});

export const URSA_POISON_BLADE = reuseLevelFiveTemplate(LIGEIA_DISINTEGRATING_POISON, {
  source: SOURCE, generation: 16,
  id: "hero-skill.ursa.poison-blade", heroId: URSA,
  name: "乌尔撒·蕈毒尖刃", slot: 3, sourceTroop: "lancer",
});

export const AISHILIN_FOREST_SONG = levelFiveGenerationSkill({
  source: SOURCE, generation: 16,
  id: "hero-skill.aishilin.forest-song", heroId: AISHILIN,
  name: "艾诗琳·林间战曲", slot: 1,
  effects: [damageModifier({ id: "hero-effect.aishilin.army-damage",
    kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value: .20 })],
});

export const AISHILIN_ARROW_RAIN = levelFiveGenerationSkill({
  source: SOURCE, generation: 16,
  id: "hero-skill.aishilin.arrow-rain", heroId: AISHILIN,
  name: "艾诗琳·矢石如雨", slot: 2,
  effects: [
    damageModifier({ id: "hero-effect.aishilin.marksman-damage", kind: "damageIncrease",
      recipient: "selfArmy", group: "commonDamageIncrease", value: 1.50,
      source: "marksman", lifecycle: THIRD_ROUNDS }),
    damageModifier({ id: "hero-effect.aishilin.enemy-outgoing", kind: "outgoingDamageReduction",
      recipient: "enemyArmy", group: "enemyOutgoingDamageReduction", value: .30,
      lifecycle: THIRD_ROUNDS }),
  ],
  tags: ["periodic", "naturalRoundOnly"],
});

export const AISHILIN_FOREST_FURY = reuseLevelFiveTemplate(HENDRIK_HEIR_OF_FOREST, {
  source: SOURCE, generation: 16,
  id: "hero-skill.aishilin.forest-fury", heroId: AISHILIN,
  name: "艾诗琳·森林之怒", slot: 3,
});

export const S16_HERO_SKILL_DEFINITIONS = [
  SIGEL_DARK_ARMOR, SIGEL_ETERNAL_FORTRESS, SIGEL_NIGHT_VANGUARD,
  URSA_MUSHROOM_MAZE, URSA_ANCESTRAL_HORN, URSA_POISON_BLADE,
  AISHILIN_FOREST_SONG, AISHILIN_ARROW_RAIN, AISHILIN_FOREST_FURY,
] as const satisfies readonly HeroSkillDefinition[];
