import type { HeroSkillDefinition } from "../types";
import {
  attributeModifier,
  attributeReduction,
  damageModifier,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
} from "./generationHeroBuilders";

const SOURCE = "confirmed S4 expedition PVP rules; bear semantics mirrored read-only, 2026-09-20";
const AHMOSE = "hero.s4.ahemosi";
const REINA = "hero.s4.lingnai";
const LYNN = "hero.s4.linen";

export const AHMOSE_VIPER_PHALANX = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.ahemosi.viper-phalanx", heroId: AHMOSE,
  name: "阿赫莫斯·腹蛇方阵", slot: 1, trigger: "beforeAttack",
  actionMechanic: {
    kind: "skipMainAttack", sourceTroop: "shield", afterCompletedAttacks: 4,
  },
  effects: [
    damageModifier({
      id: "hero-effect.ahemosi.viper-phalanx.shield-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "viperPhalanxShieldReduction", value: .70, target: "shield",
      lifecycle: { activationTiming: "immediate", durationRounds: 2, refreshMode: "replace" },
    }),
    damageModifier({
      id: "hero-effect.ahemosi.viper-phalanx.lancer-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "viperPhalanxOtherReduction", value: .30, target: "lancer",
      lifecycle: { activationTiming: "immediate", durationRounds: 2, refreshMode: "replace" },
    }),
    damageModifier({
      id: "hero-effect.ahemosi.viper-phalanx.marksman-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "viperPhalanxOtherReduction", value: .30, target: "marksman",
      lifecycle: { activationTiming: "immediate", durationRounds: 2, refreshMode: "replace" },
    }),
  ],
  tags: ["usesAttackCount", "skipMainAttack"],
});

export const AHMOSE_FIRE_BLESSING = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.ahemosi.fire-blessing", heroId: AHMOSE,
  name: "阿赫莫斯·火之祝祷", slot: 2,
  effects: [damageModifier({
    id: "hero-effect.ahemosi.fire-blessing", kind: "damageIncrease",
    recipient: "selfArmy", group: "commonDamageIncrease", value: 1,
    source: "shield",
  })],
  tags: ["bearModelSemantic"],
});

export const AHMOSE_LIGHT_FORGED_BLADE = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.ahemosi.light-forged-blade", heroId: AHMOSE,
  name: "阿赫莫斯·光铸之刃", slot: 3, trigger: "afterNormalAttack",
  effects: [
    extraDamage("hero-effect.ahemosi.light-forged-blade.extra", .60, "shield"),
    damageModifier({
      id: "hero-effect.ahemosi.light-forged-blade.vulnerability",
      kind: "incomingDamageIncrease", recipient: "enemyArmy",
      group: "vulnerability", value: .25, source: "army",
      target: "currentTarget",
      lifecycle: { activationTiming: "nextRound", durationRounds: 1, refreshMode: "replace" },
    }),
  ],
  tags: ["hitTargetTroop", "bearModelSemantic"],
});

export const REINA_ASSASSIN_INSTINCT = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.lingnai.assassin-instinct", heroId: REINA,
  name: "玲奈·刺客本能", slot: 1,
  effects: [damageModifier({
    id: "hero-effect.lingnai.assassin-instinct", kind: "damageIncrease",
    recipient: "selfArmy", group: "normalAttackDamageIncrease", value: .30,
    damageType: "normalAttack",
  })],
  tags: ["bearModelSemantic"],
});

const REINA_SWIFT_SHADOW_DANCE_LV5 = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.lingnai.swift-shadow-dance", heroId: REINA,
  name: "玲奈·迅影舞步", slot: 2, trigger: "beforeAttack", probability: .20,
  actionMechanic: { kind: "dodgeNormalAttack" },
  effects: [],
  tags: ["dodgeNormalAttack", "sharedRapidFireRoll"],
});
export const REINA_SWIFT_SHADOW_DANCE: HeroSkillDefinition = {
  ...REINA_SWIFT_SHADOW_DANCE_LV5,
  levelValues: {
    ...REINA_SWIFT_SHADOW_DANCE_LV5.levelValues,
    2: { versionLabel: "Expedition Lv.2", probability: .08, effects: [] },
  },
};

const REINA_SHADOW_BLADE_LV5 = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.lingnai.shadow-blade", heroId: REINA,
  name: "玲奈·影刃", slot: 3, trigger: "afterNormalAttack", probability: .25,
  effects: [extraDamage("hero-effect.lingnai.shadow-blade.extra", 2, "lancer")],
  tags: ["mainAttackAttempt", "preDodge", "extraDamageNotAdditionalAttack"],
});
export const REINA_SHADOW_BLADE: HeroSkillDefinition = {
  ...REINA_SHADOW_BLADE_LV5,
  levelValues: {
    ...REINA_SHADOW_BLADE_LV5.levelValues,
    4: {
      versionLabel: "Expedition Lv.4",
      effects: [extraDamage("hero-effect.lingnai.shadow-blade.extra", 1.8, "lancer")],
    },
  },
};

export const LYNN_LION_SONG = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.linen.lion-song", heroId: LYNN,
  name: "琳恩·雄狮之歌", slot: 1, trigger: "roundStart", probability: .40,
  effects: [attributeModifier(
    "hero-effect.linen.lion-song", "penetration", .50,
    "heroPenetrationBonus", "multiplyAttributeFactor", "army",
    { activationTiming: "immediate", durationRounds: 1, refreshMode: "replace" },
  )],
  tags: ["oncePerRound", "bearModelSemantic"],
});

export const LYNN_SORROWFUL_SOUND = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.linen.sorrowful-sound", heroId: LYNN,
  name: "琳恩·悲戚之音", slot: 2,
  effects: [attributeReduction(
    "hero-effect.linen.sorrowful-sound", "penetration",
    "enemyPenetrationReduction", .20,
  )],
});

export const LYNN_ONAIHUA = levelFiveGenerationSkill({
  source: SOURCE, generation: 4,
  id: "hero-skill.linen.onaihua", heroId: LYNN,
  name: "琳恩·欧纳伊华", slot: 3, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "marksman", interval: 3, mode: "onCompleted" },
  },
  effects: [attributeModifier(
    "hero-effect.linen.onaihua.marksman-attack", "attack", .05,
    "heroMarksmanAttackStack", "multiplyAttributeFactor", "marksman",
    {
      activationTiming: "nextRound", refreshMode: "stack",
    },
  )],
  tags: ["usesAttackCount", "bearModelSemantic"],
});

export const S4_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 4,
    id: "hero-weapon-skill.ahemosi.defense-life", heroId: AHMOSE,
    name: "阿赫莫斯专武·守城生命", attribute: "life", group: "buffLife",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 4,
    id: "hero-weapon-skill.lingnai.rally-penetration", heroId: REINA,
    name: "玲奈专武·集结穿透", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyAttack"] }),
  generationSceneWeapon({ source: SOURCE, generation: 4,
    id: "hero-weapon-skill.linen.defense-penetration", heroId: LYNN,
    name: "琳恩专武·守城穿透", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S4_HERO_SKILL_DEFINITIONS = [
  AHMOSE_VIPER_PHALANX, AHMOSE_FIRE_BLESSING, AHMOSE_LIGHT_FORGED_BLADE,
  REINA_ASSASSIN_INSTINCT, REINA_SWIFT_SHADOW_DANCE, REINA_SHADOW_BLADE,
  LYNN_LION_SONG, LYNN_SORROWFUL_SOUND, LYNN_ONAIHUA,
  ...S4_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
