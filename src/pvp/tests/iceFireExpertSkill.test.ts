import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { renderIceFireSide } from "../../ui/iceFireView";
import { renderExpertSkillOptions } from "../../ui/expertSkillView";
import { DEFAULT_EXTERNAL_BUFF_CONFIG, GARETH_FOURTH_SKILL_ID, resolveExpertSkillEffect,
  resolveExternalBuffs, UnresolvedExpertSkillEffectError } from "../externalBuffs";
import { getValidationThreeQueues, toValidationThreeQueueConfig } from "../validationUi";
import { iceFireExpertSkillAudit } from "../validationUi/iceFireContext";
import { iceFireQueueConversionAudit } from "../validationUi/iceFireAudit";
import { normalizeIceFireReportLineage } from "../validationUi/queueReportLineage";
import { currentCriterionQueueState, createCriterionThreeQueueEvaluator } from "../optimizer/criterion/threeQueue";
import { defaultThreeQueueOptimizationOptions, optimizeThreeQueueScenario } from "../optimizer/threeQueueOptimizer";
import { createPureTroopBattleState } from "../scenario/pureTroopScenario";
import { TROOP_TYPES } from "../types";
import type { ValidationBattleInput, ValidationSideInput } from "../validationUi/types";

function fixture(aLevel = 8, bLevel = 20): ValidationBattleInput {
  const base = createDefaultValidationInput();
  const side = (source: ValidationSideInput, level: number): ValidationSideInput => ({
    ...source, deploymentCapacity: 60, reportHeroIds: [], reportHeroByTroop: {},
    reportWeaponLevels: {}, simulationWeaponLevels: {},
    shared: { petContext: { ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet }, expertContext: { garethFourthSkillLevel: level } },
    threeQueues: getValidationThreeQueues(source).map((queue) => ({ ...queue,
      leaderHeroIds: {}, reportHeroByTroop: {}, reportWeaponLevels: {}, weaponLevels: {}, heroSkillLevels: {},
      attributes: { shield: { attack:1000, defense:1000, penetration:1000, life:1000 },
        lancer: { attack:1000, defense:1000, penetration:1000, life:1000 },
        marksman: { attack:1000, defense:1000, penetration:1000, life:1000 } },
      reportAttributeBasis: "raw", ratios: { shield:50, lancer:20, marksman:30 },
      troopLevels: { shield:"T10", lancer:"T10", marksman:"T10" }, t12Levels: { shield:0, lancer:0, marksman:0 },
    })) as unknown as NonNullable<ValidationSideInput["threeQueues"]>,
  });
  return normalizeIceFireReportLineage({ ...base, scenarioType:"ICE_FIRE_LEAGUE", attributeInputMode:"prediction",
    sideA: side(base.sideA,aLevel), sideB: side(base.sideB,bLevel), maxRounds:40 });
}

