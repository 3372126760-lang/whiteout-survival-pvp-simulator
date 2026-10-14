import type { TroopType } from "../types/combat";
import { TROOP_TYPE_DATA } from "./troopTypes";

/** Confirmed K_i^damage data. It is data, not part of the formula implementation. */
export const TROOP_DAMAGE_COEFFICIENTS = {
  shield: TROOP_TYPE_DATA.shield.damageCoefficient,
  lancer: TROOP_TYPE_DATA.lancer.damageCoefficient,
  marksman: TROOP_TYPE_DATA.marksman.damageCoefficient,
} as const satisfies Readonly<Record<TroopType, number>>;
