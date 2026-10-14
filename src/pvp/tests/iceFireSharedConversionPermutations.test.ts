import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { swapIceFireQueues } from "../../ui/sideConfigActions";
import { renderIceFireSide, renderIceFireAttributeDelta, renderIceFirePermutationMetrics, renderIceFireCandidateConversion } from "../../ui/iceFireView";
import { renderReportSpecialBonuses, renderReportRawAttributePreview } from "../../ui/reportSpecialBonusView";
import { createReportRecognitionState, mergeRecognitionImage } from "../../ui/reportImportDrafts";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { TROOP_TYPES } from "../types";
import { DEFAULT_EXTERNAL_BUFF_CONFIG } from "../externalBuffs";
import { getValidationThreeQueues, getValidationCatalog, toValidationThreeQueueConfig, createValidationPreviewState, previewExpectedReportBonuses } from "../validationUi";
import { normalizeIceFireReportLineage, changeIceFireExpectedHero, changeIceFireReportHero, changeIceFireReportAttribute, queueHeroIds } from "../validationUi/queueReportLineage";
import { iceFireQueueConversionAudit } from "../validationUi/iceFireAudit";
import { queueConversionSide } from "../validationUi/queueConversion";
import { createPureTroopBattleState } from "../scenario/pureTroopScenario";
import { ICE_FIRE_QUEUE_ORDERS, permuteIceFireState, permuteIceFireInput, comparePermutationMetrics, permutationMetrics } from "../optimizer/iceFirePermutations";
import { currentCriterionQueueState, createCriterionThreeQueueEvaluator } from "../optimizer/criterion/threeQueue";
import { samplePermutationCriterion, IceFireThreeQueueCriterionRunner } from "../optimizer/criterion/queueRunners";
import { generateCriterionQueueSeeds } from "../optimizer/criterion/queueSearch";
import { createThreeQueueOptimizationWorkflow, defaultThreeQueueOptimizationOptions, applyThreeQueueCandidate, threeQueueCandidateKey, threeQueueEvaluationKey } from "../optimizer/threeQueueOptimizer";
import { runOptimizationWorkflow, runOptimizationWorkflowAsync, createEvaluationExecutor, emptyOptimizationPerformance, type EvaluationJob } from "../optimizer/execution";
import { normalizeRecognitionResult } from "../battleReportRecognition/recognize";
import { applyRecognizedAttributeReport } from "../battleReportRecognition/attributeImport";
import { specialTotals, deriveRawReportAttribute } from "../battleReportRecognition/mapping";
import { createDefaultInnerEarthConfig, normalizeInnerEarthInput, materializeInnerEarthInput } from "../innerEarth";
import type { ValidationBattleInput, ValidationQueueAttributes, ValidationQueueConfig } from "../validationUi/types";
import type { OcrImage, ParsedBattleReport, ParsedSpecialBonus } from "../battleReportRecognition/types";

const stats = ["attack", "defense", "penetration", "life"] as const;
const matrix = (value: number) => Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
  Object.fromEntries(stats.map((stat) => [stat, value]))])) as ValidationQueueAttributes;
