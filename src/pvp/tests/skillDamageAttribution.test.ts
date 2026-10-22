import { describe, expect, it } from "vitest";
import { createBattleState } from "../battle/createBattleState";
import { createDamageEvent } from "../damage/createDamageEvent";
import { resolvePendingDamage } from "../casualty/resolvePendingDamage";
import { resolvePostBattleCasualties } from "../postBattle/casualtyResolver";
import { attributeResolvedDamage, damageEventSkillIds, projectSkillDefeats } from "../statistics/skillDamageAttribution";
import { runValidationBattle, compileValidationBattle } from "../validationUi/adapter";
import { runBatchSimulation, deriveBatchSeed } from "../validationUi/batchSimulation";
import { makeSide } from "./helpers";
import { LIGEIA_TWO, LIGEIA_THREE, POWDER, ligeiaDamagePoolInput } from "./fixtures/skillDamagePool";
import type { DamageEvent } from "../types/damage";

function settlePool(raw: number, shares: readonly number[] = [1, 1], shieldHp = 0, targetCount = 2) {
  const initial = createBattleState({ sideA: makeSide({ marksman: 10 }),
    sideB: makeSide({ shield: targetCount }, { maxHpPerUnit: 100 }) });
  const target = initial.sideB.troops.shield;
  const state = { ...initial, sideB: { ...initial.sideB, troops: { ...initial.sideB.troops,
    shield: { ...target, temporaryShieldHp: shieldHp, temporaryShields: shieldHp === 0 ? [] : [{
      id: "test-shield", sourceSkillId: "test.shield", sourceHeroId: "test.hero", ruleStatus: "supported" as const,
      generatedShieldHp: shieldHp, remainingShieldHp: shieldHp,
      generatedRound: 0, generatedActionOrder: 0, activeFromRound: 1, expiresAfterRound: 1,
    }] } } } };
  const sum = shares.reduce((a, b) => a + b, 0);
  const event = createDamageEvent({ id: "pool", round: 1, actionOrder: 5,
    sourceSide: "A", sourceTroop: "marksman", targetSide: "B", targetTroop: "shield",
    damageType: "skillDamage", damageSubtype: "extraDamage", baseDamage: raw,
    sourceSkillId: "skill.0", skillCoefficient: sum,
    skillPoolComponents: shares.map((coefficient, index) => ({ id: `component-${index}`,
      sourceSkillId: `skill.${index}`, coefficient, baseDamage: raw * coefficient / sum })),
  }, state);
  const pending = { ...state, pendingDamageEvents: [event] };
  const resolved = resolvePendingDamage(pending);
  return { pending, event, resolved, report: attributeResolvedDamage([event], resolved.targets) };
}
function sums(run: ReturnType<typeof runValidationBattle>, side: "A" | "B") {
  const report = run.skillDamageStatistics!;
  return [...Object.values(report.bySide[side]), report.normalAttack[side], report.unattributed[side]];
}

