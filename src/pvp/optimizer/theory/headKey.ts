import { TROOP_TYPES } from "../../types";
import type { RallyCandidate } from "../types";
export function headLineupKey(head: RallyCandidate["leaderHeroIds"]): string {
  return TROOP_TYPES.map((troop) => head[troop] ?? "").join("|");
}
