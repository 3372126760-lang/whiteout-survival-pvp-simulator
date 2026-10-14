export * from "./lancer";
export * from "./marksman";
export * from "./shield";

import { SHIELD_TROOP_SKILL_DEFINITIONS } from "./shield";
import { LANCER_TROOP_SKILL_DEFINITIONS } from "./lancer";
import { MARKSMAN_TROOP_SKILL_DEFINITIONS } from "./marksman";

export const CONFIRMED_TROOP_SKILL_DEFINITIONS = [
  ...SHIELD_TROOP_SKILL_DEFINITIONS,
  ...LANCER_TROOP_SKILL_DEFINITIONS,
  ...MARKSMAN_TROOP_SKILL_DEFINITIONS,
] as const;