describe("settlement-only pooled skill attribution", () => {
  it("credits both Ligeia skills when the 2B pool has no powder", () => {
    const run = runValidationBattle(ligeiaDamagePoolInput(false));
    const pooled = run.trace.rounds[1]!.damageEvents.find((e) => e.skillPoolComponents)!;
    expect(pooled.skillCoefficient).toBe(2);
    expect(damageEventSkillIds(pooled)).toEqual([LIGEIA_TWO, LIGEIA_THREE]);
    const report = run.skillDamageStatistics!.bySide.A;
    expect(report[LIGEIA_TWO]!.exited).toBeGreaterThan(0);
    expect(report[LIGEIA_THREE]!.exited).toBeCloseTo(report[LIGEIA_TWO]!.exited, 12);
    expect(report[LIGEIA_THREE]!.estimated).toBe(true);
    expect(report[POWDER]).toBeUndefined();
    for (const id of [LIGEIA_TWO, LIGEIA_THREE]) {
      const row = run.skillSummary.find((s) => s.skillId === id)!;
      expect(row.actualActivationCount).toBe(1);
      expect(row.extraDamageEventCount).toBe(1);
      expect(row.damageContribution).toEqual(report[id]);
    }
  });
  it("splits the 2.875B pool by .875/1/1 instead of assigning all to powder", () => {
    const run = runValidationBattle(ligeiaDamagePoolInput(true));
    const round = run.simulation.rounds[1]!;
    const event = round.trace.damageEvents.find((e) => e.skillPoolComponents)!;
    expect(event.skillPoolComponents!.map((c) => c.coefficient)).toEqual([.875, 1, 1]);
    expect(event.sourceSkillId).toBe(POWDER); // The actual battle event is deliberately unchanged.
    const perRound = attributeResolvedDamage(round.stateAfterActionPhase.pendingDamageEvents, round.casualties);
    const poolCasualties = round.casualties.find((c) => c.sourceEvents[0]?.id === event.id)!.casualties;
    expect(perRound.bySide.A[POWDER]!.exited).toBeCloseTo(poolCasualties * .875 / 2.875, 12);
    expect(perRound.bySide.A[LIGEIA_TWO]!.exited).toBeCloseTo(poolCasualties / 2.875, 12);
    expect(perRound.bySide.A[LIGEIA_THREE]!.exited).toBeCloseTo(poolCasualties / 2.875, 12);
    expect(perRound.bySide.A[LIGEIA_THREE]!.hpDamage).toBeGreaterThan(0);
  });
  it("allocates only actual exits after rounding, shield absorption, HP cap and discarded overflow", () => {
    const { report, event, resolved, pending } = settlePool(310.6, [1, 2], 100, 2);
    const before = JSON.stringify(pending);
    expect(event.roundedDamage).toBe(311);
    expect(resolved.targets[0]!.casualties).toBe(2);
    expect(report.bySide.A["skill.0"]).toMatchObject({ rawDamage: 310.6 / 3, estimated: true });
    expect(report.totals.A).toMatchObject({ roundedDamage: 311, hpDamage: 200, shieldAbsorbed: 100,
      overflowDiscarded: 11, exited: 2 });
    expect(report.bySide.A["skill.0"]!.exited).toBeCloseTo(2 / 3, 12);
    expect(report.bySide.A["skill.1"]!.exited).toBeCloseTo(4 / 3, 12);
    expect(attributeResolvedDamage([event], resolved.targets)).toEqual(report);
    expect(JSON.stringify(pending)).toBe(before);
    expect(resolvePendingDamage(pending)).toEqual(resolved);
  });
  it("does not fabricate exits for all-shield damage or damage queued after target death", () => {
    expect(settlePool(100, [1, 1], 100).report.totals.A.exited).toBe(0);
    const { pending, event } = settlePool(250, [1, 1], 0, 1);
    const later = { ...event, id: "later" };
    const resolution = resolvePendingDamage({ ...pending, pendingDamageEvents: [event, later] });
    const report = attributeResolvedDamage([event, later], resolution.targets);
    expect(report.totals.A.exited).toBe(1);
    expect(report.totals.A.hpDamage).toBe(100);
    expect(report.totals.A.overflowDiscarded).toBe(400);
    expect(report.bySide.A["skill.0"]!.exited).toBe(.5);
  });
  it("uses a standalone event's exact model casualty count while keeping defeat attribution an estimate", () => {
    const { event, pending } = settlePool(150);
    const single = { ...event, skillPoolComponents: undefined } as unknown as DamageEvent;
    const resolution = resolvePendingDamage({ ...pending, pendingDamageEvents: [single] });
    const report = attributeResolvedDamage([single], resolution.targets);
    expect(report.bySide.A["skill.0"]).toMatchObject({ exited: 1, exactExited: 1, estimatedExited: 0, estimated: false });
  });
  it("sums repeated skill IDs once per event without losing their separate components", () => {
    const { event, resolved } = settlePool(200);
    const repeated = { ...event, skillPoolComponents: event.skillPoolComponents!.map((c) => ({ ...c, sourceSkillId: "same" })) };
    const report = attributeResolvedDamage([repeated], resolved.targets.map((r) => ({ ...r, sourceEvents: [repeated] })));
    expect(report.bySide.A.same).toMatchObject({ eventCount: 1, exited: 2 });
    expect(event.skillPoolComponents).toHaveLength(2);
  });
  it.each(["empty", "missing-id", "partial", "invalid", "unknown-event"])("retains unassigned totals for %s source data", (kind) => {
    const { event, resolved } = settlePool(200);
    let broken: DamageEvent;
    if (kind === "empty") broken = { ...event, skillPoolComponents: [] };
    else if (kind === "missing-id") broken = { ...event, skillPoolComponents: event.skillPoolComponents!.map((c) => ({ ...c, sourceSkillId: "unknown" })) };
    else if (kind === "partial") broken = { ...event, skillPoolComponents: [event.skillPoolComponents![0]!] };
    else if (kind === "invalid") broken = { ...event, skillPoolComponents: [{ ...event.skillPoolComponents![0]!, baseDamage: 300 }] };
    else broken = { ...event, sourceSkillId: undefined, skillPoolComponents: undefined } as unknown as DamageEvent;
    const report = attributeResolvedDamage([broken], resolved.targets.map((r) => ({ ...r, sourceEvents: [broken] })));
    expect(report.unattributed.A.exited).toBeGreaterThan(0);
    expect(Object.values(report.bySide.A).reduce((n, r) => n + r.exited, report.unattributed.A.exited)).toBe(2);
    expect(report.bySide.A["skill.0"]?.exited ?? 0).toBeLessThan(2);
  });
  it("apportions same-main-attack segments without counting a second battle event", () => {
    const { event, pending } = settlePool(300);
    const segment = { ...event, damageType: "normalAttack", damageSubtype: "normalAttack",
      sourceSkillId: undefined, skillPoolComponents: undefined, internalSegments: [{ sourceSkillId: "marksman-rapid-fire",
        basis: 150, rawDamage: 150, modifiedDamage: 150, roundedDamage: 150 }] } as unknown as DamageEvent;
    const resolution = resolvePendingDamage({ ...pending, pendingDamageEvents: [segment] });
    const report = attributeResolvedDamage([segment], resolution.targets);
    expect(report.totals.A.eventCount).toBe(1);
    expect(report.normalAttack.A.exited).toBe(1);
    expect(report.bySide.A["marksman-rapid-fire"]!.exited).toBe(1);
  });
  it("keeps zero-damage pools finite without fabricating exits", () => {
    const { report } = settlePool(0);
    expect(report.bySide.A["skill.0"]!.exited).toBe(0);
    expect(report.bySide.A["skill.1"]!.rawDamage).toBe(0);
    expect(JSON.stringify(report)).not.toContain("null");
  });
  it("labels multi-event settlement fallback as estimated and conserves its actual totals", () => {
    const { event, resolved } = settlePool(200);
    const second = { ...event, id: "second", sourceSkillId: "third", skillPoolComponents: undefined } as unknown as DamageEvent;
    const settlement = { ...resolved.targets[0]!, sourceEvents: [event, second] };
    const report = attributeResolvedDamage([event, second], [settlement]);
    expect(report.issues.combinedSettlement).toBe(1);
    expect(report.bySide.A.third).toMatchObject({ exited: 1, estimated: true, exactExited: 0 });
    expect(report.bySide.A["skill.0"]!.exited).toBe(.5);
    expect(report.bySide.A["skill.1"]!.exited).toBe(.5);
    expect(report.totals.A.exited).toBe(2);
    expect(report.totals.A.hpDamage).toBe(200);
  });
});

