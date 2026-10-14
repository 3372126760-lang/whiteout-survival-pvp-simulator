import { TROOP_TYPES, type TroopType } from "../types/combat";
import { ceilProportional } from "../strategies/proportionalAllocation";

export type PostBattleCasualtyMode = "NORMAL" | "FURNACE";
export type TroopPopulation = Readonly<Record<TroopType, number>>;

export interface PostBattleCasualtyLine {
  readonly initial: number;
  readonly survivors: number;
  readonly exited: number;
  readonly loss: number;
  readonly injured: number;
  readonly lightlyWounded: number;
  /** Game report definition: loss + injured. */
  readonly defeated: number;
}

export interface PostBattleCasualtyResult {
  readonly mode: PostBattleCasualtyMode;
  readonly byTroop: Readonly<Record<TroopType, PostBattleCasualtyLine>>;
  readonly total: PostBattleCasualtyLine;
  /** Present when the battle retained troop-level composition. */
  readonly byGrade?: Readonly<Record<TroopType, readonly (PostBattleCasualtyLine & {
    readonly level: string;
    /** Sum of independently rounded categories minus original population. */
    readonly roundingDifference: number;
  })[]>>;
  /** Grade column sums minus conserved troop totals; can be negative when capped. */
  readonly gradeRoundingDifference?: Readonly<Record<TroopType, PostBattleCasualtyLine>>;
}

export type PostBattleGradeComposition = Readonly<Record<TroopType,
  readonly { readonly level: string; readonly initial: number; readonly survivors: number }[]>>;

const RATIOS = {
  NORMAL: [0, 35, 65],
  FURNACE: [35, 10, 55],
} as const;

/** Post-battle classification; never changes battle HP or troop depletion. */
export function resolvePostBattleCasualties(
  initial: TroopPopulation,
  survivors: TroopPopulation,
  mode: PostBattleCasualtyMode,
  grades?: PostBattleGradeComposition,
): PostBattleCasualtyResult {
  const exited = TROOP_TYPES.map((troop) => {
    const start = initial[troop];
    const end = survivors[troop];
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < 0 || end > start) {
      throw new RangeError(`Invalid ${troop} initial/survivor population.`);
    }
    return start - end;
  });
  const totalExited = exited.reduce((sum, count) => sum + count, 0);
  if (!Number.isSafeInteger(totalExited)) throw new RangeError("Exited population exceeds safe integer range.");
  const totalInitial = TROOP_TYPES.reduce((sum, troop) => sum + initial[troop], 0);
  const totalSurvivors = TROOP_TYPES.reduce((sum, troop) => sum + survivors[troop], 0);
  if (!Number.isSafeInteger(totalInitial) || !Number.isSafeInteger(totalSurvivors)) {
    throw new RangeError("Total population exceeds safe integer range.");
  }
  const [lossTotal, injuredTotal] = allocateProportional(totalExited,
    RATIOS[mode], RATIOS[mode].map(() => totalExited));
  const losses = allocateProportional(lossTotal!, exited, exited);
  const remaining = exited.map((count, index) => count - losses[index]!);
  const injured = allocateProportional(injuredTotal!, exited, remaining);
  const byTroop = Object.fromEntries(TROOP_TYPES.map((troop, index) => {
    const line = makeLine(initial[troop], survivors[troop],
      losses[index]!, injured[index]!);
    return [troop, line];
  })) as unknown as PostBattleCasualtyResult["byTroop"];
  const byGrade = grades === undefined ? undefined : Object.fromEntries(TROOP_TYPES.map((troop) => {
    const entries = grades[troop];
    entries.forEach((entry) => {
      if (!entry.level || !Number.isSafeInteger(entry.initial) ||
        !Number.isSafeInteger(entry.survivors) || entry.initial < 0 ||
        entry.survivors < 0 || entry.survivors > entry.initial) {
        throw new RangeError(`Invalid ${troop} grade composition.`);
      }
    });
    if (new Set(entries.map((entry) => entry.level)).size !== entries.length ||
      entries.reduce((sum, entry) => sum + entry.initial, 0) !== initial[troop] ||
      entries.reduce((sum, entry) => sum + entry.survivors, 0) !== survivors[troop]) {
      throw new RangeError(`Grade composition does not match ${troop} population.`);
    }
    const column = (total: number, entry: typeof entries[number]) =>
      Math.min(entry.initial, ceilProportional(total, entry.initial, initial[troop]));
    return [troop, entries.map((entry) => {
      const loss = column(byTroop[troop].loss, entry);
      const injured = column(byTroop[troop].injured, entry);
      const lightlyWounded = column(byTroop[troop].lightlyWounded, entry);
      const survivors = entry.survivors === 0 ? 0 : column(byTroop[troop].survivors, entry);
      const exited = loss + injured + lightlyWounded;
      return { level: entry.level, initial: entry.initial, loss, injured, lightlyWounded,
        survivors, exited, defeated: loss + injured,
        roundingDifference: exited + survivors - entry.initial };
    })];
  })) as unknown as PostBattleCasualtyResult["byGrade"];
  const gradeRoundingDifference = byGrade === undefined ? undefined :
    Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      Object.fromEntries(Object.keys(byTroop[troop]).map((key) => {
        const category = key as keyof PostBattleCasualtyLine;
        return [category, byGrade[troop].reduce((sum, line) => sum + line[category], 0) -
          byTroop[troop][category]];
      }))])) as unknown as PostBattleCasualtyResult["gradeRoundingDifference"];
  return {
    mode,
    byTroop,
    total: makeLine(totalInitial, totalSurvivors, lossTotal!, injuredTotal!),
    ...(byGrade === undefined ? {} : { byGrade }),
    ...(gradeRoundingDifference === undefined ? {} : { gradeRoundingDifference }),
  };
}

function makeLine(initial: number, survivors: number,
  loss: number, injured: number): PostBattleCasualtyLine {
  const exited = initial - survivors;
  return {
    initial, survivors, exited, loss, injured,
    lightlyWounded: exited - loss - injured,
    defeated: loss + injured,
  };
}

/** Largest remainder with row capacities and stable input-order ties. */
function allocateProportional(total: number,
  weights: readonly number[], capacities: readonly number[]): number[] {
  if (weights.length !== capacities.length || total < 0 ||
    total > capacities.reduce((sum, value) => sum + value, 0)) {
    throw new RangeError("Invalid proportional allocation capacity.");
  }
  const denominator = weights.reduce((sum, value) => sum + value, 0);
  if (denominator === 0) return weights.map(() => 0);
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
    if (!progressed) throw new Error("Unable to allocate casualties.");
  }
  return rows.sort((a, b) => a.index - b.index).map((row) => row.count);
}
