import { runObservedQueueScenario } from "../diagnostics/observedQueueScenario";
import { summarizeTrajectoryScheduler } from "../optimizer/trajectorySamples";
import type { TrajectoryObservation } from "../optimizer/execution";
import { TROOP_TYPES, type SideId } from "../types/combat";
import { deriveBatchSeed, validateBatchSimulationCount } from "./batchSimulation";
import { generateValidationRandomSeed } from "./randomMode";
import type { ValidationBattleInput } from "./types";
import { toValidationThreeQueueConfig } from "./adapter";
import { runThreeQueueScenario, ThreeQueueUnresolvedError,
  type ThreeQueueScenarioConfig, type ThreeQueueScenarioResult,
  type ThreeQueueSchedulerAudit } from "../scenario/threeQueueScenario";
import { resolveThreeQueueMode, threeQueueSchedulerType,
  type ThreeQueueMode, type ThreeQueueSchedulerType } from "../scenario/threeQueueScheduler";

export interface ThreeQueueBatchResult {
  readonly schedulerStatistics: ReturnType<typeof summarizeTrajectoryScheduler>;
  readonly battleScenario: NonNullable<ValidationBattleInput["scenarioType"]>;
  readonly innerEarthMode: NonNullable<ValidationBattleInput["innerEarth"]>["subMode"] | null;
  readonly threeQueueMode: ThreeQueueMode;
  readonly schedulerType: ThreeQueueSchedulerType;
  /** Actual first successful formal trial, rather than a Criterion prediction. */
  readonly schedulerSample: { readonly trialSeed: number; readonly audit: ThreeQueueSchedulerAudit } | null;
  readonly simulationCount: number;
  readonly simulationMode: "fixedSeed" | "random";
  readonly rootSeed: number;
  readonly firstTrialSeed: number;
  readonly lastTrialSeed: number;
  readonly attackerWins: number;
  readonly defenderWins: number;
  readonly failedTrials: number;
  readonly failedTrialSeeds: readonly number[];
  readonly attackerWinRate: number;
  readonly defenderWinRate: number;
  /** Averages use completed trials as denominator; zero if none completed. */
  readonly completedTrials: number;
  readonly averageBattleCount: number;
  readonly avgAttackerRemainingQueues: number;
  readonly avgDefenderRemainingQueues: number;
  readonly avgAttackerSurvivors: number;
  readonly avgDefenderSurvivors: number;
  readonly averageLoss: Readonly<Record<SideId, number>>;
  readonly averageInjured: Readonly<Record<SideId, number>>;
  readonly averageLightlyWounded: Readonly<Record<SideId, number>>;
}

