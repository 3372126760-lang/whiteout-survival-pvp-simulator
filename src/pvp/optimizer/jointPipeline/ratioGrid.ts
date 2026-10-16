import type { RallyTroopRatios } from "../../validationUi";
import { TROOP_TYPES } from "../../types";
export interface RatioBounds { min: readonly number[]; max: readonly number[]; }
export function localRatioBounds(center: RallyTroopRatios, radius: number, outer?: RatioBounds): RatioBounds {
  return { min: TROOP_TYPES.map((t, i) => Math.max(0, center[t] - radius, outer?.min[i] ?? 0)),
    max: TROOP_TYPES.map((t, i) => Math.min(100, center[t] + radius, outer?.max[i] ?? 100)) };
}
/** Lattice is anchored at 0, never at a fractional J peak. All three axes are bounded. */
export function localRatioGrid(center: RallyTroopRatios, radius: number, step: 1 | 5, outer?: RatioBounds): RallyTroopRatios[] {
  const { min, max } = localRatioBounds(center, radius, outer), result: RallyTroopRatios[] = [];
  for (let shield = Math.ceil((min[0]! - 1e-9) / step) * step; shield <= max[0]! + 1e-9; shield += step)
    for (let lancer = Math.ceil((min[1]! - 1e-9) / step) * step; lancer <= max[1]! + 1e-9; lancer += step) {
      const marksman = 100 - shield - lancer;
      if (marksman >= min[2]! - 1e-9 && marksman <= max[2]! + 1e-9) result.push({ shield, lancer, marksman });
    }
  return result;
}
