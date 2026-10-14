import type { TroopType } from "../types/combat";

export const DEFAULT_TARGET_PRIORITY = [
  "shield",
  "lancer",
  "marksman",
] as const satisfies readonly TroopType[];

export const LANCER_SURPRISE_TARGET_PRIORITY = [
  "marksman",
  "shield",
  "lancer",
] as const satisfies readonly TroopType[];
