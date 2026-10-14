export const TROOP_TYPES = ["shield", "lancer", "marksman"] as const;
export type TroopType = (typeof TROOP_TYPES)[number];

export const SIDE_IDS = ["A", "B"] as const;
export type SideId = (typeof SIDE_IDS)[number];

/** Confirmed PVP deployment contexts used by scene-specific hero weapons. */
export type BattleContext =
  | "unspecified"
  | "challenge"
  | "rally"
  | "rallyAttack"
  | "rallyDefense"
  | "garrisonDefense";

/**
 * Normal UI rally semantics: A is the rally attacker; B receives both
 * rally-defense and garrison-defense scene skills. Legacy explicit contexts
 * remain supported for developer fixtures and backwards compatibility.
 */
export function isBattleContextAllowedForSide(
  allowed: readonly BattleContext[] | undefined,
  context: BattleContext,
  side: SideId,
): boolean {
  if (allowed === undefined) return true;
  if (context !== "rally") return allowed.includes(context);
  return side === "A"
    ? allowed.includes("rallyAttack")
    : allowed.includes("rallyDefense") || allowed.includes("garrisonDefense");
}

export type DamageType = "normalAttack" | "skillDamage";
export type DamageSubtype = DamageType | "extraDamage";

export interface ActionSlot {
  readonly side: SideId;
  readonly troop: TroopType;
}

export function otherSide(side: SideId): SideId {
  return side === "A" ? "B" : "A";
}
