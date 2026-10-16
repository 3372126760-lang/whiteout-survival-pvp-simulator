import { CONFIRMED_HERO_SKILL_DEFINITIONS, EXPEDITION_HERO_DATA,
  type HeroSkillDefinition, type HeroSkillEffect } from "../pvp/heroSkills";
import { CanonicalBodyEffectRegistry, BODY_CATEGORIES, BODY_CATEGORY_LABELS } from "../pvp/bodyEffects/canonicalRegistry";
import { heroSGeneration, heroCategoryLabel } from "../pvp/validationUi/heroCategory";
import type { ServerStageId } from "../pvp/progression";
import type { TroopType } from "../pvp/types";

export const BODY_EFFECT_CATEGORIES = BODY_CATEGORIES.map((c) => BODY_CATEGORY_LABELS[c]);
export type BodyEffectCategory = typeof BODY_EFFECT_CATEGORIES[number];
export interface BodySkillPresentation {
  readonly skillId: string;
  readonly heroId: string;
  readonly heroName: string;
  readonly rarity: string;
  readonly generation: number | null;
  readonly identityLabel: string;
  readonly skillName: string;
  readonly skillDescription: string;
  readonly level: number;
  readonly category: BodyEffectCategory;
  readonly effectSummary: string;
  readonly displayLabel: string;
  readonly timingSummary: string;
  readonly searchText: string;
  readonly provisional: boolean;
}