const defaultShared = () => ({ petContext: { ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet }, expertContext: { ...DEFAULT_EXTERNAL_BUFF_CONFIG.expert } });
function fixture(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  const side = (source: typeof base.sideA) => ({ ...source, reportHeroIds: [], reportHeroByTroop: {},
    simulationWeaponLevels: {}, deploymentCapacity: 60, shared: defaultShared(),
    threeQueues: getValidationThreeQueues(source).map((queue, index) => ({ ...queue, attributes: matrix(1000 + index * 100),
      leaderHeroIds: {}, reportHeroByTroop: {}, weaponLevels: {}, reportWeaponLevels: {},
      troopLevels: { shield: "T10", lancer: "T10", marksman: "T10" }, t12Levels: { shield: index, lancer: 0, marksman: 0 },
      reportAttributeBasis: "raw", ratios: { shield: 50, lancer: 20, marksman: 30 } })) as unknown as NonNullable<typeof source.threeQueues> });
  return normalizeIceFireReportLineage({ ...base, scenarioType: "ICE_FIRE_LEAGUE", attributeInputMode: "prediction",
    sideA: side(base.sideA), sideB: side(base.sideB), maxRounds: 40 });
}
function replace(input: ValidationBattleInput, queue: ValidationQueueConfig, index = 0): ValidationBattleInput {
  return { ...input, sideA: { ...input.sideA, threeQueues: input.sideA.threeQueues!.map((q, i) => i === index ? queue : q) as unknown as NonNullable<typeof input.sideA.threeQueues> } };
}
const historicalShield = "hero.s11.eleonora";
const differentShield = getValidationCatalog().leaderHeroes.find((hero) => hero.generation === 8 && hero.troopType === "shield")!.heroId;
function historicalFixture() {
  const input = fixture(), q = input.sideA.threeQueues![0];
  return replace(input, { ...q, attributes: matrix(5000), reportHeroByTroop: { shield: historicalShield },
    leaderHeroIds: { shield: historicalShield }, reportWeaponLevels: { [historicalShield]: 0 }, weaponLevels: { [historicalShield]: 0 },
    reportLineage: { source: "historicalReport", historicalLineageConfirmed: true, attributeSnapshot: matrix(5000) } });
}
const tinyOptions = () => ({ ...defaultThreeQueueOptimizationOptions(1274), lockHeroes: [true,true,true] as const,
  lockRatios: [true,true,true] as const, criterionCandidatesPerQueue: 2, criterionPairLimit: 6, criterionTripleLimit: 12,
  criterionTheoryLimit: 6, finalCandidateCount: 2, finalValidationCount: 24, formalStageTrials: [10,20], formalStageKeeps: [6,3] });
function fake(job: EvaluationJob) {
  const first = job.input.sideB.threeQueues![0]!.attributes!.shield.attack;
  const wins = first === 1200 ? 0 : job.seeds.length;
  return { samples: { trials: job.seeds.length, requestedTrials: job.seeds.length, wins, losses: job.seeds.length - wins,
    failedTrials: 0, pruned: false, outcomes: [], trajectories: job.seeds.map((seed) => ({ seed,
      outcome: wins ? "A" as const : "B" as const, battleCount: 3, remainingQueuesA: wins ? 3 : 0, remainingQueuesB: wins ? 0 : 3, maxRoundHitCount: 0 })) },
    performance: { ...emptyOptimizationPerformance(), simulatedTrials: job.seeds.length } };
}
const box = [[20,20],[240,20],[240,38],[20,38]] as const;
const bonus = (label: string, value: number, category: "additive" | "buff" | "debuff", attribute: typeof stats[number] = "attack"): ParsedSpecialBonus => ({
  label, attribute, category, troopScope: "all", effectTarget: category === "debuff" ? "enemy" : "self", scope: "garrison",
  activeInThisBattle: true, amount: { value, confidence: 1, confirmed: true, box } });
function report(): ParsedBattleReport {
  return { imageId: "history", warnings: [], confidence: 1, left: { sourceSide: "left", specialEvidence: true, troopSetup: {},
    attributes: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, Object.fromEntries(stats.map((stat) => [stat, { value: 1000, confidence: 1, confirmed: true, box }]))])),
    specialBonuses: { additive: [bonus("官职赐予部队攻击力",5,"additive")], buffs: [bonus("守城部队攻击力提升",20,"buff")], debuffs: [] } },
    right: { sourceSide: "right", specialEvidence: true, attributes: {}, troopSetup: {}, specialBonuses: { additive: [], buffs: [], debuffs: [bonus("敌方攻击力减益",10,"debuff")] } } };
}
const line = (text: string, y: number, x = 20) => ({ text, confidence: .99, box: [[x,y],[x+220,y],[x+220,y+18],[x,y+18]] as const });

