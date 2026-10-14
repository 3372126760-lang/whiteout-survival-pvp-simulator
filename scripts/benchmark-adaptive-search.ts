import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { candidateKey, defaultOptimizationConfig, searchSingleWave, createEngineCandidateRunner,
  createStageSeeds, wilsonInterval, type OptimizationConfig, type SingleSearchResult, type RallyCandidate } from "../src/pvp/optimizer";
import { rallyHeadSearchFixture, opponentCandidate } from "../src/pvp/tests/fixtures/rallyHeadSearch";

const previous = JSON.parse(readFileSync("examples/optimizer-profiling-benchmark.json", "utf8"));
const oldConfig: OptimizationConfig = { ...previous.config, profiling: true, adaptiveSearch: { enabled: false } };
const input = rallyHeadSearchFixture();
const priorBest = previous.topCandidates[0].candidate as RallyCandidate;
const preview = process.argv.includes("--new-only");
function run(config: OptimizationConfig, label: string) {
  let lastLog = -Infinity;
  const started = performance.now();
  const result = searchSingleWave(input, config, (row) => {
    if (performance.now() - lastLog > 15000 || row.completed === row.total) {
      process.stdout.write(`${label}: ${row.stage} ${row.completed}/${row.total}\n`); lastLog = performance.now();
    }
  });
  return { wallMs: performance.now() - started, result };
}
const newConfig: OptimizationConfig = { ...oldConfig, stages: defaultOptimizationConfig(91).stages,
  adaptiveSearch: { enabled: true } };
if (preview) {
  const newer = run(newConfig, "adaptive-preview");
  writeFileSync("examples/adaptive-search-preview.json", JSON.stringify(newer, null, 2));
  process.stdout.write(JSON.stringify({ wallMs: newer.wallMs, calls: newer.result.performance.simulatedTrials,
    top: newer.result.top.map((row) => ({ candidate: row.candidate, wins: row.wins, trials: row.trials })),
    integrity: newer.result.searchDiagnostics.searchIntegrityReport }, null, 2) + "\n");
} else {
  const scenarios = [
    { name: "original-six-hero-fixture", references: [opponentCandidate()] },
    { name: "known-prior-best-reference", references: [opponentCandidate(), priorBest] },
  ];
  const comparisons = [];
  for (const scenario of scenarios) {
    const old = run({ ...oldConfig, protectedCandidates: scenario.references }, `${scenario.name}/legacy`);
    const newer = run({ ...newConfig, protectedCandidates: scenario.references }, `${scenario.name}/adaptive`);
    const summarize = (value: SingleSearchResult) => ({ calls: value.searchPerformanceReport!.totalBattleEngineCalls,
      best: value.top[0], top: value.top, performance: value.searchPerformanceReport,
      integrity: value.searchDiagnostics.searchIntegrityReport, ratios: value.searchDiagnostics.ratioSearchAudit });
    const oldKeys = new Set(old.result.top.map((row) => candidateKey(row.candidate)));
    const overlap = newer.result.top.filter((row) => oldKeys.has(candidateKey(row.candidate))).length;
    const runner = createEngineCandidateRunner(input), seeds = createStageSeeds(91, 2000, 900000);
    const validationCache = new Map<string, ReturnType<typeof runner>>();
    const validate = (candidate: RallyCandidate) => {
      const key = candidateKey(candidate); let rows = validationCache.get(key);
      if (!rows) { rows = runner(candidate, seeds); validationCache.set(key, rows); }
      return rows;
    };
    const oldHeldout = validate(old.result.top[0]!.candidate), newHeldout = validate(newer.result.top[0]!.candidate);
    let oldOnlyWins = 0, newOnlyWins = 0;
    for (let i = 0; i < seeds.length; i++) {
      const a = oldHeldout[i]!.outcome === "A", b = newHeldout[i]!.outcome === "A";
      if (a && !b) oldOnlyWins++; if (b && !a) newOnlyWins++;
    }
    const discordant = oldOnlyWins + newOnlyWins;
    const pairedOldInterval = discordant ? wilsonInterval(oldOnlyWins, discordant, 3.2905267314919255) : [0, 1];
    const holdout = { runsPerUniqueConfig: seeds.length, actualValidationCalls: validationCache.size * seeds.length,
      oldWins: oldHeldout.filter((row) => row.outcome === "A").length,
      newWins: newHeldout.filter((row) => row.outcome === "A").length, oldOnlyWins, newOnlyWins,
      pairedOldInterval, statisticallyWorse: pairedOldInterval[0]! > .5 };
    const formalKeys = new Set(newer.result.searchDiagnostics.battleSelections!.map((row) => row.candidateKey));
    comparisons.push({ name: scenario.name, configuration: { old: { ...oldConfig, protectedCandidates: scenario.references },
      new: { ...newConfig, protectedCandidates: scenario.references } },
      old: { wallMs: old.wallMs, ...summarize(old.result) }, new: { wallMs: newer.wallMs, ...summarize(newer.result) },
      callReduction: 1 - newer.result.performance.simulatedTrials / old.result.performance.simulatedTrials,
      wallReduction: 1 - newer.wallMs / old.wallMs, bestChanged: candidateKey(old.result.top[0]!.candidate) !== candidateKey(newer.result.top[0]!.candidate),
      top5Overlap: overlap / Math.min(5, old.result.top.length),
      knownReferencesRetained: scenario.references.every((candidate) => formalKeys.has(candidateKey(candidate))), holdout });
    writeFileSync("examples/adaptive-search-benchmark.json", JSON.stringify({
      provenance: "Synthetic equal-panel six-hero fixtures. Sequential real BattleEngine, legacy 200-run M4 vs adaptive 150-run M4; both Final max1000. Same input and firstSeed=91. Independent paired 2000-run holdout is outside optimizer budgets. No real game report and no global optimality claim.",
      comparisons }, null, 2));
    process.stdout.write(JSON.stringify({ name: scenario.name, oldMs: old.wallMs, newMs: newer.wallMs,
      oldCalls: old.result.performance.simulatedTrials, newCalls: newer.result.performance.simulatedTrials,
      top5Overlap: comparisons.at(-1)!.top5Overlap, holdout }, null, 2) + "\n");
    if (holdout.statisticallyWorse || !comparisons.at(-1)!.knownReferencesRetained)
      throw new Error("Adaptive search lost a known reference or regressed on independent paired validation.");
  }
}
