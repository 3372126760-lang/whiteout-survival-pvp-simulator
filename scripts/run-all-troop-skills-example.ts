import {
  createSeededRandomSource,
  getTroopConstant,
  runPureTroopBattleScenario,
  type PureTroopScenarioSideInput,
} from "../src/index";

const side = (
  shield: number,
  lancer: number,
  marksman: number,
  stat: number,
): PureTroopScenarioSideInput => {
  const troop = (
    count: number,
    damageCoefficient: number,
  ) => ({
    count,
    attack: stat,
    penetration: stat,
    defense: stat,
    life: stat,
    troopLevel: "T12-FC10",
    troopConstant: getTroopConstant("T12-FC10"),
    damageCoefficient,
    t12Level: 24,
  });
  return {
    shield: troop(shield, 1),
    lancer: troop(lancer, 3),
    marksman: troop(marksman, 4),
  };
};

const result = runPureTroopBattleScenario(
  {
    id: "all-confirmed-troop-skills-demo",
    sideA: side(120, 100, 80, 0.2),
    sideB: side(110, 90, 100, 0.18),
    maxRounds: 6,
  },
  { randomSource: createSeededRandomSource(20260920) },
);

console.log(result.readableTrace);
