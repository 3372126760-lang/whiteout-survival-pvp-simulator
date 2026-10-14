import { describe, expect, it, vi } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  MIA_LUCKY_BLESSING,
  REINA_SWIFT_SHADOW_DANCE,
  TROOP_TYPES,
  createActiveEffect,
  createBattleState,
  createHeroSkillSystem,
  createHeroStateFromDefinitions,
  getExpeditionHeroData,
  resolveRound,
  type AdditionalDamageGenerator,
  type BattleState,
  type HeroSkillDefinition,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const MOLLY_ICE_FIELD = CONFIRMED_HERO_SKILL_DEFINITIONS.find(
  (definition) => definition.id === "hero-skill.moli.ice-field",
)!;
const counts = { shield: 100, lancer: 100, marksman: 100 };
const hugeHp = 1_000_000_000;

function battle(skill: HeroSkillDefinition, dodge = false,
  enemyCounts: Partial<Record<TroopType, number>> = counts): BattleState {
  return createBattleState({
    sideA: {
      ...makeSide(counts, { maxHpPerUnit: hugeHp }),
      heroStates: [createHeroStateFromDefinitions(
        { heroId: skill.heroId, position: "leader" }, [skill],
      )],
    },
    sideB: {
      ...makeSide(enemyCounts, { maxHpPerUnit: hugeHp }),
      heroStates: dodge ? [createHeroStateFromDefinitions(
        { heroId: REINA_SWIFT_SHADOW_DANCE.heroId, position: "leader" },
        [REINA_SWIFT_SHADOW_DANCE],
      )] : [],
    },
  });
}

function system(skill: HeroSkillDefinition, rolls: readonly number[]) {
  let cursor = 0;
  const next = vi.fn(() => {
    const roll = rolls[cursor++];
    if (roll === undefined) throw new Error("Unexpected extra probability roll.");
    return roll;
  });
  return {
    next,
    heroSkillSystem: createHeroSkillSystem({
      definitions: [skill, REINA_SWIFT_SHADOW_DANCE],
      randomSource: { next },
      // Force only Reina's dodge; all attacker proc decisions use the supplied RNG.
      triggerOverrides: { [REINA_SWIFT_SHADOW_DANCE.id]: true },
    }),
  };
}

function stun(state: BattleState, troop: TroopType): BattleState {
  const id = `test:stun:${troop}`;
  const debuff = createActiveEffect({
    identity: { sourceId: id, sourceSkillId: "test:stun", effectId: id },
    definition: {
      id, name: "stun", kind: "skipNextRoundAction", ruleStatus: "supported",
      lifecycle: { activationTiming: "immediate", durationRounds: 1, refreshMode: "replace" },
    },
    appliedRound: state.round,
    holderScope: troop,
  });
  return {
    ...state,
    sideA: {
      ...state.sideA,
      troops: {
        ...state.sideA.troops,
        [troop]: { ...state.sideA.troops[troop], debuffs: [debuff] },
      },
    },
  };
}

type Round = ReturnType<typeof resolveRound>;
const mains = (round: Round) => round.trace.damageEvents.filter(
  (event) => event.sourceSide === "A" && event.damageSubtype === "normalAttack",
);
const extras = (round: Round) => round.trace.damageEvents.filter(
  (event) => event.sourceSide === "A" && event.damageSubtype === "extraDamage",
);
const decisions = (round: Round, skill: HeroSkillDefinition) => round.trace.heroSkills
  .filter((trace) => trace.skillId === skill.id)
  .map((trace) => [trace.sourceTroop, trace.rngRoll, trace.triggered]);

function expectExtraBases(round: Round, skill: HeroSkillDefinition) {
  for (const extra of extras(round)) {
    const parent = mains(round).find((event) => event.id === extra.parentEventId)!;
    expect(parent).toBeDefined();
    expect(extra).toMatchObject({
      sourceSkillId: skill.id,
      sourceTroop: parent.sourceTroop,
      targetSide: parent.targetSide,
      targetTroop: parent.targetTroop,
      rootEventId: parent.rootEventId,
      depth: 1,
      damageType: "skillDamage",
      damageSubtype: "extraDamage",
      skillCoefficient: .50,
      damageBasis: "parentBaseDamage",
    });
    expect(extra.baseDamage).toBeCloseTo(parent.baseDamage * .50, 12);
    expect(extra.id).toContain("hero-effect." + (skill === MIA_LUCKY_BLESSING
      ? "miya.lucky-blessing" : "moli.ice-field"));
  }
}

