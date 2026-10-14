import { EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES } from "../data/generationStats";
import type {
  HeroPosition,
  HeroSkillActionMechanic,
  HeroSkillDefinition,
  HeroSkillEffect,
  HeroSkillTrigger,
} from "../types";
import type { BattleContext, DamageType, TroopType } from "../../types/combat";

const BOTH = ["leader", "member"] as const satisfies readonly HeroPosition[];
type SupportedGeneration = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

export function levelFiveGenerationSkill(input: {
  readonly source: string;
  readonly generation: SupportedGeneration;
  readonly id: string;
  readonly heroId: string;
  readonly name: string;
  readonly slot: 1 | 2 | 3;
  readonly trigger?: HeroSkillTrigger;
  readonly probability?: number;
  readonly durationRounds?: number;
  readonly activationTiming?: "immediate" | "nextAction" | "roundEnd" | "nextRound";
  readonly actionMechanic?: HeroSkillActionMechanic;
  readonly triggerTiming?: HeroSkillDefinition["triggerTiming"];
  readonly periodRounds?: number;
  readonly periodStartRound?: number;
  readonly ruleStatus?: HeroSkillDefinition["metadata"]["ruleStatus"];
  readonly templateSource?: string;
  readonly effects: readonly HeroSkillEffect[];
  readonly tags?: readonly string[];
}): HeroSkillDefinition {
  return {
    id: input.id,
    heroId: input.heroId,
    name: input.name,
    positionRule: {
      kind: "expeditionSkillSlot",
      expeditionSkillSlot: input.slot,
      allowedPositions: BOTH,
    },
    trigger: input.trigger ?? "passive",
    ...(input.probability === undefined ? {} : { probability: input.probability }),
    ...(input.durationRounds === undefined ? {} : { durationRounds: input.durationRounds }),
    activationTiming: input.activationTiming ?? "immediate",
    ...(input.actionMechanic === undefined ? {} : { actionMechanic: input.actionMechanic }),
    ...(input.triggerTiming === undefined ? {} : { triggerTiming: input.triggerTiming }),
    levelValues: {
      5: {
        versionLabel: "Expedition Lv.5",
        ...(input.periodRounds === undefined
          ? {}
          : { periodRounds: input.periodRounds }),
        ...(input.periodStartRound === undefined
          ? {}
          : { periodStartRound: input.periodStartRound }),
        effects: input.effects,
      },
    },
    metadata: {
      ruleStatus: input.ruleStatus ?? (input.generation >= 12 ? "TENTATIVE" : "supported"),
      generation: input.generation,
      ...(input.generation < 12 ? {} : { verificationStatus: "inferredFromPriorGenerations" as const }),
      ...(input.templateSource === undefined ? {} : { templateSource: input.templateSource }),
      source: input.source,
      tags: [
        `S${input.generation}`,
        `expeditionSlot${input.slot}`,
        ...(input.tags ?? []),
      ],
    },
  };
}

export function generationSceneWeapon(input: {
  readonly source: string;
  readonly generation: SupportedGeneration;
  readonly id: string;
  readonly heroId: string;
  readonly name: string;
  readonly attribute: "attack" | "penetration" | "defense" | "life";
  readonly group: "buffAttack" | "buffPenetration" | "buffDefense" | "buffLife";
  readonly battleContexts: readonly BattleContext[];
}): HeroSkillDefinition {
  return {
    id: input.id,
    heroId: input.heroId,
    name: input.name,
    positionRule: {
      kind: "exclusiveWeapon",
      expeditionSkillSlot: 2,
      allowedPositions: BOTH,
    },
    trigger: "passive",
    activationTiming: "immediate",
    battleContexts: input.battleContexts,
    levelValues: Object.fromEntries(
      Object.entries(EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES).map(([level, value]) => [
        level,
        {
          versionLabel: `Exclusive Weapon Tier ${level}`,
          effects: [attributeModifier(
            `hero-weapon-effect.${input.id.slice("hero-weapon-skill.".length)}`,
            input.attribute,
            value,
            input.group,
            "multiplyAttributeFactor",
          )],
        },
      ]),
    ),
    metadata: {
      ruleStatus: input.generation >= 12 ? "TENTATIVE" : "supported",
      generation: input.generation,
      ...(input.generation < 12 ? {} : { verificationStatus: "inferredFromPriorGenerations" as const }),
      source: input.source,
      tags: [`S${input.generation}`, "exclusiveWeapon", "weaponSkill2"],
    },
  };
}

