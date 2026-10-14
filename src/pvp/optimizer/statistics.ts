import { summarizeBatchMetric, type BatchMetricDistribution } from "../validationUi";
import type { CandidateEvaluation, TroopSurvivors, WaveEvaluation } from "./types";

export type TroopMetricSamples = Record<"total" | keyof TroopSurvivors, number[]>;

export function emptyTroopSamples(): TroopMetricSamples {
  return { total: [], shield: [], lancer: [], marksman: [] };
}

export function addTroopSample(samples: TroopMetricSamples, troops: TroopSurvivors): void {
  samples.shield.push(troops.shield);
  samples.lancer.push(troops.lancer);
  samples.marksman.push(troops.marksman);
  samples.total.push(troops.shield + troops.lancer + troops.marksman);
}

export function summarizeTroopSamples(samples: TroopMetricSamples): Readonly<Record<keyof TroopMetricSamples, BatchMetricDistribution>> {
  return {
    total: summarizeBatchMetric(samples.total),
    shield: summarizeBatchMetric(samples.shield),
    lancer: summarizeBatchMetric(samples.lancer),
    marksman: summarizeBatchMetric(samples.marksman),
  };
}

export function wilsonInterval(successes: number, trials: number, z = 1.959963984540054): readonly [number, number] {
  if (!Number.isSafeInteger(trials) || trials < 1 || successes < 0 || successes > trials) {
    throw new RangeError("Invalid Wilson sample counts.");
  }
  if (!Number.isFinite(z) || z <= 0) throw new RangeError("Invalid Wilson confidence quantile.");
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / trials + z2 / (4 * trials * trials)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

/** Lexicographic; win rate dominates unless Wilson intervals overlap. */
export function compareSingleWin(a: CandidateEvaluation, b: CandidateEvaluation): number {
  const statisticallySeparated = a.wilson95[0] > b.wilson95[1] || b.wilson95[0] > a.wilson95[1];
  if (statisticallySeparated && a.winRate !== b.winRate) return b.winRate - a.winRate;
  return b.selfRemaining.total.mean - a.selfRemaining.total.mean ||
    b.winRate - a.winRate ||
    a.enemyRemaining.total.mean - b.enemyRemaining.total.mean ||
    a.rounds.mean - b.rounds.mean;
}

export function compareMultiWave(
  a: { readonly targetWaves: number | null; readonly waves: readonly WaveEvaluation[] },
  b: { readonly targetWaves: number | null; readonly waves: readonly WaveEvaluation[] },
): number {
  const kA = a.targetWaves ?? Number.POSITIVE_INFINITY;
  const kB = b.targetWaves ?? Number.POSITIVE_INFINITY;
  if (kA !== kB) return kA - kB;
  const commonK = Number.isFinite(kA) ? kA : Math.min(a.waves.length, b.waves.length);
  const current = commonK - 1;
  return (b.waves[current]?.defeatProbability ?? 0) - (a.waves[current]?.defeatProbability ?? 0) ||
    (b.waves[current - 1]?.defeatProbability ?? 0) - (a.waves[current - 1]?.defeatProbability ?? 0) ||
    (a.waves[current - 1]?.enemyRemaining.total.mean ?? 0) -
      (b.waves[current - 1]?.enemyRemaining.total.mean ?? 0) ||
    (a.waves[current]?.enemyRemaining.total.mean ?? 0) -
      (b.waves[current]?.enemyRemaining.total.mean ?? 0);
}
