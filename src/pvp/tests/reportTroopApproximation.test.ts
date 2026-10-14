import { normalizeRecognitionResult } from "./fixtures/historicalReportRecognition";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveDisplayedTroopComposition, TROOP_APPROXIMATION_WARNING } from "../battleReportRecognition/troopResolution";
import { createValidationPreviewState, getValidationThreeQueues,
  toValidationThreeQueueConfig, runValidationBattle } from "../validationUi/adapter";
import { runThreeQueueScenarioFast } from "../scenario/threeQueueScenario";
import { getTroopConstant } from "../data/troopConstants";
import { createPureTroopBattleState } from "../scenario/pureTroopScenario";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { applyRecognizedReport } from "../../ui/applyRecognizedReport";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import type { OcrImage, OcrLine } from "../battleReportRecognition/types";

function line(text: string, y: number): OcrLine {
  return { text, confidence: .98, box: [[20, y], [390, y], [390, y + 24], [20, y + 24]] };
}
function troopReport() {
  const lines: OcrLine[] = [];
  for (const [index, name] of ["盾兵", "矛兵", "射手"].entries()) {
    for (const [statIndex, stat] of ["攻击力", "防御力", "穿透力", "生命值"].entries())
      lines.push(line(`${name}${stat} 500%`, 35 + index * 160 + statIndex * 35));
    const y = 580 + index * 100;
    lines.push(line(`${name}兵种等级 ${["11.0", "10.3", "11.4"][index]}`, y));
    lines.push(line(`${name}数量 ${[741805, 64035, 886378][index]}`, y + 30));
    lines.push(line(`${name}火晶等级 10`, y + 60));
    lines.push(line(`${name}T12技能等级 5`, 900 + index * 30));
  }
  const image: OcrImage = { imageId: "troop-defaults", width: 1200, height: 1050, lines };
  return normalizeRecognitionResult(image);
}

