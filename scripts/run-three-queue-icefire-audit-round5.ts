import { writeFileSync } from "node:fs";
import { runThreeQueueScenario, toValidationThreeQueueConfig } from "../src/pvp/index";
import { createDefaultValidationInput } from "../src/ui/defaultInput";

// Synthetic strengths exercise the confirmed five-match schedule. These are not
// the user's historical report attributes and do not claim a game-stat fit.
const base = toValidationThreeQueueConfig({ ...createDefaultValidationInput(),
  scenarioType: "THREE_QUEUE", attributeInputMode: "prediction",
  threeQueueMode: "ICE_FIRE_LEAGUE", randomSeed: 771 });
const strengthen = (queue: typeof base.attacker.queues[number], strength: number) => ({
  ...queue, ratiosBp: { shield: 10000, lancer: 0, marksman: 0 },
  side: { ...queue.side, heroes: [], reportHeroIds: [], reportHeroes: [],
    shield: { ...queue.side.shield, attack: strength, defense: strength, penetration: strength, life: strength },
    lancer: { ...queue.side.lancer, attack: strength, defense: strength, penetration: strength, life: strength },
    marksman: { ...queue.side.marksman, attack: strength, defense: strength, penetration: strength, life: strength } },
});
const selected = { ...base, maxRoundsPerBattle: 300,
  attacker: { ...base.attacker, deploymentCapacity: 90,
    queues: [strengthen(base.attacker.queues[0], 3), strengthen(base.attacker.queues[1], .01),
      strengthen(base.attacker.queues[2], .01)] as const },
  defender: { ...base.defender, deploymentCapacity: 90,
    queues: [strengthen(base.defender.queues[0], 1), strengthen(base.defender.queues[1], 2),
      strengthen(base.defender.queues[2], 2)] as const } };
const result = runThreeQueueScenario(selected);
const battles = result.scenarioTrace.battles;
const sameCounts = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const audit = {
  fixtureKind: "syntheticFormalBattleEngineRegression",
  disclaimer: "Synthetic fixture; not the user's war-report parameters or an accuracy fit.",
  reproductionCommand: "node scripts/run-tsx.mjs scripts/run-three-queue-icefire-audit-round5.ts",
  fixture: { seed: selected.seed, deploymentCapacityPerQueue: 90, ratios: "100/0/0",
    heroIds: [], attributeFactors: { A: [3, .01, .01], B: [1, 2, 2] },
    maxRoundsPerBattle: selected.maxRoundsPerBattle },
  formalBattleEngineUsed: true,
  scheduler: result.scenarioTrace.threeQueueScheduler,
  winner: result.winner, totalBattles: result.totalBattles,
  battles: battles.map((battle, index) => ({ ...battle,
    formalRoundCount: result.battleResults[index]!.battle.simulation.rounds.length,
    formalTraceGenerated: result.battleResults[index]!.battle.simulation.trace.rounds.length > 0 })),
  inheritedSurvivors: {
    A1Round4EqualsRound1: sameCounts(battles[3]!.attackerBefore, battles[0]!.attackerAfter),
    A1Round5EqualsRound4: sameCounts(battles[4]!.attackerBefore, battles[3]!.attackerAfter),
    B2Round4EqualsRound2: sameCounts(battles[3]!.defenderBefore, battles[1]!.defenderAfter),
    B3Round5EqualsRound3: sameCounts(battles[4]!.defenderBefore, battles[2]!.defenderAfter),
  },
  remaining: { A: result.remainingAttackerQueues, B: result.remainingDefenderQueues },
};
writeFileSync("examples/criterion-round5-icefire-audit.json", `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ matchSequence: audit.scheduler.matchSequence,
  winners: battles.map((battle) => battle.winner), inheritedSurvivors: audit.inheritedSurvivors }));
