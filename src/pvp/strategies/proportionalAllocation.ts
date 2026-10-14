/** Exact integer arithmetic avoids accidental ceil(x + floating-point error). */
export function ceilProportional(total: number, weight: number, basis: number): number {
  for (const value of [total, weight, basis]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("Proportional inputs must be non-negative safe integers.");
    }
  }
  if (basis === 0) {
    if (total !== 0 || weight !== 0) throw new RangeError("Empty proportional basis.");
    return 0;
  }
  if (weight > basis) throw new RangeError("Weight exceeds proportional basis.");
  return Number((BigInt(total) * BigInt(weight) + BigInt(basis) - 1n) / BigInt(basis));
}

/** Internal population bookkeeping only; reports use independent ceiling. */
export function allocateConservedPopulation(total: number,
  weights: readonly number[], capacities: readonly number[]): number[] {
  if (weights.length !== capacities.length || !Number.isSafeInteger(total) || total < 0 ||
    [...weights, ...capacities].some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError("Invalid proportional population inputs.");
  }
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  const capacity = capacities.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(denominator) || !Number.isSafeInteger(capacity) || total > capacity) {
    throw new RangeError("Invalid proportional population capacity.");
  }
  if (denominator === 0) {
    if (total !== 0) throw new RangeError("Empty proportional population basis.");
    return weights.map(() => 0);
  }
  const basis = BigInt(denominator);
  const rows = weights.map((weight, index) => {
    const product = BigInt(total) * BigInt(weight);
    return { index, count: Math.min(Number(product / basis), capacities[index]!),
      remainder: product % basis };
  });
  let left = total - rows.reduce((sum, row) => sum + row.count, 0);
  const priority = [...rows].sort((a, b) => a.remainder === b.remainder
    ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  while (left > 0) {
    let progressed = false;
    for (const row of priority) {
      if (left === 0) break;
      if (row.count >= capacities[row.index]!) continue;
      row.count += 1;
      left -= 1;
      progressed = true;
    }
    if (!progressed) throw new Error("Unable to conserve proportional population.");
  }
  return rows.map((row) => row.count);
}
