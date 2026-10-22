import { createPureTroopBattleState, getTroopConstant, type PureTroopBattleScenario } from "../../../pvp";

export const GREG = "hero.s3.gelaige";
export const LAW = "hero-skill.gelaige.law-deterrence";
export const SWORD = "hero-skill.gelaige.sword-of-justice";
export const GREG_LAW_SEED = 20261016;

/** Mechanism fixture, NOT the original report's missing complete canonical input.
 * Known report panels/counts/constants are retained. Missing attack/penetration/defense
 * are explicitly zero; synthetic life=1e9 keeps all three stacks alive for 1500 rounds.
 * No weapons/buffs/T12; Greg and Gato ordinary skills plus shield counter run.
 * Gato Lv5 is an explicit fixture choice (the report did not preserve his levels).
 * Other troop skills are isolated out to make each normal damage oracle unambiguous.
 */
export const gregLaw1500Scenario: PureTroopBattleScenario = {
  id: "greg-law-current-target-1500-v1", maxRounds: 1500, battleContext: "rallyAttack",
  sideA: {
    attributeInputMode: "finalReport", heroes: [{ heroId: GREG, position: "leader", weaponLevel: 0 }],
    shield: troop(0, "T10-FC7", 1),
    lancer: { ...troop(100, "T10-FC7", 3), defense: 7.548 },
    marksman: troop(0, "T10-FC7", 4),
  },
  sideB: {
    attributeInputMode: "finalReport", heroes: [{ heroId: "hero.s8.jiatuo", position: "leader", weaponLevel: 0 }],
    shield: { ...troop(1, "T11-FC10", 1), attack: 12.424, penetration: 4.482 },
    lancer: { ...troop(1, "T10-FC7", 3), attack: 6.215, penetration: 3.793 },
    marksman: troop(0, "T10-FC7", 4),
  },
};

export function gregLaw1500State() {
  const state = createPureTroopBattleState(gregLaw1500Scenario);
  const isolate = (side: typeof state.sideA) => ({ ...side, troops: {
    shield: { ...side.troops.shield, skillStates: side.troops.shield.skillStates.filter((s) => s.skillId === "shield-dense-formation") },
    lancer: { ...side.troops.lancer, skillStates: [] },
    marksman: { ...side.troops.marksman, skillStates: [] },
  } });
  return { ...state, sideA: isolate(state.sideA), sideB: isolate(state.sideB) };
}

function troop(count: number, troopLevel: string, damageCoefficient: number) {
  return { count, troopLevel, troopConstant: getTroopConstant(troopLevel), damageCoefficient,
    attack: 0, penetration: 0, defense: 0, life: 1_000_000_000, t12Level: 0 };
}
