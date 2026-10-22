import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import assert from "node:assert/strict";
import type { OptimizationConfig, OptimizationInput, RallyCandidate } from "../src/pvp/optimizer/types";

const DIRECTORY = "benchmarks/optimizer";
export const RENEE_INPUT = `${DIRECTORY}/joint-rally-60-39-1-vs-49-1-50-seed-502926396-input.json`;
export const RENEE_FIXTURE = `${DIRECTORY}/renee-duplicate-source-fixture.json`;
const MARK = "hero-skill.ruini.dream-mark";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(JSON.stringify(value));
export interface ReneeFixture {
  schema: 1; kind: "renee-duplicate-source-canonical-comparison";
  inputFile: string; sourceFileSha256: string; inputSha256: string; engineScenarioSha256: string;
  provenance: string; optimizerOptionsProvenance: string; optimizerConfig: OptimizationConfig;
  rallyBodyPoolIds: readonly string[];
  seeds: { historicalReplay: number; final: readonly number[]; sha256: string; strategy: string };
}
export function readReneeFixture(path = RENEE_FIXTURE) {
  const fixture = JSON.parse(readFileSync(path, "utf8")) as ReneeFixture;
  assert.equal(fixture.kind, "renee-duplicate-source-canonical-comparison");
  const bytes = readFileSync(fixture.inputFile), input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as OptimizationInput;
  assert.equal(sha(bytes), fixture.sourceFileSha256, "Original input bytes changed");
  assert.equal(hash(input), fixture.inputSha256, "Canonical input changed");
  assert.equal(hash(fixture.seeds.final), fixture.seeds.sha256, "Common final seeds changed");
  assert.equal(fixture.seeds.final.length, 1000);
  return { fixture, input };
}

async function capture(source: string) {
  assert(!existsSync(RENEE_INPUT) && !existsSync(RENEE_FIXTURE), "Do not overwrite an established experiment fixture");
  const bytes = readFileSync(source), input = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")) as OptimizationInput;
  const { defaultOptimizationConfig } = await import("../src/pvp/optimizer");
  const { toEngineScenario } = await import("../src/pvp/validationUi");
  const { generateBodyEnumerationDomain } = await import("../src/pvp/optimizer/criterion/bodyEnumeration");
  const { resolveJointPipelineOptions } = await import("../src/pvp/optimizer/jointPipeline/types");
  const { adaptiveSeedPools } = await import("../src/pvp/optimizer/adaptiveSampling");
  assert.equal(input.randomSeed, 502926396); assert.equal(input.serverStage, "s12");
  assert.deepEqual(input.sideA.rallyDeployment?.ratios, { shield: 60, lancer: 39, marksman: 1 });
  assert.deepEqual(input.sideB.rallyDeployment?.ratios, { shield: 49, lancer: 1, marksman: 50 });
  const optimizerConfig = { ...defaultOptimizationConfig(input.randomSeed), profiling: true, jointPipeline: resolveJointPipelineOptions() };
  const seeds = adaptiveSeedPools(optimizerConfig.firstSeed, 300, 1000).final;
  const fixture: ReneeFixture = { schema: 1, kind: "renee-duplicate-source-canonical-comparison", inputFile: RENEE_INPUT,
    sourceFileSha256: sha(bytes), inputSha256: hash(input), engineScenarioSha256: hash(toEngineScenario(input)),
    provenance: "User-supplied complete canonical JSON, preserved byte-for-byte; no screenshot reconstruction.",
    optimizerOptionsProvenance: "Original file contains BattleConfig only, no optimizer config. Current defaults explicitly frozen for this comparison; not claimed to be historical optimizer settings.",
    optimizerConfig, rallyBodyPoolIds: generateBodyEnumerationDomain(input, {}, input.sideA.leaderHeroIds ?? {}, "A").sources.map((s) => s.heroId),
    seeds: { historicalReplay: input.randomSeed, final: seeds, sha256: hash(seeds),
      strategy: "adaptiveSeedPools(firstSeed,300,1000).final; common independent validation seeds for both rules" } };
  mkdirSync(DIRECTORY, { recursive: true });
  writeFileSync(RENEE_INPUT, bytes); writeFileSync(RENEE_FIXTURE, JSON.stringify(fixture, null, 2) + "\n");
}

