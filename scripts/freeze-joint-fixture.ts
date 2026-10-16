import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { freezeOptimizerBenchmarkFixture, assertFrozenOptimizerFixture, benchmarkHash } from "./optimizer-benchmark-fixture";
import { generateAllHeadFormations } from "../src/pvp/optimizer/candidateGenerator";
import { enumeratePreprocessedBodyPool } from "../src/pvp/optimizer/criterion/bodyEnumeration";
import type { OptimizationConfig, OptimizationInput } from "../src/pvp/optimizer/types";
const path = process.argv[2] ?? "benchmarks/optimizer/joint-rally-gen12-input.json";
if (!path.endsWith("-input.json")) throw new Error("Expected an -input.json fixture filename.");
const previous = JSON.parse(readFileSync(path, "utf8")) as { input: OptimizationInput; optimizerConfig: OptimizationConfig; frozen?: boolean };
if (previous.frozen) process.stdout.write("Already frozen; input left unchanged.\n");
else {
  const fixture = freezeOptimizerBenchmarkFixture(previous.input, previous.optimizerConfig);
  const heads = generateAllHeadFormations(fixture.input, fixture.optimizerConfig.constraints);
  const oldBody = enumeratePreprocessedBodyPool(fixture.input, fixture.optimizerConfig.constraints, heads[0]!.leaderHeroIds, { jointPolicy: true });
  if (heads.length !== 876 || oldBody.bodies.length !== 56859) throw new Error("Freezing changed the reproducible Head/Body space.");
  copyFileSync(path, path.replace("-input.json", "-pre-freeze-input.json"));
  copyFileSync(path.replace("-input.json", "-ab-summary.json"), path.replace("-input.json", "-pre-freeze-ab-summary.json"));
  assertFrozenOptimizerFixture(fixture);
  writeFileSync(path, JSON.stringify({ ...fixture, provenance: "Frozen S12 Rally benchmark. Full A/B canonical input, explicit ownership/optimization/Body pools, per-hero weapons, tier/T12/attributes/Buffs, resolved optimizer options and exact common seeds. Historical 57313/454201.9ms had no full input and is not claimed as reproduced.",
    previousInputSha256: benchmarkHash(previous.input), freezingPreservedFormalScenario: true, freezingPreservedHeadCount: heads.length, freezingPreservedOldJBodyCount: oldBody.bodies.length }, null, 2) + "\n");
  process.stdout.write(`Frozen ${path}; Head=${heads.length}, old Body=${oldBody.bodies.length}, SHA256=${fixture.inputSha256}\n`);
}