export function attributeModifier(
  id: string,
  attribute: "attack" | "penetration" | "defense" | "life",
  value: number,
  group = `hero${attribute[0]!.toUpperCase()}${attribute.slice(1)}Bonus`,
  operation: "addToAttribute" | "multiplyAttributeFactor" = "addToAttribute",
  source: "army" | TroopType = "army",
  lifecycle?: HeroSkillEffect["lifecycle"],
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "attributeModifier",
    recipient: "selfArmy",
    attribute,
    operation,
    group,
    value,
    scope: { source, target: "all", damageType: "all" },
    ...(lifecycle === undefined ? {} : { lifecycle }),
  };
}

export function attributeReduction(
  id: string,
  attribute: "attack" | "penetration" | "defense" | "life",
  group: string,
  value: number,
  options: {
    readonly recipient?: "selfArmy" | "enemyArmy";
    readonly source?: "army" | TroopType;
    readonly target?: "all" | TroopType;
    readonly lifecycle?: HeroSkillEffect["lifecycle"];
  } = {},
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "attributeReduction",
    recipient: options.recipient ?? "enemyArmy",
    attribute,
    group,
    value,
    scope: { source: options.source ?? "army", target: options.target ?? "all", damageType: "all" },
    ...(options.lifecycle === undefined ? {} : { lifecycle: options.lifecycle }),
  };
}

export function damageModifier(input: {
  readonly id: string;
  readonly kind:
    | "damageIncrease"
    | "damageReduction"
    | "outgoingDamageReduction"
    | "incomingDamageIncrease";
  readonly recipient: "selfArmy" | "enemyArmy";
  readonly group: string;
  readonly value: number;
  readonly source?: "army" | TroopType;
  readonly target?: "all" | "currentTarget" | TroopType;
  readonly damageType?: "all" | DamageType;
  readonly lifecycle?: HeroSkillEffect["lifecycle"];
}): HeroSkillEffect {
  return {
    id: input.id,
    name: input.id,
    kind: input.kind,
    recipient: input.recipient,
    group: input.group,
    value: input.value,
    scope: {
      source: input.source ?? "army",
      target: input.target ?? "all",
      damageType: input.damageType ?? "all",
    },
    ...(input.lifecycle === undefined ? {} : { lifecycle: input.lifecycle }),
  };
}

export function defenseAttribute(
  id: string,
  value: number,
  target: "all" | TroopType = "all",
  lifecycle?: HeroSkillEffect["lifecycle"],
): HeroSkillEffect {
  return attributeModifier(
    id, "defense", value, "heroDefenseBonus", "multiplyAttributeFactor",
    target === "all" ? "army" : target, lifecycle,
  );
}

export function defenseReduction(
  id: string,
  value: number,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "defenseReduction",
    recipient: "enemyArmy",
    group: "defenseReduction",
    value,
    scope: { source: "army", target: "all", damageType: "all" },
  };
}

export function temporaryShield(
  id: string,
  coefficient: number,
  source: TroopType,
  basis: "parentRawDamage" | "gatotReportAttackPower" = "parentRawDamage",
  activationTiming: "immediate" | "nextRound" = "immediate",
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "temporaryShield",
    recipient: "selfArmy",
    coefficient,
    basis,
    scope: { source, target: "all", damageType: "all" },
    lifecycle: {
      activationTiming,
      durationRounds: 1,
      refreshMode: "replace",
    },
  };
}

export function skipNextRoundAction(
  id: string,
  source: TroopType,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "skipNextRoundAction",
    recipient: "enemyArmy",
    scope: { source, target: "currentTarget", damageType: "all" },
    lifecycle: {
      activationTiming: "nextRound",
      durationRounds: 1,
      refreshMode: "replace",
    },
  };
}

export function extraDamage(
  id: string,
  coefficient: number,
  source: "army" | TroopType,
  target: "all" | "currentTarget" | TroopType = "currentTarget",
  basis: "parentRawDamage" | "parentBaseDamage" = "parentRawDamage",
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "extraDamage",
    recipient: "selfArmy",
    coefficient,
    basis,
    scope: { source, target, damageType: "skillDamage" },
  };
}