/** Compare a fixed lineup, not the winners of two different optimizer searches.
 * All Head×Body peaks are scanned to determine the exact global J rank. */
export async function runReneeVariant(root: string, fixturePath: string, variant: "old" | "new", progress: (message: string) => void) {
  const { fixture, input } = readReneeFixture(fixturePath), before = hash(input), start = performance.now();
  const moduleAt = (file: string) => import(pathToFileURL(resolve(root, file)).href);
  const { toEngineScenario, compileValidationBattle, runValidationBattleCore } = await moduleAt("src/pvp/validationUi/index.ts") as typeof import("../src/pvp/validationUi");
  const { generateAllHeadFormations } = await moduleAt("src/pvp/optimizer/candidateGenerator.ts") as typeof import("../src/pvp/optimizer/candidateGenerator");
  const { jointHeadPolicy } = await moduleAt("src/pvp/optimizer/jointPipeline/domain.ts") as typeof import("../src/pvp/optimizer/jointPipeline/domain");
  const { headLineupKey } = await moduleAt("src/pvp/optimizer/theory/index.ts") as typeof import("../src/pvp/optimizer/theory");
  const { enumerateCanonicalBodyPool } = await moduleAt("src/pvp/optimizer/jointPipeline/canonicalBodies.ts") as typeof import("../src/pvp/optimizer/jointPipeline/canonicalBodies");
  const { createJointCoefficientTable, combineJointCoefficients } = await moduleAt("src/pvp/optimizer/jointPipeline/coefficients.ts") as typeof import("../src/pvp/optimizer/jointPipeline/coefficients");
  const { evaluateJointJ, compareJointPeaks } = await moduleAt("src/pvp/optimizer/jointPipeline/peakScan.ts") as typeof import("../src/pvp/optimizer/jointPipeline/peakScan");
  const { createJointRankInspector } = await moduleAt("src/pvp/optimizer/jointPipeline/rankDiagnostics.ts") as typeof import("../src/pvp/optimizer/jointPipeline/rankDiagnostics");
  const { solveRatioPeak } = await moduleAt("src/pvp/optimizer/jointPipeline/ratioPeak.ts") as typeof import("../src/pvp/optimizer/jointPipeline/ratioPeak");
  assert.equal(hash(toEngineScenario(input)), fixture.engineScenarioSha256);
  const config = fixture.optimizerConfig, rankInput = { ...input, rallyBodyPoolIds: fixture.rallyBodyPoolIds };
  const heads = [...generateAllHeadFormations(rankInput, jointHeadPolicy(rankInput, config).headConstraints, undefined, "A")]
    .sort((a, b) => headLineupKey(a.leaderHeroIds).localeCompare(headLineupKey(b.leaderHeroIds), "en"));
  // Match workflow's lexical order, including its deterministic tie-break.
  heads.sort((a, b) => headLineupKey(a.leaderHeroIds) < headLineupKey(b.leaderHeroIds) ? -1 : headLineupKey(a.leaderHeroIds) > headLineupKey(b.leaderHeroIds) ? 1 : 0);
  const bodyPool = enumerateCanonicalBodyPool(rankInput, config.constraints, heads[0]!.leaderHeroIds, "A");
  const bodyKey = (b: typeof bodyPool.bodies[number]) => b.ids.map((id, i) => `${id}@Lv${b.semantic.skills[i]!.skillLevel}`).join("|");
  const bodies = [...bodyPool.bodies].sort((a, b) => bodyKey(a) < bodyKey(b) ? -1 : bodyKey(a) > bodyKey(b) ? 1 : 0);
  const table = createJointCoefficientTable(rankInput, config, heads, bodies);
  const own = input.sideA, candidate: RallyCandidate = { leaderHeroIds: own.leaderHeroIds ?? {},
    memberSkillIds: own.bodySkills!.map((s) => s.skillId), bodySkillLevels: own.bodySkills!.map((s) => s.skillLevel),
    headWeaponLevels: own.simulationWeaponLevels ?? {}, ratios: own.rallyDeployment!.ratios };
  const inspector = createJointRankInspector(table, rankInput, config, heads, bodies, [], "A"), pair = inspector.indices(candidate);
  assert(pair, "Original lineup must exist in the frozen candidate domain");
  const s = new Float64Array(3), o = new Float64Array(3), scratch = new Float64Array(12), peak = new Float64Array(5);
  combineJointCoefficients(table, pair.head, pair.body, s, o, scratch); solveRatioPeak(s, o, peak);
  const target = { ...pair, score: peak[3]!, ratio: { shield: peak[0]! * 100, lancer: peak[1]! * 100, marksman: peak[2]! * 100 } };
  let globalRank = 1, bodyRank = 1, headRank = 1, best = target;
  progress(`${heads.length} Heads × ${bodies.length} Bodies; scanning exact J ranks`);
  for (let head = 0; head < heads.length; head++) {
    for (let body = 0; body < bodies.length; body++) {
      combineJointCoefficients(table, head, body, s, o, scratch); solveRatioPeak(s, o, peak);
      const row = { head, body, score: peak[3]!, ratio: target.ratio };
      if (compareJointPeaks(row, target) < 0) { globalRank++; if (head === pair.head) bodyRank++; if (body === pair.body) headRank++; }
      if (compareJointPeaks(row, best) < 0) best = { ...row, ratio: { shield: peak[0]! * 100, lancer: peak[1]! * 100, marksman: peak[2]! * 100 } };
    }
    if ((head + 1) % 100 === 0) progress(`J scan ${head + 1}/${heads.length}`);
  }
  const j = { atOriginalRatio: evaluateJointJ(table, pair.head, pair.body, candidate.ratios), max: target.score, peakRatio: target.ratio,
    globalPeakRank: globalRank, bodyRankWithinHead: bodyRank, headRankWithinBody: headRank,
    recalledByGlobalTop10000: globalRank <= 10000, recalledByPerHeadTop1: bodyRank === 1,
    globalBest: { head: heads[best.head]!.leaderHeroIds, body: bodies[best.body]!.ids, jMax: best.score, peakRatio: best.ratio } };
  progress(`J rank ${globalRank}; Formal common Final1000 at unchanged 60/39/1`);
  const compiled = compileValidationBattle(input), trials: { seed: number; outcome: string; rounds: number }[] = [];
  const outcomes = { A: 0, B: 0, draw: 0, timeout: 0 }, remaining = { A: 0, B: 0 };
  const alive = (side: typeof compiled.initialState.sideA) => Object.values(side.troops).reduce((sum, t) => sum + t.aliveCount, 0);
  for (const [index, seed] of fixture.seeds.final.entries()) {
    const trial = compiled.runTrial(seed, "none"), a = alive(trial.finalState.sideA), b = alive(trial.finalState.sideB);
    const outcome = trial.endReason === "roundLimit" ? "timeout" : a === b ? "draw" : a > b ? "A" : "B";
    outcomes[outcome]++; remaining.A += a; remaining.B += b; trials.push({ seed, outcome, rounds: trial.roundCount });
    if ((index + 1) % 100 === 0) progress(`Formal ${index + 1}/1000`);
  }
  // Only the diagnostic replay is bounded. All 1000 Formal trials and the
  // historical seed's final result retain the original maxRounds=1500.
  const traceInput = { ...input, maxRounds: Math.min(input.maxRounds, 21) };
  const traced = runValidationBattleCore(traceInput), replay = compiled.runTrial(fixture.seeds.historicalReplay, "none");
  const partialReplay = compileValidationBattle(traceInput).runTrial(fixture.seeds.historicalReplay, "none");
  assert.equal(partialReplay.roundCount, traced.simulation.rounds.length, "Compact/full round counts diverged");
  assert.equal(alive(partialReplay.finalState.sideA), alive(traced.simulation.finalState.sideA), "Compact/full A survivors diverged");
  assert.equal(alive(partialReplay.finalState.sideB), alive(traced.simulation.finalState.sideB), "Compact/full B survivors diverged");
  const event = (e: typeof traced.simulation.trace.rounds[number]["damageEvents"][number]) => ({
    id: e.id, sourceSide: e.sourceSide, sourceTroop: e.sourceTroop, targetTroop: e.targetTroop,
    sourceSkillId: e.sourceSkillId, damageType: e.damageType, damageSubtype: e.damageSubtype,
    skillCoefficient: e.skillCoefficient, roundedDamage: e.roundedDamage, increaseGroups: e.increaseGroups,
    attributeResolutions: e.attributeResolutions, mainHitCancelled: e.mainHitCancelled,
  });
  const replayA = alive(replay.finalState.sideA), replayB = alive(replay.finalState.sideB);
  const historicalReplay = { seed: fixture.seeds.historicalReplay,
    summary: { rounds: replay.roundCount, endReason: replay.endReason, remaining: { A: replayA, B: replayB },
      outcome: replay.endReason === "roundLimit" ? "timeout" : replayA === replayB ? "draw" : replayA > replayB ? "A" : "B" },
    r20r21: traced.simulation.trace.rounds.filter((r) => r.round === 20 || r.round === 21).map((r) => ({
      round: r.round, lancerAndMarkEvents: r.damageEvents.filter((e) => e.sourceSide === "A" && (e.sourceTroop === "lancer" || e.sourceSkillId === MARK)).map(event),
      markTraces: r.heroSkills.filter((t) => t.skillId === MARK),
    })) };
  assert.equal(hash(input), before, "Benchmark mutated the original canonical input");
  const sourceCount = own.bodySkills!.filter((s) => s.skillId === MARK).length;
  return { variant, inputSha256: before, engineScenarioSha256: fixture.engineScenarioSha256, seedsSha256: fixture.seeds.sha256,
    rule: variant === "old" ? "Independent 2B per source, separate delayed events and rounding" : "One delayed payload: first source 2B, each additional source 1B",
    sourceCount, coefficient: variant === "old" ? 2 * sourceCount : sourceCount + 1,
    headCount: heads.length, bodyCount: bodies.length, headKeysSha256: hash(heads.map((h) => headLineupKey(h.leaderHeroIds))),
    bodyKeysSha256: hash(bodies.map(bodyKey)), evaluatedHeadBodyCount: heads.length * bodies.length,
    j, formal: { trials: trials.length, outcomes, winRateA: outcomes.A / trials.length, averageRemaining: { A: remaining.A / trials.length, B: remaining.B / trials.length } },
    historicalReplay, trials, elapsedMs: performance.now() - start };
}
export type ReneeVariantReport = Awaited<ReturnType<typeof runReneeVariant>>;

