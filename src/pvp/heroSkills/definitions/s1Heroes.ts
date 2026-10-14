import type {
  HeroPosition,
  HeroSkillDefinition,
  HeroSkillEffect,
  HeroSkillTrigger,
} from "../types";
import { SKILL_ATTRIBUTE_MULTIPLIER_GROUPS } from "../../constants";
import {
  S1_WEAPON_SCENE_SKILL_VALUES,
} from "../data/generationStats";

const SOURCE = "confirmed S1 expedition PVP rules, synchronized 2026-09-20";
const BOTH = ["leader", "member"] as const satisfies readonly HeroPosition[];

export const S1_HERO_SKILL_DEFINITIONS = [
  normalSkill("hero-skill.heluonimo.penetration", "hero.s1.heluonimo", "赫罗尼莫·战前宣言", 1,
    [attribute("hero-effect.heluonimo.penetration", "penetration", .25)]),
  normalSkill("hero-skill.heluonimo.attack", "hero.s1.heluonimo", "赫罗尼莫·剑术指导", 2,
    [attribute("hero-effect.heluonimo.attack", "attack", .25)]),
  normalSkill("hero-skill.heluonimo.periodic-damage", "hero.s1.heluonimo", "赫罗尼莫·精湛剑术", 3,
    [damageIncrease("hero-effect.heluonimo.periodic-damage", .30, "army", "commonDamageIncrease", {
      periodRounds: 4,
      firstActiveRound: 5,
      activeWindowRounds: 2,
    })]),

  normalSkill("hero-skill.nataliya.wild-roar", "hero.s1.nataliya", "娜塔莉亚·野性咆哮", 1,
    [roundReduction("hero-effect.nataliya.wild-roar", .50)], "roundStart", .40),
  normalSkill("hero-skill.nataliya.attack", "hero.s1.nataliya", "娜塔莉亚·兽群领袖", 2,
    [attribute("hero-effect.nataliya.attack", "attack", .25)]),
  normalSkill("hero-skill.nataliya.penetration", "hero.s1.nataliya", "娜塔莉亚·狂野呼唤", 3,
    [attribute("hero-effect.nataliya.penetration", "penetration", .25)]),

  normalSkill("hero-skill.moli.snow-command", "hero.s1.moli", "茉莉·雪之号令", 1,
    [roundReduction("hero-effect.moli.snow-command", .50)], "roundStart", .40),
  normalSkill("hero-skill.moli.ice-field", "hero.s1.moli", "茉莉·冰雪领域", 2,
    [extraDamage("hero-effect.moli.ice-field", .50)],
    "beforeAttack", .50),
  normalSkill("hero-skill.moli.penetration", "hero.s1.moli", "茉莉·少女之怒", 3,
    [attribute("hero-effect.moli.penetration", "penetration", .25)]),

  normalSkill("hero-skill.jinman.defense-life", "hero.s1.jinman", "津曼·固若金汤", 1, [
    skillDefense("hero-effect.jinman.defense", .10),
    attribute("hero-effect.jinman.life", "life", .10),
  ]),
  normalSkill("hero-skill.jinman.penetration", "hero.s1.jinman", "津曼·阵地战强者", 3,
    [attribute("hero-effect.jinman.penetration", "penetration", .25)]),
] as const satisfies readonly HeroSkillDefinition[];

export const S1_WEAPON_SKILL_DEFINITIONS = [
  sceneWeaponSkill("hero-weapon-skill.heluonimo.rally-attack", "hero.s1.heluonimo", "赫罗尼莫专武·集结进攻攻击", 2, "attack", "buffAttack", ["rallyAttack"]),

  sceneWeaponSkill("hero-weapon-skill.nataliya.rally-penetration", "hero.s1.nataliya", "娜塔莉亚专武·集结进攻穿透", 2, "penetration", "buffPenetration", ["rallyAttack"]),

  sceneWeaponSkill("hero-weapon-skill.moli.defense-penetration", "hero.s1.moli", "茉莉专武·守城穿透", 2, "penetration", "buffPenetration", ["rallyDefense", "garrisonDefense"]),

  sceneWeaponSkill("hero-weapon-skill.jinman.defense-attack", "hero.s1.jinman", "津曼专武·守城攻击", 2, "attack", "buffAttack", ["rallyDefense", "garrisonDefense"]),
] as const satisfies readonly HeroSkillDefinition[];