const definitions = new Map(CONFIRMED_HERO_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
const heroes = new Map(EXPEDITION_HERO_DATA.map((hero) => [hero.id, hero]));
const optionCache = new Map<ServerStageId, readonly BodySkillPresentation[]>();
const percent = (value: number): string => `${Number((value * 100).toFixed(4))}%`;
const troopName = (troop: TroopType): string => ({ shield: "盾兵", lancer: "矛兵", marksman: "射手" })[troop];
const attributeName = (attribute: "attack" | "defense" | "penetration" | "life"): string =>
  ({ attack: "攻击", defense: "防御", penetration: "穿透", life: "生命" })[attribute];
const targetName = (effect: HeroSkillEffect, fallback: string): string =>
  effect.scope.target && !["all", "currentTarget"].includes(effect.scope.target)
    ? troopName(effect.scope.target as TroopType) : fallback;

/** Display only: every number and condition comes from the existing selected-level definition. */
function effectText(effect: HeroSkillEffect): string {
  const source = effect.scope.source === "army" ? "全军" : troopName(effect.scope.source);
  const target = targetName(effect, "目标");
  const value = "value" in effect ? percent(effect.value) : "";
  switch (effect.kind) {
    case "attributeModifier": return `${source}${attributeName(effect.attribute)}提升${value}`;
    case "attributeReduction": return `敌方${target === "目标" ? "" : target}${attributeName(effect.attribute)}降低${value}`;
    case "defenseModifier": return `${source}防御提升${value}`;
    case "defenseReduction": return `敌方${target === "目标" ? "" : target}防御降低${value}`;
    case "damageIncrease": {
      const damage = effect.scope.damageType === "normalAttack" ? "普通攻击伤害"
        : effect.scope.damageType === "skillDamage" ? "技能伤害" : "伤害";
      return `${source}${target === "目标" ? "" : `对${target}`}${damage}提升${value}`;
    }
    case "damageReduction": {
      const damage = effect.scope.damageType === "normalAttack" ? "普通攻击伤害"
        : effect.scope.damageType === "skillDamage" ? "技能伤害" : "伤害";
      const incoming = effect.scope.incomingSourceTroop ? `来自${troopName(effect.scope.incomingSourceTroop)}的` : "";
      return `${targetName(effect, "全军")}受到${incoming}${damage}降低${value}`;
    }
    case "outgoingDamageReduction": return `${targetName(effect, "敌方目标")}造成伤害降低${value}`;
    case "incomingDamageIncrease": return `${target}受到伤害增加${value}`;
    case "oneUseIncomingDamageIncrease": return `${target}下一次受到伤害增加${value}`;
    case "extraDamage": return `${source}额外技能伤害${percent(effect.coefficient)}`;
    case "targetingOverride": return `${source}优先攻击敌方${troopName(effect.priority[0]!)}`;
    case "temporaryShield": return `生成${percent(effect.coefficient)}${effect.basis === "gatotReportAttackPower" ? "攻击力" : "伤害"}护盾`;
    case "skipNextRoundAction": return `${target}下一回合无法行动`;
    case "targetBoundMark": return `对${target}施加延迟伤害标记`;
    case "markedTargetDamageIncrease": return `标记目标受到伤害增加${value}`;
    case "decayingDamageIncrease": return `${source}伤害提升${value}（随攻击次数衰减）`;
  }
}

function contextText(definition: HeroSkillDefinition): string {
  const names = { unspecified: "未指定场景", challenge: "单撞", rally: "集结", rallyAttack: "集结进攻",
    rallyDefense: "集结防守", garrisonDefense: "守城" };
  return definition.battleContexts?.map((context) => names[context]).join(" / ") ?? "";
}

function effectCategory(definition: HeroSkillDefinition): BodyEffectCategory {
  if (definition.actionMechanic?.kind === "targetBoundMark" || definition.levelValues[5]?.effects.some((e) => e.kind === "extraDamage")) return "技能伤害类";
  const effect = definition.levelValues[5]?.effects[0];
  if (effect?.kind === "attributeModifier" || effect?.kind === "attributeReduction")
    return ({ attack: "攻击类", defense: "防御类", penetration: "穿透类", life: "生命类" } as const)[effect.attribute];
  if (effect?.kind === "defenseModifier" || effect?.kind === "defenseReduction") return "防御类";
  if (effect?.kind === "damageIncrease" || effect?.kind === "extraDamage") return "增伤类";
  if (effect?.kind === "damageReduction" || effect?.kind === "outgoingDamageReduction") return "减伤类";
  if (effect?.kind === "incomingDamageIncrease" || effect?.kind === "oneUseIncomingDamageIncrease" ||
    effect?.kind === "markedTargetDamageIncrease") return "易伤类";
  return "减伤类";
}

function triggerText(definition: HeroSkillDefinition, level: number): string {
  const values = definition.levelValues[level]!;
  const mechanic = definition.actionMechanic;
  if (mechanic?.kind === "skipMainAttack")
    return `${troopName(mechanic.sourceTroop)}每完成${mechanic.afterCompletedAttacks}次主攻击后跳过下一次普攻`;
  if (mechanic?.kind === "attackCountTrigger" || mechanic?.kind === "targetBoundMark") {
    const schedule = mechanic.schedule;
    const source = schedule.source === "army" ? "各兵种" : troopName(schedule.source);
    return `${source}每${schedule.interval}次主攻击${schedule.mode === "onCompleted" ? "完成时" : "后的下一次攻击"}触发`;
  }
  if (values.periodRounds) return `每${values.periodRounds}回合触发（首次 R${values.periodStartRound ?? 1}）`;
  return { passive: "常驻生效", roundStart: "回合开始判定", beforeAttack: "攻击前判定",
    beforeDamage: "伤害结算前判定", onAttack: "攻击时判定", afterNormalAttack: "普通攻击后判定",
    afterDamage: "伤害结算后判定", roundEnd: "回合结束判定" }[definition.trigger];
}

function lifecycleText(definition: HeroSkillDefinition, effect: HeroSkillEffect, level: number): string {
  const values = definition.levelValues[level]!;
  const timing = effect.lifecycle?.activationTiming ?? definition.activationTiming;
  const duration = effect.lifecycle?.durationRounds ?? values.durationRounds ?? definition.durationRounds;
  const parts = [timing === "nextRound" ? "次回合生效" : timing === "nextAction" ? "下次行动生效"
    : timing === "roundEnd" ? "回合末生效" : "", duration === undefined ? "" : `持续${duration}回合`];
  return parts.filter(Boolean).join("，");
}

export function presentBodySkill(skillId: string, level = 5): BodySkillPresentation | undefined {
  const definition = definitions.get(skillId);
  if (!definition || definition.positionRule.kind !== "expeditionSkillSlot" ||
    definition.positionRule.expeditionSkillSlot !== 1 || !definition.positionRule.allowedPositions.includes("member")) return;
  const hero = heroes.get(definition.heroId);
  const skill = hero?.expeditionSkills.find((entry) => entry.combatSkillDefinitionId === skillId && entry.expeditionSkillSlot === 1);
  if (!hero || !skill) return;
  const values = definition.levelValues[level];
  if (!values) throw new RangeError(`车身技能 ${hero.name} 未录入 Lv${level}。`);
  const probability = values.probability ?? definition.probability ?? 1;
  const conditions = [contextText(definition), probability < 1 ? `${percent(probability)}概率` : "",
    definition.actionMechanic || values.periodRounds ? triggerText(definition, level) : ""].filter(Boolean);
  const effects = values.effects.map((effect) => {
    const lifecycle = lifecycleText(definition, effect, level);
    return `${effectText(effect)}${lifecycle ? `（${lifecycle}）` : ""}`;
  });
  const effectSummary = `${conditions.length ? `${conditions.join(" · ")}：` : ""}${effects.join("；")}`;
  // R/SR are standalone categories, never an S-series generation.
  const generation = heroSGeneration(hero) ?? null;
  const identityLabel = `${heroCategoryLabel(hero)}${hero.name}`;
  const category = effectCategory(definition);
  const timingSummary = [triggerText(definition, level),
    definition.triggerTiming === "mainAttackAttempt" ? "主攻击尝试即可触发"
      : definition.triggerTiming === "successfulNormalAttackHit" ? "普通攻击命中后触发" : "",
    definition.actionMechanic?.kind === "targetBoundMark"
      ? `标记后${definition.actionMechanic.damageDelayRounds}回合造成${percent(definition.actionMechanic.damageCoefficient)}附加伤害` : "",
  ].filter(Boolean).join("；");
  return { skillId, heroId: hero.id, heroName: hero.name, rarity: hero.rarity, generation, identityLabel,
    skillName: skill.name, skillDescription: skill.description, level, category, effectSummary,
    displayLabel: `${hero.name}（${heroCategoryLabel(hero)}）｜${effectSummary}｜${timingSummary}`, timingSummary,
    searchText: `${hero.name} ${hero.rarity} ${generation === null ? "" : `S${generation}`} ${skill.name} ${skill.description} ${effectSummary} ${category}`,
    provisional: definition.metadata.ruleStatus !== "supported" };
}

export function getBodySkillOptions(stageId: ServerStageId): readonly BodySkillPresentation[] {
  const cached = optionCache.get(stageId); if (cached) return cached;
  const options = new CanonicalBodyEffectRegistry(undefined, stageId).effects.flatMap((row) =>
    presentBodySkill(row.representative.id) ?? []).sort((a, b) =>
    BODY_EFFECT_CATEGORIES.indexOf(a.category) - BODY_EFFECT_CATEGORIES.indexOf(b.category) ||
    a.effectSummary.localeCompare(b.effectSummary, "zh-CN") ||
    (a.generation ?? 0) - (b.generation ?? 0) || a.heroName.localeCompare(b.heroName, "zh-CN"));
  optionCache.set(stageId, options); return options;
}

export function bodySkillMatchesQuery(option: BodySkillPresentation, query: string): boolean {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
  const text = normalize(option.searchText);
  return normalize(query).trim().split(/\s+/).filter(Boolean).every((keyword) => {
    if (["r", "sr", "ssr"].includes(keyword)) return option.rarity.toLowerCase() === keyword;
    if (/^s\d+$/.test(keyword)) return option.generation === Number(keyword.slice(1));
    return text.includes(keyword);
  });
}
