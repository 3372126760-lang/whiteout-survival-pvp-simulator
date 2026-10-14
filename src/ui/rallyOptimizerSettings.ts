import { resolveCriterionSearchOptions, type CriterionSearchOptions } from "../pvp/optimizer/criterion/searchTypes";
import { resolveJointRacingSchedule } from "../pvp/optimizer/criterion/racingSchedule";
import type { OptimizationConfig } from "../pvp/optimizer/types";

/** Display the schedule actually used, including an explicit API/import override. */
export function rallyCriterionSettings(config: OptimizationConfig): CriterionSearchOptions {
  const options = resolveCriterionSearchOptions(config.criterion), schedule = resolveJointRacingSchedule(config);
  return { ...options, screeningTrials: schedule.map((stage) => stage.trials),
    screeningKeep: schedule.map((stage) => stage.keep),
    minimumHeadRuns: Math.max(20, options.minimumHeadRuns), uncertainHeadRuns: Math.max(40, options.uncertainHeadRuns) };
}

/** Editing the visible Criterion schedule replaces any old separate stage override. */
export function updateRallyCriterionSetting(config: OptimizationConfig, field: string, value: number): OptimizationConfig {
  const current = rallyCriterionSettings(config);
  let next = current;
  const stageField = /^criterion-(keep|trials)-(\d+)$/.exec(field);
  if (stageField) {
    const index = Number(stageField[2]);
    const key = stageField[1] === "keep" ? "screeningKeep" : "screeningTrials";
    if (index >= current[key].length) throw new RangeError("模拟阶段序号无效。");
    const values = [...current[key]];values[index] = value;
    next = { ...current, [key]: values };
  } else if (["criterion-headRatioLimit", "criterion-minimumHeadRuns", "criterion-uncertainHeadRuns"].includes(field)) {
    if (field === "criterion-minimumHeadRuns" && value < 20 || field === "criterion-uncertainHeadRuns" && value < 40)
      throw new RangeError("普通/高不确定性候选置信淘汰最低样本为 20/40 场。");
    const key = field.slice("criterion-".length);
    next = { ...current, [key]: value };
  } else throw new RangeError("Criterion 参数无效。");
  const { monteCarloStages: previousOverride, ...rest } = config;
  void previousOverride;
  if (next.screeningTrials.some((trials, index) => index > 0 && trials === next.screeningTrials[index - 1]!)) {
    // Sequential cuts at an equal cumulative budget are a supported explicit API
    // schedule. Keep that representation while showing/editing its real values.
    const schedule = resolveJointRacingSchedule({ ...config, monteCarloStages:
      next.screeningTrials.map((trials, index) => ({ trials, keep: next.screeningKeep[index]! })) });
    const base = resolveCriterionSearchOptions(config.criterion);
    const criterion = resolveCriterionSearchOptions({ ...next,
      screeningTrials: base.screeningTrials, screeningKeep: base.screeningKeep });
    return { ...rest, criterion, monteCarloStages: schedule, initialBattleTrials: schedule[0]!.trials };
  }
  return { ...rest, criterion: resolveCriterionSearchOptions(next), initialBattleTrials: next.screeningTrials[0]! };
}
