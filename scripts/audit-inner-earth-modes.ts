import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { INNER_EARTH_MODES, createDefaultInnerEarthConfig, normalizeInnerEarthInput,
  materializeInnerEarthInput, auditInnerEarthInput, innerEarthIsThreeQueue,
  innerEarthEnemyCounts, type InnerEarthConfig, type InnerEarthMode } from "../src/pvp/innerEarth";
import { TROOP_TYPES } from "../src/pvp/types";
import { createValidationPreviewState, runValidationBattle,
  runValidationThreeQueueScenario, toValidationThreeQueueConfig } from "../src/pvp/validationUi";
import { runThreeQueueScenario } from "../src/pvp/scenario";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function makeInput(mode: InnerEarthMode, index: number) {
  const base = createDefaultValidationInput();
  const config = createDefaultInnerEarthConfig(base, mode);
  const queues = config.ally.queues.map((queue, slot) => ({ ...queue,
    ratio: [{ shield: 50, lancer: 20, marksman: 30 }, { shield: 20, lancer: 30, marksman: 50 },
      { shield: 10, lancer: 50, marksman: 40 }][slot]!,
    expectedReportStats: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      { attack: 10000 + slot * 1000, defense: 10000, penetration: 10000, life: 10000 }])) as typeof queue.expectedReportStats,
  })) as unknown as InnerEarthConfig["ally"]["queues"];
  return normalizeInnerEarthInput({ ...base, maxRounds: 2, randomSeed: 771 + index }, {
    ...config, ally: { ...config.ally, shared: { capacity: 90 }, queues,
      counts: { shield: 45, lancer: 18, marksman: 27 },
      troopTiers: mode === "UNDERGROUND_LAB"
        ? { shield: "T10", lancer: "LAB_T11", marksman: "LAB_T12" }
        : { shield: "T10", lancer: "T10", marksman: "T10" },
      t12SkillLevels: { shield: 0, lancer: 0, marksman: mode === "UNDERGROUND_LAB" ? 3 : 0 } },
    enemy: { ...config.enemy, shared: { ...config.enemy.shared,
      // A one-soldier foe gives both queue activities conclusive official duels
      // within two rounds. Fixed-150k modes retain their required real capacity.
      capacity: innerEarthIsThreeQueue(mode) ? 1 : 90,
      troopRatioPreset: index % 2 === 0 ? "BALANCED" : "SHIELD_HEAVY" } },
    ...(mode === "HEART_OF_EARTH" ? { petContext: { ...config.petContext!, attackLevel: 3 } } : {}),
  });
}

const modeAudits = INNER_EARTH_MODES.map((mode, index) => {
  const input = makeInput(mode, index), original = structuredClone(input);
  const derived = materializeInnerEarthInput(input), audit = auditInnerEarthInput(input);
  const expectedEnemy = innerEarthEnemyCounts(input.innerEarth!.enemy.shared.capacity,
    input.innerEarth!.enemy.shared.troopRatioPreset);
  const enemyCounts = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, derived.sideB.troops[troop].count]));
  assert.deepEqual(enemyCounts, expectedEnemy);
  if (innerEarthIsThreeQueue(mode)) {
    const engineConfig = toValidationThreeQueueConfig(input), actual = runValidationThreeQueueScenario(input);
    assert.equal(actual.scenarioTrace.threeQueueScheduler.schedulerType, "RandomAliveQueueScheduler");
    assert.ok(engineConfig.defender.queues.every((queue) => same(queue.initialTroopCounts, expectedEnemy)));
    assert.deepEqual(input, original);
    return { mode, audit, actualRun: { runner: "runValidationThreeQueueScenario", winner: actual.winner,
      totalBattles: actual.totalBattles, scheduler: actual.scenarioTrace.threeQueueScheduler,
      formalRoundCounts: actual.battleResults.map((battle) => battle.battle.simulation.rounds.length),
      battles: actual.scenarioTrace.battles },
      baseConfigUnchanged: true, baseReportStatsUnchanged: true,
      allyCapacityPerQueue: engineConfig.attacker.deploymentCapacity,
      allyQueueRatios: input.innerEarth!.ally.queues.map((queue) => queue.ratio),
      allyQueueBaseShieldAttacks: input.innerEarth!.ally.queues.map((queue) => queue.expectedReportStats.shield.attack),
      enemyCounts, expectedEnemyCounts: expectedEnemy,
      enemyQueueInitialCounts: engineConfig.defender.queues.map((queue) => queue.initialTroopCounts),
      enemySharedConfiguration: true, enemyTiers: derived.sideB.threeQueues!.map((queue) => queue.troopLevels),
      eligiblePet: input.innerEarth!.petContext ?? null };
  }
  const preview = createValidationPreviewState(input), actual = runValidationBattle(input);
  const laboratory = mode === "UNDERGROUND_LAB" ? Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
    userTier: input.innerEarth!.ally.troopTiers[troop], troopConstant: preview.sideA.troops[troop].troopConstant,
    skillRuntimes: preview.sideA.troops[troop].skillStates,
    fireCrystalSkillPresent: preview.sideA.troops[troop].skillStates.some((runtime) =>
      /crystal|lightforged|crimson|flame-impact/.test(runtime.skillId)),
  }])) : null;
  if (laboratory !== null) {
    assert.equal(laboratory.lancer!.troopConstant, 8.8437);
    assert.equal(laboratory.marksman!.troopConstant, 10.4356);
    assert.ok(Object.values(laboratory).every((troop) => !troop.fireCrystalSkillPresent));
  }
  assert.equal(preview.sideA.heroStates.length, 0);
  assert.equal(preview.sideB.heroStates.length, 0);
  assert.deepEqual(input, original);
  return { mode, audit, actualRun: { runner: "runValidationBattle", outcome: actual.summary.outcome,
    rounds: actual.summary.rounds, remaining: actual.summary.remaining },
    baseConfigUnchanged: true, baseReportStatsUnchanged: true,
    emptyHead: true, allyInitialCounts: input.innerEarth!.ally.counts,
    enemyCounts, expectedEnemyCounts: expectedEnemy, laboratory };
});

