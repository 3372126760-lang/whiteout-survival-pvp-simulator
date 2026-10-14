import type { CriterionSide } from "./types";
export function firstAlive(mask: number, priority: readonly number[]): number {
  return priority.find((i) => (mask & 1 << i) !== 0) ?? -1;
}
export function aliveMask(counts: readonly number[]): number {
  return counts.reduce((mask, n, i) => n > 1e-8 ? mask | 1 << i : mask, 0);
}
/** Rows are output channels, not normalized probabilities. Extra damage adds flow. */
export function buildTargetFlow(side: CriterionSide, ownMask: number, enemyMask: number, into = new Float64Array(9)): Float64Array {
  into.fill(0);
  for (const channel of side.channels) {
    if (!(ownMask & 1 << channel.source) || !enemyMask) continue;
    const priority = channel.priority ?? side.priorities[channel.source]!;
    const main = firstAlive(enemyMask, priority);
    const coefficient = channel.coefficient;
    const matrix = channel.kind === "normalAttack" || channel.kind === "additionalAttack" ? side.normal : side.skill;
    const add = (target: number, p: number) => { if (target >= 0) into[channel.source * 3 + target]! += coefficient * p * matrix[channel.source * 3 + target]!; };
    if (channel.target === "all") { for (let t = 0; t < 3; t++) if (enemyMask & 1 << t) add(t, 1); }
    else if (channel.target === "random") {
      const count = Number(!!(enemyMask & 1)) + Number(!!(enemyMask & 2)) + Number(!!(enemyMask & 4));
      for (let t = 0; t < 3; t++) if (enemyMask & 1 << t) add(t, 1 / count);
    } else if (typeof channel.target === "number") {
      if (enemyMask & 1 << channel.target) add(channel.target, 1);
    } else if (channel.target === "priority" || channel.target === "current") {
      const policy = channel.target === "current" ? side.channels.find((c) => c.source === channel.source && c.kind === "normalAttack") : channel;
      const probability = policy?.redirectProbability ?? 0;
      const alternate = firstAlive(enemyMask, policy?.redirectPriority ?? priority);
      add(main, 1 - probability); add(alternate, probability);
    } else add(main, 1);
  }
  return into;
}