describe("canonical post-battle conversion and single/batch parity", () => {
  it.each(["NORMAL", "FURNACE"] as const)("uses %s canonical integer allocation, never per-skill rounded percentages", (mode) => {
    const run = runValidationBattle(ligeiaDamagePoolInput(true, mode));
    const post = run.postBattleCasualties.B;
    for (const row of Object.values(run.skillDamageStatistics!.bySide.A)) {
      expect(row.defeatedEstimate).toBeCloseTo(row.exitedByTargetTroop.shield * post.byTroop.shield.defeated / post.byTroop.shield.exited, 10);
    }
    expect(sums(run, "A").reduce((n, row) => n + row.exited, 0)).toBeCloseTo(post.total.exited, 10);
    expect(sums(run, "A").reduce((n, row) => n + row.defeatedEstimate!, 0)).toBeCloseTo(post.total.defeated, 10);
    expect(post.total.defeated / post.total.exited).toBeCloseTo(mode === "NORMAL" ? .35 : .45, 2);
  });
  it("uses the already rounded global rule for small exits instead of rounding each skill", () => {
    const { report } = settlePool(100);
    const populations = { shield: 2, lancer: 0, marksman: 0 }, survivors = { shield: 1, lancer: 0, marksman: 0 };
    const normal = resolvePostBattleCasualties(populations, survivors, "NORMAL");
    expect(normal.total.defeated).toBe(0);
    const result = projectSkillDefeats(report, { B: normal });
    expect(result.bySide.A["skill.0"]!.defeatedEstimate).toBe(0);
    expect(result.bySide.A["skill.1"]!.defeatedEstimate).toBe(0);
  });
  it("converts with the target troop's actual allocation when troop ratios differ after rounding", () => {
    const { report } = settlePool(200);
    const row = report.bySide.A["skill.0"]!;
    row.exitedByTargetTroop = { shield: 1, lancer: 1, marksman: 0 };
    row.exited = 2;
    const post = resolvePostBattleCasualties({ shield: 3, lancer: 5, marksman: 7 },
      { shield: 0, lancer: 0, marksman: 7 }, "NORMAL");
    const estimate = projectSkillDefeats(report, { B: post }).bySide.A["skill.0"]!.defeatedEstimate;
    expect(estimate).toBeCloseTo(post.byTroop.shield.defeated / 3 + post.byTroop.lancer.defeated / 5, 12);
    expect(estimate).not.toBe(2 * .35);
  });
  it("marks missing or unconfirmed casualty rules as unknown", () => {
    const { report } = settlePool(100);
    expect(projectSkillDefeats(report, {}).bySide.A["skill.0"]!.defeatedEstimate).toBeNull();
    const post = resolvePostBattleCasualties({ shield: 2, lancer: 0, marksman: 0 }, { shield: 1, lancer: 0, marksman: 0 }, "NORMAL");
    expect(projectSkillDefeats(report, { B: { ...post, mode: "UNCONFIRMED" } as never }).bySide.A["skill.0"]!.defeatedEstimate).toBeNull();
  });
  it.each(["NORMAL", "FURNACE"] as const)("single/full and compact batch use identical %s attribution and activations", (mode) => {
    const input = ligeiaDamagePoolInput(true, mode), single = runValidationBattle(input), batch = runBatchSimulation(input, 1);
    expect(batch.skillDamageStatistics).toEqual(single.skillDamageStatistics);
    const compiled = compileValidationBattle(input), trial = compiled.runTrial(input.randomSeed, "summary");
    expect({ ...trial.finalState, battleLog: [] }).toEqual({ ...single.simulation.finalState, battleLog: [] });
    expect(trial.damageAttribution).toEqual(single.simulation.damageAttribution);
    expect(compiled.runFastTrial(input.randomSeed).remaining).toEqual(single.summary.remaining);
    for (const row of single.skillSummary) expect(batch.skillActivationCounts![row.side][row.skillId] ?? 0).toBe(row.actualActivationCount);
    expect(batch.meanSkillCasualties.A[LIGEIA_THREE]).toBeGreaterThan(0);
  });
  it("resets transient report capture between summary, none and FastBattle without leaking callbacks or state", () => {
    const input = ligeiaDamagePoolInput(true), compiled = compileValidationBattle(input);
    const fastBefore = compiled.runFastTrial(input.randomSeed);
    let roundsCaptured = 0;
    const summary = compiled.runTrial(input.randomSeed, "summary", undefined, undefined, () => { roundsCaptured++; });
    expect(roundsCaptured).toBe(summary.roundCount);
    const none = compiled.runTrial(input.randomSeed, "none");
    expect(none.finalState).toEqual(summary.finalState);
    expect(none.damageAttribution.collected).toBe(false);
    expect(compiled.runFastTrial(input.randomSeed)).toEqual(fastBefore);
    expect(roundsCaptured).toBe(summary.roundCount);
  });
  it("1000 trials retain each contributor and equal the mean of the same single-seed results", () => {
    const input = ligeiaDamagePoolInput(true), batch = runBatchSimulation(input, 1000);
    const sums: Record<string, number> = { [POWDER]: 0, [LIGEIA_TWO]: 0, [LIGEIA_THREE]: 0 };
    let exits = 0;
    for (let i = 0; i < 1000; i++) {
      const single = runValidationBattle({ ...input, randomSeed: deriveBatchSeed(input.randomSeed, i) });
      exits += single.postBattleCasualties.B.total.exited;
      for (const id of Object.keys(sums)) sums[id]! += single.skillDamageStatistics!.bySide.A[id]!.defeatedEstimate!;
    }
    for (const [id, total] of Object.entries(sums)) {
      expect(batch.skillDamageStatistics!.bySide.A[id]!.defeatedEstimate).toBeCloseTo(total / 1000, 10);
      expect(batch.meanSkillCasualties.A[id]).toBeGreaterThan(0);
    }
    expect(batch.expectedExitedTotal.B).toBe(exits / 1000);
    expect("trace" in batch).toBe(false);
  }, 30000);
});