// Reuse the proved real-engine fixture from run-three-queue-icefire-audit-round5.ts,
// now entering through the explicit scene while deliberately supplying the old
// random scheduler value to prove the scene cannot fall back to that scheduler.
const iceInput = { ...createDefaultValidationInput(), scenarioType: "ICE_FIRE_LEAGUE" as const,
  attributeInputMode: "prediction" as const, threeQueueMode: "EARTH_HEART_BRAVE_LAND" as const, randomSeed: 771 };
const base = toValidationThreeQueueConfig(iceInput);
const strengthen = (queue: typeof base.attacker.queues[number], strength: number) => ({
  ...queue, ratiosBp: { shield: 10000, lancer: 0, marksman: 0 },
  side: { ...queue.side, heroes: [], reportHeroIds: [], reportHeroes: [],
    shield: { ...queue.side.shield, attack: strength, defense: strength, penetration: strength, life: strength },
    lancer: { ...queue.side.lancer, attack: strength, defense: strength, penetration: strength, life: strength },
    marksman: { ...queue.side.marksman, attack: strength, defense: strength, penetration: strength, life: strength } },
});
const iceConfig = { ...base, maxRoundsPerBattle: 300,
  attacker: { ...base.attacker, deploymentCapacity: 90, queues: [strengthen(base.attacker.queues[0], 3),
    strengthen(base.attacker.queues[1], .01), strengthen(base.attacker.queues[2], .01)] as const },
  defender: { ...base.defender, deploymentCapacity: 90, queues: [strengthen(base.defender.queues[0], 1),
    strengthen(base.defender.queues[1], 2), strengthen(base.defender.queues[2], 2)] as const } };
const ice = runThreeQueueScenario(iceConfig), battles = ice.scenarioTrace.battles;
const inheritedSurvivors = {
  A1Round4EqualsRound1: same(battles[3]!.attackerBefore, battles[0]!.attackerAfter),
  A1Round5EqualsRound4: same(battles[4]!.attackerBefore, battles[3]!.attackerAfter),
  B2Round4EqualsRound2: same(battles[3]!.defenderBefore, battles[1]!.defenderAfter),
  B3Round5EqualsRound3: same(battles[4]!.defenderBefore, battles[2]!.defenderAfter),
};
assert.deepEqual(ice.scenarioTrace.threeQueueScheduler.matchSequence,
  ["A1-B1", "A2-B2", "A3-B3", "A1-B2", "A1-B3"]);
assert.ok(Object.values(inheritedSurvivors).every(Boolean));
assert.equal(ice.scenarioTrace.threeQueueScheduler.schedulerType, "IceFireLeagueScheduler");
assert.equal(ice.scenarioTrace.threeQueueScheduler.battleScenario, "ICE_FIRE_LEAGUE");

const output = { generatedAt: new Date().toISOString(), fixtureKind: "syntheticFormalBattleEngineRegression",
  note: "Synthetic fixtures verify configuration and execution, not historical game-report accuracy. Single fixtures intentionally stop after two rounds and can report timeout. Hero Land and fixed-150k modes retain their required capacities.",
  reproductionCommand: "node scripts/run-tsx.mjs scripts/audit-inner-earth-modes.ts",
  formalBattleEngineUsed: true, modes: modeAudits,
  exactEnemyPresetReferenceAt150000: { BALANCED: innerEarthEnemyCounts(150000, "BALANCED"),
    SHIELD_HEAVY: innerEarthEnemyCounts(150000, "SHIELD_HEAVY") },
  iceFire: { reusedFixtureSource: "scripts/run-three-queue-icefire-audit-round5.ts",
    suppliedLegacyScheduler: iceInput.threeQueueMode, scheduler: ice.scenarioTrace.threeQueueScheduler,
    randomSchedulerUsed: false, winner: ice.winner, totalBattles: ice.totalBattles,
    inheritedSurvivors, battles: battles.map((battle, index) => ({ ...battle,
      formalRoundCount: ice.battleResults[index]!.battle.simulation.rounds.length })) },
};
writeFileSync("examples/inner-earth-modes-audit.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ modes: modeAudits.length,
  allBaseStatsUnchanged: modeAudits.every((mode) => mode.baseReportStatsUnchanged),
  iceFireSequence: output.iceFire.scheduler.matchSequence,
  inheritedSurvivors, artifact: "examples/inner-earth-modes-audit.json" }));
