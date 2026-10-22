import type { HeroSkillActionMechanic } from "./types";

/** Shared by Formal and optimizer estimates. Never changes counters, RNG or rounding. */
export function targetMarkDamageCoefficient(coefficients: readonly number[], additionalCoefficient?: number): number {
  if (coefficients.length === 0) return 0;
  if (additionalCoefficient === undefined) return coefficients.reduce((sum, value) => sum + value, 0);
  return Math.max(...coefficients) + (coefficients.length - 1) * additionalCoefficient;
}

type MarkMechanic = Extract<HeroSkillActionMechanic, { kind: "targetBoundMark" }>;
/** Sources are already filtered for enabled runtimes, recorded levels and scenario legality. */
export function targetMarkSourceGroups<T extends { skill: { id: string; actionMechanic?: HeroSkillActionMechanic } }>(sources: readonly T[]):
  { key: string; mechanic: MarkMechanic; sources: T[]; coefficient: number }[] {
  const groups = new Map<string, { key: string; mechanic: MarkMechanic; sources: T[]; coefficient: number }>();
  for (const source of sources) {
    const mechanic = source.skill.actionMechanic;
    if (mechanic?.kind !== "targetBoundMark") continue;
    const key = JSON.stringify([source.skill.id, mechanic.markId, mechanic.schedule, mechanic.damageDelayRounds, mechanic.duplicateSourceStacking]);
    const group = groups.get(key) ?? { key, mechanic, sources: [], coefficient: 0 };
    group.sources.push(source);
    group.coefficient = targetMarkDamageCoefficient(group.sources.map(() => mechanic.damageCoefficient),
      mechanic.duplicateSourceStacking?.additionalCoefficient);
    groups.set(key, group);
  }
  return [...groups.values()];
}
