import type {
  HeroPosition,
  HeroSkillDefinition,
  HeroSkillEffect,
  HeroSkillTrigger,
} from "../types";
import {
  S1_HERO_SKILL_DEFINITIONS,
  S1_WEAPON_SKILL_DEFINITIONS,
} from "./s1Heroes";
import { S2_HERO_SKILL_DEFINITIONS } from "./s2Heroes";
import { S3_HERO_SKILL_DEFINITIONS } from "./s3Heroes";
import { S4_HERO_SKILL_DEFINITIONS } from "./s4Heroes";
import { S5_HERO_SKILL_DEFINITIONS } from "./s5Heroes";
import { S6_HERO_SKILL_DEFINITIONS } from "./s6Heroes";
import { S7_HERO_SKILL_DEFINITIONS } from "./s7Heroes";
import { S8_HERO_SKILL_DEFINITIONS } from "./s8Heroes";
import { S9_HERO_SKILL_DEFINITIONS } from "./s9Heroes";
import { S10_HERO_SKILL_DEFINITIONS } from "./s10Heroes";
import { S11_HERO_SKILL_DEFINITIONS } from "./s11Heroes";
import { S12_HERO_SKILL_DEFINITIONS } from "./s12Heroes";
import { S13_HERO_SKILL_DEFINITIONS } from "./s13Heroes";
import { S14_HERO_SKILL_DEFINITIONS } from "./s14Heroes";
import { S15_HERO_SKILL_DEFINITIONS } from "./s15Heroes";
import { S16_HERO_SKILL_DEFINITIONS } from "./s16Heroes";

const SOURCE = "confirmed expedition PVP rules, synchronized 2026-09-20";
const leaderAndMember = ["leader", "member"] as const;

export const JESSIE_PENETRATION = skill({
  id: "hero-skill.jiexi.penetration", heroId: "hero.body.jiexi",
  name: "Jessie Fully Armed", slot: 1, allowedPositions: leaderAndMember,
  values: [.05, .10, .15, .20, .25],
  effects: [attribute("hero-effect.jiexi.penetration", "penetration", .25)],
});
export const JESSIE_MECHANICAL_BARRIER = skill({
  id: "hero-skill.jiexi.mechanical-barrier", heroId: "hero.body.jiexi",
  name: "Jessie Mechanical Barrier", slot: 2, allowedPositions: leaderAndMember,
  values: [.04, .08, .12, .16, .20],
  effects: [receivedDamageReduction("hero-effect.jiexi.mechanical-barrier", .20)],
});
export const JASSER_PENETRATION = skill({
  id: "hero-skill.jiesaier.penetration", heroId: "hero.body.jiesaier",
  name: "Jasser Tactical Deduction", slot: 1, allowedPositions: leaderAndMember,
  values: [.05, .10, .15, .20, .25],
  effects: [attribute("hero-effect.jiesaier.penetration", "penetration", .25)],
});
export const SEO_YOON_ATTACK = skill({
  id: "hero-skill.shuyun.attack", heroId: "hero.body.shuyun",
  name: "Seo-yoon War Drum", slot: 1, allowedPositions: leaderAndMember,
  values: [.05, .10, .15, .20, .25],
  effects: [attribute("hero-effect.shuyun.attack", "attack", .25)],
});

export const SERGEI_GUARDIAN_POWER = skill({
  id: "hero-skill.xieergai.guardian-power", heroId: "hero.sr.xieergai",
  name: "Sergei Guardian Power", slot: 1, allowedPositions: leaderAndMember,
  values: [.04, .08, .12, .16, .20],
  effects: [receivedDamageReduction("hero-effect.xieergai.guardian-power", .20)],
});
export const SERGEI_WEAKENING_STRIKE = skill({
  id: "hero-skill.xieergai.weakening-strike", heroId: "hero.sr.xieergai",
  name: "Sergei Weakening Strike", slot: 2, allowedPositions: leaderAndMember,
  values: [.04, .08, .12, .16, .20],
  effects: [attributeReduction("hero-effect.xieergai.weakening-strike", "attack", "enemyAttackReduction", .20)],
});
export const PATRICK_LIFE = skill({
  id: "hero-skill.patelike.life", heroId: "hero.sr.patelike",
  name: "Patrick Food Effect", slot: 1, allowedPositions: leaderAndMember,
  values: [.05, .10, .15, .20, .25],
  effects: [attribute("hero-effect.patelike.life", "life", .25)],
});
export const PATRICK_ATTACK = skill({
  id: "hero-skill.patelike.attack", heroId: "hero.sr.patelike",
  name: "Patrick Energy Intake", slot: 2, allowedPositions: leaderAndMember,
  values: [.05, .10, .15, .20, .25],
  effects: [attribute("hero-effect.patelike.attack", "attack", .25)],
});
export const BAHITI_DANGER_SENSE = skill({
  id: "hero-skill.baxiti.danger-sense", heroId: "hero.sr.baxiti",
  name: "Bahiti Danger Sense", slot: 1, allowedPositions: leaderAndMember,
  values: [.04, .08, .12, .16, .20],
  effects: [receivedDamageReduction("hero-effect.baxiti.danger-sense", .20)],
});
export const BAHITI_UNSTABLE_FIELD = skill({
  id: "hero-skill.baxiti.unstable-field", heroId: "hero.sr.baxiti",
  name: "Bahiti Unstable Field", slot: 2, allowedPositions: leaderAndMember,
  trigger: "beforeAttack", probability: .50,
  effects: [{
    id: "hero-effect.baxiti.unstable-field",
    name: "hero-effect.baxiti.unstable-field",
    kind: "extraDamage",
    recipient: "selfArmy",
    coefficient: .50,
    basis: "parentBaseDamage",
    scope: { source: "army", target: "currentTarget", damageType: "skillDamage" },
  }],
});
export const LUM_POGEN_PENETRATION_REDUCTION = skill({
  id: "hero-skill.lumubogen.penetration-reduction", heroId: "hero.sr.lumubogen",
  name: "Lum Pogen Deception", slot: 1, allowedPositions: leaderAndMember,
  values: [.04, .08, .12, .16, .20],
  effects: [attributeReduction("hero-effect.lumubogen.penetration-reduction", "penetration", "enemyPenetrationReduction", .20)],
});
export const LING_SHUANG_ATTACK_REDUCTION = skill({
  id: "hero-skill.lingshuang.attack-reduction", heroId: "hero.sr.lingshuang",
  name: "Ling Shuang Commanding Presence", slot: 1, allowedPositions: leaderAndMember,
  values: [.04, .08, .12, .16, .20],
  effects: [attributeReduction("hero-effect.lingshuang.attack-reduction", "attack", "enemyAttackReduction", .20)],
});

