import { TROOP_TYPES, type TroopType } from "../types/combat";
import type { RallyTroopRatios } from "../validationUi/rallyDeployment";
import type { TroopCounts } from "./scenarioTypes";

/** Manual entry permits hundredths of a percent; future search retains 1% steps. */
export const MANUAL_RATIO_BASIS_POINT_STEP = 1;
export const OPTIMIZER_RATIO_BASIS_POINT_STEP = 100;
export const TOTAL_RATIO_BASIS_POINTS = 10_000;

export type TroopRatioBasisPoints = Readonly<Record<TroopType, number>>;

/** Converts UI percentages to exact integer basis points and validates the sum. */
export function toThreeQueueBasisPoints(ratios: RallyTroopRatios): TroopRatioBasisPoints {
  const converted = Object.fromEntries(TROOP_TYPES.map((troop) => {
    const value = ratios[troop];
    const scaled = value * 100;
    const rounded = Math.round(scaled);
    if (!Number.isFinite(value) || value < 0 || value > 100 ||
      Math.abs(scaled - rounded) > 1e-8) {
      throw new RangeError(`${troop} 比例须为 0.00% 到 100.00%，步长 0.01%。`);
    }
    return [troop, rounded];
  })) as unknown as TroopRatioBasisPoints;
  if (TROOP_TYPES.reduce((sum, troop) => sum + converted[troop], 0) !==
    TOTAL_RATIO_BASIS_POINTS) {
    throw new RangeError("盾/矛/射比例总和必须为100.00%。");
  }
  return converted;
}

/** Largest remainder using integer basis points; ties follow shield, lancer, marksman. */
export function allocateThreeQueueTroops(capacity: number,
  basisPoints: TroopRatioBasisPoints): TroopCounts {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("单队列出征容量必须为正安全整数。");
  }
  const values = TROOP_TYPES.map((troop) => basisPoints[troop]);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 ||
    value > TOTAL_RATIO_BASIS_POINTS) ||
    values.reduce((sum, value) => sum + value, 0) !== TOTAL_RATIO_BASIS_POINTS) {
    throw new RangeError("盾/矛/射比例总和必须为100.00%。");
  }
  const denominator = BigInt(TOTAL_RATIO_BASIS_POINTS);
  const rows = values.map((value, index) => {
    const product = BigInt(capacity) * BigInt(value);
    return { index, count: product / denominator, remainder: product % denominator };
  });
  const leftover = Number(BigInt(capacity) - rows.reduce((sum, row) => sum + row.count, 0n));
  const priority = [...rows].sort((left, right) => left.remainder === right.remainder
    ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; index < leftover; index += 1) priority[index]!.count += 1n;
  return {
    shield: Number(rows[0]!.count),
    lancer: Number(rows[1]!.count),
    marksman: Number(rows[2]!.count),
  };
}
