import { DEFAULT_TARGET_PRIORITY } from "../../constants";
import { TROOP_TYPES } from "../../types";
import type { SignatureBinding } from "../criterion/signatures";

/** Fixed exit-count equivalents only. No enemy HP/defense or simulated rounds. */
export const TARGET_EXIT_WEIGHTS = [1, 3, 4] as const;
export function fixedTargetValue(target: string | undefined, shares: readonly number[], current = 1): number {
  if (!target || target === "currentTarget") return current;
  if (target === "all") return shares.reduce((sum, n, i) => sum + (n > 0 ? TARGET_EXIT_WEIGHTS[i]! : 0), 0);
  const index = TROOP_TYPES.indexOf(target as typeof TROOP_TYPES[number]);
  return index >= 0 && shares[index]! > 0 ? TARGET_EXIT_WEIGHTS[index]! : 0;
}
export function fixedMainTargets(bindings: readonly SignatureBinding[], shares: readonly number[]) {
  const first = (priority: readonly string[]) => priority.map(t => TROOP_TYPES.indexOf(t as typeof TROOP_TYPES[number]))
    .find(i => i >= 0 && shares[i]! > 0) ?? -1;
  const normal = first(DEFAULT_TARGET_PRIORITY);
  const probabilities: number[][] = TROOP_TYPES.map(() => TROOP_TYPES.map((_, i) => i === normal ? 1 : 0));
  for (const binding of bindings) {
    const level = binding.skill.levelValues[binding.level];
    if (!level) continue;
    const p = level.probability ?? binding.skill.probability ?? 1;
    for (const effect of level.effects) if (effect.kind === "targetingOverride") {
      const alternate = first(effect.priority);
      for (const [source, troop] of TROOP_TYPES.entries()) {
        if (effect.scope.source !== "army" && effect.scope.source !== troop &&
          !(effect.scope.source === "self" && binding.source === source)) continue;
        probabilities[source] = probabilities[source]!.map((v, i) => v * (1 - p) + (i === alternate ? p : 0));
      }
    }
  }
  return { probabilities, weights: probabilities.map(row => row.reduce((sum, p, i) => sum + p * TARGET_EXIT_WEIGHTS[i]!, 0)), normal };
}
