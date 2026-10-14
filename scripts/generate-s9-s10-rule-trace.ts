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
const defender = {
  ...side,
  heroes: [{ heroId: "hero.s4.lingnai", position: "leader" as const }],
};
const dodge = "hero-skill.lingnai.swift-shadow-dance";
const scenarios = [
  {
    id: "s9-confirmed-main-attack-attempts-20260927",
    sideA: { ...side, heroes: [
      { heroId: "hero.s9.magenusi", position: "leader" as const },
      { heroId: "hero.s9.fuleide", position: "leader" as const },
      { heroId: "hero.s9.xiula", position: "leader" as const },
    ] },
    sideB: defender,
    maxRounds: 5,
    overrides: {
      [`B:${dodge}`]: false,
      [`2:B:marksman:${dodge}`]: true,
      [`4:B:lancer:${dodge}`]: true,
      "1:A:shield:hero-skill.magenusi.steel-phalanx": true,
    },
  },
  {
    id: "s10-confirmed-hit-and-natural-round-20260927",
    sideA: { ...side, heroes: [
      { heroId: "hero.s10.gregory", position: "leader" as const },
      { heroId: "hero.s10.freya", position: "leader" as const },
      { heroId: "hero.s10.blanchette", position: "leader" as const },
    ] },
    sideB: defender,
    maxRounds: 6,
    overrides: {
      [`B:${dodge}`]: false,
      [`1:B:lancer:${dodge}`]: true,
      [`3:B:marksman:${dodge}`]: true,
      "1:A:shield:hero-skill.gregory.steel-phalanx": true,
      "2:A:lancer:hero-skill.freya.crescent-scythe": true,
    },
  },
] as const;

for (const [index, scenario] of scenarios.entries()) {
  const { overrides, ...battle } = scenario;
  const seed = 20260927 + index;
  const result = runPureTroopBattleScenario(battle, {
    randomSource: createSeededRandomSource(seed),
    heroTriggerOverrides: overrides,
  });
  console.log(`scenario=${scenario.id}, seed=${seed}, level=${troopLevel}`);
  console.log("最终战报输入模式；100盾/矛/射；指定回合闪避及触发；合成示例，非真实游戏战报。");
  console.log(result.readableTrace);
  console.log(`rounds=${result.simulation.rounds.length}, endReason=${result.simulation.endReason}`);
}