function normalSkill(
  id: string,
  heroId: string,
  name: string,
  slot: 1 | 2 | 3,
  effects: readonly HeroSkillEffect[],
  trigger: HeroSkillTrigger = "passive",
  probability?: number,
): HeroSkillDefinition {
  return {
    id,
    heroId,
    name,
    positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: slot, allowedPositions: BOTH },
    trigger,
    ...(probability === undefined ? {} : { probability }),
    activationTiming: "immediate",
    levelValues: { 5: { versionLabel: "Expedition Lv.5", effects } },
    metadata: { ruleStatus: "supported", source: SOURCE, tags: ["S1", `expeditionSlot${slot}`] },
  };
}

function weaponSkill(
  id: string,
  heroId: string,
  name: string,
  slot: 1 | 2,
  levels: Readonly<Partial<Record<1 | 2 | 3 | 4 | 5, readonly HeroSkillEffect[]>>>,
  battleContexts?: HeroSkillDefinition["battleContexts"],
): HeroSkillDefinition {
  return {
    id,
    heroId,
    name,
    positionRule: { kind: "exclusiveWeapon", expeditionSkillSlot: slot, allowedPositions: BOTH },
    trigger: "passive",
    activationTiming: "immediate",
    ...(battleContexts === undefined ? {} : { battleContexts }),
    levelValues: Object.fromEntries(Object.entries(levels).map(([level, effects]) => [
      level,
      { versionLabel: `Exclusive Weapon Tier ${level}`, effects: effects ?? [] },
    ])),
    metadata: { ruleStatus: "supported", source: SOURCE, tags: ["S1", "exclusiveWeapon", `weaponSkill${slot}`] },
  };
}

function sceneWeaponSkill(
  id: string,
  heroId: string,
  name: string,
  slot: 2,
  attributeName: "attack" | "penetration",
  group: "buffAttack" | "buffPenetration",
  battleContexts: NonNullable<HeroSkillDefinition["battleContexts"]>,
): HeroSkillDefinition {
  return weaponSkill(id, heroId, name, slot, Object.fromEntries(
    Object.entries(S1_WEAPON_SCENE_SKILL_VALUES).map(([level, value]) => [level, [
      attribute(`hero-weapon-effect.${id.slice("hero-weapon-skill.".length)}`, attributeName, value, "army", "multiplyAttributeFactor", group),
    ]]),
  ), battleContexts);
}

function attribute(
  id: string,
  attributeName: "attack" | "penetration" | "defense" | "life",
  value: number,
  source: "army" | "shield" | "lancer" | "marksman" = "army",
  operation: "multiplyAttributeFactor" = "multiplyAttributeFactor",
  group: string = attributeName === "attack"
    ? SKILL_ATTRIBUTE_MULTIPLIER_GROUPS.skillAttackMultiplier
    : attributeName === "penetration"
      ? SKILL_ATTRIBUTE_MULTIPLIER_GROUPS.skillPenetrationMultiplier
      : attributeName === "life"
        ? SKILL_ATTRIBUTE_MULTIPLIER_GROUPS.skillLifeMultiplier
        : SKILL_ATTRIBUTE_MULTIPLIER_GROUPS.skillDefenseMultiplier,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "attributeModifier",
    recipient: "selfArmy",
    attribute: attributeName,
    operation,
    group,
    value,
    scope: { source, target: "all", damageType: "all" },
  };
}

function skillDefense(id: string, value: number): HeroSkillEffect {
  return attribute(id, "defense", value);
}

function extraDamage(id: string, coefficient: number): HeroSkillEffect {
  return {
    id, name: id, kind: "extraDamage", recipient: "selfArmy",
    coefficient, basis: "parentBaseDamage",
    scope: { source: "army", target: "currentTarget", damageType: "skillDamage" },
  };
}

function damageIncrease(
  id: string,
  value: number,
  source: "army" | "shield" | "lancer" | "marksman",
  group: string,
  lifecycle?: HeroSkillEffect["lifecycle"],
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "damageIncrease",
    recipient: "selfArmy",
    group,
    value,
    scope: { source, target: "all", damageType: "all" },
    ...(lifecycle === undefined ? {} : { lifecycle }),
  };
}

function receivedReduction(
  id: string,
  value: number,
  target: "all" | "shield" | "lancer" | "marksman" = "all",
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "damageReduction",
    recipient: "selfArmy",
    group: "receivedDamageReduction",
    value,
    scope: { source: "army", target, damageType: "all" },
  };
}

function roundReduction(id: string, value: number): HeroSkillEffect {
  return {
    ...receivedReduction(id, value),
    lifecycle: { durationRounds: 1, refreshMode: "replace" },
  };
}
