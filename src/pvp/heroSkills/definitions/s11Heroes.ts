import type { HeroSkillDefinition, HeroSkillEffect } from "../types";
import {
  attributeModifier,
  attributeReduction,
  damageModifier,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
} from "./generationHeroBuilders";

const SOURCE = "2026-09-27 user-confirmed S11 expedition PVP rules";
const ELEONORA = "hero.s11.eleonora";
const LLOYD = "hero.s11.lloyd";
const RUFUS = "hero.s11.rufus";

export const ELEONORA_SUNLIGHT_MAJESTY = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.eleonora.sunlight-majesty", heroId: ELEONORA,
  name: "埃莱奥诺拉·烈日威光", slot: 1,
  effects: [attributeModifier(
    "hero-effect.eleonora.life", "life", .25, "heroLifeBonus",
  )],
});

export const ELEONORA_SOLARIS_PHALANX = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.eleonora.solaris-phalanx", heroId: ELEONORA,
  name: "埃莱奥诺拉·索拉里斯方阵", slot: 2,
  effects: [
    damageModifier({ id: "hero-effect.eleonora.shield-reduction", kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value: .10, target: "shield" }),
    damageModifier({ id: "hero-effect.eleonora.marksman-damage", kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value: .10, source: "marksman" }),
  ],
});

export const ELEONORA_SOARING_FLAME = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.eleonora.soaring-flame", heroId: ELEONORA,
  name: "埃莱奥诺拉·腾焰飞芒", slot: 3, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "shield", interval: 5, mode: "onCompleted" },
  },
  triggerTiming: "mainAttackAttempt",
  effects: [
    damageModifier({ id: "hero-effect.eleonora.soaring-flame.damage", kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value: .25, lifecycle: { activationTiming: "nextRound", durationRounds: 2, refreshMode: "replace" } }),
    damageModifier({ id: "hero-effect.eleonora.soaring-flame.reduction", kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value: .25, lifecycle: { activationTiming: "nextRound", durationRounds: 2, refreshMode: "replace" } }),
  ],
  tags: ["usesAttackCount", "norahMomentumTemplate", "replaceOnRetrigger", "soaringFlameTemplate"],
});

export const LLOYD_BIRD_HARASSMENT = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.lloyd.bird-harassment", heroId: LLOYD,
  name: "劳埃德·群鸟侵扰", slot: 1,
  effects: [attributeReduction(
    "hero-effect.lloyd.bird-harassment", "penetration", "enemyPenetrationReduction", .20,
  )],
});

const lloydPeriodicPenetrationReduction: HeroSkillEffect = {
  id: "hero-effect.lloyd.ice-fog-bomb.penetration",
  name: "hero-effect.lloyd.ice-fog-bomb.penetration",
  kind: "attributeReduction", recipient: "enemyArmy",
  attribute: "penetration", group: "enemyPenetrationReduction", value: .30,
  scope: { source: "army", target: "all", damageType: "all" },
  lifecycle: { periodRounds: 3, firstActiveRound: 3, activeWindowRounds: 1 },
};

export const LLOYD_ICE_FOG_BOMB = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.lloyd.ice-fog-bomb", heroId: LLOYD,
  name: "劳埃德·冰雾爆弹", slot: 2,
  effects: [
    damageModifier({
      id: "hero-effect.lloyd.ice-fog-bomb.lancer-damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: 1.50, source: "lancer",
      lifecycle: { periodRounds: 3, firstActiveRound: 3, activeWindowRounds: 1 },
    }),
    lloydPeriodicPenetrationReduction,
  ],
  tags: ["periodic", "bearModelSemantic"],
});

export const LLOYD_ENDLESS_INGENUITY = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.lloyd.endless-ingenuity", heroId: LLOYD,
  name: "劳埃德·机巧万变", slot: 3, trigger: "roundStart", probability: .40,
  effects: [attributeModifier(
    "hero-effect.lloyd.endless-ingenuity", "penetration", .50,
    "heroPenetrationBonus", "addToAttribute", "army",
    { activationTiming: "immediate", durationRounds: 1, refreshMode: "replace" },
  )],
  tags: ["oncePerRound", "lynnAlonsoPenetrationTemplate"],
});

export const RUFUS_FIRE_BRIGADE = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.rufus.fire-brigade", heroId: RUFUS,
  name: "鲁弗斯·火焰战团", slot: 1,
  effects: [attributeModifier(
    "hero-effect.rufus.attack", "attack", .25, "heroAttackBonus",
  )],
});

export const RUFUS_ARMOR_BREAKING_STRIKE = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.rufus.armor-breaking-strike", heroId: RUFUS,
  name: "鲁弗斯·碎甲一击", slot: 2, trigger: "afterNormalAttack",
  triggerTiming: "successfulNormalAttackHit",
  effects: [
    extraDamage("hero-effect.rufus.armor-breaking-strike.extra", .60, "marksman", "currentTarget", "parentBaseDamage"),
    damageModifier({ id: "hero-effect.rufus.armor-breaking-strike.vulnerability", kind: "incomingDamageIncrease", recipient: "enemyArmy", group: "vulnerability", value: .25, target: "currentTarget", lifecycle: { activationTiming: "nextRound", durationRounds: 1, refreshMode: "replace" } }),
  ],
  tags: ["hitTargetTroop", "extraDamageNotAdditionalAttack", "bearModelSemantic"],
});

export const RUFUS_VIOLENT_BLAST = levelFiveGenerationSkill({
  source: SOURCE, generation: 11,
  id: "hero-skill.rufus.violent-blast", heroId: RUFUS,
  name: "鲁弗斯·暴烈震爆", slot: 3, trigger: "beforeAttack", probability: .20,
  triggerTiming: "mainAttackAttempt",
  effects: [{
    id: "hero-effect.rufus.violent-blast.penetration-reduction",
    name: "hero-effect.rufus.violent-blast.penetration-reduction",
    kind: "attributeReduction", recipient: "enemyArmy",
    attribute: "penetration", group: "enemyPenetrationReduction", value: .50,
    scope: { source: "army", target: "currentTarget", damageType: "all" },
    lifecycle: { activationTiming: "immediate", durationRounds: 2, refreshMode: "replace" },
  }],
  tags: ["hitTargetTroop", "perTroopAttack", "replaceOnRetrigger"],
});

export const S11_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 11,
    id: "hero-weapon-skill.eleonora.defense-life", heroId: ELEONORA,
    name: "埃莱奥诺拉专武·最后的堡垒", attribute: "life", group: "buffLife",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 11,
    id: "hero-weapon-skill.lloyd.rally-attack", heroId: LLOYD,
    name: "劳埃德专武·钢铁迷城", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyAttack"] }),
  generationSceneWeapon({ source: SOURCE, generation: 11,
    id: "hero-weapon-skill.rufus.rally-attack", heroId: RUFUS,
    name: "鲁弗斯专武·烈火旅团", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyAttack"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S11_HERO_SKILL_DEFINITIONS = [
  ELEONORA_SUNLIGHT_MAJESTY, ELEONORA_SOLARIS_PHALANX, ELEONORA_SOARING_FLAME,
  LLOYD_BIRD_HARASSMENT, LLOYD_ICE_FOG_BOMB, LLOYD_ENDLESS_INGENUITY,
  RUFUS_FIRE_BRIGADE, RUFUS_ARMOR_BREAKING_STRIKE, RUFUS_VIOLENT_BLAST,
  ...S11_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
