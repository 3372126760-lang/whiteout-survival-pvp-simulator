import type { TroopType } from "../types/combat";
import type { TroopTypeData } from "../types/troop";

/** Type coefficients are fixed, independent of tier and fire crystal level. */
export const TROOP_TYPE_DATA = Object.freeze({
  shield: Object.freeze({ damageCoefficient: 1, lifeCoefficient: 300 }),
  lancer: Object.freeze({ damageCoefficient: 3, lifeCoefficient: 100 }),
  marksman: Object.freeze({ damageCoefficient: 4, lifeCoefficient: 75 }),
}) satisfies Readonly<Record<TroopType, TroopTypeData>>;
