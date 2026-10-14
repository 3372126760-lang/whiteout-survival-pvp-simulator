import type { TroopSkillDefinition, TroopSkillLevelValue } from "../types";

export const MARKSMAN_REMOTE_STRIKE: TroopSkillDefinition = {
  id: "marksman-remote-strike",
  name: "远程打击",
  troopType: "marksman",
  unlockCondition: { kind: "always" },
  trigger: "passive",
  levelValues: { 1: { versionLabel: "默认", effects: [{
    id: "marksman-remote-strike-counter",
    name: "远程打击：对盾兵伤害",
    kind: "damageIncrease",
    group: "troopCounterDamage",
    value: 0.1,
    scope: { source: "self", target: "shield", damageType: "all" },
  }] } },
  metadata: { ruleStatus: "supported", tags: ["base", "troopCounterDamage"] },
};

export const MARKSMAN_RAPID_FIRE: TroopSkillDefinition = {
  id: "marksman-rapid-fire",
  name: "连射",
  troopType: "marksman",
  unlockCondition: { kind: "troopLevel", requiredLevel: "T7", ruleStatus: "supported" },
  trigger: "afterNormalAttack",
  probability: 0.1,
  levelValues: { 1: { versionLabel: "T7", effects: [{
    id: "marksman-rapid-fire-second-shot",
    name: "连射：第二次普攻",
    kind: "sameMainAttackSegment",
    segmentCount: 1,
    damageScale: 1,
    inheritTarget: true,
    suppressTriggerChain: true,
    scope: { source: "self", target: "currentTarget", damageType: "normalAttack" },
  }] } },
  metadata: { ruleStatus: "supported", tags: ["base", "sameMainAttackSegment", "noRecursion"] },
};

export const MARKSMAN_CRYSTAL_POWDER: TroopSkillDefinition = {
  id: "marksman-crystal-powder",
  name: "燃晶火药",
  uiSummary: "触发后一笔额外伤害；FC8/FC10 联动为75%/87.5%B",
  troopType: "marksman",
  unlockCondition: { kind: "troopLevel", requiredLevel: "FC3", ruleStatus: "supported" },
  trigger: "afterNormalAttack",
  levelValues: {
    1: powderLevel("Lv1 / FC3", 0.2),
    2: powderLevel("Lv2 / FC5", 0.3),
  },
  metadata: {
    ruleStatus: "supported",
    description: "50% extraDamage；FC8/FC10 联动系数在同一事件中加至75%/87.5%。",
    tags: ["fireCrystal", "extraDamage", "bearRuleReuse"],
  },
};

export const MARKSMAN_FLAME_IMPACT: TroopSkillDefinition = {
  id: "marksman-flame-impact",
  name: "火焰冲击",
  uiSummary: "基础攻击力提升进入 B，所有基于 B 的射手伤害继承",
  troopType: "marksman",
  unlockCondition: { kind: "troopLevel", requiredLevel: "FC8", ruleStatus: "supported" },
  trigger: "passive",
  levelValues: {
    1: flameImpactLevel("Lv1 / FC8", 0.04),
    2: flameImpactLevel("Lv2 / FC10", 0.06),
  },
  metadata: {
    ruleStatus: "supported",
    description: "基础攻击力倍率进入射手基础伤害 B，所有基于 B 的伤害继承。",
    tags: ["fireCrystal", "baseDamageMultiplier"] },
};

export const MARKSMAN_BLAZING_STAR: TroopSkillDefinition = {
  id: "marksman-blazing-star-t12",
  name: "炽火燧星",
  uiSummary: "R6起每5回合永久增加一层射手普通增伤，每层为等级×0.5%",
  troopType: "marksman",
  unlockCondition: { kind: "troopLevel", requiredLevel: "T12", ruleStatus: "supported" },
  trigger: "passive",
  levelValues: createT12Levels(),
  metadata: {
    ruleStatus: "supported",
    description: "R1-R5零层，R6起每5回合增加一层，永久持续且无已知上限。",
    tags: ["T12", "stacking", "damageIncrease"],
  },
};

export const MARKSMAN_TROOP_SKILL_DEFINITIONS = [
  MARKSMAN_REMOTE_STRIKE,
  MARKSMAN_RAPID_FIRE,
  MARKSMAN_CRYSTAL_POWDER,
  MARKSMAN_FLAME_IMPACT,
  MARKSMAN_BLAZING_STAR,
] as const;

function powderLevel(
  versionLabel: string,
  probability: number,
): TroopSkillLevelValue {
  return {
    versionLabel,
    probability,
    effects: [extraDamage("marksman-crystal-powder-extra", "燃晶火药：合并额外伤害", 0.5)],
  };
}

function extraDamage(id: string, name: string, coefficient: number) {
  return {
    id,
    name,
    kind: "extraDamage" as const,
    coefficient,
    // Bear-model postMultiplierDamage is reconstructed by letting this
    // independent skill-damage event apply its own applicable groups once.
    // Starting from parent raw damage keeps normal-attack-only groups out.
    basis: "parentBaseDamage" as const,
    scope: { source: "self" as const, target: "currentTarget" as const, damageType: "skillDamage" as const },
  };
}

function flameImpactLevel(
  versionLabel: string,
  value: number,
): TroopSkillLevelValue {
  return { versionLabel, effects: [
    {
      id: "marksman-flame-impact-base-attack",
      name: "火焰冲击：基础攻击力提升",
      kind: "baseDamageMultiplier",
      group: "flameImpactBaseAttack",
      value,
      scope: { source: "self", target: "all", damageType: "all" },
    },
    {
      id: "marksman-flame-impact-powder-link",
      name: "火焰冲击：燃晶火药联动",
      kind: "extraDamageContribution",
      linkedToSkillId: MARKSMAN_CRYSTAL_POWDER.id,
      coefficient: value === 0.04 ? 0.25 : 0.375,
      scope: { source: "self", target: "currentTarget", damageType: "skillDamage" },
    },
  ] };
}

function createT12Levels(): Readonly<Record<number, TroopSkillLevelValue>> {
  return Object.fromEntries(Array.from({ length: 24 }, (_, index) => {
    const level = index + 1;
    return [level, { versionLabel: `L${level}`, effects: [{
      id: "marksman-blazing-star-increase",
      name: "炽火燧星：射手累计增伤",
      kind: "damageIncrease" as const,
      group: "commonDamageIncrease",
      value: 0.005 * level,
      scope: { source: "self" as const, target: "all" as const, damageType: "all" as const },
      lifecycle: { refreshMode: "replace" as const },
    }] }];
  }));
}
