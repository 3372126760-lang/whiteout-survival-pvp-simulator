import type { HeroSkillDefinition, HeroSkillEffect } from "../../heroSkills";
import type { BodySkillEffectSignature } from "../criterion/bodyPreprocess";
export function canonicalEffectFamily(effect: HeroSkillEffect, contexts: readonly string[] = []): string {
  const { id: _id, name: _name, ...semantic } = effect;
  void _id; void _name;
  const cleaned = { ...Object.fromEntries(Object.entries(semantic).filter(([key]) => !["value", "coefficient", "initialValues"].includes(key))),
    scope: { ...effect.scope, target: effect.scope.target ?? "all", damageType: effect.scope.damageType ?? "all" },
    ...(effect.kind === "attributeModifier" ? { operation: "multiplyAttributeFactor" } : {}) };
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) : value;
  return JSON.stringify([canonical(cleaned), [...contexts].sort()]);
}
export function canonicalSkillFamilies(skill: HeroSkillDefinition, level: number): readonly string[] {
  return [...new Set((skill.levelValues[level]?.effects ?? []).map((e) => canonicalEffectFamily(e, skill.battleContexts)))].sort();
}
/** Only complete, linear numeric skills qualify. Never prove dominance from one effect of a multi-effect skill. */
export function probabilityBodyDominatedBy(a: BodySkillEffectSignature, b: BodySkillEffectSignature): boolean {
  const av = a.definition.levelValues[a.skillLevel], bv = b.definition.levelValues[b.skillLevel];
  if (!(a.probability < 1) || b.probability !== 1 || !av || !bv || a.definition.actionMechanic || b.definition.actionMechanic ||
      av.periodRounds || bv.periodRounds || av.cooldownRounds || bv.cooldownRounds ||
      (a.definition.durationRounds ?? av.durationRounds ?? 0) !== (b.definition.durationRounds ?? bv.durationRounds ?? 0) ||
      (a.definition.activationTiming ?? "immediate") !== (b.definition.activationTiming ?? "immediate")) return false;
  const numeric = (s: BodySkillEffectSignature) => {
    const values = new Map<string, number>();
    for (const e of s.definition.levelValues[s.skillLevel]!.effects) {
      if (!("value" in e) || e.value < 0 || e.lifecycle || !["attributeModifier", "attributeReduction", "damageIncrease", "damageReduction", "defenseModifier", "defenseReduction", "incomingDamageIncrease", "outgoingDamageReduction"].includes(e.kind)) return null;
      const key = canonicalEffectFamily(e, s.definition.battleContexts);
      values.set(key, (values.get(key) ?? 0) + e.value);
    }
    return values;
  };
  const x = numeric(a), y = numeric(b);
  return !!x?.size && !!y && x.size === y.size && [...x].every(([key, v]) => y.has(key) && a.probability * v <= y.get(key)! + 1e-12);
}