describe("nonblocking battle-report troop approximation", () => {
  it.each([[11, 1, 0], [11.1, .9, .1], [11.4, .6, .4], [11.5, .5, .5], [11.9, .1, .9]])(
    "restores displayed %s and FC10 as real game groups", (displayed, lower, upper) => {
      const parts = resolveDisplayedTroopComposition(displayed, 10, 1000);
      expect(parts[0]).toMatchObject({ baseTier: 11, level: "T11-FC10", ratio: lower, fireCrystalLevel: 10 });
      if (upper === 0) expect(parts).toHaveLength(1);
      else expect(parts[1]).toMatchObject({ baseTier: 12, level: "T12-FC10", ratio: upper, fireCrystalLevel: 10 });
      expect(parts.reduce((sum, part) => sum + (part.count ?? 0), 0)).toBe(1000);
    });

  it("keeps 3/3 troop success with no FC precision or T12-skill confirmation", () => {
    const report = troopReport();
    const setups = Object.values(report.left!.troopSetup);
    expect(setups).toHaveLength(3);
    for (const setup of setups) {
      expect(setup.count?.needsConfirmation).toBe(false);
      expect(setup.displayedTroopLevel?.needsConfirmation).toBe(false);
      expect(setup.displayedFireCrystalLevel?.needsConfirmation).toBe(false);
      expect(setup.level?.needsConfirmation).toBe(false);
      expect(setup.resolutionSource).toBe("battleReportApproximation");
      expect(setup).not.toHaveProperty("t12SkillLevel");
    }
    expect(report.warnings.filter((warning) => warning === TROOP_APPROXIMATION_WARNING)).toHaveLength(1);
    expect(report.warnings.some((warning) => /无法唯一确定|T12.*技能/.test(warning))).toBe(false);
  });

  it("applies directly, preserves manual T12 level and passes real groups into BattleState", () => {
    const base = createDefaultValidationInput();
    const before = { ...base, maxRounds: 1, sideA: { ...base.sideA, troops: {
      ...base.sideA.troops, marksman: { ...base.sideA.troops.marksman, t12Level: 17 },
    } } };
    const applied = applyRecognizedReport(before, troopReport(), "left", "A", "explicitZero");
    expect(applied.sideA.troops.shield.troopLevel).toBe("T11-FC10");
    expect(applied.sideA.troops.shield.levelMode).toBe("single");
    expect(applied.sideA.troops.marksman.levelMode).toBe("mixed");
    expect(applied.sideA.troops.marksman.levelComposition?.map((part) => part.level)).toEqual(["T11-FC10", "T12-FC10"]);
    expect(applied.sideA.troops.marksman.t12Level).toBe(17);
    expect(before.sideA.troops.marksman.count).toBe(12000);
    expect(applied.sideB).toBe(before.sideB);
    const state = createValidationPreviewState(applied);
    const troop = state.sideA.troops.marksman;
    expect(troop.aliveCount).toBe(886378);
    expect(troop.levelComposition.map((part) => part.level)).toEqual(["T11-FC10", "T12-FC10"]);
    const parts = applied.sideA.troops.marksman.levelComposition!;
    const expected = parts.reduce((sum, part) => sum + part.aliveCount * getTroopConstant(part.level), 0) / 886378;
    expect(troop.troopConstant).toBeCloseTo(expected, 10);
    expect(() => runValidationBattle(applied)).not.toThrow();
  });

  it("retains imported mixtures in only the selected three-queue and through scenario matching", () => {
    const base = { ...createDefaultValidationInput(), scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const, maxRounds: 1 };
    const original = getValidationThreeQueues(base.sideA);
    const applied = applyRecognizedReport(base, troopReport(), "left", "A", "explicitZero", 1);
    expect(applied.sideA.threeQueues?.[0]).toEqual(original[0]);
    expect(applied.sideA.threeQueues?.[2]).toEqual(original[2]);
    expect(applied.sideA.threeQueues?.[1].troopLevelCompositions?.marksman?.map((part) => part.level))
      .toEqual(["T11-FC10", "T12-FC10"]);
    let sawMixed = false;
    runThreeQueueScenarioFast(toValidationThreeQueueConfig(applied), (scenario) => {
      if (/A2-vs-/.test(scenario.id)) {
        sawMixed = true;
        const parts = scenario.sideA.marksman.levelComposition!;
        expect(parts.map((part) => part.level)).toEqual(["T11-FC10", "T12-FC10"]);
        expect(parts.reduce((sum, part) => sum + part.aliveCount, 0)).toBe(scenario.sideA.marksman.count);
        expect(parts[0]!.aliveCount / scenario.sideA.marksman.count).toBeCloseTo(.6, 3);
        const state = createPureTroopBattleState(scenario);
        const expected = parts.reduce((sum, part) => sum + part.aliveCount * getTroopConstant(part.level), 0) / scenario.sideA.marksman.count;
        expect(state.sideA.troops.marksman.troopConstant).toBeCloseTo(expected, 10);
      }
      return { winner: "A", attackerSurvivors: { shield: scenario.sideA.shield.count,
        lancer: scenario.sideA.lancer.count, marksman: scenario.sideA.marksman.count },
      defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 }, roundCount: 1 };
    }, { rule: "uniformAliveRandom", ruleStatus: "provisional", seed: 1,
      pick: (a, b) => ({ attackerQueueId: a.includes("A2") ? "A2" : a[0]!, defenderQueueId: b[0]! }) });
    expect(sawMixed).toBe(true);
    const restored = restorePersistedConfig(createPersistedEnvelope(applied, 1000)).input;
    expect(restored.sideA.threeQueues?.[1].troopLevelCompositions).toEqual(applied.sideA.threeQueues?.[1].troopLevelCompositions);
  });

  it("persists default composition and keeps a subsequent user override", () => {
    const applied = applyRecognizedReport(createDefaultValidationInput(), troopReport(), "left", "A", "explicitZero");
    const changed = { ...applied, sideA: { ...applied.sideA, troops: { ...applied.sideA.troops,
      marksman: { ...applied.sideA.troops.marksman, resolutionSource: "userOverride" as const,
        levelComposition: [{ level: "T11-FC10", aliveCount: 100 }, { level: "T12-FC10", aliveCount: 900 }], count: 1000 },
    } } };
    const restored = restorePersistedConfig(createPersistedEnvelope(changed, 1000)).input;
    expect(restored.sideA.troops.marksman.resolutionSource).toBe("userOverride");
    expect(restored.sideA.troops.marksman.levelComposition).toEqual(changed.sideA.troops.marksman.levelComposition);
    expect(createValidationPreviewState(restored).sideA.troops.marksman.aliveCount).toBe(1000);
  });

  it("shows no OCR T12-skill column, while keeping the formal configuration input", () => {
    const source = readFileSync(new URL("../../ui/main.ts", import.meta.url), "utf8");
    expect(source).not.toContain("<th>T12 技能</th>");
    expect(source).not.toContain("t12SkillLevel");
    expect(source).not.toContain("<th>战报火晶等级</th>");
    expect(source).toContain("T12 兵种技能等级");
  });

  it("keeps imported groups while rally capacity rescales troop counts", () => {
    const applied = applyRecognizedReport(createDefaultValidationInput(), troopReport(), "left", "A", "explicitZero");
    const rally = { ...applied, battleContext: "rally" as const, scenarioType: "RALLY" as const,
      sideA: { ...applied.sideA, rallyDeployment: { totalTroops: 10000,
        ratios: { shield: 34, lancer: 33, marksman: 33 } } } };
    const troop = createValidationPreviewState(rally).sideA.troops.marksman;
    expect(troop.aliveCount).toBe(3300);
    expect(troop.levelComposition.map((part) => part.level)).toEqual(["T11-FC10", "T12-FC10"]);
    expect(troop.levelComposition.reduce((sum, part) => sum + part.aliveCount, 0)).toBe(3300);
    expect(troop.levelComposition[0]?.aliveCount).toBe(1980);
  });
});
