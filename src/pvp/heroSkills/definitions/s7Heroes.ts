import type { HeroSkillDefinition } from "../types";
import {
  attributeModifier,
  damageModifier,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
} from "./generationHeroBuilders";

const SOURCE = "confirmed S7 expedition PVP battle reports, 2026-09-25";
const EDITH = "hero.s7.aidisi";
const GORDON = "hero.s7.gedun";
const BRADLEY = "hero.s7.buladeli";

export const EDITH_OFFENSE_AND_DEFENSE = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.aidisi.offense-and-defense", heroId: EDITH,
  name: "艾迪丝·攻守兼备", slot: 1,
  effects: [
    damageModifier({
      id: "hero-effect.aidisi.marksman-reduction",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedDamageReduction", value: .20, target: "marksman",
    }),
    damageModifier({
      id: "hero-effect.aidisi.lancer-damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: .20, source: "lancer",
    }),
  ],
});

export const EDITH_IRON_BODY = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.aidisi.iron-body", heroId: EDITH,
  name: "艾迪丝·铜头铁臂", slot: 2,
  effects: [damageModifier({
    id: "hero-effect.aidisi.shield-reduction",
    kind: "damageReduction", recipient: "selfArmy",
    group: "receivedDamageReduction", value: .20, target: "shield",
  })],
});

export const EDITH_STEEL_ARMOR = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.aidisi.steel-armor", heroId: EDITH,
  name: "艾迪丝·钢甲护体", slot: 3,
  effects: [attributeModifier(
    "hero-effect.aidisi.life", "life", .25, "heroLifeBonus",
  )],
});

const poisonedBladeBase = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.gedun.poisoned-blade", heroId: GORDON,
  name: "哥顿·浸毒锋刃", slot: 1, trigger: "afterNormalAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "lancer", interval: 2, mode: "onCompleted" },
  },
  effects: [
    extraDamage("hero-effect.gedun.poisoned-blade.extra", 1, "lancer"),
    damageModifier({
      id: "hero-effect.gedun.poison",
      kind: "outgoingDamageReduction", recipient: "enemyArmy",
      group: "poisonOutgoingDamageReduction", value: .20,
      target: "currentTarget",
      lifecycle: {
        activationTiming: "nextRound", durationRounds: 1,
        refreshMode: "replace",
      },
    }),
  ],
  tags: ["usesAttackCount", "hitTargetTroop", "poisonTarget"],
});
export const GORDON_POISONED_BLADE: HeroSkillDefinition = {
  ...poisonedBladeBase,
  levelValues: {
    ...poisonedBladeBase.levelValues,
    1: { versionLabel: "Expedition Lv.1", effects: [
      extraDamage("hero-effect.gedun.poisoned-blade.extra", .2, "lancer"),
      damageModifier({
        id: "hero-effect.gedun.poison", kind: "outgoingDamageReduction",
        recipient: "enemyArmy", group: "poisonOutgoingDamageReduction",
        value: .04, target: "currentTarget",
        lifecycle: { activationTiming: "nextRound", durationRounds: 1,
          refreshMode: "replace" },
      }),
    ] },
  },
};

const toxicPhobiaBase = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.gedun.toxic-phobia", heroId: GORDON,
  name: "哥顿·恐惧威慑", slot: 2, trigger: "roundStart",
  periodRounds: 3, periodStartRound: 3,
  effects: [
    damageModifier({
      id: "hero-effect.gedun.toxic-phobia.lancer-damage",
      kind: "damageIncrease", recipient: "selfArmy",
      group: "commonDamageIncrease", value: 1.50, source: "lancer",
      lifecycle: {
        activationTiming: "immediate", durationRounds: 1, refreshMode: "replace",
      },
    }),
    damageModifier({
      id: "hero-effect.gedun.toxic-phobia.enemy-outgoing",
      kind: "outgoingDamageReduction", recipient: "enemyArmy",
      group: "gordonPeriodicOutgoingReduction", value: .30,
      lifecycle: {
        activationTiming: "immediate", durationRounds: 1, refreshMode: "replace",
      },
    }),
  ],
  tags: ["bearModelSemantic", "periodic"],
});
export const GORDON_TOXIC_PHOBIA: HeroSkillDefinition = {
  ...toxicPhobiaBase,
  levelValues: {
    ...toxicPhobiaBase.levelValues,
    1: { versionLabel: "Expedition Lv.1", periodRounds: 3, periodStartRound: 3,
      effects: [
        damageModifier({ id: "hero-effect.gedun.toxic-phobia.lancer-damage",
          kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease",
          value: .30, source: "lancer",
          lifecycle: { activationTiming: "immediate", durationRounds: 1,
            refreshMode: "replace" } }),
        damageModifier({ id: "hero-effect.gedun.toxic-phobia.enemy-outgoing",
          kind: "outgoingDamageReduction", recipient: "enemyArmy",
          group: "gordonPeriodicOutgoingReduction", value: .06,
          lifecycle: { activationTiming: "immediate", durationRounds: 1,
            refreshMode: "replace" } }),
      ] },
  },
};

