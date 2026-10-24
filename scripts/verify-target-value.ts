import { readFileSync, writeFileSync } from "node:fs";
import { restorePersistedConfig } from "../src/storage";
import { createEngineCandidateRunner, createStageSeeds } from "../src/pvp/optimizer";
import { candidateKey } from "../src/pvp/optimizer/candidateGenerator";
import type { RallyCandidate } from "../src/pvp/optimizer/types";
const [fixturePath, browserPath, outputPath] = process.argv.slice(2);
if (!fixturePath || !browserPath) throw new Error("Usage: tsx scripts/verify-target-value.ts fixture.json browser-diagnostics.json");
const { input } = restorePersistedConfig(JSON.parse(readFileSync(fixturePath, "utf8")).envelope);
const browser = JSON.parse(readFileSync(browserPath, "utf8"));
const finalists = browser.diagnostics.jointPipeline.finalCorrelation.finalists as (RallyCandidate & { winRate: number })[];
const baseline = finalists.find(c => c.recalledBy?.includes("currentConfig"));
if (!baseline) throw new Error("Missing exact baseline in browser result");
const selected = [...new Map([baseline, ...finalists.slice(0, 2)].map(c => [candidateKey(c), c])).values()];
const runner = createEngineCandidateRunner(input), seeds = createStageSeeds(20261024, 1000, 2700000);
const results = selected.map(candidate => ({ candidate, trials: seeds.length,
  wins: runner(candidate, seeds).map(s => Number(s.outcome === "A")) }));
const reference = results[0]!.wins;
const rows = results.map(row => {
  const differences = row.wins.map((win, i) => win - reference[i]!);
  const gain = differences.reduce((a, b) => a + b, 0) / differences.length;
  const variance = differences.reduce((sum, d) => sum + (d - gain) ** 2, 0) / (differences.length - 1);
  const uncertainty = 1.96 * Math.sqrt(variance / differences.length);
  return { candidate: row.candidate, trials: row.trials, verificationWinRate: row.candidate.winRate,
    holdoutWinRate: row.wins.reduce((a, b) => a + b, 0) / row.trials,
    pairedGain: gain, pairedGain95: [gain - uncertainty, gain + uncertainty],
    improvedSeeds: differences.filter(d => d > 0).length, regressedSeeds: differences.filter(d => d < 0).length };
});
writeFileSync(outputPath ?? "examples/target-value-final-holdout-2026-10-24.json", JSON.stringify({
  provenance: "Same user fixture, candidates read from visible browser diagnostics; 1000 shared external holdout seeds, not used in search or final selection.", firstSeed: seeds[0], rows,
}, null, 2));
console.log(JSON.stringify(rows.map(r => ({ body: r.candidate.memberSkillIds, ratios: r.candidate.ratios,
  verification: r.verificationWinRate, holdout: r.holdoutWinRate, pairedGain95: r.pairedGain95 })), null, 2));