describe("IceFire shared contexts, local history and complete placements", () => {
  it("uses one pet/expert context per side in persisted data and UI", () => {
    const input = fixture(), saved = createPersistedEnvelope(input, 1000), restored = restorePersistedConfig(saved).input;
    expect(restored.sideA.shared).toEqual(input.sideA.shared);
    expect(restored.sideA.threeQueues!.every((q) => q.externalBuffs === undefined)).toBe(true);
    const view = renderIceFireSide(input,"A");
    expect((view.match(/data-scope="ice-fire-shared"/g) ?? [])).toHaveLength(8);
    expect((view.match(/data-scope="queue-report-hero"/g) ?? [])).toHaveLength(9);
    expect(view).toContain("1队 ↔ 2队"); expect(view).toContain("2队 ↔ 3队");
  });
  it.each([0,1,2])("applies shared pet once to queue %i", (index) => {
    const base = fixture(), input = { ...base, sideA: { ...base.sideA, shared: { ...base.sideA.shared!, petContext: { ...base.sideA.shared!.petContext, attackLevel:10 } } } };
    const audit = iceFireQueueConversionAudit(input,"A",index);
    expect(audit.expectedAttributesAfterHeroConversion.shield.attack).toBeCloseTo((1100 + index*100)*1.1-100);
  });
  it("uses the enemy shared expert debuff once for every queue and both directions", () => {
    const base = fixture(); let input = { ...base, sideB: { ...base.sideB, shared: { ...base.sideB.shared!, expertContext: { garethFourthSkillLevel:20 } } } };
    for (const index of [0,1,2]) expect(iceFireQueueConversionAudit(input,"A",index).expectedAttributesAfterHeroConversion.shield.penetration).toBeCloseTo((1100+index*100)/1.05-100);
    input = { ...input, sideA: { ...input.sideA, shared: { ...input.sideA.shared!, expertContext: { garethFourthSkillLevel:20 } } } };
    expect(iceFireQueueConversionAudit(input,"B",1).expectedAttributesAfterHeroConversion.shield.penetration).toBeCloseTo(1200/1.05-100);
  });
  it.each(["A","B"] as const)("swaps complete %s queue objects while retaining shared context", (side) => {
    const input = historicalFixture(), key = side === "A" ? "sideA" : "sideB", before = input[key].threeQueues!;
    const next = swapIceFireQueues(input,side,0,1);
    expect(next[key].threeQueues![0]).toBe(before[1]); expect(next[key].threeQueues![1]).toBe(before[0]);
    expect(next[key].shared).toBe(input[key].shared); expect(next[key].queueOrder).toEqual([1,0,2]);
    expect(swapIceFireQueues(next,side,0,1)[key].threeQueues).toEqual(before);
  });
  it("binds historical heroes while expected heroes change or become EMPTY_HEAD", () => {
    const input = historicalFixture(), q = input.sideA.threeQueues![0];
    const changed = changeIceFireExpectedHero(q,"shield",differentShield), empty = changeIceFireExpectedHero(changed,"shield",null);
    expect(queueHeroIds(empty.leaderHeroIds)).toEqual([]); expect(queueHeroIds(empty.reportHeroByTroop!)).toEqual([historicalShield]);
    expect(iceFireQueueConversionAudit(replace(input,empty),"A",0).heroStaticDeltaPercent.shield!.attack).toBeLessThan(0);
    expect(restorePersistedConfig(createPersistedEnvelope(replace(input,empty),1000)).input.sideA.threeQueues![0].reportHeroByTroop).toEqual(q.reportHeroByTroop);
  });
  it("supports EMPTY_HEAD history -> hero and explicit report hero edits", () => {
    const input = fixture(), q = input.sideA.threeQueues![0];
    const withHero = changeIceFireExpectedHero(q,"shield",differentShield);
    expect(queueHeroIds(withHero.reportHeroByTroop!)).toEqual([]);
    expect(iceFireQueueConversionAudit(replace(input,withHero),"A",0).heroStaticDeltaPercent.shield!.attack).toBeGreaterThan(0);
    expect(changeIceFireReportHero(withHero,"shield",differentShield).leaderHeroIds).toEqual(withHero.leaderHeroIds);
  });
  it("changes expected attrs in audit, normal Single conversion and formal battle input", () => {
    const input = historicalFixture(), changed = replace(input,changeIceFireExpectedHero(input.sideA.threeQueues![0],"shield",differentShield));
    const before = iceFireQueueConversionAudit(input,"A",0), after = iceFireQueueConversionAudit(changed,"A",0);
    expect(after.reportAttributes).toEqual(before.reportAttributes);
    expect(after.expectedAttributesAfterHeroConversion.shield.attack).not.toBe(before.expectedAttributesAfterHeroConversion.shield.attack);
    const single = { ...changed, scenarioType: "SINGLE" as const,
      sideA: queueConversionSide(changed,"A",changed.sideA.threeQueues![0]), sideB: queueConversionSide(changed,"B",changed.sideB.threeQueues![0]) };
    const preview = previewExpectedReportBonuses(single,createValidationPreviewState(single));
    expect(after.expectedAttributesAfterHeroConversion.shield.attack).toBeCloseTo(preview.A.troops.shield.attack*100);
    const config = toValidationThreeQueueConfig(changed), state = createPureTroopBattleState({ id: "conversion", maxRounds:40,
      sideA: config.attacker.queues[0].side, sideB: config.defender.queues[0].side });
    expect(state.sideA.troops.shield.attack*100).toBeCloseTo(after.expectedAttributesAfterHeroConversion.shield.attack);
    expect(renderIceFireAttributeDelta(after.reportAttributes,after.expectedAttributesAfterHeroConversion)).toContain(after.expectedAttributesAfterHeroConversion.shield.attack.toFixed(2));
  });
  it("changes Criterion/Matrix and Theory templates for a hero-only candidate", () => {
    const source = historicalFixture(), input = { ...source, sideB: { ...source.sideB, threeQueues: source.sideB.threeQueues!.map((q) => ({ ...q, attributes:matrix(5000) })) as unknown as NonNullable<typeof source.sideB.threeQueues> } }, a = currentCriterionQueueState(input,"A"), b = currentCriterionQueueState(input,"B");
    const alternate = { ...a.queues[0], leaderHeroIds: { shield:differentShield }, headWeaponLevels:{} };
    const criterion = createCriterionThreeQueueEvaluator(input), theory = createCriterionThreeQueueEvaluator(input,"theory");
    for (const runner of [criterion,theory]) {
      const before = runner.matchup(a.queues[0],b.queues[0],0,0), after = runner.matchup(alternate,b.queues[0],0,0);
      expect(after.margin).not.toBe(before.margin);
    }
    const c = [...criterion.cache.values()]; expect(c[0]!.a.normal).not.toEqual(c[1]!.a.normal);
    const t = [...theory.theoryCache.values()]; expect(t[0]!.sideA.normalDamage).not.toEqual(t[1]!.sideA.normalDamage);
  });
  it("weapon-only conversion updates penetration/life without rewriting history", () => {
    const input = historicalFixture(), q = input.sideA.threeQueues![0], changed = replace(input,{ ...q, weaponLevels:{[historicalShield]:10} });
    const before = iceFireQueueConversionAudit(input,"A",0), after = iceFireQueueConversionAudit(changed,"A",0);
    expect(after.expectedAttributesAfterHeroConversion.shield.life).not.toBe(before.expectedAttributesAfterHeroConversion.shield.life);
    expect(after.weaponStaticDeltaPercent.shield!.life).toBeGreaterThan(0); expect(after.reportWeaponLevels).toEqual(before.reportWeaponLevels);
  });
  it("ratio-only candidates do not change attrs; applying full placement keeps source history", () => {
    const input = historicalFixture(), state = currentCriterionQueueState(input,"A"), changed = { queues: state.queues.map((q) => ({ ...q, ratiosBp:{shield:4000,lancer:3000,marksman:3000} })) as unknown as typeof state.queues };
    const applied = applyThreeQueueCandidate(input,"A",changed);
    expect(iceFireQueueConversionAudit(applied,"A",0).expectedAttributesAfterHeroConversion).toEqual(iceFireQueueConversionAudit(input,"A",0).expectedAttributesAfterHeroConversion);
    const moved = applyThreeQueueCandidate(input,"A",permuteIceFireState(state,[2,0,1]));
    expect(moved.sideA.threeQueues![1].attributes).toEqual(input.sideA.threeQueues![0].attributes);
    expect(moved.sideA.threeQueues![1].reportHeroByTroop).toEqual(input.sideA.threeQueues![0].reportHeroByTroop);
  });
  it("evaluation identity distinguishes heroes, weapons, source attrs, shared context and order", () => {
    const input = historicalFixture(), state = currentCriterionQueueState(input,"A"), key = threeQueueEvaluationKey(input,"A",state);
    const changes = [swapIceFireQueues(input,"B",0,1), replace(input,changeIceFireReportAttribute(input.sideA.threeQueues![0],"shield","attack",5100)),
      { ...input, sideA:{...input.sideA,shared:{...input.sideA.shared!,expertContext:{garethFourthSkillLevel:20}}} }];
    for (const next of changes) expect(threeQueueEvaluationKey(next,"A",currentCriterionQueueState(next,"A"))).not.toBe(key);
    expect(threeQueueCandidateKey(permuteIceFireState(state,[1,0,2]))).not.toBe(threeQueueCandidateKey(state));
    const alternate = { queues: [{...state.queues[0],leaderHeroIds:{shield:differentShield}},state.queues[1],state.queues[2]] as const };
    expect(threeQueueEvaluationKey(input,"A",alternate)).not.toBe(key);
  });
});