/** Reuses a validated skill's Lv5 trigger, lifecycle and effect structure. */
export function reuseLevelFiveTemplate(
  template: HeroSkillDefinition,
  input: {
    readonly source: string;
    readonly generation: SupportedGeneration;
    readonly id: string;
    readonly heroId: string;
    readonly name: string;
    readonly slot: 1 | 2 | 3;
    readonly sourceTroop?: TroopType;
    readonly forceParentBaseDamage?: boolean;
    readonly tags?: readonly string[];
  },
): HeroSkillDefinition {
  const level = template.levelValues[5];
  if (level === undefined) throw new Error(`Missing Lv5 template: ${template.id}`);
  const mechanic = template.actionMechanic;
  const actionMechanic = mechanic?.kind === "attackCountTrigger" &&
      input.sourceTroop !== undefined && mechanic.schedule.source !== "army"
    ? { ...mechanic, schedule: { ...mechanic.schedule, source: input.sourceTroop } }
    : mechanic?.kind === "naturalRoundTrigger" && input.sourceTroop !== undefined
      ? { ...mechanic, source: input.sourceTroop }
      : mechanic;
  const effects = level.effects.map((effect, index): HeroSkillEffect => {
    const id = `hero-effect.${input.id.slice("hero-skill.".length)}.${index + 1}`;
    const scope = input.sourceTroop === undefined || effect.scope.source === "army"
      ? effect.scope : { ...effect.scope, source: input.sourceTroop };
    if (effect.kind === "extraDamage" && input.forceParentBaseDamage) {
      return { ...effect, id, name: `${input.name}·效果${index + 1}`,
        scope, basis: "parentBaseDamage" };
    }
    return { ...effect, id, name: `${input.name}·效果${index + 1}`, scope };
  });
  return levelFiveGenerationSkill({
    ...input,
    trigger: template.trigger,
    ...(template.probability === undefined ? {} : { probability: template.probability }),
    ...(template.durationRounds === undefined ? {} : { durationRounds: template.durationRounds }),
    ...(template.activationTiming === undefined ? {} : { activationTiming: template.activationTiming }),
    ...(actionMechanic === undefined ? {} : { actionMechanic }),
    ...(template.triggerTiming === undefined ? {} : { triggerTiming: template.triggerTiming }),
    ...(level.periodRounds === undefined ? {} : { periodRounds: level.periodRounds }),
    ...(level.periodStartRound === undefined ? {} : { periodStartRound: level.periodStartRound }),
    effects,
    templateSource: template.id,
    tags: [
      ...(template.metadata.tags ?? []).filter((tag) =>
        !/^S\d+$|^expeditionSlot\d+$/.test(tag) &&
        !(input.sourceTroop !== undefined && tag === "sharedMarksmanAttackCounter")),
      ...(input.tags ?? []),
    ],
  });
}

/** Shared S6 Wayne / S10 Gregory normal-main-attack critical effect. */
export function normalAttackCritical(id: string): HeroSkillEffect {
  return damageModifier({
    id, kind: "damageIncrease", recipient: "selfArmy",
    group: "criticalNormalAttack", value: 1, damageType: "normalAttack",
  });
}

/** Shared Wayne flanking target split; each target is resolved independently. */
export function wayneFlankingDamage(prefix: string, level = 5): readonly HeroSkillEffect[] {
  return [
    extraDamage(`${prefix}.lancer`, .08 * level, "marksman", "lancer", "parentBaseDamage"),
    extraDamage(`${prefix}.marksman`, .04 * level, "marksman", "marksman", "parentBaseDamage"),
  ];
}

export function oneUseIncomingDamageIncrease(
  id: string,
  value: number,
  source: "army" | TroopType,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "oneUseIncomingDamageIncrease",
    recipient: "enemyArmy",
    group: "nextHitVulnerability",
    value,
    scope: { source, target: "currentTarget", damageType: "all" },
    lifecycle: {
      activationTiming: "immediate",
      refreshMode: "replace",
    },
  };
}

export function targetMark(id: string, markId: string): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "targetBoundMark",
    recipient: "enemyArmy",
    markId,
    scope: { source: "lancer", target: "currentTarget", damageType: "all" },
  };
}

export function markedTargetDamage(
  id: string,
  markId: string,
  source: "army" | TroopType,
  value: number,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "markedTargetDamageIncrease",
    recipient: "enemyArmy",
    markId,
    group: "dreamMarkDamage",
    value,
    scope: { source, target: "currentTarget", damageType: "all" },
  };
}

export function decayingNormalDamage(
  id: string,
  initialValues: Readonly<Partial<Record<TroopType, number>>>,
  decayFactor: number,
  maxMainAttacks: number,
): HeroSkillEffect {
  return {
    id,
    name: id,
    kind: "decayingDamageIncrease",
    recipient: "selfArmy",
    group: "commonDamageIncrease",
    initialValues,
    decayFactor,
    maxMainAttacks,
    scope: { source: "army", target: "all", damageType: "all" },
  };
}
