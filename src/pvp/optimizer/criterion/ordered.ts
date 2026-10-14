/** Ordered lifetime integral. No square outside the bracket (PDF 5.21). */
export function orderedLifetimePotential(output: readonly number[], survival: readonly number[],
  order: readonly number[] = [0, 2, 1]): number {
  let front = 0, total = 0;
  for (const i of order) { total += output[i]! * (front + 2 / 3 * survival[i]!); front += survival[i]!; }
  return total;
}
export function sqrtIntegralAverage(x0: number, x1: number): number {
  if (x0 < 0 || x1 < 0) throw new RangeError("Remaining proportions must be nonnegative.");
  return Math.abs(x0 - x1) < 1e-12 ? Math.sqrt(x0) : 2 / 3 * (x0 ** 1.5 - x1 ** 1.5) / (x0 - x1);
}
/** Independent event integrator for the lifetime-output regression, not a mutual battle. */
export function integrateOrderedLifetime(output: readonly number[], survival: readonly number[],
  order: readonly number[] = [0, 2, 1]): number {
  let value = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!; if (survival[i]! <= 0) continue;
    value += output[i]! * sqrtIntegralAverage(1, 0) * survival[i]!;
    for (let j = k + 1; j < order.length; j++) value += output[order[j]!]! * survival[i]!;
  }
  return value;
}
