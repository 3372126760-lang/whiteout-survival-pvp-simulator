import { TROOP_TYPES, type TroopType } from "../types/combat";
import { requireExpeditionHeroData } from "./data";
import { calculateExclusiveWeaponBaseStats } from "./data";

export interface HeroStatLineupEntry {
  readonly heroId: string;
  readonly weaponLevel?: number;
}

export type HeroStatLineupInput = string | HeroStatLineupEntry;

export interface HeroStatVector {
  readonly attack: number;
  readonly defense: number;
  readonly penetration: number;
  readonly life: number;
}

export type HeroStatContribution = Readonly<Record<TroopType, HeroStatVector>>;

export interface HeroStatCorrection {
  readonly reportHeroIds: readonly string[];
  readonly simulationHeroIds: readonly string[];
  readonly reportHeroContribution: HeroStatContribution;
  readonly simulationHeroContribution: HeroStatContribution;
  readonly reportWeaponContribution: HeroStatContribution;
  readonly simulationWeaponContribution: HeroStatContribution;
  readonly reportTotalContribution: HeroStatContribution;
  readonly simulationTotalContribution: HeroStatContribution;
  /** simulation contribution minus report contribution. */
  readonly delta: HeroStatContribution;
}

export function calculateHeroStatCorrection(
  reportHeroes: readonly HeroStatLineupInput[],
  simulationHeroes: readonly HeroStatLineupInput[],
): HeroStatCorrection {
  const normalizedReport = reportHeroes.map(normalizeLineupEntry);
  const normalizedSimulation = simulationHeroes.map(normalizeLineupEntry);
  const reportHeroIds = normalizedReport.map((entry) => entry.heroId);
  const simulationHeroIds = normalizedSimulation.map((entry) => entry.heroId);
  const reportHeroContribution = sumExpeditionHeroStats(reportHeroIds);
  const simulationHeroContribution = sumExpeditionHeroStats(simulationHeroIds);
  const reportWeaponContribution = sumExclusiveWeaponStats(normalizedReport);
  const simulationWeaponContribution = sumExclusiveWeaponStats(normalizedSimulation);
  const reportTotalContribution = addContributions(
    reportHeroContribution,
    reportWeaponContribution,
  );
  const simulationTotalContribution = addContributions(
    simulationHeroContribution,
    simulationWeaponContribution,
  );
  return {
    reportHeroIds: [...reportHeroIds],
    simulationHeroIds: [...simulationHeroIds],
    reportHeroContribution,
    simulationHeroContribution,
    reportWeaponContribution,
    simulationWeaponContribution,
    reportTotalContribution,
    simulationTotalContribution,
    delta: mapContribution((troop) => ({
      attack:
        simulationTotalContribution[troop].attack -
        reportTotalContribution[troop].attack,
      defense:
        simulationTotalContribution[troop].defense -
        reportTotalContribution[troop].defense,
      penetration:
        simulationTotalContribution[troop].penetration -
        reportTotalContribution[troop].penetration,
      life:
        simulationTotalContribution[troop].life -
        reportTotalContribution[troop].life,
    })),
  };
}

export function sumExclusiveWeaponStats(
  heroes: readonly HeroStatLineupEntry[],
): HeroStatContribution {
  const unique = new Set<string>();
  const mutable = emptyContribution();
  for (const entry of heroes) {
    if (unique.has(entry.heroId)) {
      throw new Error(`Duplicate hero in weapon stat lineup: ${entry.heroId}.`);
    }
    unique.add(entry.heroId);
    const hero = requireExpeditionHeroData(entry.heroId);
    const weapon = calculateExclusiveWeaponBaseStats(
      entry.heroId,
      entry.weaponLevel ?? 0,
    );
    mutable[hero.stats.troopType].penetration += weapon.penetrationBonus;
    mutable[hero.stats.troopType].life += weapon.lifeBonus;
  }
  return mutable;
}

export function sumExpeditionHeroStats(
  heroIds: readonly string[],
): HeroStatContribution {
  const unique = new Set<string>();
  const mutable = emptyContribution();
  for (const heroId of heroIds) {
    if (unique.has(heroId)) throw new Error(`Duplicate hero in stat lineup: ${heroId}.`);
    unique.add(heroId);
    const stats = requireExpeditionHeroData(heroId).stats;
    const current = mutable[stats.troopType];
    current.attack += stats.attackBonus;
    current.defense += stats.defenseBonus;
    current.penetration += stats.penetrationBonus;
    current.life += stats.lifeBonus;
  }
  return mutable;
}

function emptyContribution(): Record<TroopType, {
  attack: number;
  defense: number;
  penetration: number;
  life: number;
}> {
  return Object.fromEntries(
    TROOP_TYPES.map((troop) => [troop, {
      attack: 0,
      defense: 0,
      penetration: 0,
      life: 0,
    }]),
  ) as Record<TroopType, {
    attack: number;
    defense: number;
    penetration: number;
    life: number;
  }>;
}

function mapContribution(
  mapper: (troop: TroopType) => HeroStatVector,
): HeroStatContribution {
  return Object.fromEntries(
    TROOP_TYPES.map((troop) => [troop, mapper(troop)]),
  ) as unknown as HeroStatContribution;
}

function normalizeLineupEntry(input: HeroStatLineupInput): HeroStatLineupEntry {
  return typeof input === "string" ? { heroId: input, weaponLevel: 0 } : input;
}

function addContributions(
  left: HeroStatContribution,
  right: HeroStatContribution,
): HeroStatContribution {
  return mapContribution((troop) => ({
    attack: left[troop].attack + right[troop].attack,
    defense: left[troop].defense + right[troop].defense,
    penetration: left[troop].penetration + right[troop].penetration,
    life: left[troop].life + right[troop].life,
  }));
}