describe("IceFire expert level display and shared effect resolution", () => {
  it.each([[8,.02,"Lv8 · 2.0%"],[20,.05,"Lv20 · 5.0%"]] as const)("resolves Lv%i from the same data as external modifiers", (level,value,label) => {
    const resolved = resolveExpertSkillEffect(GARETH_FOURTH_SKILL_ID,level);
    expect(resolved.effectResolved).toBe(true); expect(resolved.displayText).toBe(label);
    expect(resolved.effects).toEqual([{ attribute:"penetration",effectTarget:"enemy",troopScope:"all",
      category:"debuff",multiplierGroup:"externalDebuff",value }]);
    expect(resolveExternalBuffs({ ...DEFAULT_EXTERNAL_BUFF_CONFIG, expert:{garethFourthSkillLevel:level} }).enemyDebuffs.penetration).toBe(value);
  });

  it("distinguishes configured zero from missing data and never defaults missing data to zero or Lv20", () => {
    expect(resolveExpertSkillEffect(GARETH_FOURTH_SKILL_ID,0)).toMatchObject({ effectResolved:true,displayText:"Lv0 · 0.0%" });
    for (const [id,level] of [[GARETH_FOURTH_SKILL_ID,21],["expert.unknown",8]] as const) {
      expect(resolveExpertSkillEffect(id,level)).toMatchObject({ effectResolved:false,effects:null,displayText:`Lv${level} · 数值未配置` });
    }
    const input = fixture(21);
    expect(iceFireExpertSkillAudit(input.sideA)).toMatchObject({ expertSkillLevel:21,expertSkillEffectResolved:false,resolvedExpertSkillEffects:null });
    expect(renderExpertSkillOptions(21)).toContain('<option value="21" selected>Lv21 · 数值未配置</option>');
    expect(renderIceFireSide(input,"A")).toContain('data-expert-skill-effect-resolved="false"');
    expect(() => toValidationThreeQueueConfig(input)).toThrow(UnresolvedExpertSkillEffectError);
  });

  it("shows the selected effect and scope independently for A and B", () => {
    const input = fixture(), a = renderIceFireSide(input,"A"), b = renderIceFireSide(input,"B");
    expect(a).toContain('<option value="8" selected>Lv8 · 2.0%</option>');
    expect(b).toContain('<option value="20" selected>Lv20 · 5.0%</option>');
    expect(a).toContain("当前效果：敌方全军穿透降低2.0%");
    expect(b).toContain("当前效果：敌方全军穿透降低5.0%");
    expect(a).toContain("本侧三队共享，对敌方全军生效，单场只应用一次");
  });

  it("changing only A's expert level changes Criterion and Theory inputs without altering B's selected level", () => {
    const before = fixture(8,20), after = fixture(20,20);
    for (const kernel of ["criterion","theory"] as const) {
      const compiled = [before,after].map((input) => {
        const evaluator = createCriterionThreeQueueEvaluator(input,kernel);
        evaluator.matchup(currentCriterionQueueState(input,"A").queues[0],currentCriterionQueueState(input,"B").queues[0],0,0);
        return kernel === "criterion" ? [...evaluator.cache.values()][0]!.b.normal : [...evaluator.theoryCache.values()][0]!.sideB.normalDamage;
      });
      expect(compiled[1]).not.toEqual(compiled[0]);
    }
    expect(after.sideB.shared!.expertContext).toEqual(before.sideB.shared!.expertContext);
    expect(iceFireQueueConversionAudit(after,"A",0).expectedAttributesAfterHeroConversion)
      .toEqual(iceFireQueueConversionAudit(before,"A",0).expectedAttributesAfterHeroConversion);
  });

  it.each([0,1,2])("applies A Lv8 and B Lv20 once, never three times, to formal queue %i", (index) => {
    const input = fixture(), config = toValidationThreeQueueConfig(input);
    const state = createPureTroopBattleState({ id:"expert-level",maxRounds:40,
      sideA:config.attacker.queues[index]!.side,sideB:config.defender.queues[index]!.side });
    for (const troop of TROOP_TYPES) {
      expect(state.sideA.troops[troop].penetration*100).toBeCloseTo(1100/1.05-100);
      expect(state.sideB.troops[troop].penetration*100).toBeCloseTo(1100/1.02-100);
    }
    const changed = toValidationThreeQueueConfig(fixture(20,20));
    const newState = createPureTroopBattleState({ id:"expert-level-changed",maxRounds:40,
      sideA:changed.attacker.queues[index]!.side,sideB:changed.defender.queues[index]!.side });
    expect(newState.sideB.troops.shield.penetration*100).toBeCloseTo(1100/1.05-100);
  });

  it("exports resolved side effects in the real optimizer and candidate audit", () => {
    const result = optimizeThreeQueueScenario(fixture(), { ...defaultThreeQueueOptimizationOptions(1091200),
      fixedOwnQueueOrder:true,enemyPermutationMode:"fixedCurrent",lockHeroes:[true,true,true],lockRatios:[true,true,true],
      criterionCandidatesPerQueue:1,criterionPairLimit:1,criterionTripleLimit:1,criterionTheoryLimit:1,
      finalCandidateCount:1,finalValidationCount:2,formalStageTrials:[1] });
    expect(result.sharedExpertAudit?.A).toMatchObject({ expertSkillId:GARETH_FOURTH_SKILL_ID,expertSkillLevel:8,
      resolvedExpertSkillDisplay:"Lv8 · 2.0%",expertSkillEffectResolved:true });
    expect(result.sharedExpertAudit?.B).toMatchObject({ expertSkillLevel:20,resolvedExpertSkillDisplay:"Lv20 · 5.0%" });
    expect(result.sharedExpertAudit?.A.resolvedExpertSkillEffects?.[0]?.value).toBe(.02);
    expect(result.sharedExpertAudit?.B.resolvedExpertSkillEffects?.[0]?.value).toBe(.05);
    expect(result.current.convertedQueueAudit!.every((queue) => queue.expertSkillLevel===8 && queue.expertSkillEffectResolved)).toBe(true);
  });
});
