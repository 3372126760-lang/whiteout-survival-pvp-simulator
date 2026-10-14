export interface WinSample {
  readonly wins: number;
  readonly trials: number;
}
export interface EarlyEliminationOptions {
  readonly reference: WinSample;
  readonly maxTrials: number;
  /** Number of candidates compared in this search; included in the error budget. */
  readonly comparisons: number;
}

/** Conservative one-sided Hoeffding bounds, union-bounded over candidates/checks.
 * Pruning is a search approximation. Finalists/baseline never use this shortcut.
 */
export function shouldEliminate(sample: WinSample, options: EarlyEliminationOptions): boolean {
  if (sample.trials < 20 || sample.trials >= options.maxTrials || sample.trials % 10 !== 0) return false;
  const checks = Math.max(1, Math.ceil(options.maxTrials / 10));
  const alpha = .01 / (2 * Math.max(1, options.comparisons) * checks);
  const bound = (value: WinSample, upper: boolean) => {
    const radius = Math.sqrt(Math.log(1 / alpha) / (2 * value.trials));
    return Math.max(0, Math.min(1, value.wins / value.trials + (upper ? radius : -radius)));
  };
  return options.reference.trials >= 20 && bound(sample, true) < bound(options.reference, false);
}

export interface SearchSampleMetadata {
  readonly requestedTrials?: number;
  readonly pruned?: boolean;
}
