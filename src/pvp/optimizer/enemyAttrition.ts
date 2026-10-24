import { TROOP_TYPES, type TroopType } from "../types";
import type { ValidationBattleInput } from "../validationUi";
import { createTheoryTemplateBuilder, defaultTheoryOptions } from "./theory";
import type { CandidateEvaluation, TroopSurvivors } from "./types";

/** A fixed-reference proxy, not a claim about the next rally's win probability.
 * Unit quality is sqrt(expected output coefficient * effective HP). The same
 * reference and weights score every candidate, so transient candidate debuffs
 * cannot masquerade as permanent damage to the next rally's opponent. */
export function createEnemyQualityMetric(input: ValidationBattleInput) {
  const template = createTheoryTemplateBuilder(defaultTheoryOptions())(input, "A");
  const enemy = template.sideB, reference = template.sideA;
  const referenceTotal = Math.max(1, reference.total);
  const weights = Object.fromEntries(TROOP_TYPES.map((troop, i) => {
    const output = reference.counts.reduce((sum, n, j) =>
      sum + n / referenceTotal * Math.max(0, enemy.damage[i * 3 + j] ?? 0), 0);
    return [troop, Math.sqrt(Math.max(1e-12, output) * Math.max(1e-12, enemy.ehp[i] ?? 0))];
  })) as Record<TroopType, number>;
  const initial = TROOP_TYPES.reduce((sum, t, i) => sum + (enemy.counts[i] ?? 0) * weights[t], 0);
  if (!Number.isFinite(initial) || initial <= 0) throw new Error("削弱目标需要非空防守部队。");
  return {
    weights,
    initial,
    score: (counts: TroopSurvivors) =>
      100 * TROOP_TYPES.reduce((sum, t) => sum + Math.max(0, counts[t]) * weights[t], 0) / initial,
  };
}

export function compareEnemyAttrition(a: CandidateEvaluation, b: CandidateEvaluation): number {
  if (!a.enemyRemainingQuality || !b.enemyRemainingQuality) throw new Error("削弱目标缺少剩余战力统计。");
  return a.enemyRemainingQuality.mean - b.enemyRemainingQuality.mean || b.winRate - a.winRate ||
    a.enemyRemaining.total.mean - b.enemyRemaining.total.mean;
}

export function shouldSuggestEnemyAttrition(value: {
  selectedMode: string;
  singleWaveTop: readonly { winRate: number }[];
  currentEvaluation?: { winRate: number };
}): boolean {
  return value.selectedMode === "singleWin" && value.singleWaveTop.length > 0 &&
    Math.max(value.currentEvaluation?.winRate ?? 0, ...value.singleWaveTop.map(row => row.winRate)) < .3;
}
