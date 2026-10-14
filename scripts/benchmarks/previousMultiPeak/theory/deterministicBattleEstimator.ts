import type { TheoryTemplate } from "./types";

export function initialTheoryCounts(template: TheoryTemplate, ratios: readonly number[]): [number[], number[]] {
  const target = template.targetSide === "A" ? template.sideA : template.sideB;
  const optimized = ratios.map((ratio) => ratio * target.total / 100);
  return template.targetSide === "A" ? [optimized, [...template.sideB.counts]]
    : [[...template.sideA.counts], optimized];
}
export function theoryTarget(counts: readonly number[], priority: readonly number[]): number {
  return priority.find((index) => counts[index]! > 1e-8) ?? -1;
}
/** Separate continuous approximation: simultaneous round-end losses, no RNG,
 * integer casualties, runtime skill mutation, damage events or BattleTrace. */
export function estimateDeterministicBattle(template: TheoryTemplate, ratios: readonly number[]): {
  score: number; remaining: readonly [number, number]; rounds: number; horizonReached: boolean;
} {
  const counts = initialTheoryCounts(template, ratios);
  const initial = counts.map((side) => side.reduce((sum, n) => sum + n, 0));
  const fixed = Math.sqrt(Math.min(initial[0]!, initial[1]!));
  const sides = [template.sideA, template.sideB];
  let round = 0;
  for (; round < template.maxRounds; round += 1) {
    if (counts.some((side) => side.every((n) => n <= 1e-8))) break;
    const damage = [[0, 0, 0], [0, 0, 0]];
    for (let side = 0; side < 2; side += 1) for (let troop = 0; troop < 3; troop += 1) {
      const target = theoryTarget(counts[1 - side]!, sides[side]!.priorities[troop]!);
      if (target < 0) continue;
      damage[1 - side]![target]! += fixed * Math.sqrt(counts[side]![troop]!) *
        sides[side]!.damage[troop * 3 + target]!;
    }
    // Overflow beyond a target stack is discarded, as in the official round snapshot model.
    for (let side = 0; side < 2; side += 1) for (let troop = 0; troop < 3; troop += 1)
      counts[side]![troop] = Math.max(0, counts[side]![troop]! - damage[side]![troop]! / sides[side]!.hp[troop]!);
  }
  const remaining = counts.map((side, index) => side.reduce((sum, n) => sum + n, 0) / Math.max(1, initial[index]!)) as [number, number];
  const eliminated = remaining.map((n) => n <= 1e-8);
  const terminal = eliminated[0] === eliminated[1] ? 0 : eliminated[1] ? 1 : -1;
  const aScore = .7 * terminal + .3 * (remaining[0] - remaining[1]);
  return { score: template.targetSide === "A" ? aScore : -aScore, remaining,
    rounds: round, horizonReached: !eliminated[0] && !eliminated[1] && round === template.maxRounds };
}
