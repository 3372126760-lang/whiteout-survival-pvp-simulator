import type { HeroSkillDefinition } from "../types";
import {
  attributeModifier,
  attributeReduction,
  damageModifier,
  defenseAttribute,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
} from "./generationHeroBuilders";

const SOURCE = "confirmed S9 expedition PVP rules, 2026-09-27";
const MAGNUS = "hero.s9.magenusi";
const FRED = "hero.s9.fuleide";
const SHURA = "hero.s9.xiula";

export const MAGNUS_RAGING_SEA = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.magenusi.raging-sea", heroId: MAGNUS,
  name: "马格努斯·怒海狂涛", slot: 1,
  effects: [attributeModifier(
    "hero-effect.magenusi.attack", "attack", .25, "heroAttackBonus",
  )],
});

export const MAGNUS_STEEL_PHALANX = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.magenusi.steel-phalanx", heroId: MAGNUS,
  name: "马格努斯·钢铁方阵", slot: 2, trigger: "afterNormalAttack",
  probability: .40,
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "shield", interval: 1, mode: "onCompleted" },
  },
  triggerTiming: "mainAttackAttempt",
  effects: [defenseAttribute(
    "hero-effect.magenusi.steel-phalanx", .50, "all",
    { activationTiming: "immediate", durationRounds: 1, refreshMode: "replace" },
  )],
  tags: ["immediateCurrentRoundDefenseBuff"],
});

export const MAGNUS_ICE_SEA_TACTICS = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.magenusi.ice-sea-tactics", heroId: MAGNUS,
  name: "马格努斯·冰海战法", slot: 3,
  effects: [
    damageModifier({
      id: "hero-effect.magenusi.shield-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedDamageReduction", value: .10, target: "shield",
    }),
    damageModifier({
      id: "hero-effect.magenusi.marksman-damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: .10, source: "marksman",
    }),
  ],
});

export const FRED_WATER_CANNON = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.fuleide.water-cannon", heroId: FRED,
  name: "弗雷德·水炮压制", slot: 1,
  effects: [attributeReduction(
    "hero-effect.fuleide.enemy-penetration", "penetration",
    "enemyPenetrationReduction", .20,
  )],
});

export const FRED_ACID_SOLUTION = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.fuleide.acid-solution", heroId: FRED,
  name: "弗雷德·酸性溶液", slot: 2,
  effects: [damageModifier({
    id: "hero-effect.fuleide.acid-solution",
    kind: "incomingDamageIncrease", recipient: "enemyArmy",
    group: "vulnerability", value: .20, target: "shield",
  })],
});

export const FRED_TIDAL_OFFENSIVE = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.fuleide.tidal-offensive", heroId: FRED,
  name: "弗雷德·攻势如潮", slot: 3, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "lancer", interval: 4, mode: "onCompleted" },
  },
  triggerTiming: "mainAttackAttempt",
  effects: [
    extraDamage("hero-effect.fuleide.tidal-offensive.extra", 2, "lancer", "currentTarget", "parentBaseDamage"),
    damageModifier({
      id: "hero-effect.fuleide.tidal-offensive.enemy-outgoing",
      kind: "outgoingDamageReduction", recipient: "enemyArmy",
      group: "enemyOutgoingDamageReduction", value: .20,
      lifecycle: {
        activationTiming: "nextRound", durationRounds: 1,
        refreshMode: "replace",
      },
    }),
  ],
  tags: ["usesAttackCount", "bearModelSemantic"],
});

export const SHURA_MIST_SPORES = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.xiula.mist-spores", heroId: SHURA,
  name: "修拉·迷雾孢子", slot: 1,
  effects: [damageModifier({
    id: "hero-effect.xiula.mist-spores", kind: "damageReduction",
    recipient: "selfArmy", group: "receivedDamageReduction", value: .20,
  })],
});

export const SHURA_PIERCING_ARROW = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.xiula.piercing-arrow", heroId: SHURA,
  name: "修拉·贯穿之矢", slot: 2, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "marksman", interval: 2, mode: "onCompleted" },
  },
  triggerTiming: "mainAttackAttempt",
  effects: [
    extraDamage("hero-effect.xiula.piercing-arrow.extra", 1, "marksman", "currentTarget", "parentBaseDamage"),
    damageModifier({
      id: "hero-effect.xiula.piercing-arrow.vulnerability",
      kind: "incomingDamageIncrease", recipient: "enemyArmy",
      group: "vulnerability", value: .25, target: "currentTarget",
      lifecycle: {
        activationTiming: "nextRound", durationRounds: 1,
        refreshMode: "replace",
      },
    }),
  ],
  tags: ["usesAttackCount", "hitTargetTroop", "bearModelSemantic"],
});

export const SHURA_UNPREDICTABLE_CLOUDS = levelFiveGenerationSkill({
  source: SOURCE, generation: 9,
  id: "hero-skill.xiula.unpredictable-clouds", heroId: SHURA,
  name: "修拉·波云诡谲", slot: 3,
  effects: [
    damageModifier({
      id: "hero-effect.xiula.marksman-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedDamageReduction", value: .15, target: "marksman",
    }),
    damageModifier({
      id: "hero-effect.xiula.marksman-damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: .10, source: "marksman",
    }),
  ],
});

export const S9_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 9,
    id: "hero-weapon-skill.magenusi.defense-life", heroId: MAGNUS,
    name: "马格努斯专武·英灵意志", attribute: "life", group: "buffLife",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 9,
    id: "hero-weapon-skill.fuleide.rally-attack", heroId: FRED,
    name: "弗雷德专武·英勇感召", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyAttack"] }),
  generationSceneWeapon({ source: SOURCE, generation: 9,
    id: "hero-weapon-skill.xiula.defense-attack", heroId: SHURA,
    name: "修拉专武·大地的祝福", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S9_HERO_SKILL_DEFINITIONS = [
  MAGNUS_RAGING_SEA, MAGNUS_STEEL_PHALANX, MAGNUS_ICE_SEA_TACTICS,
  FRED_WATER_CANNON, FRED_ACID_SOLUTION, FRED_TIDAL_OFFENSIVE,
  SHURA_MIST_SPORES, SHURA_PIERCING_ARROW, SHURA_UNPREDICTABLE_CLOUDS,
  ...S9_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
