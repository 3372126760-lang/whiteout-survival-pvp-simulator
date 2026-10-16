import { createHash } from "node:crypto";
import { getValidationCatalog, toEngineScenario } from "../src/pvp/validationUi";
import { optimizationHeroIds, ownedHeroIds, visibleOptimizationHeroIds } from "../src/pvp/optimizer/heroPools";
import { generateBodyEnumerationDomain } from "../src/pvp/optimizer/criterion/bodyEnumeration";
import { adaptiveSeedPools, resolveAdaptiveSearchOptions } from "../src/pvp/optimizer/adaptiveSampling";
import { resolveBasinSearchOptions } from "../src/pvp/optimizer/basinSearch";
import { resolveJointPipelineOptions } from "../src/pvp/optimizer/jointPipeline/types";
import { resolveJointRacingSchedule } from "../src/pvp/optimizer/criterion/racingSchedule";
import type { OptimizationConfig, OptimizationInput } from "../src/pvp/optimizer/types";

export const benchmarkHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function sharedOptimizerOptions(config: OptimizationConfig) {
  const options = { ...config } as Record<string, unknown>; delete options["useSimpleRatioPrior"]; return options;
}
/** Resolve defaults once when a fixture is deliberately created. Normal runs
 * only read it; neither current defaults nor new server heroes can expand it. */
