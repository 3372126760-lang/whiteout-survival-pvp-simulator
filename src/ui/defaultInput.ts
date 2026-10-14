import type {
  ExternalBuffConfig,
  TroopType,
  ValidationBattleInput,
  ValidationSideInput,
  ValidationTroopInput,
} from "../pvp";

export function createDefaultValidationInput(): ValidationBattleInput {
  return {
    serverStage: "s11",
    sideA: sideInput(12_000, 240),
    sideB: sideInput(12_000, 220),
    postBattleCasualtyMode: "NORMAL",
    maxRounds: 1500,
    randomSeed: 12_345,
    battleContext: "challenge",
    simulationMode: "fixedSeed",
    attributeInputMode: "finalReport",
    triggerOverrides: {},
    disabledSkillIds: [],
    actualRounds: [],
  };
}

function sideInput(count: number, baseStat: number): ValidationSideInput {
  return {
    troops: Object.fromEntries(
      (["shield", "lancer", "marksman"] as const).map((troop) => [
        troop,
        troopInput(count, baseStat, troop),
      ]),
    ) as unknown as Readonly<Record<TroopType, ValidationTroopInput>>,
    reportHeroIds: [],
    reportHeroByTroop: { shield: null, lancer: null, marksman: null },
    reportWeaponLevels: {},
    leaderHeroId: null,
    leaderHeroIds: { shield: null, lancer: null, marksman: null },
    selectedMemberSkillIds: [],
    simulationWeaponLevels: {},
    externalBuffs: externalBuffs(),
    rallyDeployment: {
      totalTroops: count * 3,
      ratios: { shield: 34, lancer: 33, marksman: 33 },
    },
    threeQueues: [
      { ratios: { shield: 50, lancer: 20, marksman: 30 }, leaderHeroIds: {} },
      { ratios: { shield: 33, lancer: 33, marksman: 34 }, leaderHeroIds: {} },
      { ratios: { shield: 10, lancer: 20, marksman: 70 }, leaderHeroIds: {} },
    ],
  };
}

function externalBuffs(): ExternalBuffConfig {
  return {
    town: {
      attack: "none",
      defense: "none",
      penetration: "none",
      life: "none",
      enemyAttackReduction: "none",
      enemyDefenseReduction: "none",
    },
    pet: {
      attackLevel: 0,
      defenseLevel: 0,
      penetrationLevel: 0,
      lifeLevel: 0,
      enemyDefenseReductionLevel: 0,
      enemyPenetrationReductionLevel: 0,
      enemyLifeReductionLevel: 0,
    },
    expert: { garethFourthSkillLevel: 0 },
  };
}

function troopInput(
  count: number,
  baseStat: number,
  troop: TroopType,
): ValidationTroopInput {
  return {
    count,
    attack: baseStat,
    defense: baseStat,
    penetration: baseStat,
    life: baseStat,
    troopLevel: troop === "marksman" ? "T10-FC10" : "T10-FC8",
    levelMode: "single",
    t12Level: 0,
  };
}
