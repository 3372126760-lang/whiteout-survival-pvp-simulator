import { describe, expect, it } from "vitest";
import {
  LANCER_AMBUSH_SKILL_DEFINITION,
  createBattleState,
  createSequenceRandomSource,
  createTroopSkillRuntimeState,
  createTroopSkillSystem,
  resolveRound,
  runActionPhase,
  createRoundStartSnapshot,
  type BattleSideSetup,
  type TroopSkillDefinition,
  type TroopSkillEffect,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

function supportedSkill(
  id: string,
  troopType: TroopType,
  trigger: TroopSkillDefinition["trigger"],
  effects: readonly TroopSkillEffect[],
  options: {
    readonly probability?: number;
    readonly level?: number;
  } = {},
): TroopSkillDefinition {
  const level = options.level ?? 1;
  return {
    id,
    name: id,
    troopType,
    unlockCondition: { kind: "always" },
    trigger,
    ...(options.probability === undefined
      ? {}
      : { probability: options.probability }),
    levelValues: { [level]: { effects } },
    metadata: { ruleStatus: "supported" },
  };
}

function modifier(
  id: string,
  kind: "damageIncrease" | "damageReduction",
  source: "army" | "self" | TroopType,
  options: {
    readonly target?: "all" | "currentTarget" | TroopType;
    readonly damageType?: "all" | "normalAttack" | "skillDamage";
    readonly value?: number;
    readonly lifecycle?: TroopSkillEffect["lifecycle"];
  } = {},
): TroopSkillEffect {
  return {
    id,
    name: id,
    kind,
    group: id,
    value: options.value ?? 0.5,
    scope: {
      source,
      ...(options.target === undefined ? {} : { target: options.target }),
      ...(options.damageType === undefined
        ? {}
        : { damageType: options.damageType }),
    },
    ...(options.lifecycle === undefined
      ? {}
      : { lifecycle: options.lifecycle }),
  };
}

function extraDamage(id = "extra", coefficient = 0.5): TroopSkillEffect {
  return {
    id,
    name: id,
    kind: "extraDamage",
    coefficient,
    basis: "parentBaseDamage",
    scope: {
      source: "self",
      target: "currentTarget",
      damageType: "skillDamage",
    },
  };
}

function sideWithSkill(
  troop: TroopType,
  skillId: string,
  counts: Partial<Record<TroopType, number>> = { [troop]: 100 },
  maxHpPerUnit = 1_000_000,
): BattleSideSetup {
  return makeSide(counts, {
    maxHpPerUnit,
    skillStates: {
      [troop]: [createTroopSkillRuntimeState(skillId, 1)],
    },
  });
}

function emptyOpponent(
  counts: Partial<Record<TroopType, number>> = { shield: 100 },
  maxHpPerUnit = 1_000_000,
): BattleSideSetup {
  return makeSide(counts, { maxHpPerUnit });
}

describe("troop skill system", () => {
  it("attaches a passive attribute effect and uses it in base damage", () => {
    const skill = supportedSkill("shield-attack", "shield", "passive", [
      {
        id: "shield-attack-effect",
        name: "shield-attack-effect",
        kind: "attributeModifier",
        attribute: "attack",
        operation: "addToAttribute",
        group: "troop-attack",
        value: 0.2,
        scope: { source: "self", target: "all", damageType: "all" },
      },
    ]);
    const state = createBattleState({
      sideA: sideWithSkill("shield", skill.id),
      sideB: emptyOpponent(),
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({ definitions: [skill] }),
    });
    const event = result.trace.damageEvents.find(
      (candidate) => candidate.sourceSide === "A" && candidate.sourceTroop === "shield",
    )!;
    expect(event.baseDamage).toBeCloseTo(120);
    expect(event.baseDamageAttributeEffects[0]?.sourceSkillId).toBe(skill.id);
    expect(result.snapshot.sideA.troops.shield.buffs).toHaveLength(1);
  });

  it("keeps a self/shield outgoing effect off lancer and marksman attacks", () => {
    const skill = supportedSkill("shield-only", "shield", "passive", [
      modifier("shield-only-effect", "damageIncrease", "self", { value: 1 }),
    ]);
    const state = createBattleState({
      sideA: sideWithSkill(
        "shield",
        skill.id,
        { shield: 100, lancer: 100, marksman: 100 },
      ),
      sideB: emptyOpponent({ shield: 300 }),
    });
    const result = resolveRound(state, {
      troopSkillSystem: createTroopSkillSystem({ definitions: [skill] }),
    });
    const fromA = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(fromA.find((event) => event.sourceTroop === "shield")?.increaseMultiplier).toBe(2);
    expect(fromA.find((event) => event.sourceTroop === "lancer")?.increaseMultiplier).toBe(1);
    expect(fromA.find((event) => event.sourceTroop === "marksman")?.increaseMultiplier).toBe(1);
  });

  it("matches a normalAttack-only skill effect only to normal attacks", () => {
    const increase = supportedSkill("normal-only", "shield", "passive", [
      modifier("normal-only-effect", "damageIncrease", "self", {
        damageType: "normalAttack",
      }),
    ]);
    const extra = supportedSkill("extra-skill", "shield", "afterNormalAttack", [
      extraDamage(),
    ]);
    const sideA = makeSide({ shield: 100 }, {
      maxHpPerUnit: 1_000_000,
      skillStates: {
        shield: [
          createTroopSkillRuntimeState(increase.id, 1),
          createTroopSkillRuntimeState(extra.id, 1),
        ],
      },
    });
    const result = resolveRound(
      createBattleState({ sideA, sideB: emptyOpponent() }),
      { troopSkillSystem: createTroopSkillSystem({ definitions: [increase, extra] }) },
    );
    const events = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(events.find((event) => event.damageType === "normalAttack")?.increaseMultiplier).toBe(1.5);
    expect(events.find((event) => event.damageSubtype === "extraDamage")?.increaseMultiplier).toBe(1);
  });

  it("applies skillDamage reduction to extraDamage", () => {
    const extra = supportedSkill("extra", "shield", "afterNormalAttack", [extraDamage()]);
    const reduction = supportedSkill("skill-reduction", "shield", "passive", [
      modifier("skill-reduction-effect", "damageReduction", "army", {
        target: "shield",
        damageType: "skillDamage",
      }),
    ]);
    const result = resolveRound(
      createBattleState({
        sideA: sideWithSkill("shield", extra.id),
        sideB: sideWithSkill("shield", reduction.id),
      }),
      { troopSkillSystem: createTroopSkillSystem({ definitions: [extra, reduction] }) },
    );
    const event = result.trace.damageEvents.find(
      (candidate) => candidate.sourceSide === "A" && candidate.damageSubtype === "extraDamage",
    )!;
    expect(event.damageType).toBe("skillDamage");
    expect(event.reductionMultiplier).toBe(1.5);
  });

  it("creates extraDamage as an independent DamageEvent", () => {
    const skill = supportedSkill("independent-extra", "shield", "afterNormalAttack", [
      extraDamage("independent-extra-effect", 0.25),
    ]);
    const result = resolveRound(
      createBattleState({
        sideA: sideWithSkill("shield", skill.id),
        sideB: emptyOpponent(),
      }),
      { troopSkillSystem: createTroopSkillSystem({ definitions: [skill] }) },
    );
    const events = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.damageSubtype)).toEqual([
      "normalAttack",
      "extraDamage",
    ]);
  });

  it("links extraDamage to the correct parent and root event", () => {
    const skill = supportedSkill("linked-extra", "shield", "afterNormalAttack", [extraDamage()]);
    const result = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: createTroopSkillSystem({ definitions: [skill] }) },
    );
    const [normal, extra] = result.trace.damageEvents.filter((event) => event.sourceSide === "A");
    expect(extra?.parentEventId).toBe(normal?.id);
    expect(extra?.rootEventId).toBe(normal?.id);
    expect(extra?.depth).toBe(1);
  });

  it("uses the migrated ambush skill targetingOverride when explicitly triggered", () => {
    const result = resolveRound(
      createBattleState({
        sideA: sideWithSkill("lancer", LANCER_AMBUSH_SKILL_DEFINITION.id),
        sideB: emptyOpponent({ shield: 50, marksman: 50 }),
      }),
      {
        troopSkillSystem: createTroopSkillSystem({
          definitions: [LANCER_AMBUSH_SKILL_DEFINITION],
          triggerOverrides: { "A:lancer:lancer-ambush": true },
        }),
      },
    );
    const attack = result.trace.damageEvents.find(
      (event) => event.sourceSide === "A" && event.sourceTroop === "lancer",
    );
    expect(attack?.targetTroop).toBe("marksman");
    expect(result.trace.troopSkills[0]?.targetingChanged).toBe(true);
  });

  it("requires injected RNG for confirmed ambush probability", () => {
    expect(() => resolveRound(
      createBattleState({
        sideA: sideWithSkill("lancer", LANCER_AMBUSH_SKILL_DEFINITION.id),
        sideB: emptyOpponent({ shield: 50, marksman: 50 }),
      }),
      {
        troopSkillSystem: createTroopSkillSystem({
          definitions: [LANCER_AMBUSH_SKILL_DEFINITION],
        }),
      },
    )).toThrow("needs an injected RandomSource");
  });

  it("keeps the explicit ambush debug switch available without skill runtime", () => {
    const state = createBattleState({
      sideA: makeSide({ lancer: 100 }),
      sideB: makeSide({ shield: 50, marksman: 50 }),
    });
    const snapshot = createRoundStartSnapshot(state);
    const action = runActionPhase(state, snapshot, { ambushTriggered: { A: true } });
    expect(
      action.generatedEvents.find(
        (event) => event.sourceSide === "A" && event.sourceTroop === "lancer",
      )?.targetTroop,
    ).toBe("marksman");
  });

  it("uses injected deterministic RNG and records its roll", () => {
    const skill = supportedSkill(
      "probability-extra",
      "shield",
      "afterNormalAttack",
      [extraDamage()],
      { probability: 0.5 },
    );
    const simulate = (roll: number) => resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      {
        troopSkillSystem: createTroopSkillSystem({
          definitions: [skill],
          randomSource: createSequenceRandomSource([roll]),
        }),
      },
    );
    const passed = simulate(0.2);
    const failed = simulate(0.8);
    expect(passed.trace.troopSkills[0]?.triggered).toBe(true);
    expect(passed.trace.troopSkills[0]?.rngRoll).toBe(0.2);
    expect(failed.trace.troopSkills[0]?.triggered).toBe(false);
    expect(failed.trace.damageEvents.filter((event) => event.sourceSide === "A")).toHaveLength(1);
  });

  it("decays a finite passive effect duration across rounds", () => {
    const skill = supportedSkill("duration-passive", "shield", "passive", [
      modifier("duration-effect", "damageIncrease", "self", {
        lifecycle: { durationRounds: 2 },
      }),
    ]);
    const system = createTroopSkillSystem({ definitions: [skill] });
    const round1 = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: system },
    );
    expect(round1.stateAfter.sideA.troops.shield.buffs[0]?.remainingRounds).toBe(1);
    const round2 = resolveRound(round1.stateAfter, { troopSkillSystem: system });
    expect(round2.stateAfter.sideA.troops.shield.buffs).toHaveLength(0);
  });

  it("stacks repeated skill effects according to lifecycle policy", () => {
    const skill = supportedSkill("stacking", "shield", "roundStart", [
      modifier("stacking-effect", "damageIncrease", "self", {
        lifecycle: { refreshMode: "stack", maxStacks: 3 },
      }),
    ]);
    const system = createTroopSkillSystem({ definitions: [skill] });
    const round1 = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: system },
    );
    const round2 = resolveRound(round1.stateAfter, { troopSkillSystem: system });
    expect(round2.stateAfter.sideA.troops.shield.buffs[0]?.stackCount).toBe(2);
    expect(round2.stateAfter.sideA.troops.shield.skillStates[0]?.stacks).toBe(2);
  });

  it("refreshes effect duration according to lifecycle policy", () => {
    const skill = supportedSkill("refreshing", "shield", "roundStart", [
      modifier("refreshing-effect", "damageIncrease", "self", {
        lifecycle: { durationRounds: 3, refreshMode: "refresh" },
      }),
    ]);
    const system = createTroopSkillSystem({ definitions: [skill] });
    const round1 = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: system },
    );
    const round2 = resolveRound(round1.stateAfter, { troopSkillSystem: system });
    expect(round2.stateAfter.sideA.troops.shield.buffs[0]?.remainingRounds).toBe(2);
    expect(round2.trace.troopSkills[0]?.lifecycleChanges[0]?.mode).toBe("refresh");
  });

  it("replaces repeated effects according to lifecycle policy", () => {
    const skill = supportedSkill("replacing", "shield", "roundStart", [
      modifier("replacing-effect", "damageIncrease", "self", {
        lifecycle: { refreshMode: "replace" },
      }),
    ]);
    const system = createTroopSkillSystem({ definitions: [skill] });
    const round1 = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: system },
    );
    const round2 = resolveRound(round1.stateAfter, { troopSkillSystem: system });
    expect(round2.stateAfter.sideA.troops.shield.buffs[0]?.appliedRound).toBe(2);
    expect(round2.trace.troopSkills[0]?.lifecycleChanges[0]?.mode).toBe("replace");
  });

  it("audits the full skill to child-event trigger chain", () => {
    const skill = supportedSkill("trace-extra", "shield", "afterNormalAttack", [extraDamage()]);
    const result = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: createTroopSkillSystem({ definitions: [skill] }) },
    );
    const trace = result.trace.troopSkills[0]!;
    const extra = result.trace.damageEvents.find((event) => event.damageSubtype === "extraDamage")!;
    expect(trace.checked).toBe(true);
    expect(trace.triggered).toBe(true);
    expect(trace.producedDamageEventIds).toContain(extra.id);
    expect(trace.parentEventId).toBe(extra.parentEventId);
  });

  it("keeps skill and extra damage pending until RoundEnd resolution", () => {
    const skill = supportedSkill("pending-extra", "shield", "afterNormalAttack", [
      extraDamage("pending-extra-effect", 10),
    ]);
    const initial = createBattleState({
      sideA: sideWithSkill("shield", skill.id, { shield: 100 }, 1),
      sideB: emptyOpponent({ shield: 100 }, 1),
    });
    const result = resolveRound(initial, {
      troopSkillSystem: createTroopSkillSystem({ definitions: [skill] }),
    });
    expect(result.stateAfterActionPhase.sideB.troops.shield.aliveCount).toBe(100);
    expect(result.stateAfterActionPhase.pendingDamageEvents.length).toBeGreaterThan(1);
    expect(result.stateAfter.sideB.troops.shield.aliveCount).toBeLessThan(100);
  });

  it("supports an explicit periodic phase without guessing its offset", () => {
    const skill: TroopSkillDefinition = {
      id: "periodic",
      name: "periodic",
      troopType: "shield",
      unlockCondition: { kind: "always" },
      trigger: "roundStart",
      levelValues: {
        1: {
          periodRounds: 2,
          periodStartRound: 1,
          effects: [
            modifier("periodic-effect", "damageIncrease", "self", {
              lifecycle: { refreshMode: "replace" },
            }),
          ],
        },
      },
      metadata: { ruleStatus: "supported" },
    };
    const system = createTroopSkillSystem({ definitions: [skill] });
    const round1 = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: system },
    );
    const round2 = resolveRound(round1.stateAfter, { troopSkillSystem: system });
    const round3 = resolveRound(round2.stateAfter, { troopSkillSystem: system });
    expect(round1.trace.troopSkills[0]?.triggered).toBe(true);
    expect(round2.trace.troopSkills[0]?.reason).toBe("periodNotDue");
    expect(round3.trace.troopSkills[0]?.triggered).toBe(true);
  });

  it("honors an explicit cooldown counter across later rounds", () => {
    const skill: TroopSkillDefinition = {
      ...supportedSkill("cooldown-extra", "shield", "afterNormalAttack", [extraDamage()]),
      levelValues: {
        1: { cooldownRounds: 1, effects: [extraDamage()] },
      },
    };
    const system = createTroopSkillSystem({ definitions: [skill] });
    const round1 = resolveRound(
      createBattleState({ sideA: sideWithSkill("shield", skill.id), sideB: emptyOpponent() }),
      { troopSkillSystem: system },
    );
    const round2 = resolveRound(round1.stateAfter, { troopSkillSystem: system });
    const round3 = resolveRound(round2.stateAfter, { troopSkillSystem: system });
    expect(round1.trace.troopSkills[0]?.triggered).toBe(true);
    expect(round2.trace.troopSkills[0]?.reason).toBe("cooldown");
    expect(round3.trace.troopSkills[0]?.triggered).toBe(true);
  });
});