describe("restored special OCR and atomic history import", () => {
  it("recognizes attribute/special pages while excluding troop/FC inference", () => {
    const image: OcrImage = { imageId:"attrs-special",width:800,height:1000,lines:[...TROOP_TYPES.flatMap((troop,i) => stats.map((stat,j) => line(`${{shield:"盾兵",lancer:"矛兵",marksman:"射手"}[troop]}${{attack:"攻击力",defense:"防御力",penetration:"穿透力",life:"生命值"}[stat]} 1000%`,20+(i*4+j)*35))),line("特殊加成说明",600),line("官职赐予部队攻击力 0%",650),line("敌方穿透力减益（专家技能） 5%",700),line("T12 火晶7 88888",750)] };
    const parsed = normalizeRecognitionResult(image);
    expect(parsed.left!.specialBonuses!.additive[0]!.amount.value).toBe(0);
    expect(parsed.left!.specialBonuses!.debuffs[0]).toMatchObject({attribute:"penetration",effectTarget:"enemy",troopScope:"all"});
    expect(parsed.left!.troopSetup).toEqual({shield:{},lancer:{},marksman:{}});
    expect(parsed.pageTypes).toContain("specialBonuses"); expect(parsed.pageTypes).toContain("attributes");
  });
  it("merges owned special pages without leaking into official config or other owner", () => {
    const input = fixture(), before = structuredClone(input), first = report();
    const state = mergeRecognitionImage(createReportRecognitionState(),"A",first,true);
    expect(state.B.reportContext).toBeNull(); expect(input).toEqual(before);
    expect(renderReportSpecialBonuses(first,"A","left","incomplete")).toContain("特殊加成识别");
    expect(() => applyRecognizedAttributeReport(input,first,"left","A","incomplete")).toThrow(/完整/);
  });
  it("reverses additive/buff/debuff once, including historical garrison rows in challenge", () => {
    const input = fixture(), before = structuredClone(input), imported = applyRecognizedAttributeReport(input,report(),"left","A","complete",1);
    const queue = imported.sideA.threeQueues![1], raw = (1100*1.1/1.2)-100-5;
    expect(queue.attributes!.shield.attack).toBeCloseTo(raw); expect(queue.sourceReportAttributes!.shield.attack).toBe(1000);
    expect(iceFireQueueConversionAudit(imported,"A",1).rawAttributesAfterSpecialReverse.shield.attack).toBeCloseTo(raw);
    expect(imported.sideA.threeQueues![0]).toEqual(input.sideA.threeQueues![0]); expect(imported.sideB).toBe(input.sideB); expect(input).toEqual(before);
  });
  it("manual historical stat edits retain heroes and reverse bound special context", () => {
    const imported = applyRecognizedAttributeReport(historicalFixture(),report(),"left","A","complete");
    const q = imported.sideA.threeQueues![0], changed = changeIceFireReportAttribute(q,"shield","attack",5100);
    expect(changed.reportHeroByTroop).toEqual(q.reportHeroByTroop);
    expect(changed.attributes!.shield.attack).toBeCloseTo(5200*1.1/1.2-100-5);
    expect(changed.sourceReportAttributes!.shield.attack).toBe(5100);
  });
  it("pending attack bonuses only block attack preview totals", () => {
    const r = report(), pending = { ...r.left!, unmatchedBonuses:[{rawText:"攻击未知",normalizedText:"攻击未知",possibleAttribute:"attack" as const,nearestRegistryCandidates:[]}] };
    expect(() => specialTotals(pending,"shield","attack",r.right)).toThrow(/待确认/);
    expect(specialTotals(pending,"shield","defense",r.right).additivePercent).toBe(0);
    expect(specialTotals(pending,"shield","life",r.right).buffDecimal).toBe(0);
    const owned = { ...r, left:pending };
    expect(renderReportRawAttributePreview(owned,"left","A","complete",[{troop:"shield",stat:"attack"}])).toContain("待确认");
    expect(renderReportRawAttributePreview(owned,"left","A","complete",[{troop:"shield",stat:"defense"}])).toContain("1000.00%");
  });
  it("rejects low confidence or conflicting special values before any commit", () => {
    const input = fixture(), before = structuredClone(input), r = report();
    const bad = {...r,left:{...r.left!,specialBonuses:{...r.left!.specialBonuses!,buffs:[{...r.left!.specialBonuses!.buffs[0]!,amount:{value:20,confidence:.4,box}}]}}};
    expect(() => applyRecognizedAttributeReport(input,bad,"left","A","complete")).toThrow(/确认/);
    expect(() => applyRecognizedAttributeReport(input,r,"left","A","explicitZero")).toThrow(/非零/); expect(input).toEqual(before);
  });
  it("keeps compact InnerEarth report schemas while reversing each raw cell independently", () => {
    const base = fixture(), input = normalizeInnerEarthInput(base,createDefaultInnerEarthConfig(base,"EQUIPMENT_FORGE"));
    const r = report(), imported = applyRecognizedAttributeReport(input,r,"left","A","complete"), materialized = materializeInnerEarthInput(imported);
    expect(imported.innerEarth!.ally.reportStats.shield.attack).toBe(1000);
    expect(materialized.sideA.reportAttributeBasis).toBe("raw");
    expect(createValidationPreviewState(imported).sideA.troops.shield.attack*100).toBeCloseTo(1100*1.1/1.2-100-5);
    const restored = restorePersistedConfig(createPersistedEnvelope(imported,1000)).input;
    expect(restored.innerEarth!.ally.reportHistory).toEqual(imported.innerEarth!.ally.reportHistory);
  });
  it("uses additive as percentage points, never an independent factor", () => {
    expect(deriveRawReportAttribute({reportPercent:1000,additivePercent:150,buffDecimal:0,debuffDecimal:0})).toBe(850);
  });
  it.each(["SINGLE","RALLY"] as const)("retains %s final-report semantics and only reverses historical modifiers in prediction", (scenarioType) => {
    const base = {...fixture(),scenarioType,attributeInputMode:"finalReport" as const};
    const final = applyRecognizedAttributeReport(base,report(),"left","A","complete");
    expect(createValidationPreviewState(final).sideA.troops.shield.attack*100).toBeCloseTo(1000);
    const prediction = applyRecognizedAttributeReport({...base,attributeInputMode:"prediction"},report(),"left","A","complete");
    expect(createValidationPreviewState(prediction).sideA.troops.shield.attack*100).toBeCloseTo(1100*1.1/1.2-100-5);
  });
});

