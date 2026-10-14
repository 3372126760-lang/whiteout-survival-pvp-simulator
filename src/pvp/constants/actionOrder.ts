import type { ActionSlot } from "../types/combat";

/**
 * Phase-one deterministic event order. Both sides still use the same round-start
 * snapshot, so this order cannot cause early casualties.
 */
export const DEFAULT_ACTION_ORDER = [
  { side: "A", troop: "shield" },
  { side: "B", troop: "shield" },
  { side: "A", troop: "lancer" },
  { side: "B", troop: "lancer" },
  { side: "A", troop: "marksman" },
  { side: "B", troop: "marksman" },
] as const satisfies readonly ActionSlot[];
