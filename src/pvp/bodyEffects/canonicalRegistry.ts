import { CONFIRMED_HERO_SKILL_DEFINITIONS, EXPEDITION_HERO_DATA, type HeroSkillDefinition } from "../heroSkills";
import { isHeroAvailableAtStage, type ServerStageId } from "../progression";
import { heroSGeneration } from "../validationUi/heroCategory";

export const BODY_CATEGORIES = ["attack", "defense", "penetration", "life", "damageIncrease", "skillDamage", "damageReduction", "vulnerability"] as const;
export type CanonicalBodyCategory = typeof BODY_CATEGORIES[number];
export const BODY_CATEGORY_LABELS: Record<CanonicalBodyCategory, string> = { attack: "攻击类", defense: "防御类", penetration: "穿透类", life: "生命类", damageIncrease: "增伤类", skillDamage: "技能伤害类", damageReduction: "减伤类", vulnerability: "易伤类" };
const heroes = new Map(EXPEDITION_HERO_DATA.map((h, order) => [h.id, { hero: h, order }]));
const exclusions = new Set(["hero-skill.alongsuo.stormy-waves", "hero-skill.gelaige.sword-of-justice", "hero-skill.fulinte.wildfire", "hero-skill.nataliya.wild-roar"]);
const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : value;

/** Complete selected-level runtime semantics. Only presentation/identity fields
 * disappear. The legacy attribute operation is documented by the formal type as
 * the same multiplier. Timing defaults mirror the runtime, never UI wording. */
export function canonicalBodySemanticKey(skill: HeroSkillDefinition, level = 5): string {
  const values = skill.levelValues[level];
  if (!values) throw new RangeError(`Missing Body level: ${skill.id} Lv${level}`);
  return JSON.stringify(sorted({ trigger: skill.trigger, triggerTiming: skill.triggerTiming,
    probability: values.probability ?? skill.probability ?? 1,
    cooldownRounds: values.cooldownRounds ?? skill.cooldownRounds ?? 0,
    periodRounds: values.periodRounds, periodStartRound: values.periodStartRound,
    activationTiming: skill.activationTiming ?? "immediate", durationRounds: values.durationRounds ?? skill.durationRounds,
    actionMechanic: skill.actionMechanic, battleContexts: skill.battleContexts ? [...skill.battleContexts].sort() : [],
    procEffectFamilyId: skill.procEffectFamilyId, activeRule: skill.metadata.ruleStatus !== "RULE_UNKNOWN",
    effects: values.effects.map(({ id: _id, name: _name, ...effect }) => {
      void _id; void _name;
      return { ...effect, ...(effect.kind === "attributeModifier" ? { operation: "multiplyAttributeFactor" } : {}),
        scope: { ...effect.scope, target: effect.scope.target ?? "all", damageType: effect.scope.damageType ?? "all" },
        lifecycle: { ...effect.lifecycle, activationTiming: effect.lifecycle?.activationTiming ?? skill.activationTiming ?? "immediate" } };
    }) }));
}
function category(skill: HeroSkillDefinition): CanonicalBodyCategory {
  const effects = skill.levelValues[5]!.effects;
  if (skill.actionMechanic?.kind === "targetBoundMark" || effects.some((e) => e.kind === "extraDamage")) return "skillDamage";
  const first = effects[0]!;
  if (first.kind === "attributeModifier" || first.kind === "attributeReduction") return first.attribute;
  if (first.kind === "defenseModifier" || first.kind === "defenseReduction") return "defense";
  if (effects.some((e) => e.kind === "incomingDamageIncrease" || e.kind === "oneUseIncomingDamageIncrease")) return "vulnerability";
  return first.kind === "damageIncrease" ? "damageIncrease" : "damageReduction";
}
export interface CanonicalBodyEffect {
  readonly canonicalBodyEffectId: string;
  readonly semanticKey: string;
  readonly representative: HeroSkillDefinition;
  readonly aliases: readonly HeroSkillDefinition[];
  readonly category: CanonicalBodyCategory;
  readonly optimizerExcluded: boolean;
}
export class CanonicalBodyEffectRegistry {
  readonly effects: readonly CanonicalBodyEffect[];
  private readonly bySkill = new Map<string, CanonicalBodyEffect>();
  constructor(definitions: readonly HeroSkillDefinition[] = CONFIRMED_HERO_SKILL_DEFINITIONS, stage?: ServerStageId) {
    const groups = new Map<string, HeroSkillDefinition[]>();
    const eligible = definitions.filter((s) => s.positionRule.kind === "expeditionSkillSlot" && s.positionRule.expeditionSkillSlot === 1 &&
      s.positionRule.allowedPositions.includes("member") && (!stage || isHeroAvailableAtStage(s.heroId, stage)));
    const generation = (s: HeroSkillDefinition) => { const h = heroes.get(s.heroId)?.hero; return (h ? heroSGeneration(h) : undefined) ?? s.metadata.generation ?? 0; };
    eligible.sort((a, b) => generation(a) - generation(b) ||
      (heroes.get(a.heroId)?.order ?? Infinity) - (heroes.get(b.heroId)?.order ?? Infinity) || a.id.localeCompare(b.id));
    for (const skill of eligible) { const key = canonicalBodySemanticKey(skill); const group = groups.get(key) ?? []; group.push(skill); groups.set(key, group); }
    this.effects = [...groups].map(([semanticKey, aliases]) => {
      const representative = aliases[0]!;
      const row: CanonicalBodyEffect = { canonicalBodyEffectId: `body-effect:${representative.id}`, semanticKey, representative, aliases,
        category: category(representative), optimizerExcluded: aliases.some((s) => exclusions.has(s.id)) };
      for (const s of aliases) this.bySkill.set(s.id, row); return row;
    });
  }
  forSkill(skillId: string): CanonicalBodyEffect | undefined { return this.bySkill.get(skillId); }
  get automaticEffects(): readonly CanonicalBodyEffect[] { return this.effects.filter((e) => !e.optimizerExcluded); }
  categoryCounts(automatic = false): Record<CanonicalBodyCategory, number> {
    return Object.fromEntries(BODY_CATEGORIES.map((c) => [c, (automatic ? this.automaticEffects : this.effects).filter((e) => e.category === c).length])) as Record<CanonicalBodyCategory, number>;
  }
}
