import type { HeroSkillDefinition, HeroSkillEffect } from "../types";
import {
  damageModifier,
  decayingNormalDamage,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
} from "./generationHeroBuilders";

const SOURCE = "S5 expedition PVP battle-report confirmation, 2026-09-25; 095fe8e6/已粘贴的文本.txt";
const HECTOR = "hero.s5.heketuo";
const NORAH = "hero.s5.nuola";
const GWEN = "hero.s5.gewen";
const hectorGaleExtra: HeroSkillEffect = {
  id: "hero-effect.heketuo.gale-strike.extra",
  name: "赫克托·疾风猛击额外伤害",
  kind: "extraDamage",
  recipient: "selfArmy",
  coefficient: 1,
  basis: "parentBaseDamage",
  scope: { source: "army", target: "currentTarget", damageType: "skillDamage" },
};

export const HECTOR_SURVIVAL_INSTINCT = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.heketuo.survival-instinct", heroId: HECTOR,
  name: "赫克托·生存本能", slot: 1, trigger: "roundStart", probability: .40,
  effects: [damageModifier({
    id: "hero-effect.heketuo.survival-instinct", kind: "damageReduction",
    recipient: "selfArmy", group: "receivedDamageReduction", value: .50,
    lifecycle: { activationTiming: "immediate", durationRounds: 1, refreshMode: "replace" },
  })],
  tags: ["oncePerRound", "jasmineReductionTemplate", "bearModelSemantic"],
});

export const HECTOR_THUNDER_STRIKE = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.heketuo.thunder-strike", heroId: HECTOR,
  name: "赫克托·雷霆出击", slot: 2,
  effects: [decayingNormalDamage(
    "hero-effect.heketuo.thunder-strike",
    { shield: 2, marksman: 1 },
    .85,
    10,
  )],
  tags: ["usesAttackCount", "bearModelSemantic", "normalAttackDamageNotExtra"],
});

export const HECTOR_GALE_STRIKE = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.heketuo.gale-strike", heroId: HECTOR,
  name: "赫克托·疾风猛击", slot: 3, trigger: "afterNormalAttack", probability: .25,
  effects: [hectorGaleExtra],
  tags: ["postDodge", "perSuccessfulMainAttack", "extraDamageNotAdditionalAttack"],
});

export const NORAH_MULTI_TROOP_COMBAT = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.nuola.multi-troop-combat", heroId: NORAH,
  name: "诺拉·多兵种作战", slot: 1,
  effects: [
    damageModifier({
      id: "hero-effect.nuola.multi-troop-combat.shield-damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: .15, source: "shield",
    }),
    damageModifier({
      id: "hero-effect.nuola.multi-troop-combat.marksman-damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: .15, source: "marksman",
    }),
    damageModifier({
      id: "hero-effect.nuola.multi-troop-combat.shield-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedDamageReduction", value: .15, target: "shield",
    }),
    damageModifier({
      id: "hero-effect.nuola.multi-troop-combat.marksman-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedDamageReduction", value: .15, target: "marksman",
    }),
  ],
  tags: ["bearModelSemantic", "pvpStaticReduction"],
});

export const NORAH_CATCH_OFF_GUARD = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.nuola.catch-off-guard", heroId: NORAH,
  name: "诺拉·攻其不备", slot: 2, trigger: "afterNormalAttack", probability: .20,
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "lancer", interval: 1, mode: "onCompleted" },
  },
  effects: [extraDamage(
    "hero-effect.nuola.catch-off-guard.all-enemies", 1, "lancer", "all",
  )],
  tags: ["usesAttackCount", "multiTargetExtraDamage"],
});

export const NORAH_MOMENTUM_PURSUIT = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.nuola.momentum-pursuit", heroId: NORAH,
  name: "诺拉·乘势追击", slot: 3, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "lancer", interval: 5, mode: "onCompleted" },
  },
  effects: [
    damageModifier({
      id: "hero-effect.nuola.momentum-pursuit.damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: .25,
      lifecycle: { activationTiming: "nextRound", durationRounds: 2, refreshMode: "replace" },
    }),
    damageModifier({
      id: "hero-effect.nuola.momentum-pursuit.reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedDamageReduction", value: .25,
      lifecycle: { activationTiming: "nextRound", durationRounds: 2, refreshMode: "replace" },
    }),
  ],
  tags: ["usesAttackCount", "replaceOnRetrigger"],
});

export const GWEN_EAGLE_VISION = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.gewen.eagle-vision", heroId: GWEN,
  name: "格温·鹰之视野", slot: 1, trigger: "beforeAttack",
  effects: [damageModifier({
    id: "hero-effect.gewen.eagle-vision.vulnerability",
    kind: "incomingDamageIncrease", recipient: "enemyArmy",
    group: "vulnerability", value: .25, target: "currentTarget",
    lifecycle: { activationTiming: "nextRound", refreshMode: "replace", maxStacks: 1 },
  })],
  tags: ["hitTargetTroop", "bearModelSemantic"],
});

export const GWEN_AERIAL_SUPPRESSION = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.gewen.aerial-suppression", heroId: GWEN,
  name: "格温·空中压制", slot: 2, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "army", interval: 6, mode: "onCompleted" },
  },
  effects: [
    extraDamage("hero-effect.gewen.aerial-suppression.extra", 1, "army", "currentTarget", "parentBaseDamage"),
    {
      id: "hero-effect.gewen.aerial-suppression.vulnerability",
      name: "格温·空中压制一次性易伤",
      kind: "oneUseIncomingDamageIncrease", recipient: "enemyArmy",
      group: "aerialSuppressionOverride", value: .15,
      scope: { source: "army", target: "currentTarget", damageType: "all" },
      lifecycle: { activationTiming: "immediate", refreshMode: "replace" },
    },
  ],
  tags: ["usesAttackCount", "hitTargetTroop", "bearModelSemantic", "gwenAerialTemplate"],
});

export const GWEN_DEMOLITION_SQUAD = levelFiveGenerationSkill({
  source: SOURCE, generation: 5,
  id: "hero-skill.gewen.demolition-squad", heroId: GWEN,
  name: "格温·爆破小队", slot: 3, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "marksman", interval: 5, mode: "onCompleted" },
  },
  effects: [extraDamage(
    "hero-effect.gewen.demolition-squad.all-enemies", .50, "marksman", "all",
  )],
  tags: ["usesAttackCount", "preDodge", "mainAttackAttempt", "multiTargetExtraDamage"],
});

export const S5_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 5,
    id: "hero-weapon-skill.heketuo.defense-attack", heroId: HECTOR,
    name: "赫克托专武·守城攻击", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 5,
    id: "hero-weapon-skill.nuola.defense-defense", heroId: NORAH,
    name: "诺拉专武·守城防御", attribute: "defense", group: "buffDefense",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 5,
    id: "hero-weapon-skill.gewen.rally-penetration", heroId: GWEN,
    name: "格温专武·集结穿透", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyAttack"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S5_HERO_SKILL_DEFINITIONS = [
  HECTOR_SURVIVAL_INSTINCT, HECTOR_THUNDER_STRIKE, HECTOR_GALE_STRIKE,
  NORAH_MULTI_TROOP_COMBAT, NORAH_CATCH_OFF_GUARD, NORAH_MOMENTUM_PURSUIT,
  GWEN_EAGLE_VISION, GWEN_AERIAL_SUPPRESSION, GWEN_DEMOLITION_SQUAD,
  ...S5_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
