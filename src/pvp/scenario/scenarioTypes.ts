import { TROOP_TYPES, type TroopType } from "../types/combat";
import { SUPPORTED_TROOP_LEVELS } from "../troopSkills";

/** THREE_QUEUE is retained as an internal/legacy adapter value, not a public scene. */
export type BattleScenarioType = "SINGLE" | "CITY_DEFENSE" | "THREE_THREE_THREE" | "ICE_FIRE_LEAGUE" | "RALLY" | "INNER_EARTH" | "THREE_QUEUE";

export type TroopCounts = Readonly<Record<TroopType, number>>;

/** Exact 1:1:1 allocation. Fixed tie order: shield, lancer, marksman. */
export function allocateThreeThreeThree(capacity: number): TroopCounts {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError("出征容量必须是非负安全整数。");
  }
  const base = Math.floor(capacity / 3);
  const remainder = capacity % 3;
  return {
    shield: base + Number(remainder >= 1),
    lancer: base + Number(remainder >= 2),
    marksman: base,
  };
}

/** The player's configured unlock list bounds automatic level selection. */
export function highestConfiguredTroopLevel(levels: readonly string[]): string {
  if (levels.length === 0) throw new RangeError("至少配置一个已开放兵种等级。");
  const ranks = levels.map((level) => {
    const rank = SUPPORTED_TROOP_LEVELS.indexOf(level as typeof SUPPORTED_TROOP_LEVELS[number]);
    if (rank < 0) throw new RangeError(`未知兵种等级：${level}`);
    return rank;
  });
  return SUPPORTED_TROOP_LEVELS[Math.max(...ranks)]!;
}

export function totalTroops(counts: TroopCounts): number {
  return TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0);
}
