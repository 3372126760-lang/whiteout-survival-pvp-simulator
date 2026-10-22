import { getExpeditionHeroData } from "../pvp/heroSkills/data/expeditionHeroes";
import type { TroopType, ValidationSideInput } from "../pvp";

/** A newly selected equipped hero starts at the player's full-weapon default on either side.
 * Explicit custom levels, including zero, are authoritative; optimizer pool levels stay separate. */
export function selectSimulationHero(side: ValidationSideInput, troop: TroopType, heroId: string | null): ValidationSideInput {
  const equipped = heroId !== null && getExpeditionHeroData(heroId)?.exclusiveWeapon !== undefined;
  return { ...side, leaderHeroIds: { ...side.leaderHeroIds, [troop]: heroId },
    ...(heroId !== null && equipped ? { simulationWeaponLevels: {
      ...side.simulationWeaponLevels, [heroId]: side.simulationWeaponLevels?.[heroId] ?? 10,
    } } : {}),
  };
}
