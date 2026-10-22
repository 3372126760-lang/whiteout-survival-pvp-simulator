import { createDefaultValidationInput } from "../../../ui/defaultInput";
import type { ValidationBattleInput } from "../../validationUi/types";
import { TROOP_TYPES } from "../../types/combat";

export const POWDER = "marksman-crystal-powder";
export const LIGEIA_TWO = "hero-skill.ligeia.disintegrating-poison";
export const LIGEIA_THREE = "hero-skill.ligeia.venom-fang-assault";
export function ligeiaDamagePoolInput(powder: boolean, mode: "NORMAL" | "FURNACE" = "NORMAL"): ValidationBattleInput {
  const base = createDefaultValidationInput();
  return { ...base, serverStage: "s12", maxRounds: 2, randomSeed: 502926396,
    postBattleCasualtyMode: mode,
    triggerOverrides: { [POWDER]: powder ? "FORCE_TRIGGER" : "FORCE_NOT_TRIGGER",
      "marksman-rapid-fire": "FORCE_NOT_TRIGGER", "shield-crystal-shield": "FORCE_NOT_TRIGGER" },
    sideA: { ...base.sideA, leaderHeroIds: { marksman: "hero.s12.ligeia" },
      troops: Object.fromEntries(TROOP_TYPES.map((t) => [t, { ...base.sideA.troops[t], count: t === "marksman" ? 12000 : 0 }])) as typeof base.sideA.troops },
    sideB: { ...base.sideB, troops: Object.fromEntries(TROOP_TYPES.map((t) => [t,
      { ...base.sideB.troops[t], count: t === "shield" ? 12000 : 0 }])) as typeof base.sideB.troops } };
}
