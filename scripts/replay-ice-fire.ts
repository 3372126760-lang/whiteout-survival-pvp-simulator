import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePersistedJson } from "../src/storage/configCodec";
import { toValidationThreeQueueConfig } from "../src/pvp/validationUi/adapter";
import { KNOWN_ICE_FIRE_FAILURE_SEEDS, replayIceFireTrial } from "../src/pvp/diagnostics/iceFireReplay";
import type { ValidationBattleInput } from "../src/pvp/validationUi/types";

const path = process.argv[2];
if (!path) throw new Error("Usage: node scripts/run-tsx.mjs scripts/replay-ice-fire.ts <export.json> [trial-seed]");
const json = readFileSync(resolve(path),"utf8").replace(/^\uFEFF/,"");
const raw = JSON.parse(json) as { schemaVersion?:unknown; input?:ValidationBattleInput; config?:ValidationBattleInput };
const input = raw.schemaVersion !== undefined ? parsePersistedJson(json).input : raw.input ?? raw.config ?? raw as ValidationBattleInput;
if (input.scenarioType !== "ICE_FIRE_LEAGUE" && input.threeQueueMode !== "ICE_FIRE_LEAGUE") throw new Error("Please export the actual failing IceFire configuration.");
const seeds = process.argv[3] ? [Number(process.argv[3])] : [...KNOWN_ICE_FIRE_FAILURE_SEEDS];
if (seeds.some((seed)=>!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff))throw new Error("Invalid trial seed");
const config = toValidationThreeQueueConfig(input);
const reports = seeds.map((seed) => {
  const report = replayIceFireTrial(config,seed);
  console.log(JSON.stringify({seed,status:report.status,duels:report.duels.map((duel)=>({battleId:duel.report.battleId,
    classification:duel.report.classification,roundCount:duel.report.roundCount}))}));
  return report;
});
const output = resolve(process.argv[4] ?? "examples/ice-fire-failure-replay.json");
writeFileSync(output,JSON.stringify({sourceConfig:resolve(path),generatedAt:new Date().toISOString(),reports},null,2));
console.log(output);