describe("six-order robust search through theory and formal stages", () => {
  it.each(["criterion","theory"] as const)("%s evaluates all six initial enemy orders with fixed cursor semantics", (kernel) => {
    const input = fixture(), a = currentCriterionQueueState(input,"A"), b = currentCriterionQueueState(input,"B");
    const sampled = samplePermutationCriterion(IceFireThreeQueueCriterionRunner(input,kernel),a,b,"A",17,1,"allPermutations");
    expect(sampled.permutationCount).toBe(6); expect(sampled.permutations.map((p) => p.order)).toEqual(ICE_FIRE_QUEUE_ORDERS);
    expect(sampled.permutations.every((p) => p.sample.matchSequenceSamples[0]![0] === "A1-B1")).toBe(true);
  });
  it("retains distinct own placements or locks own order explicitly", () => {
    const input = fixture(), state = currentCriterionQueueState(input,"A"), heroes = {shield:[],lancer:[],marksman:[]};
    const unlocked = generateCriterionQueueSeeds(input,state,tinyOptions(),heroes), locked = generateCriterionQueueSeeds(input,state,{...tinyOptions(),fixedOwnQueueOrder:true},heroes);
    expect(new Set(unlocked.candidates.map((c) => c.queues.map((q) => q.sourceQueueIndex).join())).size).toBe(6);
    expect(locked.candidates.every((c) => c.queues.map((q) => q.sourceQueueIndex).join() === "0,1,2")).toBe(true);
    expect(unlocked.audit.enemyPermutationCount).toBe(6);
  });
  it("ranks worst then average then current instead of blending metrics", () => {
    const metrics = (rates: number[]) => permutationMetrics(rates.map((winRate,i) => ({order:ICE_FIRE_QUEUE_ORDERS[i]!,winRate,trials:100,wins:winRate*100,failedTrials:0})));
    expect(comparePermutationMetrics(metrics([.7,.7,.7]),metrics([1,1,.6]))).toBeLessThan(0);
    expect(comparePermutationMetrics(metrics([.8,.7,.7]),metrics([.7,.7,.7]))).toBeLessThan(0);
    expect(comparePermutationMetrics(metrics([.8,.7,.7]),metrics([.7,.8,.7]))).toBeLessThan(0);
  });
  it("protects all six placements of a manual repeated-head baseline", () => {
    const base = fixture(), input = {...base,sideA:{...base.sideA,threeQueues:base.sideA.threeQueues!.map((q,index) => ({...q,
      attributes:matrix(5000+index*100),leaderHeroIds:{shield:historicalShield},reportHeroByTroop:{shield:historicalShield},
      reportLineage:{source:"historicalReport" as const,historicalLineageConfirmed:true,attributeSnapshot:matrix(5000+index*100)}
    })) as unknown as NonNullable<typeof base.sideA.threeQueues>}};
    const result = generateCriterionQueueSeeds(input,currentCriterionQueueState(input,"A"),{...tinyOptions(),lockHeroes:[false,false,false]},
      {shield:[historicalShield],lancer:[],marksman:[]});
    expect(new Set(result.candidates.map((c) => c.queues.map((q) => q.sourceQueueIndex).join())).size).toBe(6);
  });
  it("covers 6×10 early, deepens dangerous orders, then fully validates all six", () => {
    const jobs:EvaluationJob[] = [], input = fixture(), options = tinyOptions();
    const result = runOptimizationWorkflow(createThreeQueueOptimizationWorkflow(input,options),(job) => {jobs.push(job);return fake(job);});
    const baseline = jobs.filter((job) => job.protectFromPruning);
    expect(baseline.slice(0,6).every((job) => job.seeds.length === 10)).toBe(true);
    expect(result.formalStages![0]!.baselineIncrementalRuns).toBe(60);
    expect(result.current.trials).toBe(6*24); expect(result.current.permutationAudit!.permutationResults.every((p) => p.trials === 24)).toBe(true);
    expect(result.current.permutationAudit!.currentOrderWinRate).toBe(1); expect(result.current.permutationAudit!.worstPermutationWinRate).toBe(0);
    expect(result.current.permutationAudit!.averagePermutationWinRate).toBeCloseTo(4/6);
    expect(result.current.permutationAudit!.worstEnemyOrder[0]).toBe(2);
    expect(result.topCandidates[0]!.winRate).toBeGreaterThanOrEqual(result.current.winRate);
    expect(renderIceFirePermutationMetrics(result.current,"A")).toContain("最坏换位胜率");
    expect(renderIceFireCandidateConversion(result.current)).toContain("预期英雄");
    expect(result.current.convertedQueueAudit).toHaveLength(3);
  });
  it("fixedCurrent evaluates one enemy order while still exposing metrics", () => {
    const result = runOptimizationWorkflow(createThreeQueueOptimizationWorkflow(fixture(),{...tinyOptions(),enemyPermutationMode:"fixedCurrent",fixedOwnQueueOrder:true}),fake);
    expect(result.current.trials).toBe(24); expect(result.current.permutationAudit!.permutationResults).toHaveLength(1);
  });
  it("sync and asynchronous candidate execution use identical per-order trajectories", async () => {
    const input = fixture(), options = tinyOptions(), sync = runOptimizationWorkflow(createThreeQueueOptimizationWorkflow(input,options),fake);
    const parallel = await runOptimizationWorkflowAsync(createThreeQueueOptimizationWorkflow(input,options),async (jobs) => Promise.all(jobs.map(async (job) => fake(job))));
    expect(parallel).toEqual(sync);
  });
  it("real FastBattle trials preserve cursor, max-five duels and whole enemy order", () => {
    const input = fixture(), run = createEvaluationExecutor();
    for (const order of ICE_FIRE_QUEUE_ORDERS) {
      const next = permuteIceFireInput(input,"B",order), config = toValidationThreeQueueConfig(next);
      expect(config.defender.queues[0].side.shield.attack*100).toBe(1000+order[0]*100);
      const outcome = run({kind:"threeQueue",input:next,side:"A",seeds:[1294],collectTrajectories:true});
      expect(outcome.samples.trajectories![0]!.battleCount).toBeLessThanOrEqual(5);
      expect(outcome.samples.trajectories![0]!.battleCount).toBeGreaterThan(0);
    }
  });
});
