import type { TroopLevelCompositionEntry } from "../types/troop";
import { allocateConservedPopulation, ceilProportional } from "./proportionalAllocation";

export interface MixedLevelCasualtyAllocationEntry {
  readonly level: string;
  readonly aliveCountBefore: number;
  readonly exactProportionalDeaths: number;
  readonly deaths: number;
  readonly aliveCountAfter: number;
  /** Independent ceiling values for the level report, not extra battle deaths. */
  readonly ceilingDeaths: number;
  readonly ceilingAliveCountAfter: number;
}

export interface MixedLevelCasualtyAllocationResult {
  readonly strategyId: string;
  readonly ruleUnknown?: "mixedLevelCasualtyIntegerAllocation";
  readonly totalDeaths: number;
  readonly roundingDifference: { readonly deaths: number; readonly survivors: number };
  readonly allocations: readonly MixedLevelCasualtyAllocationEntry[];
  readonly levelCompositionAfter: readonly TroopLevelCompositionEntry[];
}

export interface MixedLevelCasualtyAllocationStrategy {
  readonly id: string;
  readonly provisional: boolean;
  readonly ruleUnknown?: "mixedLevelCasualtyIntegerAllocation";
  readonly allocate: (
    composition: readonly TroopLevelCompositionEntry[],
    totalDeaths: number,
    initialComposition?: readonly TroopLevelCompositionEntry[],
  ) => MixedLevelCasualtyAllocationResult;
}

/**
 * RULE_UNKNOWN: mixedLevelCasualtyIntegerAllocation.
 * Confirmed proportional split, with a provisional deterministic largest-
 * remainder tie-breaker (original composition order) for integer conservation.
 */
export const PROVISIONAL_PROPORTIONAL_LARGEST_REMAINDER:
  MixedLevelCasualtyAllocationStrategy = {
    id: "provisional-proportional-largest-remainder",
    provisional: true,
    ruleUnknown: "mixedLevelCasualtyIntegerAllocation",
    allocate(composition, totalDeaths) {
      if (!Number.isSafeInteger(totalDeaths) || totalDeaths < 0) {
        throw new RangeError("totalDeaths must be a non-negative safe integer.");
      }
      const totalAlive = composition.reduce(
        (sum, entry) => sum + entry.aliveCount,
        0,
      );
      if (totalDeaths > totalAlive) {
        throw new RangeError("Mixed-level deaths cannot exceed alive troops.");
      }
      if (composition.length === 0) {
        throw new Error("Cannot allocate casualties to an empty composition.");
      }
      const work = composition.map((entry, index) => {
        const exact = totalAlive === 0
          ? 0
          : totalDeaths * entry.aliveCount / totalAlive;
        const deaths = Math.min(entry.aliveCount, Math.floor(exact));
        return { entry, index, exact, deaths, remainder: exact - deaths };
      });
      let remaining = totalDeaths - work.reduce(
        (sum, entry) => sum + entry.deaths,
        0,
      );
      const order = [...work].sort(
        (left, right) => right.remainder - left.remainder || left.index - right.index,
      );
      for (const entry of order) {
        if (remaining === 0) break;
        if (entry.deaths < entry.entry.aliveCount) {
          entry.deaths += 1;
          remaining -= 1;
        }
      }
      if (remaining !== 0) {
        throw new Error("Mixed-level casualty allocation failed to conserve deaths.");
      }
      const allocations = work.map(({ entry, exact, deaths }) => ({
        level: entry.level,
        aliveCountBefore: entry.aliveCount,
        exactProportionalDeaths: exact,
        deaths,
        aliveCountAfter: entry.aliveCount - deaths,
        ceilingDeaths: deaths,
        ceilingAliveCountAfter: entry.aliveCount - deaths,
      }));
      return {
        strategyId: this.id,
        ruleUnknown: "mixedLevelCasualtyIntegerAllocation",
        totalDeaths,
        roundingDifference: { deaths: 0, survivors: 0 },
        allocations,
        levelCompositionAfter: allocations.map((entry) => ({
          level: entry.level,
          aliveCount: entry.aliveCountAfter,
        })),
      };
    },
  };

/**
 * Confirmed original-ratio ceiling in report fields. Internal integer population
 * uses a conserved projection of the ORIGINAL weights, capped by current counts.
 * The projection is bookkeeping, not a claim about the game's rounding tie rule.
 */
export const CONFIRMED_INITIAL_RATIO_CEILING: MixedLevelCasualtyAllocationStrategy = {
  id: "confirmed-initial-ratio-ceiling",
  provisional: false,
  allocate(composition, totalDeaths, initialComposition = composition) {
    const initial = new Map(initialComposition.map((entry) => [entry.level, entry.aliveCount]));
    if (composition.length === 0 || initial.size !== initialComposition.length ||
      initial.size !== composition.length || new Set(composition.map((entry) => entry.level)).size !== composition.length ||
      composition.some((entry) => !initial.has(entry.level) ||
        !Number.isSafeInteger(entry.aliveCount) || entry.aliveCount < 0 ||
        entry.aliveCount > initial.get(entry.level)!)) {
      throw new RangeError("Invalid current/initial mixed-level composition.");
    }
    const totalAlive = composition.reduce((sum, entry) => sum + entry.aliveCount, 0);
    const totalInitial = initialComposition.reduce((sum, entry) => sum + entry.aliveCount, 0);
    if (!Number.isSafeInteger(totalAlive) || !Number.isSafeInteger(totalInitial) ||
      !Number.isSafeInteger(totalDeaths) || totalDeaths < 0 || totalDeaths > totalAlive) {
      throw new RangeError("Mixed-level deaths cannot exceed alive troops.");
    }
    const remaining = totalAlive - totalDeaths;
    const weights = composition.map((entry) => initial.get(entry.level)!);
    const survivors = allocateConservedPopulation(remaining, weights,
      composition.map((entry) => entry.aliveCount));
    const allocations = composition.map((entry, index) => ({
      level: entry.level,
      aliveCountBefore: entry.aliveCount,
      exactProportionalDeaths: totalInitial === 0 ? 0 : totalDeaths * weights[index]! / totalInitial,
      deaths: entry.aliveCount - survivors[index]!,
      aliveCountAfter: survivors[index]!,
      ceilingDeaths: Math.min(entry.aliveCount, ceilProportional(totalDeaths, weights[index]!, totalInitial)),
      ceilingAliveCountAfter: Math.min(entry.aliveCount,
        ceilProportional(remaining, weights[index]!, totalInitial)),
    }));
    return {
      strategyId: this.id, totalDeaths, allocations,
      roundingDifference: {
        deaths: allocations.reduce((sum, entry) => sum + entry.ceilingDeaths, 0) - totalDeaths,
        survivors: allocations.reduce((sum, entry) => sum + entry.ceilingAliveCountAfter, 0) - remaining,
      },
      levelCompositionAfter: allocations.map((entry) => ({
        level: entry.level, aliveCount: entry.aliveCountAfter,
      })),
    };
  },
};
