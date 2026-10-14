import { TROOP_TYPES, type SideId } from "../types/combat";
import { createValidationPreviewState, getValidationThreeQueues, previewExpectedReportBonuses } from "./adapter";
import { queueConversionSide } from "./queueConversion";
import { rawReportSide } from "./reportBonusContexts";
import { queueHeroIds, normalizeIceFireReportLineage } from "./queueReportLineage";
import { iceFireExpertSkillAudit, iceFireSharedContext } from "./iceFireContext";
import type { ValidationBattleInput, ValidationQueueAttributes } from "./types";

export function iceFireQueueConversionAudit(input: ValidationBattleInput, side: SideId, index: number) {
  input = normalizeIceFireReportLineage(input);
  const key = side === "A" ? "sideA" : "sideB", queue = getValidationThreeQueues(input[key])[index]!;
  const single = { ...input, scenarioType: "SINGLE" as const, battleContext: "challenge" as const, attributeInputMode: "prediction" as const,
    sideA: queueConversionSide(input, "A", getValidationThreeQueues(input.sideA)[index]!),
    sideB: queueConversionSide(input, "B", getValidationThreeQueues(input.sideB)[index]!) };
  const state = createValidationPreviewState(single), breakdown = previewExpectedReportBonuses(single, state)[side];
  const raw = rawReportSide(single[key]);
  const rawAttributes = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(["attack", "defense", "penetration", "life"].map((stat) =>
      [stat, raw.troops[troop][stat as keyof ValidationQueueAttributes[typeof troop]]]))])) as ValidationQueueAttributes;
  const matrix = (field: "hero" | "weapon") => Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(["attack", "defense", "penetration", "life"].map((stat) => {
      const correction = (side === "A" ? state.sideA : state.sideB).heroStatCorrection;
      const attr = stat as keyof ValidationQueueAttributes[typeof troop];
      const weapon = ((correction?.simulationWeaponContribution[troop][attr] ?? 0) - (correction?.reportWeaponContribution[troop][attr] ?? 0)) * 100;
      const total = (correction?.delta[troop][attr] ?? 0) * 100;
      return [stat, field === "weapon" ? weapon : total - weapon];
    }))]));
  const correction = (side === "A" ? state.sideA : state.sideB).heroStatCorrection;
  const baseAttributes = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(Object.entries(rawAttributes[troop]).map(([stat, value]) => [stat,
      value - (correction?.reportTotalContribution[troop][stat as keyof ValidationQueueAttributes[typeof troop]] ?? 0) * 100]))])) as ValidationQueueAttributes;
  return { sharedPetContext: iceFireSharedContext(input[key]).petContext, sharedExpertContext: iceFireSharedContext(input[key]).expertContext,
    ...iceFireExpertSkillAudit(input[key]),
    reportHeroIds: queueHeroIds(queue.reportHeroByTroop ?? {}), reportWeaponLevels: queue.reportWeaponLevels ?? {},
    reportHoldHeroIds: queueHeroIds(queue.reportHeroByTroop ?? {}), simulationHeroIds: queueHeroIds(queue.leaderHeroIds),
    expectedHeroIds: queueHeroIds(queue.leaderHeroIds), expectedWeaponLevels: queue.weaponLevels ?? {},
    reportAttributes: queue.sourceReportAttributes ?? queue.attributes, recognizedSpecialBonuses: queue.recognizedSpecialBonuses,
    rawAttributesAfterSpecialReverse: rawAttributes, rawAttributesAfterReverse: baseAttributes, expectedAttributesAfterHeroConversion: Object.fromEntries(TROOP_TYPES.map((troop) =>
      [troop, Object.fromEntries(Object.entries(breakdown.troops[troop]).map(([stat, value]) => [stat, value * 100]))])) as ValidationQueueAttributes,
    heroStaticDeltaPercent: matrix("hero"), weaponStaticDeltaPercent: matrix("weapon"), breakdown };
}
