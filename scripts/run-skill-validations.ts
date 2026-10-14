import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSkillValidationCase,
  runSkillValidationCase,
  type SkillValidationFixture,
  type SkillValidationReport,
} from "../src/pvp";
import { createDefaultValidationInput } from "../src/ui/defaultInput";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = join(
  scriptDirectory,
  "..",
  "src",
  "pvp",
  "validation",
  "cases",
);
const requestedIds = new Set(
  process.argv.slice(2).filter((argument) => !argument.startsWith("--")),
);
const countArgument = process.argv.find((argument) => argument.startsWith("--count="));
const countOverride = countArgument === undefined
  ? undefined
  : Number(countArgument.slice("--count=".length));

const fixtureFiles = readdirSync(fixtureDirectory)
  .filter((file) => file.endsWith(".json"))
  .sort();
let failed = false;

for (const file of fixtureFiles) {
  const fixture = JSON.parse(
    readFileSync(join(fixtureDirectory, file), "utf8"),
  ) as SkillValidationFixture;
  if (requestedIds.size > 0 && !requestedIds.has(fixture.id)) continue;
  const validationCase = createSkillValidationCase(
    fixture,
    createDefaultValidationInput(),
  );
  const report = runSkillValidationCase(
    validationCase,
    countOverride ?? fixture.simulationCount,
  );
  printReport(report);
  if (!report.passed) failed = true;
}

if (failed) process.exitCode = 1;

function printReport(report: SkillValidationReport): void {
  const side = report.fixture.targetSide;
  const probability = report.probability;
  console.log(`\n技能：${report.fixture.name}`);
  console.log(`案例：${report.fixture.id}`);
  console.log(`模拟次数：${report.simulationCount}`);
  if (probability !== null) {
    console.log(`理论概率：${percent(probability.theoreticalProbability)}`);
    console.log(`实际触发率：${probability.actualProbability === null ? "—" : percent(probability.actualProbability)}`);
    console.log(`概率偏差：${probability.absoluteDeviation === null ? "—" : percent(probability.absoluteDeviation)}`);
    console.log(`检查次数：${probability.probabilityCheckCount}`);
    console.log(`触发次数：${probability.procSuccessCount}`);
  }
  if (report.fixture.theoreticalImpact?.damageGain !== undefined) {
    console.log(`理论伤害增益：${percent(report.fixture.theoreticalImpact.damageGain)}`);
  }
  if (report.fixture.theoreticalImpact?.damageTakenReduction !== undefined) {
    console.log(`理论承伤降低：${percent(report.fixture.theoreticalImpact.damageTakenReduction)}`);
  }
  console.log(`胜率：${percent(report.skill.winRates[side])}`);
  console.log(`平均剩余兵：${fixed(report.skill.expectedRemaining[side].total)}`);
  console.log(`平均增加伤害：${fixed(report.impact.averageDamageIncrease)}`);
  console.log(`模拟等效伤害增益：${nullablePercent(report.impact.equivalentDamageGain)}`);
  console.log(`敌方平均伤害变化：${fixed(report.impact.averageEnemyDamageChange)}`);
  console.log(`模拟等效承伤降低：${nullablePercent(report.impact.equivalentDamageTakenReduction)}`);
  console.log(`平均剩余兵提升：${fixed(report.impact.averageRemainingIncrease)}`);
  console.log(`平均战斗回合变化：${fixed(report.impact.averageRoundsChange)}`);
  console.log(`非目标概率技能成功次数：${report.nonTargetProbabilitySuccessCount}`);
  console.log(`验收结果：${report.passed ? "通过" : "失败"}`);
  for (const failure of report.failures) console.log(`  - ${failure}`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function nullablePercent(value: number | null): string {
  return value === null ? "—" : percent(value);
}

function fixed(value: number): string {
  return value.toFixed(2);
}
