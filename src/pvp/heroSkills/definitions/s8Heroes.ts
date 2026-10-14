import type { HeroSkillDefinition } from "../types";
import {
  attributeModifier,
  damageModifier,
  defenseAttribute,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
  skipNextRoundAction,
  temporaryShield,
} from "./generationHeroBuilders";

const SOURCE = "2026-09-27 user-confirmed S8 PVP rules";
const GATOT = "hero.s8.jiatuo";
const SONYA = "hero.s8.suoniya";
const HENDRIK = "hero.s8.hengdelike";

export const GATOT_GOLDEN_GUARD = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.jiatuo.golden-guard", heroId: GATOT,
  name: "加托·黄金近卫", slot: 1,
  effects: [attributeModifier(
    "hero-effect.jiatuo.shield-defense", "defense", .30,
    "heroDefenseBonus", "addToAttribute", "shield",
  )],
});

const gatotKingsGiftLevelFive = levelFiveGenerationSkill({
  source: "2026-09-27 user-confirmed Gatot PVP shield formula and Sheet2/Sheet3 level-4 experiments", generation: 8,
  id: "hero-skill.jiatuo.kings-gift", heroId: GATOT,
  name: "加托·列王恩赐", slot: 2, trigger: "afterNormalAttack",
  activationTiming: "nextRound",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "shield", interval: 1, mode: "onCompleted" },
  },
  effects: [temporaryShield("hero-effect.jiatuo.kings-gift", .30, "shield", "gatotReportAttackPower", "nextRound")],
  tags: ["temporaryShieldHp", "gatotReportAttackPower", "nextRound", "replaceOnMainAttack"],
});

export const GATOT_KINGS_GIFT: HeroSkillDefinition = {
  ...gatotKingsGiftLevelFive,
  levelValues: {
    4: {
      versionLabel: "Expedition Lv.4 (Sheet2/Sheet3)",
      effects: [temporaryShield("hero-effect.jiatuo.kings-gift", .24, "shield", "gatotReportAttackPower", "nextRound")],
    },
    ...gatotKingsGiftLevelFive.levelValues,
  },
};

export const GATOT_KINGS_ARMY = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.jiatuo.kings-army", heroId: GATOT,
  name: "加托·王者之师", slot: 3,
  effects: [{
    id: "hero-effect.jiatuo.enemy-attack-reduction",
    name: "hero-effect.jiatuo.enemy-attack-reduction",
    kind: "attributeReduction", recipient: "enemyArmy",
    attribute: "attack", group: "enemyAttackReduction", value: .25,
    scope: { source: "army", target: "all", damageType: "all" },
  }],
});

export const SONYA_TREASURE_HUNTER = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.suoniya.treasure-hunter", heroId: SONYA,
  name: "索妮娅·宝藏猎人", slot: 1,
  effects: [damageModifier({
    id: "hero-effect.suoniya.treasure-hunter",
    kind: "damageIncrease", recipient: "selfArmy",
    group: "commonDamageIncrease", value: .20,
  })],
  tags: ["bearModelSemantic"],
});

export const SONYA_BOUNTY_TEMPTATION = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.suoniya.bounty-temptation", heroId: SONYA,
  name: "索妮娅·赏金诱惑", slot: 2, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "lancer", interval: 2, mode: "onCompleted" },
  },
  effects: [
    extraDamage("hero-effect.suoniya.bounty-temptation.extra", .75, "lancer", "currentTarget", "parentBaseDamage"),
    attributeModifier(
      "hero-effect.suoniya.bounty-temptation.attack", "attack", .25,
      "heroAttackBonus", "addToAttribute", "army",
      { activationTiming: "nextRound", durationRounds: 1, refreshMode: "replace" },
    ),
  ],
  tags: ["usesAttackCount", "bearModelSemantic"],
});

export const SONYA_TORRENT_IMPACT = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.suoniya.torrent-impact", heroId: SONYA,
  name: "索妮娅·激流冲击", slot: 3, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "naturalRoundTrigger", source: "lancer",
  },
  periodRounds: 5, periodStartRound: 5,
  effects: [
    extraDamage("hero-effect.suoniya.torrent-impact.extra", 2.50, "lancer", "currentTarget", "parentBaseDamage"),
    skipNextRoundAction("hero-effect.suoniya.torrent-impact.stun", "lancer"),
  ],
  tags: ["periodic", "hitTargetTroop", "stun", "bearModelSemantic"],
});

export const HENDRIK_DEFENSE_REDUCTION_S8 = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.s8.hengdelike.defense-reduction", heroId: HENDRIK,
  name: "亨德里克·蝙虫之噬", slot: 1,
  effects: [{
    id: "hero-effect.s8.hengdelike.defense-reduction",
    name: "hero-effect.s8.hengdelike.defense-reduction",
    kind: "attributeReduction", recipient: "enemyArmy",
    attribute: "defense", group: "enemyDefenseReduction", value: .25,
    scope: { source: "army", target: "all", damageType: "all" },
  }],
});

export const HENDRIK_BARNACLE_ARMOR = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.s8.hengdelike.barnacle-armor", heroId: HENDRIK,
  name: "亨德里克·藤壶之铠", slot: 2,
  effects: [defenseAttribute(
    "hero-effect.s8.hengdelike.barnacle-armor", .30, "all",
    {
      periodRounds: 4, firstActiveRound: 5, activeWindowRounds: 2,
      refreshMode: "replace",
    },
  )],
  tags: ["periodicDefenseBuff", "rounds5-6-9-10"],
});

export const HENDRIK_HEIR_OF_FOREST = levelFiveGenerationSkill({
  source: SOURCE, generation: 8,
  id: "hero-skill.s8.hengdelike.heir-of-forest", heroId: HENDRIK,
  name: "亨德里克·大森之嗣", slot: 3, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "naturalRoundTrigger", source: "marksman",
  },
  periodRounds: 3, periodStartRound: 3,
  effects: [extraDamage(
    "hero-effect.s8.hengdelike.heir-of-forest.all", .40,
    "marksman", "all", "parentBaseDamage",
  )],
  tags: ["periodic", "multiTargetExtraDamage", "bearModelSemantic"],
});

export const S8_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 8,
    id: "hero-weapon-skill.jiatuo.defense-defense", heroId: GATOT,
    name: "加托专武·不灭之城", attribute: "defense", group: "buffDefense",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 8,
    id: "hero-weapon-skill.suoniya.defense-penetration", heroId: SONYA,
    name: "索妮娅专武·涡流炮台", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 8,
    id: "hero-weapon-skill.s8.hengdelike.rally-attack", heroId: HENDRIK,
    name: "亨德里克专武·深渊之佑", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyAttack"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S8_HERO_SKILL_DEFINITIONS = [
  GATOT_GOLDEN_GUARD, GATOT_KINGS_GIFT, GATOT_KINGS_ARMY,
  SONYA_TREASURE_HUNTER, SONYA_BOUNTY_TEMPTATION, SONYA_TORRENT_IMPACT,
  HENDRIK_DEFENSE_REDUCTION_S8, HENDRIK_BARNACLE_ARMOR,
  HENDRIK_HEIR_OF_FOREST,
  ...S8_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
