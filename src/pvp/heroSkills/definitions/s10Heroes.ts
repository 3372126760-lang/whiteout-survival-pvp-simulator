import type { HeroSkillDefinition } from "../types";
import {
  attributeModifier,
  attributeReduction,
  damageModifier,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
  normalAttackCritical,
  wayneFlankingDamage,
} from "./generationHeroBuilders";

const SOURCE = "confirmed S10 expedition PVP rules, 2026-09-27";
const GREGORY = "hero.s10.gregory";
const FREYA = "hero.s10.freya";
const BLANCHETTE = "hero.s10.blanchette";

export const GREGORY_BLAZING_SUN_ARMY = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.gregory.blazing-sun-army", heroId: GREGORY,
  name: "格里高利·炽阳之师", slot: 1,
  effects: [
    attributeModifier("hero-effect.gregory.attack", "attack", .15, "heroAttackBonus"),
    attributeModifier("hero-effect.gregory.defense", "defense", .10, "heroDefenseBonus"),
  ],
});

export const GREGORY_STEEL_PHALANX = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.gregory.steel-phalanx", heroId: GREGORY,
  name: "格里高利·钢铁方阵", slot: 2, trigger: "beforeAttack", probability: .25,
  effects: [normalAttackCritical("hero-effect.gregory.steel-phalanx.critical")],
  tags: ["criticalNormalAttack", "perTroopAttack", "wayneCriticalTemplate"],
});

export const GREGORY_STEEL_DEFENSE = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.gregory.steel-defense", heroId: GREGORY,
  name: "格里高利·钢铁防线", slot: 3,
  effects: [damageModifier({
    id: "hero-effect.gregory.steel-defense", kind: "damageReduction",
    recipient: "selfArmy", group: "receivedDamageReduction", value: .20,
    target: "shield",
  })],
});

export const FREYA_TWILIGHT_MIST = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.freya.twilight-mist", heroId: FREYA,
  name: "芙蕾雅·暮色迷雾", slot: 1,
  effects: [attributeReduction(
    "hero-effect.freya.twilight-mist", "attack", "enemyAttackReduction", .20,
  )],
});

export const FREYA_CRESCENT_SCYTHE = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.freya.crescent-scythe", heroId: FREYA,
  name: "芙蕾雅·新月之镰", slot: 2,
  trigger: "afterNormalAttack", probability: .50,
  triggerTiming: "successfulNormalAttackHit",
  effects: [extraDamage(
    "hero-effect.freya.crescent-scythe.extra", 1, "lancer", "currentTarget", "parentBaseDamage",
  )],
  tags: ["perTroopAttack", "extraDamageNotAdditionalAttack", "bearModelSemantic"],
});

export const FREYA_AGILE_STRIKE = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.freya.agile-strike", heroId: FREYA,
  name: "芙蕾雅·灵动一击", slot: 3,
  effects: [
    damageModifier({ id: "hero-effect.freya.shield-reduction", kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value: .15, target: "shield" }),
    damageModifier({ id: "hero-effect.freya.marksman-reduction", kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value: .15, target: "marksman" }),
    damageModifier({ id: "hero-effect.freya.shield-damage", kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value: .15, source: "shield" }),
    damageModifier({ id: "hero-effect.freya.marksman-damage", kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value: .15, source: "marksman" }),
  ],
});

export const BLANCHETTE_CRIMSON_HUNTING_BLADE = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.blanchette.crimson-hunting-blade", heroId: BLANCHETTE,
  name: "布兰琪·真红猎刃", slot: 1,
  effects: [attributeModifier(
    "hero-effect.blanchette.penetration", "penetration", .25, "heroPenetrationBonus",
  )],
});

export const BLANCHETTE_CRIMSON_BURST = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.blanchette.crimson-burst", heroId: BLANCHETTE,
  name: "布兰琪·炽红爆裂", slot: 2, trigger: "afterNormalAttack",
  actionMechanic: { kind: "naturalRoundTrigger", source: "marksman" },
  triggerTiming: "mainAttackAttempt",
  periodRounds: 3, periodStartRound: 3,
  effects: [extraDamage(
    "hero-effect.blanchette.crimson-burst.extra", .75, "marksman", "currentTarget", "parentBaseDamage",
  )],
  tags: ["periodic", "bearModelSemantic", "extraDamageNotAdditionalAttack"],
});

export const BLANCHETTE_DAWN_SNIPER = levelFiveGenerationSkill({
  source: SOURCE, generation: 10,
  id: "hero-skill.blanchette.dawn-sniper", heroId: BLANCHETTE,
  name: "布兰琪·曙红狙刺", slot: 3, trigger: "beforeAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "marksman", interval: 2, mode: "onCompleted" },
  },
  effects: wayneFlankingDamage("hero-effect.blanchette.dawn-sniper"),
  tags: ["usesAttackCount", "multiTargetExtraDamage", "noRetarget", "wayneFlankingTemplate"],
});

export const S10_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 10,
    id: "hero-weapon-skill.gregory.defense-penetration", heroId: GREGORY,
    name: "格里高利专武·烈日坚城", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 10,
    id: "hero-weapon-skill.freya.defense-defense", heroId: FREYA,
    name: "芙蕾雅专武·备夜守望", attribute: "defense", group: "buffDefense",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 10,
    id: "hero-weapon-skill.blanchette.rally-penetration", heroId: BLANCHETTE,
    name: "布兰琪专武·焰红雷霆", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyAttack"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S10_HERO_SKILL_DEFINITIONS = [
  GREGORY_BLAZING_SUN_ARMY, GREGORY_STEEL_PHALANX, GREGORY_STEEL_DEFENSE,
  FREYA_TWILIGHT_MIST, FREYA_CRESCENT_SCYTHE, FREYA_AGILE_STRIKE,
  BLANCHETTE_CRIMSON_HUNTING_BLADE, BLANCHETTE_CRIMSON_BURST,
  BLANCHETTE_DAWN_SNIPER,
  ...S10_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
