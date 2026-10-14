import type { ValidationBattleInput } from "../pvp";
import { initializeOptimizationHeroPool } from "../pvp/optimizer/heroPools";
export const DEFAULT_OPTIMIZER_EXCLUSIVE_WEAPON_LEVEL = 10;
/** Optimizer levels never read or write the current battle's simulationWeaponLevels. */
export function initializeOptimizerWeaponLevels(input: ValidationBattleInput,
  _heroes: readonly { readonly heroId: string; readonly weaponMaxStat: number | null }[]): ValidationBattleInput {
  void _heroes; return initializeOptimizationHeroPool(input);
}
