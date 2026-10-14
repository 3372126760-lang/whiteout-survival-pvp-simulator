import type { TroopLevelData } from "../types/troop";

/** Explicit confirmed checkpoints. No inferred levels or precision chains. */
export const TROOP_LEVEL_CONSTANTS = Object.freeze({
  T1: 1, T2: 1.5, T3: 2.1, T4: 2.73, T5: 3.276,
  T6: 3.8657, T7: 4.5615, T8: 5.3826, T9: 6.3514, T10: 7.4947,
  "T10-FC1": 7.7945, "T10-FC2": 8.1842,
  "T10-FC3": 8.5934, "T10-FC4": 9.0231,
  "T10-FC5": 9.4742, "T10-FC6": 9.8532,
  "T10-FC7": 10.3459, "T10-FC8": 10.8632,
  "T10-FC9": 11.4063, "T10-FC10": 11.9766,
  "T11-FC3": 10.1402, "T11-FC4": 10.6472,
  "T11-FC5": 11.1796, "T11-FC6": 11.6268,
  "T11-FC7": 12.2081, "T11-FC8": 12.8185,
  "T11-FC9": 13.4595, "T11-FC10": 14.1324,
  "T12-FC7": 14.4056, "T12-FC8": 15.1259,
  "T12-FC9": 15.8822, "T12-FC10": 16.6763,
});

export type TroopLevelId = keyof typeof TROOP_LEVEL_CONSTANTS;
export const SUPPORTED_TROOP_LEVELS: readonly TroopLevelId[] =
  Object.freeze(Object.keys(TROOP_LEVEL_CONSTANTS) as TroopLevelId[]);
export const TROOP_LEVEL_DATA: readonly TroopLevelData[] = Object.freeze(
  SUPPORTED_TROOP_LEVELS.map((id) => Object.freeze({
    id, troopConstant: TROOP_LEVEL_CONSTANTS[id],
  })),
);

/** Catalog successors skip levels that do not exist, including T11-FC1/2. */
export const NEXT_AVAILABLE_TROOP_LEVEL: Readonly<Record<TroopLevelId, TroopLevelId | null>> =
  Object.freeze(Object.fromEntries(SUPPORTED_TROOP_LEVELS.map((id, index) =>
    [id, SUPPORTED_TROOP_LEVELS[index + 1] ?? null])) as Record<TroopLevelId, TroopLevelId | null>);

export function isSupportedTroopLevel(level: string): level is TroopLevelId {
  return Object.prototype.hasOwnProperty.call(TROOP_LEVEL_CONSTANTS, level);
}

export function getTroopConstant(troopLevel: string): number {
  if (!isSupportedTroopLevel(troopLevel)) {
    throw new Error(`Unsupported troop level: ${troopLevel}.`);
  }
  return TROOP_LEVEL_CONSTANTS[troopLevel];
}

/** Custom non-game fixture levels retain an explicit C; invalid game levels fail. */
export function resolveTroopConstant(troopLevel: string, customLevelConstant: number): number {
  if (isSupportedTroopLevel(troopLevel) || /^T\d/i.test(troopLevel.trim())) {
    return getTroopConstant(troopLevel);
  }
  return customLevelConstant;
}
