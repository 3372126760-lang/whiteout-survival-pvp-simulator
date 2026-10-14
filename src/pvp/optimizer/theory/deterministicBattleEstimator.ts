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
export function nextRoundExpectedOutput(template: TheoryTemplate, counts: readonly (readonly number[])[], fixed: number) {
  const sides = [template.sideA, template.sideB], total: [number, number] = [0, 0];
  const matrix: [number[], number[]] = [[], []];
  for (let side = 0; side < 2; side++) for (let troop = 0; troop < 3; troop++) {
    const target = theoryTarget(counts[1 - side]!, sides[side]!.priorities[troop]!);
    for (let t = 0; t < 3; t++) matrix[side as 0 | 1].push(fixed * Math.sqrt(Math.max(0, counts[side]![troop]!)) * sides[side]!.damage[troop * 3 + t]!);
    if (target >= 0) total[side as 0 | 1] += matrix[side as 0 | 1][troop * 3 + target]!;
  }
  return { matrix, total };
}
export function estimateDeterministicBattle(template: TheoryTemplate, ratios: readonly number[]): {
  score: number; remaining: readonly [number, number]; rounds: number; horizonReached: boolean;
  counts: readonly (readonly number[])[]; initialOutput: readonly [number, number]; output: readonly [number, number];
  outputRetention: readonly [number, number]; outputMatrix: readonly [readonly number[], readonly number[]];
} {
  const counts = initialTheoryCounts(template, ratios);
  const initial = counts.map((side) => side.reduce((sum, n) => sum + n, 0));
  const fixed = Math.sqrt(Math.min(initial[0]!, initial[1]!));
  const sides = [template.sideA, template.sideB];
  const program = template.expectationProgram, runtime = program?.createRuntime();
  const initialOutput = program && runtime ? program.nextOutput(1, counts, fixed, runtime) : nextRoundExpectedOutput(template, counts, fixed);
  let round = 0;
  for (; round < template.maxRounds; round += 1) {
    if (counts.some((side) => side.every((n) => n <= 1e-8))) break;
    const expected = program && runtime ? program.runRound(round + 1, counts, fixed, runtime) : undefined;
    const damage = expected?.damage ?? [[0, 0, 0], [0, 0, 0]];
    if (!expected) for (let side = 0; side < 2; side += 1) for (let troop = 0; troop < 3; troop += 1) {
      const target = theoryTarget(counts[1 - side]!, sides[side]!.priorities[troop]!);
      if (target < 0) continue;
      damage[1 - side]![target]! += fixed * Math.sqrt(counts[side]![troop]!) *
        sides[side]!.damage[troop * 3 + target]!;
    }
    // Overflow beyond a target stack is discarded, as in the official round snapshot model.
    for (let side = 0; side < 2; side += 1) for (let troop = 0; troop < 3; troop += 1)
      counts[side]![troop] = Math.max(0, counts[side]![troop]! - damage[side]![troop]! / (expected?.hp[side]![troop] ?? sides[side]!.hp[troop]!));
  }
  const remaining = counts.map((side, index) => side.reduce((sum, n) => sum + n, 0) / Math.max(1, initial[index]!)) as [number, number];
  const eliminated = remaining.map((n) => n <= 1e-8);
  const terminal = eliminated[0] === eliminated[1] ? 0 : eliminated[1] ? 1 : -1;
  const aScore = .7 * terminal + .3 * (remaining[0] - remaining[1]);
  const output = program && runtime ? program.nextOutput(round + 1, counts, fixed, runtime) : nextRoundExpectedOutput(template, counts, fixed);
  return { counts, initialOutput: initialOutput.total, output: output.total, outputMatrix: output.matrix,
    outputRetention: output.total.map((n, i) => initialOutput.total[i as 0 | 1] > 0 ? n / initialOutput.total[i as 0 | 1] : 0) as [number, number], score: template.targetSide === "A" ? aScore : -aScore, remaining,
    rounds: round, horizonReached: !eliminated[0] && !eliminated[1] && round === template.maxRounds };
}
