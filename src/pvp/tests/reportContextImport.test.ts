import { sourceReportBonuses } from "../validationUi/reportBonusContexts";
import { describe, expect, it } from "vitest";
import { TROOP_TYPES } from "../types/combat";
import { previewReportContextAttribute } from "../battleReportRecognition/mapping";
import type { ParsedBattleReport, ParsedBattleReportSide, ParsedSpecialBonus,
  ReportSourceSide } from "../battleReportRecognition/types";
import { createReportRecognitionState, mergeRecognitionImage,
  clearRecognitionContext } from "../../ui/reportImportDrafts";
import { applyRecognizedReport } from "../../ui/applyRecognizedReport";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const box = [[20, 60], [180, 60], [180, 84], [20, 84]] as const;
function bonus(value: number, category: "additive" | "buff" | "debuff"): ParsedSpecialBonus {
  const label = category === "additive" ? "官职赐予部队攻击力" :
    category === "debuff" ? "敌方攻击力" : "部队攻击力";
  return { label, canonicalLabel: label, attribute: "attack", scope: "general", category,
    troopScope: "all", effectTarget: category === "debuff" ? "enemy" : "self",
    amount: { value, confidence: .99, box } };
}
function report(imageId: string, source: ReportSourceSide, value: number,
  additive: number, buff: number, receivedDebuff: number): ParsedBattleReport {
  const column = (name: ReportSourceSide): ParsedBattleReportSide => ({
    sourceSide: name, troopSetup: {}, specialEvidence: true,
    attributes: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      Object.fromEntries((["attack", "defense", "penetration", "life"] as const)
        .map((stat) => [stat, { value, confidence: .99, box }]))])),
    specialBonuses: name === source ? { additive: [bonus(additive, "additive")],
      buffs: [bonus(buff, "buff")], debuffs: [bonus(99, "debuff")] } :
      { additive: [], buffs: [], debuffs: [bonus(receivedDebuff, "debuff")] },
  });
  return { imageId, left: column("left"), right: column("right"),
    warnings: [], confidence: .99, pageTypes: ["attributes", "specialBonuses"] };
}

describe("independent historical report contexts", () => {
  it("starts incomplete and supports exactly one completeness value", () => {
    const state = createReportRecognitionState();
    expect(state.A.specialBonusCompleteness).toBe("incomplete");
    expect(state.B.specialBonusCompleteness).toBe("incomplete");
    state.A.specialBonusCompleteness = "complete";
    state.A.specialBonusCompleteness = "explicitZero";
    expect(state.A.specialBonusCompleteness).toBe("explicitZero");
    expect(state.B.specialBonusCompleteness).toBe("incomplete");
    const imported = mergeRecognitionImage(state, "A", report("new", "left", 2612.8, 0, 30, 20));
    expect(imported.A.specialBonusCompleteness).toBe("incomplete");
    expect(imported.B).toBe(state.B);
  });

  it("blocks incomplete data; explicit zero discards every historical modifier", () => {
    const context = report("A-history", "left", 2612.8, 5, 30, 20);
    expect(() => previewReportContextAttribute(context, "left", "A", "incomplete", "lancer", "attack"))
      .toThrow(/特殊加成信息尚未完整/);
    expect(() => applyRecognizedReport(createDefaultValidationInput(), context, "left", "A", "incomplete"))
      .toThrow(/尚未完整/);
    const preview = previewReportContextAttribute(context, "left", "A", "explicitZero", "lancer", "attack");
    expect(preview).toMatchObject({ specialBonusAdditivePercent: 0, buffDecimal: 0,
      debuffDecimal: 0, rawPercent: 2612.8, receivedDebuffContributions: [] });
    const applied = applyRecognizedReport(createDefaultValidationInput(), context, "left", "A", "explicitZero");
    expect(applied.sideA.troops.lancer.attack).toBe(2612.8);
    expect(sourceReportBonuses(applied.sideA).lancer.attack).toEqual({ additive: 0, buff: 0, debuff: 0 });
  });

  it("uses A's right historical opponent even when B has never uploaded", () => {
    const state = mergeRecognitionImage(createReportRecognitionState(), "A",
      report("A-history", "left", 2612.8, 0, 30, 20));
    expect(state.B.reportContext).toBeNull();
    const preview = previewReportContextAttribute(state.A.reportContext!, "left", "A", "complete", "lancer", "attack");
    expect(preview.reportValueSource).toEqual({ value: 2612.8, source: "ocrPreview" });
    expect(preview.debuffDecimal).toBe(.2);
    expect(preview.specialBonusAdditivePercent).toBe(0);
    expect(preview.rawPercent).toBeCloseTo((100 + 2612.8) * 1.2 / 1.3 - 100, 10);
    expect(preview.receivedDebuffContributions).toEqual([{
      targetModelSide: "A", sourceRecognitionState: "A", sourceReportSide: "right",
      canonicalLabel: "敌方攻击力", value: 20,
    }]);
    const input = createDefaultValidationInput();
    const before = JSON.stringify(input);
    expect(JSON.stringify(input)).toBe(before);
    const applied = applyRecognizedReport(input, state.A.reportContext!, "left", "A", "complete");
    expect(applied.sideB).toBe(input.sideB);
    expect(sourceReportBonuses(applied.sideA).lancer.attack.debuff).toBe(20);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("never transfers A's enemy effect into independently uploaded B", () => {
    let state = mergeRecognitionImage(createReportRecognitionState(), "A", report("A-history", "left", 2612.8, 0, 30, 20));
    state = mergeRecognitionImage(state, "B", report("B-history", "right", 500, 5, 10, 6.75));
    const bPreview = () => previewReportContextAttribute(state.B.reportContext!, "right", "B", "complete", "lancer", "attack");
    const b = bPreview();
    expect(b.specialBonusAdditivePercent).toBe(5);
    expect(b.debuffDecimal).toBe(.0675);
    expect(b.receivedDebuffContributions).toEqual([{
      targetModelSide: "B", sourceRecognitionState: "B", sourceReportSide: "left",
      canonicalLabel: "敌方攻击力", value: 6.75,
    }]);
    const bContext = state.B;
    state = clearRecognitionContext(state, "A");
    expect(state.B).toBe(bContext);
    expect(bPreview()).toEqual(b);
    state = mergeRecognitionImage(state, "A", report("A-new", "left", 1000, 5, 25, 80), true);
    expect(state.B).toBe(bContext);
    expect(bPreview()).toEqual(b);
    const a = previewReportContextAttribute(state.A.reportContext!, "left", "A", "complete", "shield", "attack");
    const aContext = state.A;
    state = clearRecognitionContext(state, "B");
    state = mergeRecognitionImage(state, "B", report("B-new", "right", 900, 0, 0, 0), true);
    expect(state.A).toBe(aContext);
    expect(previewReportContextAttribute(state.A.reportContext!, "left", "A", "complete", "shield", "attack")).toEqual(a);
  });

  it("keeps unresolved attack rows from blocking defense, penetration or life", () => {
    const context = report("pending", "left", 200, 0, 0, 0);
    const withPending = { ...context, right: { ...context.right!, unmatchedBonuses: [{
      rawText: "未知攻击项目", normalizedText: "未知攻击项目", possibleAttribute: "attack" as const,
      nearestRegistryCandidates: [],
    }] } };
    expect(() => previewReportContextAttribute(withPending, "left", "A", "complete", "shield", "attack"))
      .toThrow(/attack.*待确认/);
    for (const stat of ["defense", "penetration", "life"] as const)
      expect(previewReportContextAttribute(withPending, "left", "A", "complete", "shield", stat).rawPercent).toBe(200);
  });
});
