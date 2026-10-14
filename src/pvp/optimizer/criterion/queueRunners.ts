import { deriveBatchSeed } from "../../validationUi/batchSimulation";
import type { ValidationBattleInput } from "../../validationUi/types";
import type { SideId } from "../../types/combat";
import type { ThreeQueueOptimizationState } from "../threeQueueOptimizer";
import { createCriterionThreeQueueEvaluator } from "./threeQueue";
import { enemyQueueOrders, permuteIceFireState, type EnemyPermutationMode } from "../iceFirePermutations";
export function IceFireThreeQueueCriterionRunner(input: ValidationBattleInput, kernel: "criterion" | "theory" = "criterion") {
  return createCriterionThreeQueueEvaluator({ ...input, threeQueueMode: "ICE_FIRE_LEAGUE" }, kernel);
}

/** Criterion and DeterministicTheory evaluate the same opponent order domain. */
export function samplePermutationCriterion(runner: ReturnType<typeof createCriterionThreeQueueEvaluator>,
  candidate: ThreeQueueOptimizationState, enemy: ThreeQueueOptimizationState, side: SideId, seed: number, count: number, mode: EnemyPermutationMode) {
  const results = enemyQueueOrders(mode).map((order) => ({ order,
    sample: sampleQueueCriterion(runner, candidate, permuteIceFireState(enemy, order), side, seed, count) }));
  const current = results[0]!.sample;
  const worst = [...results].sort((a, b) => a.sample.estimatedWinProbability - b.sample.estimatedWinProbability ||
    a.sample.meanRemainingTroops - b.sample.meanRemainingTroops)[0]!.sample;
  return { ...worst, estimatedWinProbability: worst.estimatedWinProbability,
    criterionCurrent: current.estimatedWinProbability,
    criterionAverage: results.reduce((sum, row) => sum + row.sample.estimatedWinProbability, 0) / results.length,
    criterionWorst: worst.estimatedWinProbability, permutationCount: results.length, permutations: results };
}
export function ThreeQueueRandomCriterionRunner(input: ValidationBattleInput, kernel: "criterion" | "theory" = "criterion") {
  return createCriterionThreeQueueEvaluator({ ...input, scenarioType: "THREE_QUEUE", threeQueueMode: "EARTH_HEART_BRAVE_LAND" }, kernel);
}
export function sampleQueueCriterion(runner: ReturnType<typeof createCriterionThreeQueueEvaluator>,
  candidate: ThreeQueueOptimizationState, enemy: ThreeQueueOptimizationState, side: SideId, seed: number, count: number) {
  let wins = 0, remaining = 0, twoQueueFinishes = 0, uncertainty = 0;
  const matchSequenceSamples: string[][] = [];
  for (let index = 0; index < count; index++) {
    const result = side === "A" ? runner.run(candidate, enemy, deriveBatchSeed(seed, index)) : runner.run(enemy, candidate, deriveBatchSeed(seed, index));
    const own = side === "A" ? result.remainingA : result.remainingB;
    wins += Number(result.winner === side); remaining += own.flat().reduce((sum, value) => sum + value, 0);
    twoQueueFinishes += Number(own.filter((queue) => queue.some((value) => value > 0)).length >= 2);
    uncertainty += result.uncertainty;
    if (matchSequenceSamples.length < 3 && !matchSequenceSamples.some((sample) => sample.join() === result.matchSequence.join())) matchSequenceSamples.push([...result.matchSequence]);
  }
  return { estimatedWinProbability: wins / count, meanRemainingTroops: remaining / count,
    twoQueueFinishRate: twoQueueFinishes / count, uncertainty: uncertainty / count, matchSequenceSamples };
}
