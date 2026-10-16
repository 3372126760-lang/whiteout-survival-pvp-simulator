import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { createHeadPoolAudit } from "../src/pvp/optimizer/headPoolAudit";
import { generateAllHeadFormations } from "../src/pvp/optimizer/candidateGenerator";
import { initializeOptimizationHeroPool } from "../src/pvp/optimizer/heroPools";
import { getValidationCatalog, toEngineScenario } from "../src/pvp/validationUi";
import { createPersistedEnvelope } from "../src/storage";
import { assertFrozenOptimizerFixture, benchmarkHash, type FrozenOptimizerBenchmarkFixture } from "./optimizer-benchmark-fixture";
import type { OptimizationInput, OptimizationConfig } from "../src/pvp/optimizer/types";

const sourcePath = "benchmarks/optimizer/joint-rally-gen12-input.json";
const inputPath = "benchmarks/optimizer/head-pool-s12-all-available-input.json";
const auditPath = process.argv[2] ?? "artifacts/benchmarks/optimizer/head-pool-s12-all-available-audit.json";
const sourceBytes = readFileSync(sourcePath, "utf8");
const source = JSON.parse(sourceBytes) as FrozenOptimizerBenchmarkFixture;
assertFrozenOptimizerFixture(source);
const formalSources = JSON.parse(readFileSync("benchmarks/optimizer/formal-engine-integrity.json", "utf8")) as { path: string; sha256: string }[];
for (const file of formalSources) assert.equal(createHash("sha256")
  .update(readFileSync(file.path, "utf8").replaceAll("\r\n", "\n")).digest("hex"), file.sha256, file.path);

interface HeadFixture {
  schema: number;
  purpose: string;
  sourceFixture: string;
  sourceInputSha256: string;
  derivation: string;
  input: OptimizationInput;
  optimizerConfig: OptimizationConfig;
  inputSha256: string;
  envelope: ReturnType<typeof createPersistedEnvelope>;
}
let fixture: HeadFixture;
if (existsSync(inputPath)) fixture = JSON.parse(readFileSync(inputPath, "utf8")) as HeadFixture;
else {
  // A deliberate new fixture. Never relabel the old 34-enabled-SSR performance
  // input as an all-S12 benchmark or alter its explicitly disabled S12 entries.
  const all = { ...source.input };
  delete all.ownedHeroIds;
  delete all.availableHeroIds;
  const catalog = getValidationCatalog().leaderHeroes;
  all.optimizerHeroPool = Object.fromEntries((["A", "B"] as const).map((side) => [side,
    Object.fromEntries(Object.entries(all.optimizerHeroPool?.[side] ?? {})
      .filter(([id]) => (catalog.find((hero) => hero.heroId === id)?.generation ?? 0) <= 11))]));
  const input = initializeOptimizationHeroPool(all);
  fixture = { schema: 1, purpose: "Head Pool Audit + H0 only; no J, Theory or Formal",
    sourceFixture: sourcePath, sourceInputSha256: source.inputSha256,
    derivation: "New all-available S12 scope, starting with the saved S1-S11 optimizer entries. Remove ownership aliases and post-S11 entries, then initialize using the current server registry. Preserve all battle fields and existing S1-S11 toggles/weapons. This is not the previous performance fixture.",
    input, optimizerConfig: source.optimizerConfig, inputSha256: benchmarkHash(input),
    envelope: createPersistedEnvelope(input, 1000, source.optimizerConfig, 1000) };
  assert.deepEqual(toEngineScenario(input), toEngineScenario(source.input));
  writeFileSync(inputPath, JSON.stringify(fixture, null, 2) + "\n");
}
assert.equal(benchmarkHash(fixture.input), fixture.inputSha256);
assert.equal(fixture.sourceInputSha256, source.inputSha256);
const side = fixture.optimizerConfig.candidateSide ?? "A";
const audit = createHeadPoolAudit(fixture.input, fixture.optimizerConfig.constraints, side);
const heads = generateAllHeadFormations(fixture.input, fixture.optimizerConfig.constraints, undefined, side);
assert.equal(heads.length, audit.finalLegalHeadCount);
for (const id of ["hero.s12.hervor", "hero.s12.karol", "hero.s12.ligeia"]) assert(audit.eligibleS12HeadHeroIds.includes(id));
const oldAudit = createHeadPoolAudit(source.input, source.optimizerConfig.constraints, side);
assert.equal(oldAudit.finalLegalHeadCount, 876);
assert.equal(oldAudit.eligibleS12HeadHeroIds.length, 0);
assert.equal(readFileSync(sourcePath, "utf8"), sourceBytes);
const result = { inputFixture: inputPath, inputSha256: fixture.inputSha256, stagesExecuted: ["Head Pool Audit", "H0"],
  totalBattleEngineCalls: 0, verifiedFormalSourceFiles: formalSources.length, generatedHeadCount: heads.length, headPoolAudit: audit,
  previousFrozenPerformanceFixture: { path: sourcePath, inputSha256: source.inputSha256,
    interpretation: "Performance evidence only. S12 explicitly disabled; no conclusion about optimal S12 heroes.", headPoolAudit: oldAudit } };
mkdirSync(dirname(auditPath), { recursive: true });
writeFileSync(auditPath, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify({ serverStage: audit.serverStage, availableSSRHeadHeroes: audit.availableSSRHeadHeroCount,
  eligibleS12HeadHeroIds: audit.eligibleS12HeadHeroIds, effectiveN: audit.effectiveN,
  recentGenerationWindow: audit.recentGenerationWindow, heroCountByTroop: audit.heroCountByTroop,
  finalLegalHeadCount: heads.length, totalBattleEngineCalls: 0, verifiedFormalSourceFiles: formalSources.length, saved: auditPath }, null, 2) + "\n");
