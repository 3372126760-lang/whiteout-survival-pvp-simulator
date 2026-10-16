import { createPersistedEnvelope, restorePersistedConfig, type PersistedConfigEnvelope } from "../storage";
import { APP_VERSION } from "../version";
import { toEngineScenario, validationStageId, type ValidationBattleInput } from "../pvp/validationUi";
import { initializeOptimizationHeroPool, ownedHeroIds } from "../pvp/optimizer/heroPools";
import { generateBodyEnumerationDomain } from "../pvp/optimizer/criterion/bodyEnumeration";
import { generateAllHeadFormations } from "../pvp/optimizer/candidateGenerator";
import { enumerateCanonicalBodyPool } from "../pvp/optimizer/jointPipeline/canonicalBodies";
import { resolveJointPipelineOptions } from "../pvp/optimizer/jointPipeline/types";
import { adaptiveSeedPools } from "../pvp/optimizer/adaptiveSampling";
import { jointHeadPolicy } from "../pvp/optimizer/jointPipeline/domain";
import { headLineupKey } from "../pvp/optimizer/theory";
import { defaultOptimizationConfig } from "../pvp/optimizer";
import type { OptimizationConfig } from "../pvp/optimizer/types";

const FORMAT = "wos-pvp-optimizer-benchmark";
const stable = (value: unknown): string => JSON.stringify(value, (_key, row: unknown) => row && typeof row === "object" && !Array.isArray(row)
  ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : row);
const hash = async (value: unknown) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value))))]
  .map((n) => n.toString(16).padStart(2, "0")).join("");
function seedPolicy(config: OptimizationConfig) {
  const finalTrials = Math.max(1000, config.verificationTrials), pools = adaptiveSeedPools(config.firstSeed, 300, finalTrials);
  return { strategy: "common-prefix-300-independent-validation-offset-500000-v1", firstSeed: config.firstSeed,
    screeningSeeds: pools.screening, finalSeeds: pools.final, finalScreeningPrefix: pools.finalScreeningPrefix, finalTrials };
}
function space(input: ValidationBattleInput, config: OptimizationConfig) {
  const side = config.candidateSide ?? "A", own = input[side === "A" ? "sideA" : "sideB"];
  const { dimensions, headConstraints } = jointHeadPolicy(input, config);
  const heads = [...generateAllHeadFormations(input, headConstraints, undefined, side)]
    .sort((a, b) => headLineupKey(a.leaderHeroIds) < headLineupKey(b.leaderHeroIds) ? -1 : headLineupKey(a.leaderHeroIds) > headLineupKey(b.leaderHeroIds) ? 1 : 0);
  if (!heads.length) throw new Error("Benchmark 无合法 Head，请检查英雄池及固定条件。");
  const bodies = enumerateCanonicalBodyPool(input, config.constraints, heads[0]!.leaderHeroIds, side);
  return { headCount: heads.length, bodyCount: bodies.bodies.length, headBodyCount: heads.length * bodies.bodies.length,
    serverStage: validationStageId(input), optimizeSide: side, objective: config.objectiveMode,
    fixedHead: !dimensions.headSearchEnabled, headFixedReason: dimensions.headFixedReason,
    fixedBody: !dimensions.bodySearchEnabled, currentHead: own.leaderHeroIds, canonicalBodyAudit: bodies.audit.canonical };
}
export interface OptimizerBenchmarkFixture {
  format: typeof FORMAT; schemaVersion: 1; createdAt: string; appVersion: typeof APP_VERSION;
  envelope: PersistedConfigEnvelope;
  seedPolicy: ReturnType<typeof seedPolicy>;
  searchSpace: ReturnType<typeof space>;
  engineScenario: ReturnType<typeof toEngineScenario>;
  hashes: { input: string; optimizerConfig: string; engineScenario: string; seedPolicy: string };
}
/** Freeze effective inventories, resolved settings and exact seeds. No J scan or battles. */
export async function createOptimizerBenchmarkFixture(input: ValidationBattleInput, options: OptimizationConfig,
  simulationCount = 1000): Promise<OptimizerBenchmarkFixture> {
  if (input.scenarioType !== "RALLY" || input.battleContext !== "rally") throw new Error("完整优化 Benchmark Fixture 目前用于集结场景。");
  const side = options.candidateSide ?? "A", own = input[side === "A" ? "sideA" : "sideB"];
  const initialized = initializeOptimizationHeroPool(input);
  const frozen = { ...structuredClone(initialized), ownedHeroIds: [...ownedHeroIds(initialized)],
    rallyBodyPoolIds: [...(input.rallyBodyPoolIds ?? generateBodyEnumerationDomain(input, options.constraints, own.leaderHeroIds ?? {}, side).sources.map((source) => source.heroId))] };
  // The browser optimizer Worker enables profiling for every real run.
  const config = { ...defaultOptimizationConfig(options.firstSeed), ...structuredClone(options), profiling: true, jointPipeline: resolveJointPipelineOptions(options.jointPipeline) };
  const envelope = createPersistedEnvelope(frozen, simulationCount, config);
  const restored = restorePersistedConfig(envelope), normalized = restored.input, effectiveConfig = restored.optimizationConfig;
  const engineScenario = toEngineScenario(normalized);
  if (stable(engineScenario) !== stable(toEngineScenario(input))) throw new Error("导出规范化改变了正式 BattleConfig；已停止导出。");
  const seeds = seedPolicy(effectiveConfig);
  const [inputHash, configHash, engineHash, seedsHash] = await Promise.all([hash(normalized), hash(effectiveConfig), hash(engineScenario), hash(seeds)]);
  return { format: FORMAT, schemaVersion: 1, appVersion: APP_VERSION, createdAt: new Date().toISOString(), envelope,
    seedPolicy: seeds, searchSpace: space(normalized, effectiveConfig), engineScenario,
    hashes: { input: inputHash, optimizerConfig: configHash, engineScenario: engineHash, seedPolicy: seedsHash } };
}
export async function restoreOptimizerBenchmarkFixture(text: string) {
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("Benchmark Fixture JSON 格式错误。"); }
  if (!raw || typeof raw !== "object" || !("format" in raw) || raw.format !== FORMAT || !("schemaVersion" in raw) || raw.schemaVersion !== 1)
    throw new Error("不是支持的完整优化 Benchmark Fixture。");
  const fixture = raw as OptimizerBenchmarkFixture, restored = restorePersistedConfig(fixture.envelope);
  const config = restored.optimizationConfig, input = restored.input, engine = toEngineScenario(input);
  const actual = { input: await hash(input), optimizerConfig: await hash(config), engineScenario: await hash(engine), seedPolicy: await hash(seedPolicy(config)) };
  if (stable(actual) !== stable(fixture.hashes) || stable(seedPolicy(config)) !== stable(fixture.seedPolicy))
    throw new Error("Fixture 输入、优化参数、引擎快照或共同种子校验失败；未导入。");
  if (stable(engine) !== stable(fixture.engineScenario) || stable(space(input, config)) !== stable(fixture.searchSpace))
    throw new Error("当前版本的 Head/Body 候选空间或 BattleConfig 与 Fixture 不一致；未导入。");
  return restored;
}