/** Every trial runs a complete seeded three-queue elimination scenario. */
export function runThreeQueueBatchSimulation(
  input: ValidationBattleInput,
  count: number,
  randomUint32?: () => number,
  onProgress?: (completed: number, total: number) => void,
  executeScenario: (config: ThreeQueueScenarioConfig) => ThreeQueueScenarioResult =
    runThreeQueueScenario,
): ThreeQueueBatchResult {
  validateBatchSimulationCount(count);
  const base = toValidationThreeQueueConfig(input);
  const threeQueueMode = resolveThreeQueueMode(base.threeQueueMode);
  let schedulerSample: ThreeQueueBatchResult["schedulerSample"] = null;
  const simulationMode = input.simulationMode ?? "fixedSeed";
  const rootSeed = simulationMode === "random"
    ? generateValidationRandomSeed(randomUint32 ?? secureRandomUint32)
    : deriveBatchSeed(input.randomSeed, 0);
  let attackerWins = 0;
  let defenderWins = 0;
  let failedTrials = 0;
  let totalBattles = 0;
  let remainingQueuesA = 0;
  let remainingQueuesB = 0;
  let survivorsA = 0;
  let survivorsB = 0;
  const failedTrialSeeds: number[] = [];
  const trajectories: TrajectoryObservation[] = [];
  const categories = {
    loss: { A: 0, B: 0 },
    injured: { A: 0, B: 0 },
    lightlyWounded: { A: 0, B: 0 },
  };
  for (let index = 0; index < count; index += 1) {
    const trialSeed = deriveBatchSeed(rootSeed, index);
    let battleCount = 0, maxRoundHitCount = 0, failedBattleId: string | undefined;
    let failedBattleSeed: number | undefined, failureReason: TrajectoryObservation["failureReason"];
    try {
      const trial = executeScenario !== runThreeQueueScenario ? executeScenario({ ...base, seed: trialSeed })
        : runObservedQueueScenario({...base,seed:trialSeed},(duel)=>{
          battleCount++;
          if(duel.endReason==="roundLimit")maxRoundHitCount++;
          if(duel.endReason==="roundLimit"||duel.bothSidesEliminated){failedBattleId=duel.battleId;failedBattleSeed=duel.battleSeed;
            failureReason=duel.endReason==="roundLimit"?"roundLimit":"simultaneousElimination";}
        });
      trajectories.push({seed:trialSeed,outcome:trial.winner,battleCount:trial.totalBattles,
        remainingQueuesA:trial.remainingAttackerQueues.length,remainingQueuesB:trial.remainingDefenderQueues.length,maxRoundHitCount});
      schedulerSample ??= { trialSeed, audit: trial.scenarioTrace.threeQueueScheduler };
      if (trial.winner === "A") attackerWins += 1;
      else defenderWins += 1;
      totalBattles += trial.totalBattles;
      remainingQueuesA += trial.remainingAttackerQueues.length;
      remainingQueuesB += trial.remainingDefenderQueues.length;
      survivorsA += trial.remainingAttackerQueues.reduce((sum, queue) => sum +
        TROOP_TYPES.reduce((amount, troop) => amount + queue.survivors[troop], 0), 0);
      survivorsB += trial.remainingDefenderQueues.reduce((sum, queue) => sum +
        TROOP_TYPES.reduce((amount, troop) => amount + queue.survivors[troop], 0), 0);
      for (const side of ["A", "B"] as const) {
        for (const category of ["loss", "injured", "lightlyWounded"] as const) {
          categories[category][side] += trial.aggregateCasualties[side].total[category];
        }
      }
    } catch (error) {
      if (!(error instanceof ThreeQueueUnresolvedError)) throw error;
      failedTrials += 1;
      failedTrialSeeds.push(trialSeed);
      trajectories.push({seed:trialSeed,outcome:"failed",battleCount,remainingQueuesA:0,remainingQueuesB:0,maxRoundHitCount,
        failureReason:failureReason??"unknown",...(failedBattleId===undefined?{}:{failedBattleId}),
        ...(failedBattleSeed===undefined?{}:{failedBattleSeed})});
    }
    if ((index + 1) % 25 === 0 || index + 1 === count) {
      onProgress?.(index + 1, count);
    }
  }
  const completedTrials = attackerWins + defenderWins;
  const mean = (total: number): number => completedTrials === 0 ? 0 : total / completedTrials;
  return {
    schedulerStatistics: summarizeTrajectoryScheduler(trajectories),
    battleScenario: input.scenarioType ?? "THREE_QUEUE",
    innerEarthMode: input.scenarioType === "INNER_EARTH" ? input.innerEarth!.subMode : null,
    threeQueueMode, schedulerType: threeQueueSchedulerType(threeQueueMode), schedulerSample,
    simulationCount: count, simulationMode, rootSeed,
    firstTrialSeed: deriveBatchSeed(rootSeed, 0),
    lastTrialSeed: deriveBatchSeed(rootSeed, count - 1),
    attackerWins, defenderWins, failedTrials, failedTrialSeeds,
    attackerWinRate: attackerWins / count,
    defenderWinRate: defenderWins / count,
    completedTrials,
    averageBattleCount: mean(totalBattles),
    avgAttackerRemainingQueues: mean(remainingQueuesA),
    avgDefenderRemainingQueues: mean(remainingQueuesB),
    avgAttackerSurvivors: mean(survivorsA),
    avgDefenderSurvivors: mean(survivorsB),
    averageLoss: { A: mean(categories.loss.A), B: mean(categories.loss.B) },
    averageInjured: { A: mean(categories.injured.A), B: mean(categories.injured.B) },
    averageLightlyWounded: {
      A: mean(categories.lightlyWounded.A), B: mean(categories.lightlyWounded.B),
    },
  };
}

function secureRandomUint32(): number {
  if (typeof crypto === "undefined" || crypto.getRandomValues === undefined) {
    throw new Error("Random batch mode requires crypto.getRandomValues.");
  }
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
