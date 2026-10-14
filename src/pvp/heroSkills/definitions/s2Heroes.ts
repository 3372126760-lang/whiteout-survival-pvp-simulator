import { EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES } from "../data/generationStats";
import { SKILL_ATTRIBUTE_MULTIPLIER_GROUPS } from "../../constants";
import type {
  HeroPosition,
  HeroSkillDefinition,
  HeroSkillEffect,
  HeroSkillTrigger,
} from "../types";

const SOURCE = "confirmed S2 expedition PVP rules, synchronized 2026-09-20";
const BOTH = ["leader", "member"] as const satisfies readonly HeroPosition[];

export const FLINT_WILDFIRE = skill({
  id: "hero-skill.fulinte.wildfire", heroId: "hero.head.fulinte", name: "弗林特·野火燎原", slot: 1,
  values: [.20, .40, .60, .80, 1], effects: [damageIncrease("hero-effect.fulinte.wildfire.shield-damage", 1, "shield", "commonDamageIncrease")],
});
export const FLINT_BURNING_WILL = skill({
  id: "hero-skill.fulinte.burning-will", heroId: "hero.head.fulinte", name: "弗林特·燃烧意志", slot: 2,
  values: [.05, .10, .15, .20, .25], effects: [attribute("hero-effect.fulinte.burning-will.attack", "attack", .25)],
});
export const FLINT_ENDLESS_FIRE = skill({
  id: "hero-skill.fulinte.endless-fire", heroId: "hero.head.fulinte", name: "弗林特·无尽烈火", slot: 3,
  values: [.05, .10, .15, .20, .25], effects: [attribute("hero-effect.fulinte.endless-fire.penetration", "penetration", .25)],
});

export const PHILLY_FITNESS_SECRET = skill({
  id: "hero-skill.feilande.fitness-secret", heroId: "hero.s2.feilande", name: "菲兰德·健身秘诀", slot: 1,
  levelEffects: [1, 2, 3, 4, 5].map((level) => [
    attribute("hero-effect.feilande.fitness-secret.attack", "attack", .03 * level),
    skillDefense("hero-effect.feilande.fitness-secret.defense", .02 * level),
  ]),
});
export const PHILLY_STRENGTHENING_POTION = skill({
  id: "hero-skill.feilande.strengthening-potion", heroId: "hero.s2.feilande", name: "菲兰德·强化药剂", slot: 2,
  trigger: "beforeAttack", probability: .25, values: [.20, .40, .60, .80, 1],
  effects: [extraDamage("hero-effect.feilande.strengthening-potion.extra", 1)],
  tags: ["perTroopMainAttackProc", "noRapidFireReproc"],
});
export const PHILLY_STIMULANT = skill({
  id: "hero-skill.feilande.stimulant", heroId: "hero.s2.feilande", name: "菲兰德·提神针剂", slot: 3,
  trigger: "roundStart", probability: .40, values: [.10, .20, .30, .40, .50],
  effects: [receivedReduction("hero-effect.feilande.stimulant", .50, 1)],
});

export const ALONSO_STORMY_WAVES = skill({
  id: "hero-skill.alongsuo.stormy-waves", heroId: "hero.s2.alongsuo", name: "阿隆索·惊涛骇浪", slot: 1,
  trigger: "roundStart", probability: .40, values: [.10, .20, .30, .40, .50],
  effects: [attribute("hero-effect.alongsuo.stormy-waves", "penetration", .50, 1)],
});
export const ALONSO_STEEL_WILL = skill({
  id: "hero-skill.alongsuo.steel-will", heroId: "hero.s2.alongsuo", name: "阿隆索·钢铁意志", slot: 2,
  trigger: "beforeAttack", probability: .20, values: [.10, .20, .30, .40, .50],
  effects: [targetPenetrationReduction("hero-effect.alongsuo.steel-will.penetration-reduction", .50, 2)],
  activationTiming: "nextRound",
  tags: ["hitTargetTroop"],
});
export const ALONSO_SHARP_HARPOON = skill({
  id: "hero-skill.alongsuo.sharp-harpoon", heroId: "hero.s2.alongsuo", name: "阿隆索·锋锐鱼叉", slot: 3,
  trigger: "beforeAttack", probability: .50, values: [.10, .20, .30, .40, .50],
  effects: [extraDamage("hero-effect.alongsuo.sharp-harpoon", .50, "parentBaseDamage")],
});

export const S2_WEAPON_SKILL_DEFINITIONS = [
  sceneWeapon("hero-weapon-skill.fulinte.defense-attack", "hero.head.fulinte", "弗林特专武·龙之吐息", "attack", "buffAttack", ["rallyDefense", "garrisonDefense"]),
  sceneWeapon("hero-weapon-skill.feilande.defense-life", "hero.s2.feilande", "菲兰德专武·急救训练", "life", "buffLife", ["rallyDefense", "garrisonDefense"]),
  sceneWeapon("hero-weapon-skill.alongsuo.rally-penetration", "hero.s2.alongsuo", "阿隆索专武·鱼叉强化", "penetration", "buffPenetration", ["rallyAttack"]),
] as const satisfies readonly HeroSkillDefinition[];

export const S2_HERO_SKILL_DEFINITIONS = [
  FLINT_WILDFIRE, FLINT_BURNING_WILL, FLINT_ENDLESS_FIRE,
  PHILLY_FITNESS_SECRET, PHILLY_STRENGTHENING_POTION, PHILLY_STIMULANT,
  ALONSO_STORMY_WAVES, ALONSO_STEEL_WILL, ALONSO_SHARP_HARPOON,
  ...S2_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];