const poisonCloudBase = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.gedun.poison-cloud", heroId: GORDON,
  name: "哥顿·腐蚀云雾", slot: 3, trigger: "roundStart",
  periodRounds: 4, periodStartRound: 4,
  effects: [
    damageModifier({
      id: "hero-effect.gedun.poison-cloud.shield-vulnerability",
      kind: "incomingDamageIncrease", recipient: "enemyArmy",
      group: "vulnerability", value: .30, target: "shield",
      lifecycle: {
        activationTiming: "immediate", durationRounds: 2, refreshMode: "replace",
      },
    }),
    damageModifier({
      id: "hero-effect.gedun.poison-cloud.marksman-outgoing",
      kind: "outgoingDamageReduction", recipient: "enemyArmy",
      group: "gordonMarksmanOutgoingReduction", value: .30,
      source: "marksman",
      lifecycle: {
        activationTiming: "immediate", durationRounds: 2, refreshMode: "replace",
      },
    }),
  ],
  tags: ["bearModelSemantic", "periodic", "rounds4-5-8-9"],
});
export const GORDON_POISON_CLOUD: HeroSkillDefinition = {
  ...poisonCloudBase,
  levelValues: {
    ...poisonCloudBase.levelValues,
    1: { versionLabel: "Expedition Lv.1", periodRounds: 4, periodStartRound: 4,
      effects: [
        damageModifier({ id: "hero-effect.gedun.poison-cloud.shield-vulnerability",
          kind: "incomingDamageIncrease", recipient: "enemyArmy",
          group: "vulnerability", value: .06, target: "shield",
          lifecycle: { activationTiming: "immediate", durationRounds: 2,
            refreshMode: "replace" } }),
        damageModifier({ id: "hero-effect.gedun.poison-cloud.marksman-outgoing",
          kind: "outgoingDamageReduction", recipient: "enemyArmy",
          group: "gordonMarksmanOutgoingReduction", value: .06,
          source: "marksman",
          lifecycle: { activationTiming: "immediate", durationRounds: 2,
            refreshMode: "replace" } }),
      ] },
  },
};

export const BRADLEY_VETERANS_PRIDE = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.buladeli.veterans-pride", heroId: BRADLEY,
  name: "布拉德利·老兵的骄傲", slot: 1,
  effects: [attributeModifier(
    "hero-effect.buladeli.attack", "attack", .25, "heroAttackBonus",
  )],
});

export const BRADLEY_HEAD_CANNON = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.buladeli.head-cannon", heroId: BRADLEY,
  name: "布拉德利·当头炮", slot: 2,
  effects: [
    damageModifier({
      id: "hero-effect.buladeli.vs-lancer", kind: "damageIncrease",
      recipient: "selfArmy", group: "troopVsTroopDamage",
      value: .30, target: "lancer",
    }),
    damageModifier({
      id: "hero-effect.buladeli.vs-shield", kind: "damageIncrease",
      recipient: "selfArmy", group: "troopVsTroopDamage",
      value: .25, target: "shield",
    }),
  ],
  tags: ["bearModelSemantic", "targetTroopModifier"],
});

export const BRADLEY_BATTLEFIELD_INSIGHT = levelFiveGenerationSkill({
  source: SOURCE, generation: 7,
  id: "hero-skill.buladeli.battlefield-insight", heroId: BRADLEY,
  name: "布拉德利·洞悉战局", slot: 3,
  effects: [damageModifier({
    id: "hero-effect.buladeli.battlefield-insight",
    kind: "damageIncrease", recipient: "selfArmy",
    group: "commonDamageIncrease", value: .30,
    lifecycle: {
      periodRounds: 4, firstActiveRound: 5, activeWindowRounds: 2,
    },
  })],
  tags: ["bearModelSemantic", "periodic", "rounds5-6-9-10"],
});

export const S7_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 7,
    id: "hero-weapon-skill.aidisi.defense-life", heroId: EDITH,
    name: "艾迪丝专武·坚固工事", attribute: "life", group: "buffLife",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 7,
    id: "hero-weapon-skill.gedun.rally-penetration", heroId: GORDON,
    name: "哥顿专武·毒暴侵袭", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyAttack"] }),
  generationSceneWeapon({ source: SOURCE, generation: 7,
    id: "hero-weapon-skill.buladeli.defense-attack", heroId: BRADLEY,
    name: "布拉德利专武·精准布防", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S7_HERO_SKILL_DEFINITIONS = [
  EDITH_OFFENSE_AND_DEFENSE, EDITH_IRON_BODY, EDITH_STEEL_ARMOR,
  GORDON_POISONED_BLADE, GORDON_TOXIC_PHOBIA, GORDON_POISON_CLOUD,
  BRADLEY_VETERANS_PRIDE, BRADLEY_HEAD_CANNON, BRADLEY_BATTLEFIELD_INSIGHT,
  ...S7_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
