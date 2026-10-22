import type { HeroSkillDefinition } from "../types";
import {
  damageModifier,
  extraDamage,
  generationSceneWeapon,
  levelFiveGenerationSkill,
  markedTargetDamage,
  normalAttackCritical,
  targetMark,
  wayneFlankingDamage,
} from "./generationHeroBuilders";

const SOURCE = "confirmed S6 expedition PVP rules and battle reports, 2026-09-25";
const WAYNE_SHARED_SOURCE = "2026-09-27 user-confirmed S10 reuse of Wayne critical and flanking templates; original S6 battle reports require recheck";
const WU_MING = "hero.s6.wuming";
const RENEE = "hero.s6.ruini";
const WAYNE = "hero.s6.weien";
const DREAM_MARK = "reneeDreamMark";

export const WU_MING_WIND_SHELTER = levelFiveGenerationSkill({
  source: SOURCE, generation: 6,
  id: "hero-skill.wuming.wind-shelter", heroId: WU_MING,
  name: "无名·避风扑雨", slot: 1,
  effects: [
    damageModifier({
      id: "hero-effect.wuming.wind-shelter.normal",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedNormalAttackReduction", value: .25,
      target: "shield", damageType: "normalAttack",
    }),
    damageModifier({
      id: "hero-effect.wuming.wind-shelter.skill",
      kind: "damageReduction", recipient: "selfArmy",
      group: "receivedSkillDamageReduction", value: .30,
      target: "shield", damageType: "skillDamage",
    }),
  ],
});

export const WU_MING_HALF_MOON = levelFiveGenerationSkill({
  source: SOURCE, generation: 6,
  id: "hero-skill.wuming.half-moon", heroId: WU_MING,
  name: "无名·半月冲雪", slot: 2,
  effects: [damageModifier({
    id: "hero-effect.wuming.half-moon", kind: "damageIncrease",
    recipient: "selfArmy", group: "commonDamageIncrease", value: .20,
  })],
  tags: ["bearModelSemantic"],
});

export const WU_MING_FOUR_IMAGES = levelFiveGenerationSkill({
  source: SOURCE, generation: 6,
  id: "hero-skill.wuming.four-images", heroId: WU_MING,
  name: "无名·四象分明", slot: 3,
  effects: [damageModifier({
    id: "hero-effect.wuming.four-images", kind: "damageIncrease",
    recipient: "selfArmy", group: "skillDamageIncrease", value: .25,
    damageType: "skillDamage",
  })],
  tags: ["bearModelSemantic", "includesExtraDamage"],
});

export const RENEE_DREAM_MARK: HeroSkillDefinition = { ...levelFiveGenerationSkill({
  source: "2026-10-17 battle-report-supported duplicate DreamMark coefficient m+1; PROVISIONAL pending fixed-N0 control", generation: 6,
  id: "hero-skill.ruini.dream-mark", heroId: RENEE,
  name: "芮妮·惊梦留痕", slot: 1, trigger: "beforeAttack",
  actionMechanic: {
    kind: "targetBoundMark",
    schedule: { source: "lancer", interval: 2, mode: "onCompleted" },
    markId: DREAM_MARK,
    damageDelayRounds: 1,
    damageCoefficient: 2,
    markDurationRounds: 1,
    duplicateSourceStacking: {
      additionalCoefficient: 1,
      evidenceStatus: "BATTLE_REPORT_SUPPORTED",
      ruleStatus: "PROVISIONAL",
    },
  },
  effects: [targetMark("hero-effect.ruini.dream-mark", DREAM_MARK)],
  tags: ["usesAttackCount", "hitTargetTroop", "targetBoundMark", "bearModelSemantic", "BATTLE_REPORT_SUPPORTED", "duplicateSourceStacking:PROVISIONAL"],
}), uiSummary: "矛兵每2次主攻击尝试标记当前目标，下一回合造成200%B技能伤害；每个重复来源追加100%B（战报支持，暂定），各来源分别计数。" };

export const RENEE_DREAM_CATCHER = levelFiveGenerationSkill({
  source: SOURCE, generation: 6,
  id: "hero-skill.ruini.dream-catcher", heroId: RENEE,
  name: "芮妮·捕梦手", slot: 2,
  effects: [markedTargetDamage(
    "hero-effect.ruini.dream-catcher", DREAM_MARK, "lancer", 1.50,
  )],
  tags: ["targetBoundMark", "bearModelSemantic"],
});

