import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { restorePersistedConfig } from "../src/storage";
import { runRallyOptimization } from "../src/pvp/optimizer";
import { candidateToInput } from "../src/pvp/optimizer/candidateGenerator";
const path = process.argv[2];
if (!path) throw new Error("Usage: tsx scripts/probe-target-value-recovery.ts fixture.json");
const { input, optimizationConfig } = restorePersistedConfig(JSON.parse(readFileSync(path, "utf8")).envelope);
const weak = { leaderHeroIds: input.sideA.leaderHeroIds!, headWeaponLevels: input.sideA.simulationWeaponLevels!,
  memberSkillIds: input.sideA.bodySkills!.map(s => s.skillId === "hero-skill.miya.doom-entanglement" ? "hero-skill.nuola.multi-troop-combat" : s.skillId),
  bodySkillLevels: [5, 5, 5, 5], ratios: input.sideA.rallyDeployment!.ratios };
const started = performance.now();
const result = runRallyOptimization(candidateToInput(input, weak), { ...optimizationConfig,
  constraints: { fixedLeaders: weak.leaderHeroIds },
  jointPipeline: { criterionKeep: 1, criterionFineKeep: 1, theoryKeep: 1, formalRatioKeep: 1,
    formalStages: [{ trials: 20, keep: 1 }, { trials: 50, keep: 1 }, { trials: 100, keep: 1 }, { trials: 300, keep: 1 }] },
});
const output = { purpose: "Recovery probe: fixed same Head, full legal Body pool; start at two Norahs, never inject the known stronger Body as a protected reference. Tight main recall budget, unchanged full battle rules.",
  elapsedMs: performance.now() - started, calls: result.performance.simulatedTrials,
  baseline: result.currentEvaluation, top: result.singleWaveTop, diagnostics: result.searchDiagnostics };
writeFileSync("examples/target-value-recovery-2026-10-24.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ elapsedMs: output.elapsedMs, calls: output.calls, baseline: result.currentEvaluation.winRate,
  top: result.singleWaveTop.map(r => ({ winRate: r.winRate, body: r.candidate.memberSkillIds, ratio: r.candidate.ratios, source: r.candidate.recalledBy })) }, null, 2));