async function main() {
  const args = process.argv.slice(2), captureIndex = args.indexOf("--capture");
  if (captureIndex >= 0) await capture(args[captureIndex + 1]!);
  const { fixture } = readReneeFixture(), root = resolve("."), output = resolve("artifacts/benchmarks/optimizer/renee-stacking");
  mkdirSync(output, { recursive: true });
  // Isolated benchmark snapshot: never toggle or rewrite the working production implementation.
  const baseline = resolve(output, "legacy-independent-source");
  cpSync(resolve("src"), resolve(baseline, "src"), { recursive: true, filter: (file) => !file.includes("tests") && !file.endsWith(".test.ts") });
  const definitionFile = resolve(baseline, "src/pvp/heroSkills/definitions/s6Heroes.ts"), definition = readFileSync(definitionFile, "utf8");
  const policy = / {4}duplicateSourceStacking: \{\r?\n {6}additionalCoefficient: 1,\r?\n {6}evidenceStatus: "BATTLE_REPORT_SUPPORTED",\r?\n {6}ruleStatus: "PROVISIONAL",\r?\n {4}\},\r?\n/g;
  assert.equal([...definition.matchAll(policy)].length, 1, "Legacy patch must identify Renee's exact stacking policy once");
  const patched = definition.replace(policy, ""); writeFileSync(definitionFile, patched);
  const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(resolve(dir, entry.name)) : [resolve(dir, entry.name)]);
  const sourceSnapshot = sourceFiles(resolve(baseline, "src")).map((file) => ({ path: relative(baseline, file).replaceAll("\\", "/"), sha256: sha(readFileSync(file)) }));
  // Assert every copied production file is unchanged except for the exact Renee policy removal.
  for (const file of sourceSnapshot) if (file.path !== "src/pvp/heroSkills/definitions/s6Heroes.ts")
    assert.equal(file.sha256, sha(readFileSync(resolve(root, file.path))));
  const reports: ReneeVariantReport[] = [];
  for (const variant of ["old", "new"] as const) {
    const worker = new Worker(new URL("./renee-stacking-worker.mjs", import.meta.url), {
      execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 16 },
      workerData: { root: variant === "old" ? baseline : root, fixture: RENEE_FIXTURE, variant } });
    try {
      const report = await new Promise<ReneeVariantReport>((fulfill, reject) => {
        worker.on("message", (message: { progress?: string; result?: ReneeVariantReport; error?: string }) => {
          if (message.progress) process.stdout.write(`[${variant}] ${message.progress}\n`);
          if (message.error) reject(new Error(message.error)); if (message.result) fulfill(message.result);
        }); worker.on("error", reject); worker.on("exit", (code) => { if (code) reject(new Error(`Benchmark worker exited ${code}`)); });
      });
      reports.push(report); writeFileSync(resolve(output, `${variant}-profile.json`), JSON.stringify(report, null, 2) + "\n");
    } finally { await worker.terminate(); }
  }
  const [old, current] = reports as [ReneeVariantReport, ReneeVariantReport];
  for (const key of ["inputSha256", "engineScenarioSha256", "seedsSha256", "headKeysSha256", "bodyKeysSha256"] as const) assert.equal(old[key], current[key], key);
  const paired = { oldAnewA: 0, oldAnewOther: 0, oldOtherNewA: 0, neitherA: 0 };
  for (const [i, row] of old.trials.entries()) {
    const next = current.trials[i]!; assert.equal(row.seed, next.seed);
    if (row.outcome === "A") paired[next.outcome === "A" ? "oldAnewA" : "oldAnewOther"]++;
    else paired[next.outcome === "A" ? "oldOtherNewA" : "neitherA"]++;
  }
  const compact = ({ trials: _trials, historicalReplay, ...report }: ReneeVariantReport) => {
    void _trials; return { ...report, historicalReplay: { seed: historicalReplay.seed, summary: historicalReplay.summary,
      markEventsR21: historicalReplay.r20r21.find((r) => r.round === 21)?.lancerAndMarkEvents.filter((e) => e.sourceSkillId === MARK)
        .map((e) => ({ sourceSide: e.sourceSide, targetTroop: e.targetTroop, damageType: e.damageType,
          skillCoefficient: e.skillCoefficient, roundedDamage: e.roundedDamage })) } };
  };
  const summary = { schema: 1, fixture: RENEE_FIXTURE, sourceFileSha256: fixture.sourceFileSha256,
    interpretation: "Strict same-canonical-input/source/seed comparison of Renee stacking only. Legacy runtime selected by removing only Renee duplicateSourceStacking policy in an isolated current-source snapshot. Not a replay of historical optimizer options, and not a full optimizer search rerun; ranks scan all Head×Body J peaks, Formal holds the supplied 60/39/1 lineup fixed.",
    optimizerOptionsProvenance: fixture.optimizerOptionsProvenance,
    baselinePatch: { file: "src/pvp/heroSkills/definitions/s6Heroes.ts", currentSha256: sha(definition), legacySha256: sha(patched), changedFiles: 1 },
    old: compact(old), new: compact(current), paired,
    delta: { jAtOriginalRatio: current.j.atOriginalRatio - old.j.atOriginalRatio, jMax: current.j.max - old.j.max,
      globalJPeakRank: current.j.globalPeakRank - old.j.globalPeakRank, formalWinRateA: current.formal.winRateA - old.formal.winRateA } };
  writeFileSync(`${DIRECTORY}/renee-duplicate-source-summary.json`, JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(resolve(output, "legacy-source-hashes.json"), JSON.stringify(sourceSnapshot, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ old: old.formal, new: current.formal, delta: summary.delta, paired }, null, 2) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
