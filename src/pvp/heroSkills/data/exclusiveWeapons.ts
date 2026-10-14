import { requireExpeditionHeroData } from "./expeditionHeroes";

export interface ExclusiveWeaponBaseStats {
  readonly level: number;
  readonly penetrationBonus: number;
  readonly lifeBonus: number;
}

export function calculateExclusiveWeaponBaseStats(
  heroId: string,
  level: number,
): ExclusiveWeaponBaseStats {
  validateExclusiveWeaponLevel(level);
  const weapon = requireExpeditionHeroData(heroId).exclusiveWeapon;
  if (weapon === undefined) {
    if (level === 0) return { level, penetrationBonus: 0, lifeBonus: 0 };
    throw new Error(`Hero ${heroId} has no confirmed exclusive weapon data.`);
  }
  return {
    level,
    penetrationBonus: weapon.maxPenetrationBonus * level / 10,
    lifeBonus: weapon.maxLifeBonus * level / 10,
  };
}

export function getExclusiveWeaponSkillTier(level: number): 0 | 1 | 2 | 3 | 4 | 5 {
  validateExclusiveWeaponLevel(level);
  if (level < 2) return 0;
  if (level < 4) return 1;
  if (level < 6) return 2;
  if (level < 8) return 3;
  if (level < 10) return 4;
  return 5;
}

export function validateExclusiveWeaponLevel(level: number): void {
  if (!Number.isSafeInteger(level) || level < 0 || level > 10) {
    throw new RangeError("Exclusive weapon level must be an integer from 0 to 10.");
  }
}
