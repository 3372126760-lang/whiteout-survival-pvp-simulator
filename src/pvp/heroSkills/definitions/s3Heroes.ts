import { EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES } from "../data/generationStats";
import { S1_HERO_SKILL_DEFINITIONS } from "./s1Heroes";
import type {
  HeroPosition,
  HeroSkillDefinition,
  HeroSkillEffect,
  HeroSkillTrigger,
} from "../types";

const SOURCE = "confirmed S3 expedition PVP rules, synchronized 2026-09-20";
const BOTH = ["leader", "member"] as const satisfies readonly HeroPosition[];

export const LOGAN_ANGRY_LION_ASSAULT = levelFiveSkill({
  id: "hero-skill.luogen.angry-lion-assault",
  heroId: "hero.s3.luogen",
  name: "罗根·怒狮强袭",
  slot: 1,
  effects: [enemyAttackReduction("hero-effect.luogen.angry-lion-assault", .20)],
});

export const LOGAN_LION_INTIMIDATION = levelFiveSkill({
  id: "hero-skill.luogen.lion-intimidation",
  heroId: "hero.s3.luogen",
  name: "罗根·猛狮恫吓",
  slot: 2,
  effects: [receivedDamageReduction("hero-effect.luogen.lion-intimidation", .20)],
});

export const LOGAN_BURNING_BODY = levelFiveSkill({
  id: "hero-skill.luogen.burning-body",
  heroId: "hero.s3.luogen",
  name: "罗根·烈火焚身",
  slot: 3,
  effects: [attribute("hero-effect.luogen.burning-body", "life", .25)],
});

export const MIA_DOOM_ENTANGLEMENT = levelFiveSkill({
  id: "hero-skill.miya.doom-entanglement",
  heroId: "hero.s3.miya",
  name: "米娅·厄运缠身",
  procEffectFamilyId: "miya-doom-entanglement-family",
  slot: 1,
  trigger: "beforeAttack",
  probability: .50,
  durationRounds: 1,
  activationTiming: "nextRound",
  effects: [hitTargetVulnerability("hero-effect.miya.doom-entanglement", .50, 1)],
  tags: ["hitTargetTroop", "perTroopAttack", "bearModelSemantic"],
});

// Lucky Blessing has the same per-main-attack proc and dodge gate as Ice Field.
// Reuse the complete execution template; only Mia's identities/catalogue differ.
const luckyBlessingTemplate = S1_HERO_SKILL_DEFINITIONS.find(
  (definition) => definition.id === "hero-skill.moli.ice-field",
);
if (luckyBlessingTemplate === undefined) {
  throw new Error("Mia Lucky Blessing requires the Molly Ice Field template.");
}

export const MIA_LUCKY_BLESSING: HeroSkillDefinition = {
  ...luckyBlessingTemplate,
  id: "hero-skill.miya.lucky-blessing",
  heroId: "hero.s3.miya",
  name: "米娅·幸运加护",
  levelValues: Object.fromEntries(Object.entries(luckyBlessingTemplate.levelValues).map(
    ([level, value]) => [level, {
      ...value,
      effects: value.effects.map((effect) => ({
        ...effect,
        id: "hero-effect.miya.lucky-blessing",
        name: "hero-effect.miya.lucky-blessing",
      })),
    }],
  )),
  metadata: {
    ruleStatus: "supported",
    source: "confirmed Mia Lucky Blessing matches Molly Ice Field, synchronized 2026-10-13",
    tags: ["S3", "expeditionSlot2", "perTroopAttack", "bearModelSemantic"],
  },
};

export const MIA_SECRET_INTERPRETATION = levelFiveSkill({
  id: "hero-skill.miya.secret-interpretation",
  heroId: "hero.s3.miya",
  name: "米娅·秘义解读",
  slot: 3,
  trigger: "roundStart",
  probability: .40,
  durationRounds: 1,
  activationTiming: "immediate",
  effects: [receivedDamageReduction(
    "hero-effect.miya.secret-interpretation",
    .50,
    1,
  )],
  tags: ["oncePerRound"],
});

