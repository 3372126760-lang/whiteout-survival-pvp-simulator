import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createSeededRandomSource,
  getTroopConstant,
  runPureTroopBattleScenario,
} from "../src/index";

const troopLevel = "T10-FC10";
const troopConstant = getTroopConstant(troopLevel);
const troop = (damageCoefficient: number) => ({
  count: 300, attack: .5, penetration: .5, defense: .5, life: 1000,
  troopLevel, troopConstant, damageCoefficient,
});
const side = {
  shield: troop(1), lancer: troop(3), marksman: troop(4),
  attributeInputMode: "finalReport" as const,
};
const seed = 20260927;
const traces = [
  { id: "s12-ligeia-shared-pool", heroId: "hero.s12.ligeia", maxRounds: 3 },
  { id: "s16-aishilin-periodic-targets", heroId: "hero.s16.aishilin", maxRounds: 3 },
  { id: "s13-vulcanus-one-use-token", heroId: "hero.s13.vulcanus", maxRounds: 7 },
  { id: "s14-elif-next-round-shield", heroId: "hero.s14.elif", maxRounds: 2 },
].map(({ id, heroId, maxRounds }) => {
  const scenario = {
    id, sideA: { ...side, heroes: [{ heroId, position: "leader" as const }] },
    sideB: side, maxRounds,
  };
  const result = runPureTroopBattleScenario(scenario, {
    randomSource: createSeededRandomSource(seed),
  });
  return [
    `scenario=${scenario.id}, seed=${seed}, level=${troopLevel}`,
    result.readableTrace,
    `rounds=${result.simulation.rounds.length}, endReason=${result.simulation.endReason}`,
  ].join("\n");
});
const output = [
  "S12 丽姬娅、S13 乌尔卡努斯、S14 艾丽芙与 S16 艾诗琳的独立合成 BattleTrace；所有 S12+ 规则均为 provisional / inferredFromPriorGenerations，非真实游戏战报。",
  ...traces,
  "",
].join("\n\n");
const outputPath = fileURLToPath(new URL("../s12_s16_rule_trace.txt", import.meta.url));
writeFileSync(outputPath, output, "utf8");
console.log(`Wrote ${outputPath}`);
