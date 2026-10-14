import type { TroopType } from "../types/combat";
import { TROOP_TYPE_DATA } from "./troopTypes";

/** Confirmed PVP single-unit HP coefficients. */
export const TROOP_HP_COEFFICIENTS: Readonly<Record<TroopType, number>> = {
  shield: TROOP_TYPE_DATA.shield.lifeCoefficient,
  lancer: TROOP_TYPE_DATA.lancer.lifeCoefficient,
  marksman: TROOP_TYPE_DATA.marksman.lifeCoefficient,
};
