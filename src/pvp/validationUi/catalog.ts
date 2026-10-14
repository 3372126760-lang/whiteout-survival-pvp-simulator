import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  EXPEDITION_HERO_DATA,
  type HeroSkillDefinition,
  type HeroSkillEffect,
} from "../heroSkills";
import {
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  SUPPORTED_TROOP_LEVELS,
} from "../troopSkills";
import { getHeroSkillUiSummary, getTroopSkillUiSummary } from "../skillPresentation";
import type {
  ValidationCatalog,
  ValidationSkillOption,
} from "./types";
import type { TroopType } from "../types";
import { isHeroAvailableAtStage, type ServerStageId } from "../progression";
import { heroCategoryMetadata, heroSGeneration } from "./heroCategory";

let cachedCatalog: ValidationCatalog | undefined;

export function getValidationCatalog(): ValidationCatalog {
  return cachedCatalog ??= buildValidationCatalog();
}

function buildValidationCatalog(): ValidationCatalog {
  const reportHeroes = EXPEDITION_HERO_DATA.map((hero) => ({
    heroId: hero.id,
    name: hero.name,
    rarity: hero.rarity,
    ...heroCategoryMetadata(hero),
    troopType: hero.stats.troopType,
    generation: heroSGeneration(hero) ?? null,
    weaponMaxStat: hero.exclusiveWeapon?.maxPenetrationBonus ?? null,
  }));
  const rawMemberSkills = EXPEDITION_HERO_DATA.flatMap((hero) =>
    hero.expeditionSkills.flatMap((skill) =>
      skill.expeditionSkillSlot === 1 &&
      skill.combatRelevant &&
      skill.combatSkillDefinitionId !== undefined
        ? [{
            heroId: hero.id,
            heroName: hero.name,
            skillId: skill.combatSkillDefinitionId,
            skillName: skill.name,
            troopType: hero.stats.troopType,
            description: skill.description,
          }]
        : [],
    ),
  );
  const memberSkills = groupMemberSkillsByEffect(rawMemberSkills);
  const troopSkills: ValidationSkillOption[] =
    CONFIRMED_TROOP_SKILL_DEFINITIONS.map((skill, definitionOrder) => ({
      id: skill.id,
      name: skill.name,
      uiSummary: getTroopSkillUiSummary(skill),
      source: "troop",
      troopType: skill.troopType,
      heroId: null,
      expeditionSkillSlot: null,
      definitionOrder,
      category: skill.metadata.tags?.includes("T12")
        ? "T12"
        : skill.metadata.tags?.includes("fireCrystal")
          ? "fireCrystal"
          : skill.unlockCondition.kind === "always"
            ? "base"
            : "tier",
      probability:
        skill.probability ??
        Object.values(skill.levelValues).find(
          (level) => level.probability !== undefined,
        )?.probability ??
        null,
      perTroop: skill.trigger === "beforeAttack" || skill.trigger === "afterNormalAttack",
    }));
  const heroSkills: ValidationSkillOption[] =
    CONFIRMED_HERO_SKILL_DEFINITIONS.flatMap((skill, definitionOrder) => {
      const hero = EXPEDITION_HERO_DATA.find((candidate) => candidate.id === skill.heroId);
      if (hero === undefined) return [];
      return [{
        id: skill.id,
        name: skill.name,
        uiSummary: getHeroSkillUiSummary(skill),
        source: "hero" as const,
        troopType: hero.stats.troopType,
        heroId: skill.heroId,
        expeditionSkillSlot: skill.positionRule.expeditionSkillSlot,
        definitionOrder,
        category: skill.positionRule.kind === "exclusiveWeapon"
          ? "exclusiveWeapon"
          : "expedition",
        probability:
          skill.probability ??
          Object.values(skill.levelValues).find(
            (level) => level.probability !== undefined,
          )?.probability ??
          null,
        perTroop: skill.trigger === "beforeAttack" || skill.trigger === "afterNormalAttack",
      }];
    });
  return {
    troopLevels: SUPPORTED_TROOP_LEVELS,
    reportHeroes,
    leaderHeroes: reportHeroes,
    memberSkills,
    skills: [...troopSkills, ...heroSkills],
  };
}

export function resolveValidationMemberSkillSelections(
  selectedSkillIds: readonly string[],
  reservedHeroIds: readonly string[] = [],
  stageId?: ServerStageId,
): readonly { readonly heroId: string; readonly skillId: string }[] {
  const options = stageId === undefined
    ? getValidationCatalog().memberSkills : getAvailableMemberSkills(stageId);
  const usedHeroes = new Set(reservedHeroIds);
  return selectedSkillIds.map((selectedSkillId) => {
    const option = options.find(
      (candidate) =>
        candidate.skillId === selectedSkillId ||
        candidate.sourceSkillIds.includes(selectedSkillId),
    );
    if (option === undefined) {
      throw new Error(`Unknown member skill: ${selectedSkillId}.`);
    }
    const exactIndex = option.sourceSkillIds.indexOf(selectedSkillId);
    const indexes = [
      ...(exactIndex < 0 ? [] : [exactIndex]),
      ...option.sourceSkillIds.map((_, index) => index)
        .filter((index) => index !== exactIndex),
    ];
    const selectedIndex = indexes.find(
      (index) => !usedHeroes.has(option.sourceHeroIds[index]!),
    );
    if (selectedIndex === undefined) {
      throw new Error(
        `No unused hero source remains for member effect: ${option.effectLabel}.`,
      );
    }
    const heroId = option.sourceHeroIds[selectedIndex]!;
    const skillId = option.sourceSkillIds[selectedIndex]!;
    usedHeroes.add(heroId);
    return { heroId, skillId };
  });
}