describe("Mia Lucky Blessing reuses Molly Ice Field's per-main-attack extra damage", () => {
  it("rolls [.2, .8, .2] three times and adds 0.5B only for shield and marksman", () => {
    const options = system(MIA_LUCKY_BLESSING, [.2, .8, .2]);
    const round = resolveRound(battle(MIA_LUCKY_BLESSING), options);
    expect(options.next).toHaveBeenCalledTimes(3);
    expect(decisions(round, MIA_LUCKY_BLESSING)).toEqual([
      ["shield", .2, true], ["lancer", .8, false], ["marksman", .2, true],
    ]);
    expect(mains(round)).toHaveLength(3);
    expect(extras(round).map((event) => event.sourceTroop)).toEqual(["shield", "marksman"]);
    expectExtraBases(round, MIA_LUCKY_BLESSING);
    expect(round.trace.damageEvents.every((event) => !event.increaseGroups.some(
      (group) => group.group === "commonDamageIncrease",
    ))).toBe(true);
    expect(round.stateAfter.sideA.armyEffects).toEqual([]);
  });

  it.each([
    { rolls: [.8, .2, .8], triggered: ["lancer"] },
    { rolls: [.2, .2, .2], triggered: ["shield", "lancer", "marksman"] },
    { rolls: [.8, .8, .8], triggered: [] },
  ])("keeps the three troop decisions independent for $rolls", ({ rolls, triggered }) => {
    const options = system(MIA_LUCKY_BLESSING, rolls);
    const round = resolveRound(battle(MIA_LUCKY_BLESSING), options);
    expect(options.next).toHaveBeenCalledTimes(3);
    expect(extras(round).map((event) => event.sourceTroop)).toEqual(triggered);
    expect(decisions(round, MIA_LUCKY_BLESSING)).toEqual(TROOP_TYPES.map(
      (troop, index) => [troop, rolls[index], rolls[index]! < .50],
    ));
  });

  it("checks each troop again on the next round instead of keeping a shared round buff", () => {
    const options = system(MIA_LUCKY_BLESSING, [.2, .8, .2, .8, .2, .8]);
    const first = resolveRound(battle(MIA_LUCKY_BLESSING), options);
    const second = resolveRound(first.stateAfter, options);
    expect(options.next).toHaveBeenCalledTimes(6);
    expect(extras(first).map((event) => event.sourceTroop)).toEqual(["shield", "marksman"]);
    expect(extras(second).map((event) => event.sourceTroop)).toEqual(["lancer"]);
    expectExtraBases(second, MIA_LUCKY_BLESSING);
  });

  it("does not advance mainAttackCounts or recursively invoke afterNormalAttack for extra damage", () => {
    const options = system(MIA_LUCKY_BLESSING, [.2, .2, .2]);
    const afterNormalAttack = vi.fn<AdditionalDamageGenerator["afterNormalAttack"]>(() => []);
    const round = resolveRound(battle(MIA_LUCKY_BLESSING), {
      ...options,
      additionalDamageGenerators: [{ id: "test:observe-main-attacks", afterNormalAttack }],
    });
    expect(extras(round)).toHaveLength(3);
    expect(afterNormalAttack.mock.calls.filter(([context]) =>
      context.primaryDamageEvent.sourceSide === "A"
    )).toHaveLength(3);
    expect(options.next).toHaveBeenCalledTimes(3);
    expect(round.stateAfter.sideA.heroStates[0]!.skillStates[0]!.mainAttackCounts)
      .toEqual({ shield: 0, lancer: 0, marksman: 0 });
  });

  describe.each([MIA_LUCKY_BLESSING, MOLLY_ICE_FIELD])("$id main-attack gates", (skill) => {
    it("discards successful pre-dodge procs when Reina cancels the parent hit", () => {
      const options = system(skill, [.2, .2, .2]);
      const round = resolveRound(battle(skill, true), options);
      expect(options.next).toHaveBeenCalledTimes(3);
      expect(decisions(round, skill)).toEqual([
        ["shield", .2, true], ["lancer", .2, true], ["marksman", .2, true],
      ]);
      expect(mains(round)).toHaveLength(3);
      expect(mains(round).every((event) => event.mainHitCancelled && event.finalDamage === 0)).toBe(true);
      expect(extras(round)).toEqual([]);
    });

    it("does not roll or emit extra damage when all three troops are stunned", () => {
      const options = system(skill, []);
      const state = TROOP_TYPES.reduce(stun, battle(skill));
      const round = resolveRound(state, options);
      expect(options.next).not.toHaveBeenCalled();
      expect(decisions(round, skill)).toEqual([]);
      expect(mains(round)).toEqual([]);
      expect(extras(round)).toEqual([]);
    });

    it.each(TROOP_TYPES)("only rolls the other two troops when %s is stunned", (troop) => {
      const options = system(skill, [.2, .2]);
      const round = resolveRound(stun(battle(skill), troop), options);
      const active = TROOP_TYPES.filter((type) => type !== troop);
      expect(options.next).toHaveBeenCalledTimes(2);
      expect(mains(round).map((event) => event.sourceTroop)).toEqual(active);
      expect(extras(round).map((event) => event.sourceTroop)).toEqual(active);
      expect(decisions(round, skill).map(([sourceTroop]) => sourceTroop)).toEqual(active);
      expectExtraBases(round, skill);
    });
  });

  it("does not roll for a main action skipped by a lifecycle provider", () => {
    const options = system(MIA_LUCKY_BLESSING, [.2, .2]);
    const round = resolveRound(battle(MIA_LUCKY_BLESSING), {
      ...options,
      mainAttackLifecycleProviders: [{
        id: "test:skip-lancer",
        beforeMainAttack: ({ action }) => ({ skip: action.side === "A" && action.troop === "lancer" }),
      }],
    });
    expect(options.next).toHaveBeenCalledTimes(2);
    expect(mains(round).map((event) => event.sourceTroop)).toEqual(["shield", "marksman"]);
    expect(extras(round).map((event) => event.sourceTroop)).toEqual(["shield", "marksman"]);
  });

  it.each(["lancer", "marksman"] as const)("inherits the actual %s main target, identically to Molly", (target) => {
    const rounds = [MIA_LUCKY_BLESSING, MOLLY_ICE_FIELD].map((skill) => {
      const options = system(skill, [.2, .8, .2]);
      const round = resolveRound(battle(skill, false, { [target]: 100 }), options);
      expect(options.next).toHaveBeenCalledTimes(3);
      expect(extras(round).map((event) => event.targetTroop)).toEqual([target, target]);
      expectExtraBases(round, skill);
      return round;
    });
    const numericEvents = (round: Round) => round.trace.damageEvents.map((event) => ({
      sourceSide: event.sourceSide, sourceTroop: event.sourceTroop,
      targetSide: event.targetSide, targetTroop: event.targetTroop,
      damageType: event.damageType, damageSubtype: event.damageSubtype,
      baseDamage: event.baseDamage, rawDamage: event.rawDamage, finalDamage: event.finalDamage,
    }));
    expect(numericEvents(rounds[0]!)).toEqual(numericEvents(rounds[1]!));
  });

  it("has the same complete execution template as Molly except Mia's identity and catalogue metadata", () => {
    const omit = (value: object, keys: readonly string[]) => Object.fromEntries(
      Object.entries(value).filter(([key]) => !keys.includes(key)),
    );
    const mechanics = (skill: HeroSkillDefinition) => {
      return {
        ...omit(skill, ["id", "heroId", "name", "metadata"]),
        levelValues: Object.fromEntries(Object.entries(skill.levelValues).map(([level, value]) => [
          level, {
            ...value,
            effects: value.effects.map((effect) => omit(effect, ["id", "name"])),
          },
        ])),
      };
    };
    expect(mechanics(MIA_LUCKY_BLESSING)).toEqual(mechanics(MOLLY_ICE_FIELD));
    expect(MIA_LUCKY_BLESSING.levelValues[5]!.effects).toEqual([
      expect.objectContaining({
        id: "hero-effect.miya.lucky-blessing", kind: "extraDamage",
        coefficient: .50, basis: "parentBaseDamage", recipient: "selfArmy",
        scope: { source: "army", target: "currentTarget", damageType: "skillDamage" },
      }),
    ]);
    const description = getExpeditionHeroData(MIA_LUCKY_BLESSING.heroId)!.expeditionSkills
      .find((entry) => entry.combatSkillDefinitionId === MIA_LUCKY_BLESSING.id)!.description;
    expect(description).toContain("0.5B");
    expect(description).not.toContain("全军当回合造成伤害提升");
  });
});