export const CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS = [
  JESSIE_PENETRATION, JESSIE_MECHANICAL_BARRIER,
  JASSER_PENETRATION, SEO_YOON_ATTACK,
  SERGEI_GUARDIAN_POWER, SERGEI_WEAKENING_STRIKE,
  PATRICK_LIFE, PATRICK_ATTACK,
  BAHITI_DANGER_SENSE, BAHITI_UNSTABLE_FIELD,
  LUM_POGEN_PENETRATION_REDUCTION, LING_SHUANG_ATTACK_REDUCTION,
  ...S1_HERO_SKILL_DEFINITIONS,
  ...S1_WEAPON_SKILL_DEFINITIONS,
  ...S2_HERO_SKILL_DEFINITIONS,
  ...S3_HERO_SKILL_DEFINITIONS,
  ...S4_HERO_SKILL_DEFINITIONS,
  ...S5_HERO_SKILL_DEFINITIONS,
  ...S6_HERO_SKILL_DEFINITIONS,
  ...S7_HERO_SKILL_DEFINITIONS,
  ...S8_HERO_SKILL_DEFINITIONS,
  ...S9_HERO_SKILL_DEFINITIONS,
  ...S10_HERO_SKILL_DEFINITIONS,
  ...S11_HERO_SKILL_DEFINITIONS,
  ...S12_HERO_SKILL_DEFINITIONS,
  ...S13_HERO_SKILL_DEFINITIONS,
  ...S14_HERO_SKILL_DEFINITIONS,
  ...S15_HERO_SKILL_DEFINITIONS,
  ...S16_HERO_SKILL_DEFINITIONS,
] as const;

export const CONFIRMED_HERO_SKILL_DEFINITIONS =
  CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS;

function skill(input: {
  readonly id: string; readonly heroId: string; readonly name: string;
  readonly slot: 1 | 2 | 3; readonly allowedPositions: readonly HeroPosition[];
  readonly trigger?: HeroSkillTrigger; readonly probability?: number;
  readonly values?: readonly [number, number, number, number, number];
  readonly effects: readonly HeroSkillEffect[];
}): HeroSkillDefinition {
  return {
    id: input.id, heroId: input.heroId, name: input.name,
    positionRule: { kind: "expeditionSkillSlot", expeditionSkillSlot: input.slot, allowedPositions: input.allowedPositions },
    trigger: input.trigger ?? "passive",
    ...(input.probability === undefined ? {} : { probability: input.probability }),
    activationTiming: "immediate",
    levelValues: input.values === undefined
      ? { 5: { versionLabel: "Expedition Lv.5", effects: input.effects } }
      : Object.fromEntries(input.values.map((value, index) => {
          const level = index + 1;
          return [level, {
            versionLabel: `Expedition Lv.${level}`,
            effects: input.effects.map((effect) => withLevelValue(effect, value)),
          }];
        })),
    metadata: { ruleStatus: "supported", source: SOURCE, tags: ["confirmed", `expeditionSlot${input.slot}`] },
  };
}

function withLevelValue(effect: HeroSkillEffect, value: number): HeroSkillEffect {
  if (
    effect.kind === "targetingOverride" ||
    effect.kind === "extraDamage" ||
    effect.kind === "targetBoundMark" ||
    effect.kind === "temporaryShield" ||
    effect.kind === "skipNextRoundAction" ||
    effect.kind === "markedTargetDamageIncrease" ||
    effect.kind === "decayingDamageIncrease"
  ) {
    throw new Error("Numeric expedition level tables require a modifier effect.");
  }
  return { ...effect, value };
}

function attribute(id: string, attributeName: "attack" | "penetration" | "life", value: number): HeroSkillEffect {
  return {
    id, name: id, kind: "attributeModifier", recipient: "selfArmy",
    attribute: attributeName, operation: "addToAttribute",
    group: `hero${attributeName[0]!.toUpperCase()}${attributeName.slice(1)}Bonus`, value,
    scope: { source: "army", target: "all", damageType: "all" },
  };
}

function attributeReduction(
  id: string, attributeName: "attack" | "penetration",
  group: "enemyAttackReduction" | "enemyPenetrationReduction", value: number,
): HeroSkillEffect {
  return {
    id, name: id, kind: "attributeReduction", recipient: "enemyArmy",
    attribute: attributeName, group, value,
    scope: { source: "army", target: "all", damageType: "all" },
  };
}

function receivedDamageReduction(id: string, value: number): HeroSkillEffect {
  return {
    id, name: id, kind: "damageReduction", recipient: "selfArmy",
    group: "receivedDamageReduction", value,
    scope: { source: "army", target: "all", damageType: "all" },
  };
}
