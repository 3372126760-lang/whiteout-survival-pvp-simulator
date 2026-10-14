import type {
  TroopSkillDefinition,
  TroopSkillLevelValue,
} from "../types";

const passive = { kind: "always" } as const;
const t7 = {
  kind: "troopLevel",
  requiredLevel: "T7",
  ruleStatus: "supported",
} as const;

export const SHIELD_DENSE_FORMATION: TroopSkillDefinition = {
  id: "shield-dense-formation",
  name: "密集战阵",
  troopType: "shield",
  unlockCondition: passive,
  trigger: "passive",
  levelValues: {
    1: {
      versionLabel: "默认",
      effects: [{
        id: "shield-dense-formation-counter",
        name: "密集战阵：对矛兵伤害",
        kind: "damageIncrease",
        group: "troopCounterDamage",
        value: 0.1,
        scope: { source: "self", target: "lancer", damageType: "all" },
      }],
    },
  },
  metadata: { ruleStatus: "supported", tags: ["base", "troopCounterDamage"] },
};

export const SHIELD_STEEL_GUARDIAN: TroopSkillDefinition = {
  id: "shield-steel-guardian",
  name: "钢铁守护",
  troopType: "shield",
  unlockCondition: t7,
  trigger: "passive",
  levelValues: {
    1: {
      versionLabel: "T7",
      effects: [{
        id: "shield-steel-guardian-defense",
        name: "钢铁守护：对矛兵防御",
        kind: "attributeModifier",
        attribute: "defense",
        operation: "multiplyAttributeFactor",
        group: "heroDefenseBonus",
        value: 0.1,
        scope: {
          source: "self",
          target: "all",
          incomingSourceTroop: "lancer",
          damageType: "all",
        },
      }],
    },
  },
  metadata: { ruleStatus: "supported", tags: ["base", "defense"] },
};

export const SHIELD_CRYSTAL_SHIELD: TroopSkillDefinition = {
  id: "shield-crystal-shield",
  name: "烈晶盾牌",
  uiSummary: "每笔独立受击 DamageEvent 各判一次；成功后与其他受到伤害降低同组加算，连射内部第二段不另判",
  troopType: "shield",
  unlockCondition: {
    kind: "troopLevel",
    requiredLevel: "FC3",
    ruleStatus: "supported",
  },
  trigger: "beforeDamage",
  levelValues: {
    1: crystalShieldLevel("Lv1 / FC3", 0.25),
    2: crystalShieldLevel("Lv2 / FC5", 0.375),
  },
  metadata: { ruleStatus: "supported", tags: ["fireCrystal", "receivedDamageReduction"] },
};

export const SHIELD_LIGHTFORGED_BODY: TroopSkillDefinition = {
  id: "shield-lightforged-body",
  name: "光铸之躯",
  uiSummary: "基础防御力独立提升；烈晶盾牌承伤降低升至46%/51%，并入同一承伤组",
  troopType: "shield",
  unlockCondition: {
    kind: "troopLevel",
    requiredLevel: "FC8",
    ruleStatus: "supported",
  },
  trigger: "passive",
  levelValues: {
    1: lightforgedLevel("Lv1 / FC8", 0.04, 0.1),
    2: lightforgedLevel("Lv2 / FC10", 0.06, 0.15),
  },
  metadata: { ruleStatus: "supported", tags: ["fireCrystal", "linked"] },
};

export const SHIELD_IMMORTAL_WALL: TroopSkillDefinition = {
  id: "shield-immortal-wall-t12",
  name: "不朽之壁",
  troopType: "shield",
  unlockCondition: {
    kind: "troopLevel",
    requiredLevel: "T12",
    ruleStatus: "supported",
  },
  trigger: "passive",
  levelValues: createT12Levels((level) => [{
    id: "shield-immortal-wall-enemy-outgoing",
    name: "不朽之壁：敌方造成伤害降低",
    kind: "damageReduction" as const,
    group: "enemyOutgoingDamageReduction",
    value: 0.006 * level,
    scope: { source: "army" as const, target: "all" as const, damageType: "all" as const },
    lifecycle: { activeRounds: [1, 2, 3, 4, 5] },
  }]),
  metadata: { ruleStatus: "supported", tags: ["T12", "directFinalLevel", "round1-5"] },
};

export const SHIELD_TROOP_SKILL_DEFINITIONS = [
  SHIELD_DENSE_FORMATION,
  SHIELD_STEEL_GUARDIAN,
  SHIELD_CRYSTAL_SHIELD,
  SHIELD_LIGHTFORGED_BODY,
  SHIELD_IMMORTAL_WALL,
] as const;

function crystalShieldLevel(
  versionLabel: string,
  probability: number,
): TroopSkillLevelValue {
  return {
    versionLabel,
    probability,
    effects: [{
      id: "shield-crystal-shield-reduction",
      name: "烈晶盾牌：受到伤害降低",
      kind: "damageReduction",
      group: "receivedDamageReduction",
      value: 0.36,
      scope: { source: "self", target: "shield", damageType: "all" },
    }],
  };
}

function lightforgedLevel(
  versionLabel: string,
  defense: number,
  linkedCancellation: number,
): TroopSkillLevelValue {
  return {
    versionLabel,
    effects: [
      {
        id: "shield-lightforged-defense",
        name: "光铸之躯：基础防御力提升",
        kind: "baseDefenseMultiplier",
        group: "lightforgedBaseDefense",
        value: defense,
        scope: { source: "self", target: "shield", damageType: "all" },
      },
      {
        id: "shield-lightforged-linked-reduction",
        name: "光铸之躯：烈晶盾牌联动承伤降低",
        kind: "damageReduction",
        group: "receivedDamageReduction",
        value: linkedCancellation,
        linkedToSkillId: SHIELD_CRYSTAL_SHIELD.id,
        scope: { source: "self", target: "shield", damageType: "all" },
      },
    ],
  };
}

function createT12Levels(
  effects: (level: number) => TroopSkillLevelValue["effects"],
): Readonly<Record<number, TroopSkillLevelValue>> {
  return Object.fromEntries(
    Array.from({ length: 24 }, (_, index) => {
      const level = index + 1;
      return [level, { versionLabel: `L${level}`, effects: effects(level) }];
    }),
  );
}
