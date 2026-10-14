import {
  createSeededRandomSource,
  getTroopConstant,
  runPureTroopBattleScenario,
  type PureTroopScenarioSideInput,
} from "../src/index";

const troopLevel = "T10-FC10";
const troopConstant = getTroopConstant(troopLevel);
const emptyTroop = {
  count: 0, attack: 0, penetration: 0, defense: 0, life: 0,
  troopLevel, troopConstant, damageCoefficient: 1,
};

function side(heroId: string, reportAttack: number): PureTroopScenarioSideInput {
  return {
    shield: { ...emptyTroop, count: 1, attack: reportAttack,
      penetration: 0.1, defense: 0.1, life: 0.1 },
    lancer: { ...emptyTroop, damageCoefficient: 3 },
    marksman: { ...emptyTroop, damageCoefficient: 4 },
    heroes: [{ heroId, position: "leader" }],
    attributeInputMode: "finalReport",
  };
}

const scenario = {
  id: "gatot-received-reduction-20260927",
  sideA: side("hero.sr.baxiti", 0.1),
  sideB: side("hero.s8.jiatuo", 6.519),
  maxRounds: 2,
} as const;
const seed = 20260927;
const result = runPureTroopBattleScenario(scenario, {
  randomSource: createSeededRandomSource(seed),
});

console.log(`scenario=${scenario.id}, seed=${seed}, troopLevel=${troopLevel}, Ct=${troopConstant}`);
console.log("A=巴希提盾兵1，B=加托盾兵1，B战报攻击+651.9%，英雄远征技能默认Lv5；合成示例，非真实游戏战报。");
console.log(result.readableTrace);
