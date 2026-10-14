import type {
  HeroSkillDefinition,
  HeroSkillEffect,
} from "./heroSkills/types";
import type {
  TroopSkillDefinition,
  TroopSkillEffect,
} from "./troopSkills/types";
import type { TroopType } from "./types/combat";

type PresentableEffect = HeroSkillEffect | TroopSkillEffect;

export function getTroopSkillUiSummary(
  definition: TroopSkillDefinition,
): string {
  if (definition.uiSummary !== undefined) return definition.uiSummary;
  const effect = representativeEffect(definition.levelValues);
  if (effect === undefined) {
    return definition.metadata.description ?? "按兵种技能规则生效";
  }
  return describeEffect(
    effect,
    probabilityLabel(definition.probability, definition.levelValues),
    definition.metadata.tags?.includes("T12") ?? false,
  );
}

export function getHeroSkillUiSummary(
  definition: HeroSkillDefinition,
): string {
  if (definition.uiSummary !== undefined) return definition.uiSummary;
  const probability = probabilityLabel(
    definition.probability,
    definition.levelValues,
  );
  if (definition.actionMechanic?.kind === "skipMainAttack") {
    return "按攻击次数跳过一次本兵种普通攻击";
  }
  if (definition.actionMechanic?.kind === "dodgeNormalAttack") {
    return `${probability}闪避普通攻击`;
  }
  const effect = representativeEffect(definition.levelValues);
  if (effect === undefined) {
    return definition.metadata.description ?? "按英雄远征技能规则生效";
  }
  return describeEffect(effect, probability, false);
}

function representativeEffect(
  levels: Readonly<Record<number, { readonly effects: readonly PresentableEffect[] }>>,
): PresentableEffect | undefined {
  const highest = Object.keys(levels).map(Number).sort((a, b) => b - a)[0];
  return highest === undefined ? undefined : levels[highest]?.effects[0];
}

function probabilityLabel(
  definitionProbability: number | undefined,
  levels: Readonly<Record<number, { readonly probability?: number }>>,
): string {
  const values = new Set(
    Object.values(levels)
      .map((level) => level.probability ?? definitionProbability)
      .filter((value): value is number => value !== undefined),
  );
  if (values.size !== 1) return values.size === 0 ? "" : "概率";
  return `${percent([...values][0]!)}概率`;
}

function describeEffect(
  effect: PresentableEffect,
  probability: string,
  levelScaled: boolean,
): string {
  const source = effect.scope.source === "army"
    ? "全军"
    : effect.scope.source === "self"
      ? "本兵种"
      : troopName(effect.scope.source);
  const target = effect.scope.target;
  const value = "value" in effect ? effect.value : undefined;
  const amount = levelScaled || value === undefined ? "" : ` ${signedPercent(value)}`;
  const probabilityPrefix = probability === "" ? "" : `${probability}`;

  switch (effect.kind) {
    case "targetingOverride":
      return `${probabilityPrefix}优先攻击敌方${troopName(effect.priority[0]!)}`;
    case "sameMainAttackSegment":
      return `${probabilityPrefix}同次主攻击追加第二段普通伤害`;
    case "extraDamage":
      return `${probabilityPrefix}造成${levelScaled ? "随等级提高的" : `${percent(effect.coefficient)} `}额外技能伤害`;
    case "extraDamageContribution":
      return `合并增加${percent(effect.coefficient)}额外技能伤害`;
    case "baseDamageMultiplier":
      return `${source}基础攻击力提升${amount || "按技能值提升"}`;
    case "baseDefenseMultiplier":
      return `${source}基础防御力提升${amount || "按技能值提升"}`;
    case "directDamageCancellation":
      return `${probabilityPrefix}抵消命中伤害`;
    case "attributeModifier":
      return `${source}${attributeName(effect.attribute)}${amount || "按技能值提升"}`;
    case "attributeReduction":
      return `敌军${attributeName(effect.attribute)}降低${amount.replace("+", "") || "技能值"}`;
    case "defenseModifier":
      return effect.scope.incomingSourceTroop === undefined
        ? `${source}防御${amount || "按技能值提升"}`
        : `${source}面对${troopName(effect.scope.incomingSourceTroop)}时防御${amount || "按技能值提升"}`;
    case "defenseReduction":
      return `敌军防御降低${amount.replace("+", "") || "技能值"}`;
    case "damageIncrease":
      return target !== undefined && target !== "all" && target !== "currentTarget"
        ? `对${troopName(target)}伤害${amount || "按技能值提升"}`
        : `${source}${damageTypeName(effect.scope.damageType)}伤害${amount || "按技能值提升"}`;
    case "damageReduction":
      return `${source}受到伤害降低${amount.replace("+", "") || "技能值"}`;
    case "outgoingDamageReduction":
      return `使命中目标造成伤害降低${amount.replace("+", "") || "技能值"}`;
    case "incomingDamageIncrease":
      return `使命中目标受到伤害增加${amount || "技能值"}`;
    case "oneUseIncomingDamageIncrease":
      return `使命中目标下一次受到伤害增加${amount || "技能值"}`;
    case "temporaryShield":
      return `${probabilityPrefix}按本次伤害生成临时护盾`;
    case "skipNextRoundAction":
      return `${probabilityPrefix}使命中目标跳过下一回合行动`;
    case "markedTargetDamageIncrease":
      return `标记目标受到伤害增加${amount || "技能值"}`;
    case "decayingDamageIncrease":
      return "普通攻击增伤随攻击次数衰减";
    case "targetBoundMark":
      return "对命中目标施加延迟伤害标记";
  }
}

function troopName(troop: TroopType): string {
  return troop === "shield" ? "盾兵" : troop === "lancer" ? "矛兵" : "射手";
}

function attributeName(attribute: string): string {
  return attribute === "attack"
    ? "攻击"
    : attribute === "defense"
      ? "防御"
      : attribute === "penetration"
        ? "穿透"
        : "生命";
}

function damageTypeName(type: string | undefined): string {
  return type === "normalAttack" ? "普通攻击" : type === "skillDamage" ? "技能" : "";
}

function percent(value: number): string {
  return `${Number((value * 100).toFixed(4))}%`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${percent(value)}`;
}