export function freezeOptimizerBenchmarkFixture(input: OptimizationInput, config: OptimizationConfig) {
  const catalog = getValidationCatalog(), pool = { ...input.optimizerHeroPool };
  for (const side of ["A", "B"] as const) {
    const enabled = new Set(optimizationHeroIds(input, side));
    const next = { ...pool[side] };
    for (const id of visibleOptimizationHeroIds(input)) if (!next[id]) next[id] = {
      enabled: enabled.has(id), weaponLevel: catalog.leaderHeroes.find((h) => h.heroId === id)!.weaponMaxStat === null ? null : 10 };
    pool[side] = next;
  }
  const own = input[config.candidateSide === "B" ? "sideB" : "sideA"];
  const frozenInput: OptimizationInput = { ...input, ownedHeroIds: [...ownedHeroIds(input)], optimizerHeroPool: pool,
    rallyBodyPoolIds: [...(input.rallyBodyPoolIds ?? generateBodyEnumerationDomain(input, {}, own.leaderHeroIds ?? {}, config.candidateSide).sources.map((s) => s.heroId))] };
  const frozenConfig: OptimizationConfig = { ...config, jointPipeline: resolveJointPipelineOptions(config.jointPipeline),
    adaptiveSearch: resolveAdaptiveSearchOptions(config.adaptiveSearch), basinSearch: resolveBasinSearchOptions(config.basinSearch),
    monteCarloStages: resolveJointRacingSchedule(config) };
  const seedPools = adaptiveSeedPools(frozenConfig.firstSeed, 300, Math.max(1000, frozenConfig.verificationTrials));
  const engineScenario = toEngineScenario(frozenInput);
  if (benchmarkHash(engineScenario) !== benchmarkHash(toEngineScenario(input))) throw new Error("Freezing pools changed formal BattleConfig.");
  return { schema: 2, frozen: true, input: frozenInput, canonicalBattleConfig: frozenInput, engineScenario,
    engineScenarioSha256: benchmarkHash(engineScenario), optimizerConfig: frozenConfig,
    inputSha256: benchmarkHash(frozenInput), optimizerConfigSha256: benchmarkHash(frozenConfig),
    optimizerConfigSha256ExcludingFlag: benchmarkHash(sharedOptimizerOptions(frozenConfig)),
    seedPolicy: { firstSeed: frozenConfig.firstSeed, strategy: "shared screening prefix 300 + independently derived validation seeds at offset 500000; common Final 1000",
      screeningSeeds: seedPools.screening, finalSeeds: seedPools.final, finalSeedsSha256: benchmarkHash(seedPools.final), finalScreeningPrefix: seedPools.finalScreeningPrefix },
    weaponPolicy: { mode: "per-hero optimizerHeroPool weaponLevel; exact current simulationWeaponLevels for protected baseline",
      currentA: frozenInput.sideA.simulationWeaponLevels, currentB: frozenInput.sideB.simulationWeaponLevels },
    historicalBodyCount: 57313, currentReproducibleBodyCount: 56859, difference: -454,
    historicalInputAvailable: false, historicalTotalElapsedMs: 454201.9 };
}
export type FrozenOptimizerBenchmarkFixture = ReturnType<typeof freezeOptimizerBenchmarkFixture>;
/** The exact input/config/seed snapshot extracted from an already measured run. */
export interface MeasuredOptimizerBenchmarkFixture {
  schema: 1;
  kind: "exact-measured-canonical-input";
  input: OptimizationInput;
  optimizerConfig: OptimizationConfig;
  inputSha256: string;
  optimizerConfigSha256: string;
  engineScenario: ReturnType<typeof toEngineScenario>;
  engineScenarioSha256: string;
  seedPolicySha256: string;
  seedPolicy: {
    firstSeed: number; strategy: string; screeningSeeds: readonly number[]; finalSeeds: readonly number[];
    finalScreeningPrefix: number; finalSeedsSha256: string;
  };
}
export function assertMeasuredOptimizerFixture(fixture: MeasuredOptimizerBenchmarkFixture): void {
  const seeds = adaptiveSeedPools(fixture.optimizerConfig.firstSeed, 300, Math.max(1000, fixture.optimizerConfig.verificationTrials));
  const { finalSeedsSha256, ...recordedSeedPolicy } = fixture.seedPolicy;
  if (fixture.schema !== 1 || fixture.kind !== "exact-measured-canonical-input" ||
      benchmarkHash(fixture.input) !== fixture.inputSha256 ||
      benchmarkHash(fixture.optimizerConfig) !== fixture.optimizerConfigSha256 ||
      benchmarkHash(fixture.engineScenario) !== fixture.engineScenarioSha256 ||
      benchmarkHash(toEngineScenario(fixture.input)) !== fixture.engineScenarioSha256 ||
      benchmarkHash(recordedSeedPolicy) !== fixture.seedPolicySha256 ||
      fixture.seedPolicy.firstSeed !== fixture.optimizerConfig.firstSeed ||
      benchmarkHash(seeds.screening) !== benchmarkHash(fixture.seedPolicy.screeningSeeds) ||
      benchmarkHash(seeds.final) !== benchmarkHash(fixture.seedPolicy.finalSeeds) ||
      benchmarkHash(seeds.final) !== finalSeedsSha256 || seeds.finalScreeningPrefix !== fixture.seedPolicy.finalScreeningPrefix)
    throw new Error("Measured benchmark fixture/input/config/engine/seed snapshot mismatch.");
}
export function assertFrozenOptimizerFixture(fixture: FrozenOptimizerBenchmarkFixture): void {
  if (!fixture.frozen || fixture.schema !== 2 || !fixture.input.ownedHeroIds || !fixture.input.rallyBodyPoolIds ||
      !fixture.input.optimizerHeroPool?.A || !fixture.input.optimizerHeroPool.B ||
      benchmarkHash(fixture.input) !== fixture.inputSha256 || benchmarkHash(fixture.canonicalBattleConfig) !== fixture.inputSha256 ||
      benchmarkHash(fixture.optimizerConfig) !== fixture.optimizerConfigSha256 ||
      benchmarkHash(fixture.engineScenario) !== fixture.engineScenarioSha256 ||
      benchmarkHash(toEngineScenario(fixture.input)) !== fixture.engineScenarioSha256 ||
      benchmarkHash(adaptiveSeedPools(fixture.optimizerConfig.firstSeed, 300, Math.max(1000, fixture.optimizerConfig.verificationTrials)).final) !== fixture.seedPolicy.finalSeedsSha256)
    throw new Error("Frozen benchmark fixture/hash/seed policy mismatch; normal benchmarks must not regenerate input.");
}
