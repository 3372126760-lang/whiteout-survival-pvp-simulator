import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import {
  compileValidationBattle,
  deriveBatchSeed,
  runValidationBattleCore,
  type ValidationBattleInput,
  type ValidationSideInput,
} from "../src/pvp";
import { createDefaultValidationInput } from "../src/ui/defaultInput";

const base = createDefaultValidationInput();
const configuredSide = (side: ValidationSideInput): ValidationSideInput => ({
  ...side,
  troops: {
    shield: { ...side.troops.shield, count: 10, troopLevel: "T11-FC10" },
    lancer: { ...side.troops.lancer, count: 1_000, troopLevel: "T10-FC8" },
    marksman: { ...side.troops.marksman, count: 0 },
  },
});
const input: ValidationBattleInput = {
  ...base,
  maxRounds: 1_500,
  randomSeed: 12_345,
  sideA: configuredSide(base.sideA),
  sideB: configuredSide(base.sideB),
};
const compiled = compileValidationBattle(input);
const firstSeed = input.randomSeed;
const fullCheck = runValidationBattleCore(input);
for (const mode of ["summary", "none"] as const) {
  const compact = compiled.runTrial(firstSeed, mode);
  assert.deepEqual(compact.finalState.sideA.troops, fullCheck.simulation.finalState.sideA.troops);
  assert.deepEqual(compact.finalState.sideB.troops, fullCheck.simulation.finalState.sideB.troops);
  assert.equal(compact.roundCount, fullCheck.simulation.rounds.length);
}
process.stdout.write("同种子 full/summary/none 最终兵力与回合数一致。\n");

function run(label: string, count: number, trial: (seed: number) => number): void {
  const started = performance.now();
  let rounds = 0;
  for (let index = 0; index < count; index += 1) {
    rounds += trial(deriveBatchSeed(firstSeed, index));
  }
  const elapsed = performance.now() - started;
  process.stdout.write(`${label}: ${elapsed.toFixed(1)} ms total, ` +
    `${(elapsed / count).toFixed(3)} ms/battle, ` +
    `${(elapsed / rounds).toFixed(5)} ms/round, ${rounds} rounds\n`);
}

run("full ×100", 100, (seed) =>
  runValidationBattleCore({ ...input, randomSeed: seed }).simulation.rounds.length);
run("summary ×1000", 1_000, (seed) => compiled.runTrial(seed, "summary").roundCount);
run("none ×1000", 1_000, (seed) => compiled.runTrial(seed, "none").roundCount);

if (process.argv.includes("--stress")) {
  // Diagnostic only: near -100% attack rounds to zero damage and exercises the cap.
  const noDamageSide = (side: ValidationSideInput): ValidationSideInput => ({
    ...side,
    troops: {
      shield: { ...side.troops.shield, attack: -99.9999 },
      lancer: { ...side.troops.lancer, attack: -99.9999 },
      marksman: { ...side.troops.marksman, attack: -99.9999 },
    },
  });
  const stressInput = {
    ...input,
    sideA: noDamageSide(input.sideA),
    sideB: noDamageSide(input.sideB),
  };
  const stress = compileValidationBattle(stressInput);
  const sample = stress.runTrial(firstSeed, "summary");
  assert.equal(sample.roundCount, 1_500);
  run("1500-round stress summary ×1000", 1_000, (seed) =>
    stress.runTrial(seed, "summary").roundCount);
  run("1500-round stress none ×1000", 1_000, (seed) =>
    stress.runTrial(seed, "none").roundCount);
}
