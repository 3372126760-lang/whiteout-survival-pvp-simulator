import { LANCER_SURPRISE_TARGET_PRIORITY } from "../../constants";
import type { TroopSkillDefinition, TroopSkillLevelValue } from "../types";

const passive = { kind: "always" } as const;
const t7 = {
  kind: "troopLevel",
  requiredLevel: "T7",
  ruleStatus: "supported",
} as const;

export const LANCER_CHARGE: TroopSkillDefinition = {
  id: "lancer-charge",
  name: "冲锋",
  troopType: "lancer",
  unlockCondition: passive,
  trigger: "passive",
  levelValues: { 1: { versionLabel: "默认", effects: [{
    id: "lancer-charge-counter",
    name: "冲锋：对射手伤害",
    kind: "damageIncrease",
    group: "troopCounterDamage",
    value: 0.1,
    scope: { source: "self", target: "marksman", damageType: "all" },
  }] } },
  metadata: { ruleStatus: "supported", tags: ["base", "troopCounterDamage"] },
};

export const LANCER_AMBUSH_SKILL_DEFINITION: TroopSkillDefinition = {
  id: "lancer-ambush",
  name: "奇袭",
  troopType: "lancer",
  unlockCondition: t7,
  trigger: "beforeAttack",
  probability: 0.2,
  levelValues: { 1: { versionLabel: "T7", effects: [{
    id: "lancer-ambush-targeting",
    name: "奇袭：射手优先",
    kind: "targetingOverride",
    scope: { source: "self", target: "currentTarget" },
    priority: LANCER_SURPRISE_TARGET_PRIORITY,
    lifecycle: { activationTiming: "nextAction" },
  }] } },
  metadata: { ruleStatus: "supported", tags: ["base", "targetingOverride"] },
};

export const LANCER_CRYSTAL_SPEAR: TroopSkillDefinition = {
  id: "lancer-crystal-spear",
  name: "炎晶战矛",
  troopType: "lancer",
  unlockCondition: { kind: "troopLevel", requiredLevel: "FC3", ruleStatus: "supported" },
  trigger: "beforeAttack",
  levelValues: {
    1: crystalSpearLevel("Lv1 / FC3", 0.1),
    2: crystalSpearLevel("Lv2 / FC5", 0.15),
  },
  metadata: {
    ruleStatus: "supported",
    description: "触发后生成100% skillDamage/extraDamage独立事件。",
    tags: ["fireCrystal", "extraDamage", "independentDamageEvent"],
  },
};

export const LANCER_CRIMSON_FIELD: TroopSkillDefinition = {
  id: "lancer-crimson-field",
  name: "炽红力场",
  uiSummary: "每笔独立伤害事件分别判定；成功时受到伤害降低50%，与同组来源加算",
  troopType: "lancer",
  unlockCondition: { kind: "troopLevel", requiredLevel: "FC8", ruleStatus: "supported" },
  trigger: "beforeDamage",
  levelValues: {
    1: crimsonFieldLevel("Lv1 / FC8", 0.1),
    2: crimsonFieldLevel("Lv2 / FC10", 0.15),
  },
  metadata: {
    ruleStatus: "supported",
    description: "每笔独立 incoming DamageEvent 单独判定；连射内部第二段不另判。",
    tags: ["fireCrystal", "receivedDamageReduction", "perDamageEvent"],
  },
};

export const LANCER_RADIANT_FORMATION: TroopSkillDefinition = {
  id: "lancer-radiant-formation-t12",
  name: "烈辉战阵",
  uiSummary: "前五回合盾兵承伤降低、射手造成伤害增加",
  troopType: "lancer",
  unlockCondition: { kind: "troopLevel", requiredLevel: "T12", ruleStatus: "supported" },
  trigger: "passive",
  levelValues: createT12Levels(),
  metadata: { ruleStatus: "supported", tags: ["T12", "directFinalLevel", "round1-5"] },
};

export const LANCER_TROOP_SKILL_DEFINITIONS = [
  LANCER_CHARGE,
  LANCER_AMBUSH_SKILL_DEFINITION,
  LANCER_CRYSTAL_SPEAR,
  LANCER_CRIMSON_FIELD,
  LANCER_RADIANT_FORMATION,
] as const;

function crystalSpearLevel(versionLabel: string, probability: number): TroopSkillLevelValue {
  return { versionLabel, probability, effects: [{
    id: "lancer-crystal-spear-extra-damage",
    name: "炎晶战矛：100%额外伤害",
    kind: "extraDamage",
    coefficient: 1,
    basis: "parentBaseDamage",
    scope: { source: "self", target: "currentTarget", damageType: "skillDamage" },
  }] };
}

function crimsonFieldLevel(versionLabel: string, probability: number): TroopSkillLevelValue {
  return { versionLabel, probability, effects: [{
    id: "lancer-crimson-field-reduction",
    name: "炽红力场：受到伤害降低50%",
    kind: "damageReduction",
    group: "receivedDamageReduction",
    value: 0.5,
    scope: { source: "self", target: "lancer", damageType: "all" },
  }] };
}

function createT12Levels(): Readonly<Record<number, TroopSkillLevelValue>> {
  return Object.fromEntries(Array.from({ length: 24 }, (_, index) => {
    const level = index + 1;
    return [level, { versionLabel: `L${level}`, effects: [
      {
        id: "lancer-radiant-shield-reduction",
        name: "烈辉战阵：盾兵承伤降低",
        kind: "damageReduction" as const,
        group: "receivedDamageReduction",
        value: 0.01 * level,
        scope: { source: "shield" as const, target: "shield" as const, damageType: "all" as const },
        lifecycle: { activeRounds: [1, 2, 3, 4, 5] },
      },
      {
        id: "lancer-radiant-marksman-increase",
        name: "烈辉战阵：射手造成伤害增加",
        kind: "damageIncrease" as const,
        group: "commonDamageIncrease",
        value: 0.01 * level,
        scope: { source: "marksman" as const, target: "all" as const, damageType: "all" as const },
        lifecycle: { activeRounds: [1, 2, 3, 4, 5] },
      },
    ] }];
  }));
}