interface SkillInput {
  readonly id: string;
  readonly heroId: string;
  readonly name: string;
  readonly slot: 1 | 2 | 3;
  readonly trigger?: HeroSkillTrigger;
  readonly probability?: number;
  readonly values?: readonly [number, number, number, number, number];
  readonly levelEffects?: readonly (readonly HeroSkillEffect[])[];
  readonly effects?: readonly HeroSkillEffect[];
  readonly ruleStatus?: "supported" | "RULE_UNKNOWN";
  readonly activationTiming?: "immediate" | "nextAction" | "roundEnd" | "nextRound";
  readonly tags?: readonly string[];
}

function skill(input: SkillInput): HeroSkillDefinition {
  const baseEffects = input.effects ?? [];
  const levels = input.levelEffects ?? input.values?.map((value) =>
    baseEffects.map((effect) => withLevelValue(effect, value))
  ) ?? [[], [], [], [], baseEffects];
  return {
    id: input.id,
    heroId: input.heroId,
    name: input.name,
    positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: input.slot, allowedPositions: BOTH },
    trigger: input.trigger ?? "passive",
    ...(input.probability === undefined ? {} : { probability: input.probability }),
    ...(input.activationTiming === undefined ? {} : { activationTiming: input.activationTiming }),
    levelValues: Object.fromEntries(levels.map((effects, index) => [index + 1, {
      versionLabel: `Expedition Lv.${index + 1}`,
      effects,
    }])),
    metadata: {
      ruleStatus: input.ruleStatus ?? "supported",
      source: SOURCE,
      tags: ["S2", `expeditionSlot${input.slot}`, ...(input.tags ?? [])],
    },
  };
}

function sceneWeapon(
  id: string,
  heroId: string,
  name: string,
  attributeName: "attack" | "penetration" | "life",
  group: string,
  battleContexts: NonNullable<HeroSkillDefinition["battleContexts"]>,
  tags: readonly string[] = [],
  operation: "multiplyAttributeFactor" = "multiplyAttributeFactor",
): HeroSkillDefinition {
  return {
    id, heroId, name,
    positionRule: { kind: "exclusiveWeapon", expeditionSkillSlot: 2, allowedPositions: BOTH },
    trigger: "passive",
    activationTiming: "immediate",
    battleContexts,
    levelValues: Object.fromEntries(Object.entries(EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES).map(([level, value]) => [level, {
      versionLabel: `Exclusive Weapon Tier ${level}`,
      effects: [attribute(`hero-weapon-effect.${id.slice("hero-weapon-skill.".length)}`, attributeName, value, undefined, operation, group)],
    }])),
    metadata: { ruleStatus: "supported", source: SOURCE, tags: ["S2", "exclusiveWeapon", "weaponSkill2", ...tags] },
  };
}

function attribute(
  id: string,
  attributeName: "attack" | "penetration" | "defense" | "life",
  value: number,
  durationRounds?: number,
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
    id, name: id, kind: "attributeModifier", recipient: "selfArmy",
    attribute: attributeName, operation, group, value,
    scope: { source: "army", target: "all", damageType: "all" },
    ...(durationRounds === undefined ? {} : { lifecycle: { durationRounds, refreshMode: "replace" as const } }),
  };
}

function skillDefense(id: string, value: number): HeroSkillEffect {
  return attribute(id, "defense", value);
}

function damageIncrease(id: string, value: number, source: "army" | "shield", group: string): HeroSkillEffect {
  return { id, name: id, kind: "damageIncrease", recipient: "selfArmy", group, value,
    scope: { source, target: "all", damageType: "all" } };
}

function receivedReduction(id: string, value: number, durationRounds: number): HeroSkillEffect {
  return { id, name: id, kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value,
    scope: { source: "army", target: "all", damageType: "all" },
    lifecycle: { durationRounds, refreshMode: "replace" } };
}

function targetPenetrationReduction(id: string, value: number, durationRounds: number): HeroSkillEffect {
  return { id, name: id, kind: "attributeReduction", recipient: "enemyArmy",
    attribute: "penetration",
    group: "enemyPenetrationReduction", value,
    scope: { source: "army", target: "currentTarget", damageType: "all" },
    lifecycle: { activationTiming: "nextRound", durationRounds, refreshMode: "replace" } };
}

function extraDamage(
  id: string,
  coefficient: number,
  basis: "parentRawDamage" | "parentBaseDamage" = "parentRawDamage",
): HeroSkillEffect {
  return { id, name: id, kind: "extraDamage", recipient: "selfArmy", coefficient,
    basis, scope: { source: "army", target: "currentTarget", damageType: "skillDamage" } };
}

function withLevelValue(effect: HeroSkillEffect, value: number): HeroSkillEffect {
  if (effect.kind === "extraDamage") return { ...effect, coefficient: value };
  if (
    effect.kind === "targetingOverride" ||
    effect.kind === "targetBoundMark" ||
    effect.kind === "temporaryShield" ||
    effect.kind === "skipNextRoundAction" ||
    effect.kind === "markedTargetDamageIncrease" ||
    effect.kind === "decayingDamageIncrease"
  ) return effect;
  return { ...effect, value };
}
