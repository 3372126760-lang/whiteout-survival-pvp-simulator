import { TROOP_TYPES, type TroopType } from "../types/combat";

export interface RallyTroopRatios {
  readonly shield: number;
  readonly lancer: number;
  readonly marksman: number;
}

export interface RallyDeploymentInput {
  readonly totalTroops: number;
  readonly ratios: RallyTroopRatios;
}

export type RallyTroopCounts = Readonly<Record<TroopType, number>>;

/** Mirrored from the neighboring bear model's deterministic ratio allocator. */
export const TROOP_RATIO_SUM_EPSILON = .005;

/** Largest remainder; equal remainders use shield -> lancer -> marksman. */
export function allocateRallyTroopsByRatio(
  input: RallyDeploymentInput,
): RallyTroopCounts {
  if (!Number.isSafeInteger(input.totalTroops) || input.totalTroops < 0) {
    throw new RangeError("集结总兵力必须是非负安全整数。");
  }
  const ratios = TROOP_TYPES.map((troop) => input.ratios[troop]);
  for (const [index, ratio] of ratios.entries()) {
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 100) {
      throw new RangeError(`${TROOP_TYPES[index]} 比例必须位于 0% 到 100%。`);
    }
  }
  const ratioTotal = ratios.reduce((sum, ratio) => sum + ratio, 0);
  if (Math.abs(ratioTotal - 100) > TROOP_RATIO_SUM_EPSILON) {
    throw new RangeError(
      `盾/矛/射比例之和必须为 100.00%，当前为 ${ratioTotal.toFixed(2)}%。`,
    );
  }
  const { units } = toCommonDecimalUnits(ratios);
  const ratioSum = units.reduce((sum, value) => sum + value, 0n);
  const total = BigInt(input.totalTroops);
  const allocations = units.map((ratio, index) => ({
    index,
    count: total * ratio / ratioSum,
    remainder: total * ratio % ratioSum,
  }));
  const allocated = allocations.reduce((sum, entry) => sum + entry.count, 0n);
  const remainderOrder = [...allocations].sort((left, right) =>
    left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1
  );
  const remaining = Number(total - allocated);
  for (let index = 0; index < remaining; index += 1) {
    remainderOrder[index]!.count += 1n;
  }
  return {
    shield: Number(allocations[0]!.count),
    lancer: Number(allocations[1]!.count),
    marksman: Number(allocations[2]!.count),
  };
}

function toCommonDecimalUnits(values: readonly number[]): {
  readonly units: readonly bigint[];
} {
  const parts = values.map((value) => {
    const [mantissa = "0", exponentText] = value.toString().toLowerCase().split("e");
    const exponent = exponentText === undefined ? 0 : Number(exponentText);
    const [integer = "0", fraction = ""] = mantissa.split(".");
    let coefficient = BigInt(`${integer}${fraction}`.replace(/^0+(?=\d)/, "") || "0");
    let places = fraction.length - exponent;
    if (places < 0) {
      coefficient *= 10n ** BigInt(-places);
      places = 0;
    }
    return { coefficient, places };
  });
  const commonPlaces = parts.reduce((maximum, part) =>
    Math.max(maximum, part.places), 0
  );
  return {
    units: parts.map((part) =>
      part.coefficient * 10n ** BigInt(commonPlaces - part.places)
    ),
  };
}
