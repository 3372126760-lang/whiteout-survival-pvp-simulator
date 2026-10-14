import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { normalizeRecognitionResult } from "../src/pvp/battleReportRecognition/recognize";
import type { OcrImage } from "../src/pvp/battleReportRecognition/types";
const image = JSON.parse(readFileSync("examples/ice-fire-local-ocr-smoke.json","utf8")) as OcrImage;
const report = normalizeRecognitionResult(image), column = report.left!;
assert.equal(column.specialBonuses!.additive[0]!.amount.value,0);
assert.equal(column.specialBonuses!.debuffs[0]!.attribute,"penetration");
assert.equal(column.specialBonuses!.debuffs[0]!.effectTarget,"enemy");
assert.equal(column.specialBonuses!.debuffs[0]!.amount.value,5);
assert.deepEqual(column.troopSetup,{shield:{},lancer:{},marksman:{}});
assert.equal(column.attributes.shield!.attack!.value,1917.1);
writeFileSync("examples/ice-fire-local-special-parser.json",JSON.stringify({syntheticImage:true,localOnly:true,report},null,2)+"\n","utf8");
console.log(JSON.stringify({localOnly:true,attribute:column.attributes.shield!.attack!.value,
  specialBonusCount:Object.values(column.specialBonuses!).flat().length,troopInference:false}));
