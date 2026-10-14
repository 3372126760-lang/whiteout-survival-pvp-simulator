import { describe, expect, it } from "vitest";
import { deriveExpectedReportAttribute, expectedAttributeAuditIsConsistent } from "../validationUi/expectedReportAttribute";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { previewExpectedReportBonuses, createValidationPreviewState, compileValidationBattle, runValidationBattle } from "../index";
import { zeroReportBonuses } from "../validationUi/reportBonusContexts";

describe("canonical expected report builder", () => {
  const base = { raw: 2541.3, formationDelta: 170.14, targetAdditive: 0,
    targetBuff: .3, targetDebuff: .2 };
  it("sums normal and weapon Buff before construction and rejects post-result addition", () => {
    const totalBuff = .3 + .15;
    const expected = deriveExpectedReportAttribute({ ...base, targetBuff: totalBuff });
    expect(totalBuff).toBeCloseTo(.45, 12);
    expect(deriveExpectedReportAttribute(base)).toBeCloseTo(2945.726666666667, 9);
    expect(expected).toBeCloseTo(3297.156666666667, 9);
    expect(expected).not.toBeCloseTo(deriveExpectedReportAttribute(base) + 15, 4);
    expect(expected).not.toBeCloseTo(deriveExpectedReportAttribute({ ...base,
      targetBuff: 1.3 * 1.15 - 1 }), 4);
    const row = previewExpectedReportBonuses(createDefaultValidationInput()).A.breakdown.shield.attack;
    const audit = { ...row.calculationAudit, displayedRaw: 2541.3, displayedFormationDelta: 170.14,
      displayedTargetAdditive: 0, displayedTargetBuff: .3, displayedTargetDebuff: .2,
      displayedWeaponModifier: 15, currentExternalBuffBase: .3, currentWeaponBuff: .15,
      currentExternalBuffTotal: totalBuff, actualTargetBuffUsed: totalBuff,
      displayedExpected: 2960.7267 };
    expect(expectedAttributeAuditIsConsistent(audit)).toBe(false);
    expect(expectedAttributeAuditIsConsistent({ ...audit, calculatedExpected: expected,
      actualEnginePanel: expected, displayedExpected: 3297.1567 })).toBe(true);
  });
  it.each([
    [{}, 200], [{ targetBuff: .3 }, 290], [{ targetDebuff: .2 }, 150],
    [{ targetAdditive: 5 }, 205], [{ formationDelta: 20 }, 220],
    [{ targetBuff: .15 }, 245],
    [{ targetBuff: .45 }, 335],
    [{ formationDelta: 20, targetAdditive: 5, targetBuff: .45, targetDebuff: .2 }, 292.708333333333],
  ])("handles isolated and combined groups %j", (modifiers, expected) => {
    expect(deriveExpectedReportAttribute({ raw: 200, formationDelta: 0, targetAdditive: 0,
      targetBuff: 0, targetDebuff: 0, ...modifiers })).toBeCloseTo(expected, 9);
  });
  it("uses the same panel in UI, optimizer compilation and battle trace", () => {
    const base = createDefaultValidationInput();
    const matrix = zeroReportBonuses();
    const input = { ...base, attributeInputMode: "prediction" as const, maxRounds: 1,
      sideA: { ...base.sideA, targetBonusMode: "custom" as const,
        targetBattleBonuses: { ...matrix, shield: { ...matrix.shield,
          attack: { additive: 0, buff: 30, debuff: 20 } } },
        troops: { ...base.sideA.troops, shield: { ...base.sideA.troops.shield, attack: 2541.3 } } } };
    const row = previewExpectedReportBonuses(input).A.breakdown.shield.attack;
    const panel = createValidationPreviewState(input).sideA.troops.shield.attack;
    expect(row.finalBonus).toBeCloseTo(panel, 12);
    expect(expectedAttributeAuditIsConsistent(row.calculationAudit)).toBe(true);
    const compile = compileValidationBattle(input);
    expect(compile.runFastTrial(19).outcome).toBe(runValidationBattle({ ...input, randomSeed: 19 }).summary.outcome);
    const event = runValidationBattle(input).trace.rounds[0]!.damageEvents.find((event) =>
      event.sourceSide === "A" && event.sourceTroop === "shield");
    expect(event?.attributeResolutions?.find((attribute) => attribute.attribute === "attack")?.baseAttribute)
      .toBeCloseTo(panel, 12);
  });
});
