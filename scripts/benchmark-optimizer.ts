import { performance } from "node:perf_hooks";
import {
  createEngineCandidateRunner,
  createEngineWaveRunner,
  evaluateMultiWaveSequence,
  generateRatioGrid,
  candidateToInput,
  type RallyCandidate,
} from "../src/pvp/optimizer";
import { createStageSeeds } from "../src/pvp/optimizer/seedSet";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { compileValidationBattle, createValidationBattleCompiler, toValidationThreeQueueConfig } from "../src/pvp/validationUi";
import { runThreeQueueScenario } from "../src/pvp/scenario/threeQueueScenario";
import { compileFastThreeQueue } from "../src/pvp/optimizer/fastTemplates";
import { createEvaluationExecutor } from "../src/pvp/optimizer/execution";

const baseline = createDefaultValidationInput();
const input = {
  ...baseline,
  battleContext: "rally" as const,
  maxRounds: 3,
  sideA: { ...baseline.sideA, rallyDeployment: {
    totalTroops: 10, ratios: { shield: 100, lancer: 0, marksman: 0 },
  } },
  sideB: { ...baseline.sideB, rallyDeployment: {
    totalTroops: 1_000, ratios: { shield: 0, lancer: 100, marksman: 0 },
  } },
};
const candidates: RallyCandidate[] = generateRatioGrid(1).slice(0, 1_000).map((ratios) => ({
  leaderHeroIds: { shield: null, lancer: null, marksman: null },
  memberSkillIds: [], ratios,
}));
const candidateRunner = createEngineCandidateRunner(input);

function benchmark(label: string, fn: () => number): number {
  const started = performance.now();
  const rounds = fn();
  const elapsed = performance.now() - started;
  process.stdout.write(`${label}: ${elapsed.toFixed(1)} ms; ${rounds} rounds; ${(elapsed / rounds).toFixed(4)} ms/round\n`);
  return elapsed;
}

benchmark("1000 candidates × 1 coarse trial", () => {
  let rounds = 0;
  for (const candidate of candidates) rounds += candidateRunner(candidate, [1])[0]!.rounds;
  return rounds;
});

benchmark("Top candidate × 1000 verification trials", () =>
  candidateRunner(candidates[0]!, createStageSeeds(10_000, 1_000))
    .reduce((total, trial) => total + trial.rounds, 0));

benchmark("3-wave × 1000 full trajectories", () => {
  let rounds = 0;
  const countedRunner = createEngineWaveRunner(input, (count) => { rounds += count; });
  evaluateMultiWaveSequence([candidates[0]!, candidates[1]!, candidates[2]!],
    { shield: 0, lancer: 1_000, marksman: 0 }, createStageSeeds(20_000, 1_000), .9,
    countedRunner);
  return rounds;
});

const seeds = createStageSeeds(12_345, 200);
const compiled = compileValidationBattle(input);
// Warm up both paths before comparing. Both execute the unchanged round chain.
for (const seed of seeds.slice(0, 20)) { compiled.runTrial(seed, "none"); compiled.runFastTrial(seed); }
const compactMs = benchmark("Existing compact mode x 200", () => seeds.reduce(
  (rounds, seed) => rounds + compiled.runTrial(seed, "none").roundCount, 0));
const fastMs = benchmark("FastBattleMode x 200", () => seeds.reduce(
  (rounds, seed) => rounds + compiled.runFastTrial(seed).roundCount, 0));
process.stdout.write(`Fast/compact ratio: ${(compactMs / fastMs).toFixed(2)}x\n`);

const cacheCompiler = createValidationBattleCompiler();
const sampleInputs = candidates.slice(0, 200).map((candidate) => candidateToInput(input, candidate));
const coldMs = benchmark("200 candidates without static skill cache", () => sampleInputs.reduce(
  (rounds, config) => rounds + compileValidationBattle(config).runFastTrial(1).roundCount, 0));
const cachedMs = benchmark("200 candidates with shared static skill cache", () => sampleInputs.reduce(
  (rounds, config) => rounds + cacheCompiler(config).runFastTrial(1).roundCount, 0));
process.stdout.write(`Static skill cache speedup: ${(coldMs / cachedMs).toFixed(2)}x\n`);

const queueConfig = toValidationThreeQueueConfig({ ...baseline, scenarioType: "THREE_QUEUE",
  maxRounds: 300, sideA: { ...baseline.sideA, deploymentCapacity: 60 },
  sideB: { ...baseline.sideB, deploymentCapacity: 60 } });
const fastQueues = compileFastThreeQueue(queueConfig);
const queueSeeds = createStageSeeds(42, 30);
for (const seed of queueSeeds.slice(0, 3)) {
  runThreeQueueScenario({ ...queueConfig, seed }); fastQueues.run(seed);
}
const fullQueueMs = benchmark("Three queues with full trace x 30", () => queueSeeds.reduce(
  (rounds, seed) => rounds + runThreeQueueScenario({ ...queueConfig, seed }).battleResults.reduce(
    (count, battle) => count + battle.battle.simulation.rounds.length, 0), 0));
const fastQueueMs = benchmark("Three queues FastBattleMode + templates x 30", () => queueSeeds.reduce(
  (rounds, seed) => rounds + fastQueues.run(seed).roundCount, 0));
process.stdout.write(`Three-queue speedup: ${(fullQueueMs / fastQueueMs).toFixed(2)}x; pair templates: ${fastQueues.pairs.builds}; pair hits: ${fastQueues.pairs.hits}\n`);

const evaluate = createEvaluationExecutor();
const pruned = evaluate({ kind: "battle", input: { ...input, maxRounds: 1 },
  side: "A", seeds, pruning: { reference: { wins: 200, trials: 200 },
    maxTrials: 200, comparisons: 100 } });
process.stdout.write(`Clearly weak candidate: ${pruned.samples.trials}/200 trials; skipped ${pruned.performance.skippedTrials}\n`);