export function getAvailableMemberSkills(stageId: ServerStageId) {
  return getValidationCatalog().memberSkills.flatMap((option) => {
    const sources = option.sourceHeroIds.flatMap((heroId, index) =>
      isHeroAvailableAtStage(heroId, stageId)
        ? [{ heroId, skillId: option.sourceSkillIds[index]! }] : []);
    if (sources.length === 0) return [];
    return [{ ...option, heroId: sources[0]!.heroId,
      skillId: sources[0]!.skillId,
      sourceHeroIds: sources.map((source) => source.heroId),
      sourceSkillIds: sources.map((source) => source.skillId) }];
  });
}

interface RawMemberSkill {
  readonly heroId: string;
  readonly heroName: string;
  readonly skillId: string;
  readonly skillName: string;
  readonly troopType: TroopType;
  readonly description: string;
}

function groupMemberSkillsByEffect(
  skills: readonly RawMemberSkill[],
): ValidationCatalog["memberSkills"] {
  const grouped = new Map<string, RawMemberSkill[]>();
  for (const skill of skills) {
    const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find(
      (candidate) => candidate.id === skill.skillId,
    );
    if (definition === undefined) continue;
    const signature = memberEffectSignature(definition);
    grouped.set(signature, [...(grouped.get(signature) ?? []), skill]);
  }
  return [...grouped.entries()].map(([effectKey, sources]) => {
    const first = sources[0]!;
    const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find(
      (candidate) => candidate.id === first.skillId,
    )!;
    return {
      heroId: first.heroId,
      heroName: first.heroName,
      skillId: first.skillId,
      skillName: first.skillName,
      troopType: first.troopType,
      effectKey,
      effectLabel: memberEffectLabel(definition, first.description),
      sourceHeroIds: sources.map((source) => source.heroId),
      sourceSkillIds: sources.map((source) => source.skillId),
    };
  });
}

function memberEffectSignature(definition: HeroSkillDefinition): string {
  const level = definition.levelValues[5];
  return JSON.stringify({
    trigger: definition.trigger,
    probability: level?.probability ?? definition.probability ?? null,
    durationRounds: level?.durationRounds ?? definition.durationRounds ?? null,
    cooldownRounds: level?.cooldownRounds ?? definition.cooldownRounds ?? null,
    activationTiming: definition.activationTiming ?? null,
    battleContexts: definition.battleContexts ?? null,
    effects: (level?.effects ?? []).map((effect) =>
      Object.fromEntries(
        Object.entries(effect).filter(([key]) => key !== "id" && key !== "name"),
      )
    ),
  });
}

function memberEffectLabel(
  definition: HeroSkillDefinition,
  fallback: string,
): string {
  const effects = definition.levelValues[5]?.effects ?? [];
  if (effects.length === 0) return fallback.replace(/[。.]$/, "");
  return effects.map(formatMemberEffect).join("；");
}

function formatMemberEffect(effect: HeroSkillEffect): string {
  const source = effect.scope.source === "army"
    ? "全军"
    : troopLabel(effect.scope.source);
  const percentage = "value" in effect
    ? formatCatalogPercent(effect.value)
    : effect.kind === "extraDamage"
      ? formatCatalogPercent(effect.coefficient)
      : "";
  if (effect.kind === "attributeModifier") {
    return `${source}${attributeLabel(effect.attribute)} +${percentage}`;
  }
  if (effect.kind === "attributeReduction") {
    return `敌军${attributeLabel(effect.attribute)}降低 ${percentage}`;
  }
  if (effect.kind === "defenseReduction") {
    return `敌军防御降低 ${percentage}`;
  }
  if (effect.kind === "damageReduction") {
    return `${source}受到伤害降低 ${percentage}`;
  }
  if (effect.kind === "outgoingDamageReduction") {
    return `目标造成伤害降低 ${percentage}`;
  }
  if (effect.kind === "incomingDamageIncrease") {
    return `目标受到伤害增加 ${percentage}`;
  }
  if (effect.kind === "oneUseIncomingDamageIncrease") {
    return `目标下一次受到伤害增加 ${percentage}`;
  }
  if (effect.kind === "damageIncrease") {
    const kind = effect.scope.damageType === "normalAttack"
      ? "普通攻击伤害"
      : effect.scope.damageType === "skillDamage"
        ? "技能伤害"
        : "伤害";
    return `${source}${kind} +${percentage}`;
  }
  if (effect.kind === "defenseModifier") {
    return `${source}防御 +${percentage}`;
  }
  if (effect.kind === "extraDamage") {
    return `${source}额外伤害 ${percentage}`;
  }
  return `${source}索敌调整`;
}

function attributeLabel(
  attribute: "attack" | "penetration" | "defense" | "life",
): string {
  return attribute === "attack"
    ? "攻击"
    : attribute === "penetration"
      ? "穿透"
      : attribute === "defense"
        ? "防御"
        : "生命";
}

function troopLabel(troop: string): string {
  return troop === "shield" ? "盾兵" : troop === "lancer" ? "矛兵" : "射手";
}

function formatCatalogPercent(value: number): string {
  return `${Number((value * 100).toFixed(4))}%`;
}