export const GREG_SWORD_OF_JUSTICE = levelFiveSkill({
  id: "hero-skill.gelaige.sword-of-justice",
  heroId: "hero.s3.gelaige",
  name: "格雷格·正义之剑",
  slot: 1,
  trigger: "roundStart",
  probability: .20,
  durationRounds: 3,
  activationTiming: "immediate",
  effects: [timedDamageIncrease("hero-effect.gelaige.sword-of-justice", .40, 3)],
  tags: ["oncePerRound", "bearModelSemantic", "replaceOnRetrigger"],
});

export const GREG_LAW_DETERRENCE = levelFiveSkill({
  id: "hero-skill.gelaige.law-deterrence",
  heroId: "hero.s3.gelaige",
  name: "格雷格·律令威慑",
  slot: 2,
  trigger: "beforeAttack",
  probability: .20,
  durationRounds: 2,
  activationTiming: "immediate",
  effects: [hitTargetOutgoingReduction(
    "hero-effect.gelaige.law-deterrence",
    .50,
    2,
  )],
  tags: ["hitTargetTroop", "perTroopAttack", "replaceOnRetrigger"],
});

export const GREG_ORDER_PROTECTION = levelFiveSkill({
  id: "hero-skill.gelaige.order-protection",
  heroId: "hero.s3.gelaige",
  name: "格雷格·秩序庇护",
  slot: 3,
  effects: [attribute("hero-effect.gelaige.order-protection", "life", .25)],
});

export const S3_WEAPON_SKILL_DEFINITIONS = [
  sceneWeapon(
    "hero-weapon-skill.luogen.defense-defense",
    "hero.s3.luogen",
    "罗根专武·铁壁守护",
    "defense",
    "buffDefense",
    ["rallyDefense", "garrisonDefense"],
  ),
  sceneWeapon(
    "hero-weapon-skill.miya.rally-attack",
    "hero.s3.miya",
    "米娅专武·宿命的集结",
    "attack",
    "buffAttack",
    ["rallyAttack"],
  ),
  sceneWeapon(
    "hero-weapon-skill.gelaige.rally-life",
    "hero.s3.gelaige",
    "格雷格专武·正义的号角",
    "life",
    "buffLife",
    ["rallyAttack"],
  ),
] as const satisfies readonly HeroSkillDefinition[];

export const S3_HERO_SKILL_DEFINITIONS = [
  LOGAN_ANGRY_LION_ASSAULT,
  LOGAN_LION_INTIMIDATION,
  LOGAN_BURNING_BODY,
  MIA_DOOM_ENTANGLEMENT,
  MIA_LUCKY_BLESSING,
  MIA_SECRET_INTERPRETATION,
  GREG_SWORD_OF_JUSTICE,
  GREG_LAW_DETERRENCE,
  GREG_ORDER_PROTECTION,
  ...S3_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];

interface LevelFiveSkillInput {
  readonly procEffectFamilyId?: string;
  readonly id: string;
  readonly heroId: string;
  readonly name: string;
  readonly slot: 1 | 2 | 3;
  readonly trigger?: HeroSkillTrigger;
  readonly probability?: number;
  readonly durationRounds?: number;
  readonly activationTiming?: "immediate" | "nextAction" | "roundEnd" | "nextRound";
  readonly effects: readonly HeroSkillEffect[];
  readonly tags?: readonly string[];
}

