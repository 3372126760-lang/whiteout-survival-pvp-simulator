import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { restorePersistedConfig } from "../src/storage";
import { runRallyOptimization, createEngineCandidateRunner, createStageSeeds } from "../src/pvp/optimizer";
import { candidateToInput } from "../src/pvp/optimizer/candidateGenerator";
const path = process.argv[2];
if (!path) throw new Error("Pass the user benchmark fixture path.");
const { input, optimizationConfig } = restorePersistedConfig(JSON.parse(readFileSync(path, "utf8")).envelope);
const weak = { leaderHeroIds: input.sideA.leaderHeroIds!, headWeaponLevels: input.sideA.simulationWeaponLevels!,
  memberSkillIds: input.sideA.bodySkills!.map(s => s.skillId === "hero-skill.miya.doom-entanglement" ? "hero-skill.nuola.multi-troop-combat" : s.skillId),
  bodySkillLevels: input.sideA.bodySkills!.map(s => s.skillLevel), ratios: input.sideA.rallyDeployment!.ratios };
const baseline = candidateToInput(input, weak);
const started = performance.now(); let last = "";
const result = runRallyOptimization(baseline, { ...optimizationConfig, protectedCandidates: [], jointDebugCandidates: [] }, p => {
  if (last !== p.stage) { last = p.stage; console.log(last); }
});
const elapsedMs = performance.now() - started;
const runner = createEngineCandidateRunner(baseline), seeds = createStageSeeds(20261024, 1000, 2700000);
const top = result.singleWaveTop.slice(0, 3).map(row => ({ candidate: row.candidate, winRate: row.winRate,
  holdoutWinRate: runner(row.candidate, seeds).filter(s => s.outcome === "A").length / seeds.length }));
const output = { purpose: "Full free Head/Body search from two Norahs; no known stronger protected candidate; full default budgets and engine.",
  elapsedMs, calls: result.performance.simulatedTrials, baselineWinRate: result.currentEvaluation.winRate, top, diagnostics: result.searchDiagnostics };
writeFileSync("examples/diverse-recall-2026-10-24.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ elapsedMs, calls: output.calls, baseline: output.baselineWinRate, top }, null, 2));
