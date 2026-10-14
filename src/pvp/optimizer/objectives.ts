import { compareMultiWave, compareSingleWin } from "./statistics";
import type { CandidateEvaluation, MultiWaveEvaluation, OptimizationConfig } from "./types";

export interface OptimizationObjective<T> {
  readonly mode: "singleWin" | "minRallies";
  compare(left: T, right: T): number;
}

export const SingleWinObjective: OptimizationObjective<CandidateEvaluation> = {
  mode: "singleWin",
  compare: compareSingleWin,
};

export const MinRalliesObjective: OptimizationObjective<MultiWaveEvaluation> = {
  mode: "minRallies",
  compare: compareMultiWave,
};

export const AutoObjective = {
  select(coarseMaximumWinRate: number, config: OptimizationConfig): "singleWin" | "minRallies" {
    if (coarseMaximumWinRate <= config.singleFightThresholdLow) return "minRallies";
    if (coarseMaximumWinRate >= config.singleFightThresholdHigh) return "singleWin";
    return "singleWin";
  },
};