function levelFiveSkill(input: LevelFiveSkillInput): HeroSkillDefinition {
  return {
    id: input.id,
    ...(input.procEffectFamilyId === undefined ? {} : { procEffectFamilyId: input.procEffectFamilyId }),
    heroId: input.heroId,
    name: input.name,
    positionRule: {
      kind: "expeditionSkillSlot",
      expeditionSkillSlot: input.slot,
      allowedPositions: BOTH,
    },
    trigger: input.trigger ?? "passive",
    ...(input.probability === undefined ? {} : { probability: input.probability }),
    ...(input.durationRounds === undefined
      ? {}
      : { durationRounds: input.durationRounds }),
    ...(input.activationTiming === undefined
      ? { activationTiming: "immediate" as const }
      : { activationTiming: input.activationTiming }),
    levelValues: {
      5: { versionLabel: "Expedition Lv.5", effects: input.effects },
    },
    metadata: {
      ruleStatus: "supported",
      source: SOURCE,
      tags: ["S3", `expeditionSlot${input.slot}`, ...(input.tags ?? [])],
    },
  };
}

function sceneWeapon(
  id: string,
  heroId: string,
  name: string,
  attributeName: "attack" | "defense" | "life",
  group: "buffAttack" | "buffDefense" | "buffLife",
  battleContexts: NonNullable<HeroSkillDefinition["battleContexts"]>,
): HeroSkillDefinition {
  return {
    id,
    heroId,
    name,
    positionRule: {
      kind: "exclusiveWeapon",
      expeditionSkillSlot: 2,
      allowedPositions: BOTH,
    },
    trigger: "passive",
    activationTiming: "immediate",
    battleContexts,
    levelValues: Object.fromEntries(
      Object.entries(EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES).map(([level, value]) => [
        level,
        {
          versionLabel: `Exclusive Weapon Tier ${level}`,
          effects: [attribute(
            `hero-weapon-effect.${id.slice("hero-weapon-skill.".length)}`,
            attributeName,
            value,
            "multiplyAttributeFactor",
            group,
          )],
        },
      ]),
    ),
    metadata: {
      ruleStatus: "supported",
      source: SOURCE,
      tags: ["S3", "exclusiveWeapon", "weaponSkill2"],
    },
  };
}

function attribute(
  id: string,
  attributeName: "attack" | "defense" | "life",
  value: number,
  operation: "addToAttribute" | "multiplyAttributeFactor" = "addToAttribute",
  group = `hero${attributeName[0]!.toUpperCase()}${attributeName.slice(1)}Bonus`,
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
    scope: { source: "army", target: "all", damageType: "all" },
  };
}

function enemyAttackReduction(id: string, value: number): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "attributeReduction",
    recipient: "enemyArmy",
    attribute: "attack",
    group: "enemyAttackReduction",
    value,
    scope: { source: "army", target: "all", damageType: "all" },
  };
}

function receivedDamageReduction(
  id: string,
  value: number,
  durationRounds?: number,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "damageReduction",
    recipient: "selfArmy",
    group: "receivedDamageReduction",
    value,
    scope: { source: "army", target: "all", damageType: "all" },
    ...(durationRounds === undefined
      ? {}
      : {
          lifecycle: {
            activationTiming: "immediate" as const,
            durationRounds,
            refreshMode: "replace" as const,
          },
        }),
  };
}

function timedDamageIncrease(
  id: string,
  value: number,
  durationRounds: number,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "damageIncrease",
    recipient: "selfArmy",
    group: "commonDamageIncrease",
    value,
    scope: { source: "army", target: "all", damageType: "all" },
    lifecycle: {
      activationTiming: "immediate",
      durationRounds,
      refreshMode: "replace",
    },
  };
}

function hitTargetVulnerability(
  id: string,
  value: number,
  durationRounds: number,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "incomingDamageIncrease",
    recipient: "enemyArmy",
    group: "vulnerability",
    value,
    scope: { source: "army", target: "currentTarget", damageType: "all" },
    lifecycle: {
      activationTiming: "nextRound",
      durationRounds,
      refreshMode: "replace",
    },
  };
}

function hitTargetOutgoingReduction(
  id: string,
  value: number,
  durationRounds: number,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "outgoingDamageReduction",
    recipient: "enemyArmy",
    group: "enemyOutgoingDamageReduction",
    value,
    scope: { source: "army", target: "all", damageType: "all" },
    lifecycle: {
      activationTiming: "immediate",
      durationRounds,
      refreshMode: "replace",
    },
  };
}
