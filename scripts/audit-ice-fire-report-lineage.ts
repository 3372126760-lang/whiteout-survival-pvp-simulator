import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { getValidationThreeQueues, toValidationThreeQueueConfig,
  createQueueReportLineageAudit, normalizeIceFireReportLineage } from "../src/pvp/validationUi";
import { createPureTroopBattleState } from "../src/pvp/scenario/pureTroopScenario";
import { calculateHeroStatCorrection } from "../src/pvp/heroSkills/heroStatCorrection";
import { createPersistedEnvelope, restorePersistedConfig } from "../src/storage";
import type { ValidationBattleInput, ValidationSideInput } from "../src/pvp/validationUi/types";

const base = createDefaultValidationInput();
const oldHeroes = { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" };
const side = (): ValidationSideInput => ({ ...base.sideA,
  reportHeroIds: Object.values(oldHeroes), reportHeroByTroop: oldHeroes,
  reportWeaponLevels: Object.fromEntries(Object.values(oldHeroes).map((id) => [id, 10])),
  threeQueues: getValidationThreeQueues(base.sideA).map((queue) => ({ ...queue,
    leaderHeroIds: { shield: null, lancer: null, marksman: null },
    attributeSource: "manualInput", reportHeroByTroop: oldHeroes,
    reportWeaponLevels: Object.fromEntries(Object.values(oldHeroes).map((id) => [id, 10])),
    reportLineage: { source: "historicalReport", attributeSnapshot: structuredClone(queue.attributes!) },
  })) as unknown as NonNullable<ValidationSideInput["threeQueues"]> });
const dirty: ValidationBattleInput = { ...base, scenarioType: "ICE_FIRE_LEAGUE",
  attributeInputMode: "prediction", sideA: side(), sideB: side() };
const input = normalizeIceFireReportLineage(dirty);
const config = toValidationThreeQueueConfig(input);
const queues = ["sideA", "sideB"].flatMap((key) => {
  const sideId = key === "sideA" ? "A" : "B";
  return getValidationThreeQueues(input[key as "sideA" | "sideB"]).map((queue, index) => {
    const attacker = config.attacker.queues[index]!.side;
    const defender = config.defender.queues[index]!.side;
    const state = createPureTroopBattleState({ id: `lineage-${index}`, maxRounds: 1,
      sideA: attacker, sideB: defender });
    const audit = createQueueReportLineageAudit(queue, `${key}.threeQueues[${index}]`);
    const finalFactor = 1 + (sideId === "A" ? state.sideA : state.sideB).troops.shield.attack;
    assert.deepEqual(audit.simulationHeroIds, []);
    assert.deepEqual(audit.reportHoldHeroIds, []);
    assert.equal(audit.heroStaticDeltaPercent.shield!.attack, 0);
    assert.ok(Math.abs(finalFactor - 3.4) < 1e-12);
    return { queue: `${sideId}${index + 1}`, ...audit,
      shieldAttack: { rawInputPercent: 240, heroStaticDeltaPercent: 0, finalFactor } };
  });
});
const envelope = createPersistedEnvelope(input, 1000);
const restored = restorePersistedConfig(envelope).input;
assert.equal(toValidationThreeQueueConfig(restored).battleScenario, "ICE_FIRE_LEAGUE");
const oldDelta = calculateHeroStatCorrection(Object.values(oldHeroes), []).delta.shield.attack;
const legacyFailure = { reportValue: 240, reportFactor: 3.4,
  reportHoldHeroIds: Object.values(oldHeroes), simulationHeroIds: [],
  heroStaticDeltaPercent: oldDelta * 100, finalFactor: 3.4 + oldDelta };
const result = { generatedAt: new Date().toISOString(), legacyFailure,
  preflightPassed: true, saveAndRestorePassed: true, queues };
writeFileSync("examples/ice-fire-report-lineage-audit.json", JSON.stringify(result, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify({ queues: queues.length, finalFactors: queues.map((q) => q.shieldAttack.finalFactor),
  preflightPassed: true, saveAndRestorePassed: true, legacyFailure }, null, 2) + "\n");
