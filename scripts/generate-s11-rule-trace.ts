import {
  createSeededRandomSource,
  getTroopConstant,
  runPureTroopBattleScenario,
} from "../src/index";

const troopLevel = "T10-FC10";
const troopConstant = getTroopConstant(troopLevel);
const troop = (count: number, damageCoefficient: number) => ({
  count, attack: .5, penetration: .5, defense: .5, life: 1000,
  troopLevel, troopConstant, damageCoefficient,
});
const side = {
  shield: troop(100, 1), lancer: troop(100, 3), marksman: troop(100, 4),
  attributeInputMode: "finalReport" as const,
};
const dodge = "hero-skill.lingnai.swift-shadow-dance";
const blast = "hero-skill.rufus.violent-blast";
const ingenuity = "hero-skill.lloyd.endless-ingenuity";
const scenario = {
  id: "s11-confirmed-attempt-hit-and-round-cycle-20260927",
  sideA: { ...side, heroes: [
    { heroId: "hero.s11.eleonora", position: "leader" as const },
    { heroId: "hero.s11.lloyd", position: "leader" as const },
    { heroId: "hero.s11.rufus", position: "leader" as const },
  ] },
  sideB: { ...side, heroes: [
    { heroId: "hero.s4.lingnai", position: "leader" as const },
  ] },
  ambushTriggered: { A: true },
  maxRounds: 7,
} as const;
const seed = 20260927;
const result = runPureTroopBattleScenario(scenario, {
  randomSource: createSeededRandomSource(seed),
  heroTriggerOverrides: {
    [`B:${dodge}`]: false,
    [`1:B:marksman:${dodge}`]: true,
    [`5:B:shield:${dodge}`]: true,
    [`A:${blast}`]: false,
    [`1:A:shield:${blast}`]: true,
    [`1:A:lancer:${blast}`]: true,
    [`2:A:shield:${blast}`]: true,
    [`A:${ingenuity}`]: false,
    [`1:A:${ingenuity}`]: true,
    [`3:A:${ingenuity}`]: true,
  },
});
console.log(`scenario=${scenario.id}, seed=${seed}, level=${troopLevel}`);
console.log("S11 三英雄对玲奈；指定闪避和概率触发；最终战报输入模式；合成示例，非真实游戏战报。");
console.log(result.readableTrace);
console.log(`rounds=${result.simulation.rounds.length}, endReason=${result.simulation.endReason}`);
