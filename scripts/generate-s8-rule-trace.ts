import {
  createSeededRandomSource,
  getTroopConstant,
  runPureTroopBattleScenario,
} from "../src/index";

const troopLevel = "T10-FC10";
const troopConstant = getTroopConstant(troopLevel);
const troop = (count: number, damageCoefficient: number, attack = .5) => ({
  count, attack, penetration: .5, defense: .5, life: .5,
  troopLevel, troopConstant, damageCoefficient,
});
const scenario = {
  id: "s8-confirmed-timing-and-kB-20260927",
  sideA: {
    shield: troop(0, 1), lancer: troop(100, 3), marksman: troop(100, 4),
    heroes: [
      { heroId: "hero.s8.suoniya", position: "leader" },
      { heroId: "hero.s8.hengdelike", position: "leader" },
    ],
    attributeInputMode: "finalReport",
  },
  sideB: {
    shield: troop(100, 1, 6.519), lancer: troop(0, 3), marksman: troop(0, 4),
    heroes: [{ heroId: "hero.s8.jiatuo", position: "leader" }],
    attributeInputMode: "finalReport",
  },
  maxRounds: 10,
} as const;
const seed = 20260927;
const result = runPureTroopBattleScenario(scenario, {
  randomSource: createSeededRandomSource(seed),
});
console.log(`scenario=${scenario.id}, seed=${seed}, level=${troopLevel}`);
console.log("A=索妮娅矛100+亨德里克射100；B=加托盾100，战报攻击+651.9%；英雄远征技能默认Lv5。合成示例，非真实游戏战报。");
console.log(result.readableTrace);
console.log(`rounds=${result.simulation.rounds.length}, endReason=${result.simulation.endReason}`);
