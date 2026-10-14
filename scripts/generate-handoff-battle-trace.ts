import {
  createSeededRandomSource,
  getTroopConstant,
  runPureTroopBattleScenario,
  type PureTroopScenarioSideInput,
} from "../src/index";

const seed = 20260926;
const troopLevel = "T12-FC10";
const troopConstant = getTroopConstant(troopLevel);

function side(
  counts: readonly [number, number, number],
  stat: number,
  heroes: NonNullable<PureTroopScenarioSideInput["heroes"]>,
): PureTroopScenarioSideInput {
  const troop = (count: number, damageCoefficient: number) => ({
    count,
    attack: stat,
    penetration: stat,
    defense: stat,
    life: stat,
    troopLevel,
    troopConstant,
    damageCoefficient,
    t12Level: 24,
  });
  return {
    shield: troop(counts[0], 1),
    lancer: troop(counts[1], 3),
    marksman: troop(counts[2], 4),
    heroes,
  };
}

const scenario = {
  id: "pvp-handoff-complete-battle-20260926",
  sideA: side([20, 18, 16], 0.8, [
    { heroId: "hero.sr.baxiti", position: "leader" },
    { heroId: "hero.body.shuyun", position: "member", selectedMemberSkillId: "hero-skill.shuyun.attack" },
  ]),
  sideB: side([10, 9, 8], 0.1, [
    { heroId: "hero.sr.xieergai", position: "leader" },
  ]),
  maxRounds: 30,
} as const;

const result = runPureTroopBattleScenario(scenario, {
  randomSource: createSeededRandomSource(seed),
});

console.log(`scenario=${scenario.id}`);
console.log(`seed=${seed}, level=${troopLevel}, t12Level=24, maxRounds=${scenario.maxRounds}`);
console.log("A: shield=20 lancer=18 marksman=16, attack/penetration/defense/life=0.8, leader=巴希提, member=书允·攻击");
console.log("B: shield=10 lancer=9 marksman=8, attack/penetration/defense/life=0.1, leader=谢尔盖");
console.log("All percentages above are engine input decimals. This is a synthetic scenario, not a game battle report.");
console.log(result.readableTrace);
for (const [sideId, sideState] of [["A", result.simulation.finalState.sideA], ["B", result.simulation.finalState.sideB]] as const) {
  console.log(`FINAL ${sideId}: shield=${sideState.troops.shield.aliveCount}, lancer=${sideState.troops.lancer.aliveCount}, marksman=${sideState.troops.marksman.aliveCount}`);
}
console.log(`rounds=${result.simulation.rounds.length}, endReason=${result.simulation.endReason}`);
