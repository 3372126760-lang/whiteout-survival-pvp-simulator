import type { ValidationBattleInput } from "../validationUi/types";
import type { SideId } from "../types/combat";
import type { ThreeQueueOptimizationState } from "./threeQueueOptimizer";

export type EnemyPermutationMode = "fixedCurrent" | "allPermutations" | "worstCase";
export type QueueOrder = readonly [number, number, number];
export const ICE_FIRE_QUEUE_ORDERS: readonly QueueOrder[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];
export function enemyQueueOrders(mode: EnemyPermutationMode): readonly QueueOrder[] {
  return mode === "fixedCurrent" ? ICE_FIRE_QUEUE_ORDERS.slice(0, 1) : ICE_FIRE_QUEUE_ORDERS;
}
export function permuteIceFireInput(input: ValidationBattleInput, side: SideId, order: QueueOrder): ValidationBattleInput {
  const key = side === "A" ? "sideA" : "sideB", queues = input[key].threeQueues;
  if (!queues) throw new Error("换位要求完整三队配置。");
  return { ...input, [key]: { ...input[key], queueOrder: order.map((index) => input[key].queueOrder?.[index] ?? index),
    threeQueues: order.map((index) => queues[index]!) } };
}
/** Move the complete source queue, not just its searched head and ratio. */
export function permuteIceFireState(state: ThreeQueueOptimizationState, order: QueueOrder): ThreeQueueOptimizationState {
  return { queues: order.map((index) => ({ ...state.queues[index]!,
    sourceQueueIndex: state.queues[index]!.sourceQueueIndex ?? index })) as unknown as ThreeQueueOptimizationState["queues"] };
}
export interface PermutationMetric {
  readonly order: QueueOrder;
  readonly trials: number;
  readonly wins: number;
  readonly failedTrials: number;
  readonly winRate: number;
}
export function permutationMetrics(rows: readonly PermutationMetric[]) {
  if (!rows.length) throw new Error("排列评价不能为空。");
  const sorted = [...rows].sort((a, b) => a.winRate - b.winRate || a.order.join().localeCompare(b.order.join()));
  return { currentOrderWinRate: rows[0]!.winRate,
    averagePermutationWinRate: rows.reduce((sum, row) => sum + row.winRate, 0) / rows.length,
    worstPermutationWinRate: sorted[0]!.winRate, worstEnemyOrder: sorted[0]!.order,
    bestEnemyOrder: sorted.at(-1)!.order, permutationResults: rows };
}
export function comparePermutationMetrics(a: ReturnType<typeof permutationMetrics>, b: ReturnType<typeof permutationMetrics>) {
  return b.worstPermutationWinRate - a.worstPermutationWinRate || b.averagePermutationWinRate - a.averagePermutationWinRate ||
    b.currentOrderWinRate - a.currentOrderWinRate;
}