export const RENEE_DREAM_FRAGMENT = levelFiveGenerationSkill({
  source: SOURCE, generation: 6,
  id: "hero-skill.ruini.dream-fragment", heroId: RENEE,
  name: "芮妮·梦境切片", slot: 3,
  effects: [markedTargetDamage(
    "hero-effect.ruini.dream-fragment", DREAM_MARK, "army", .75,
  )],
  tags: ["targetBoundMark", "bearModelSemantic"],
});

const thunderRaidBase = levelFiveGenerationSkill({
  source: SOURCE, generation: 6,
  id: "hero-skill.weien.thunder-raid", heroId: WAYNE,
  name: "韦恩·惊雷奇袭", slot: 1, trigger: "roundStart",
  periodRounds: 4, periodStartRound: 4,
  effects: [extraDamage(
    "hero-effect.weien.thunder-raid.extra", 1, "army", "currentTarget",
  )],
  tags: ["roundBasedExtraDamage", "extraDamageNotAdditionalAttack"],
});
export const WAYNE_THUNDER_RAID: HeroSkillDefinition = {
  ...thunderRaidBase,
  levelValues: Object.fromEntries([.2, .4, .6, .8, 1].map((coefficient, index) => [
    index + 1,
    { versionLabel: `Expedition Lv.${index + 1}`, periodRounds: 4,
      periodStartRound: 4, effects: [extraDamage(
        "hero-effect.weien.thunder-raid.extra", coefficient, "army", "currentTarget",
      )] },
  ])),
};

const flankingStrikeBase = levelFiveGenerationSkill({
  source: WAYNE_SHARED_SOURCE, generation: 6,
  id: "hero-skill.weien.flanking-strike", heroId: WAYNE,
  name: "韦恩·迂回打击", slot: 2, trigger: "beforeAttack",
  actionMechanic: {
    kind: "attackCountTrigger",
    schedule: { source: "marksman", interval: 2, mode: "onCompleted" },
  },
  effects: wayneFlankingDamage("hero-effect.weien.flanking-strike"),
  tags: ["usesAttackCount", "multiTargetExtraDamage", "noRetarget"],
});
export const WAYNE_FLANKING_STRIKE: HeroSkillDefinition = {
  ...flankingStrikeBase,
  levelValues: Object.fromEntries([1, 2, 3, 4, 5].map((level) => [
    level,
    { versionLabel: `Expedition Lv.${level}`,
      effects: wayneFlankingDamage("hero-effect.weien.flanking-strike", level) },
  ])),
};

const lightningSpeedBase = levelFiveGenerationSkill({
  source: WAYNE_SHARED_SOURCE, generation: 6,
  id: "hero-skill.weien.lightning-speed", heroId: WAYNE,
  name: "韦恩·电光石火", slot: 3, trigger: "beforeAttack", probability: .25,
  effects: [normalAttackCritical("hero-effect.weien.lightning-speed.critical")],
  tags: ["criticalNormalAttack", "perTroopAttack"],
});
export const WAYNE_LIGHTNING_SPEED: HeroSkillDefinition = {
  ...lightningSpeedBase,
  levelValues: Object.fromEntries([1, 2, 3, 4, 5].map((level) => [
    level,
    { versionLabel: `Expedition Lv.${level}`, probability: .05 * level,
      effects: [normalAttackCritical("hero-effect.weien.lightning-speed.critical")] },
  ])),
};

export const S6_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 6,
    id: "hero-weapon-skill.wuming.defense-defense", heroId: WU_MING,
    name: "无名专武·守城防御", attribute: "defense", group: "buffDefense",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 6,
    id: "hero-weapon-skill.ruini.rally-penetration", heroId: RENEE,
    name: "芮妮专武·集结穿透", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyAttack"] }),
  generationSceneWeapon({ source: SOURCE, generation: 6,
    id: "hero-weapon-skill.weien.defense-penetration", heroId: WAYNE,
    name: "韦恩专武·守城穿透", attribute: "penetration", group: "buffPenetration",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S6_HERO_SKILL_DEFINITIONS = [
  WU_MING_WIND_SHELTER, WU_MING_HALF_MOON, WU_MING_FOUR_IMAGES,
  RENEE_DREAM_MARK, RENEE_DREAM_CATCHER, RENEE_DREAM_FRAGMENT,
  WAYNE_THUNDER_RAID, WAYNE_FLANKING_STRIKE, WAYNE_LIGHTNING_SPEED,
  ...S6_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
