import type { HeroSkillDefinition } from "../types";
import {
  attributeModifier,
  damageModifier,
  attributeReduction,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
} from "./generationHeroBuilders";

const SOURCE = "2026-09-27 S12 rules inferred from earlier generations; PVP battle report unavailable";
const HERVOR = "hero.s12.hervor";
const KAROL = "hero.s12.karol";
const LIGEIA = "hero.s12.ligeia";

export const HERVOR_WAR_CRY = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.hervor.war-cry", heroId: HERVOR,
  name: "赫尔薇尔·战争怒吼", slot: 1,
  effects: [attributeModifier(
    "hero-effect.hervor.penetration", "penetration", .25, "heroPenetrationBonus",
  )],
});

export const HERVOR_IMMORTAL_ARMY = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.hervor.immortal-army", heroId: HERVOR,
  name: "赫尔薇尔·不灭之师", slot: 2,
  effects: [
    damageModifier({ id: "hero-effect.hervor.immortal-army.normal", kind: "damageReduction", recipient: "selfArmy", group: "receivedNormalAttackReduction", value: .25, target: "shield", damageType: "normalAttack" }),
    damageModifier({ id: "hero-effect.hervor.immortal-army.skill", kind: "damageReduction", recipient: "selfArmy", group: "receivedSkillDamageReduction", value: .30, target: "shield", damageType: "skillDamage" }),
  ],
  tags: ["wuMingDamageTypeReductionTemplate"],
});

export const HERVOR_WILL_OF_WAR = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.hervor.will-of-war", heroId: HERVOR,
  name: "赫尔薇尔·战火意志", slot: 3,
  effects: [
    damageModifier({ id: "hero-effect.hervor.shield-reduction", kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value: .15, target: "shield" }),
    damageModifier({ id: "hero-effect.hervor.shield-damage", kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value: .10, source: "shield" }),
  ],
});

export const KAROL_GUARDIAN_WINGS = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.karol.guardian-wings", heroId: KAROL,
  name: "加罗尔·守护之翼", slot: 1,
  effects: [damageModifier({
    id: "hero-effect.karol.guardian-wings", kind: "damageReduction",
    recipient: "selfArmy", group: "receivedDamageReduction", value: .20,
  })],
});

export const KAROL_FORMATION_BREAKING_SPEAR = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.karol.formation-breaking-spear", heroId: KAROL,
  name: "加罗尔·破阵之矛", slot: 2,
  effects: [
    damageModifier({ id: "hero-effect.karol.vs-lancer", kind: "damageIncrease", recipient: "selfArmy", group: "troopVsTroopDamage", value: .30, target: "lancer" }),
    damageModifier({ id: "hero-effect.karol.vs-shield", kind: "damageIncrease", recipient: "selfArmy", group: "troopVsTroopDamage", value: .25, target: "shield" }),
  ],
  tags: ["targetTroopModifier", "bearModelSemantic"],
});

export const KAROL_BANNER_OF_GLORY = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.karol.banner-of-glory", heroId: KAROL,
  name: "加罗尔·荣耀战旗", slot: 3,
  effects: [
    attributeModifier("hero-effect.karol.attack", "attack", .15, "heroAttackBonus"),
    attributeModifier("hero-effect.karol.defense", "defense", .10, "heroDefenseBonus"),
  ],
});

export const LIGEIA_STEEL_FANG_GNAW = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.ligeia.steel-fang-gnaw", heroId: LIGEIA,
  name: "丽姬娅·钢牙啃噬", slot: 1,
  effects: [attributeReduction("hero-effect.ligeia.defense-reduction", "defense", "enemyDefenseReduction", .25)],
});

export const LIGEIA_DISINTEGRATING_POISON = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.ligeia.disintegrating-poison", heroId: LIGEIA,
  name: "丽姬娅·瓦解之毒", slot: 2, trigger: "afterNormalAttack",
  triggerTiming: "successfulNormalAttackHit",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "marksman", interval: 2, mode: "onCompleted" },
  },
  effects: [
    extraDamage("hero-effect.ligeia.disintegrating-poison.extra", 1, "marksman", "currentTarget", "parentBaseDamage"),
    damageModifier({ id: "hero-effect.ligeia.disintegrating-poison.vulnerability", kind: "incomingDamageIncrease", recipient: "enemyArmy", group: "vulnerability", value: .25, target: "currentTarget", lifecycle: { activationTiming: "nextRound", durationRounds: 1, refreshMode: "replace" } }),
  ],
  tags: ["usesAttackCount", "sharedMarksmanAttackCounter", "hitTargetTroop", "bearModelSemantic"],
});

export const LIGEIA_VENOM_FANG_ASSAULT = levelFiveGenerationSkill({
  source: SOURCE, generation: 12,
  id: "hero-skill.ligeia.venom-fang-assault", heroId: LIGEIA,
  name: "丽姬娅·毒牙侵袭", slot: 3, trigger: "afterNormalAttack",
  triggerTiming: "successfulNormalAttackHit",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "marksman", interval: 2, mode: "onCompleted" },
  },
  effects: [
    extraDamage("hero-effect.ligeia.venom-fang-assault.extra", 1, "marksman", "currentTarget", "parentBaseDamage"),
    damageModifier({ id: "hero-effect.ligeia.venom-fang-assault.poison", kind: "outgoingDamageReduction", recipient: "enemyArmy", group: "enemyOutgoingDamageReduction", value: .20, source: "army", target: "currentTarget", lifecycle: { activationTiming: "nextRound", durationRounds: 1, refreshMode: "replace" } }),
  ],
  tags: ["usesAttackCount", "sharedMarksmanAttackCounter", "hitTargetTroop", "poisonTarget", "gordonPoisonTemplate"],
});

export const S12_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 12,
    id: "hero-weapon-skill.hervor.defense-defense", heroId: HERVOR,
    name: "赫尔薇尔专武·霜风坚垒", attribute: "defense", group: "buffDefense",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 12,
    id: "hero-weapon-skill.karol.rally-attack", heroId: KAROL,
    name: "加罗尔专武·集群猛攻", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyAttack"] }),
  generationSceneWeapon({ source: SOURCE, generation: 12,
    id: "hero-weapon-skill.ligeia.defense-penetration", heroId: LIGEIA,
    name: "丽姬娅专武·蜘蛛巢城", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S12_HERO_SKILL_DEFINITIONS = [
  HERVOR_WAR_CRY, HERVOR_IMMORTAL_ARMY, HERVOR_WILL_OF_WAR,
  KAROL_GUARDIAN_WINGS, KAROL_FORMATION_BREAKING_SPEAR, KAROL_BANNER_OF_GLORY,
  LIGEIA_STEEL_FANG_GNAW, LIGEIA_DISINTEGRATING_POISON, LIGEIA_VENOM_FANG_ASSAULT,
  ...S12_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
