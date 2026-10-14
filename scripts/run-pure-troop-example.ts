import {
  getTroopConstant,
  runPureTroopBattleScenario,
  type PureTroopScenarioSideInput,
} from "../src/index";

const side = (
  shield: number,
  lancer: number,
  marksman: number,
  attack: number,
  penetration: number,
  defense: number,
  life: number,
): PureTroopScenarioSideInput => ({
  shield: {
    count: shield,
    attack,
    penetration,
    defense,
    life,
    troopLevel: "T6",
    troopConstant: getTroopConstant("T6"),
    damageCoefficient: 1,
  },
  lancer: {
    count: lancer,
    attack,
    penetration,
    defense,
    life,
    troopLevel: "T6",
    troopConstant: getTroopConstant("T6"),
    damageCoefficient: 3,
  },
  marksman: {
    count: marksman,
    attack,
    penetration,
    defense,
    life,
    troopLevel: "T6",
    troopConstant: getTroopConstant("T6"),
    damageCoefficient: 4,
  },
});

const result = runPureTroopBattleScenario({
  id: "no-hero-audit-demo",
  sideA: side(120, 80, 100, 0.2, 0.15, 0.15, 0.1),
  sideB: side(110, 100, 90, 0.18, 0.12, 0.2, 0.08),
  maxRounds: 3,
  ambushTriggered: false,
});

console.log(result.readableTrace);
