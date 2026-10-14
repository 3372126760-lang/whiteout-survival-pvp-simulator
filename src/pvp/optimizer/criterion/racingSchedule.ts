import { resolveCriterionSearchOptions } from "./searchTypes";
import type { OptimizationConfig } from "../types";

type RacingConfig = Pick<OptimizationConfig, "criterion" | "monteCarloStages" | "stages" |
  "initialBattleTrials" | "verificationTop" | "verificationTrials">;

/** One source of truth for runtime, visible settings and persistence. */
export function resolveJointRacingSchedule(config: RacingConfig) {
  const options = resolveCriterionSearchOptions(config.criterion);
  const legacyCustomStages = config.stages.some((stage, index) => stage.trials !== [20,50,100][index]);
  const schedule = config.monteCarloStages ?? (legacyCustomStages && !config.criterion?.screeningTrials ? [
    { trials: Math.min(config.initialBattleTrials ?? 10, config.stages[0].trials), keep: config.stages[0].keep },
    { trials: config.stages[0].trials, keep: config.stages[1].keep },
    { trials: config.stages[1].trials, keep: config.stages[2].keep },
    { trials: config.stages[2].trials, keep: config.verificationTop },
    ...(config.stages[2].trials < 300 && config.verificationTrials >= 300 ? [{ trials: 300, keep: config.verificationTop }] : []),
  ] : options.screeningTrials.map((trials, index) => ({ trials, keep: options.screeningKeep[index]! })));
  if (!schedule.length || schedule.some((stage, index) => !Number.isSafeInteger(stage.trials) || stage.trials < 1 ||
    stage.trials > 100000 || !Number.isSafeInteger(stage.keep) || stage.keep < 1 ||
    index > 0 && stage.trials < schedule[index - 1]!.trials)) throw new RangeError("Cumulative Monte Carlo budgets must be nondecreasing.");
  return schedule;
}
