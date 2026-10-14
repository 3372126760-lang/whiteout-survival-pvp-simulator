import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  createActiveEffect,
  createBattleState,
  createConfirmedHeroFormation,
  createHeroSkillSystem,
  createPureTroopBattleState,
  getTroopConstant,
  resolveRound,
  simulateBattle,
  type BattleState,
  type HeroSkillTriggerOverrides,
  type TroopType,
} from "../../pvp";
import { makeSide } from "./helpers";

const ELEONORA = "hero.s11.eleonora";
const LLOYD = "hero.s11.lloyd";
const RUFUS = "hero.s11.rufus";
const SOARING = "hero-skill.eleonora.soaring-flame";
const INGENUITY = "hero-skill.lloyd.endless-ingenuity";
const ARMOR = "hero-skill.rufus.armor-breaking-strike";
const BLAST = "hero-skill.rufus.violent-blast";
const DODGE = "hero-skill.lingnai.swift-shadow-dance";

function battle(heroId: string,
  troops: Partial<Record<TroopType, number>>,
  enemyTroops: Partial<Record<TroopType, number>> = { shield: 100, lancer: 100, marksman: 100 },
  dodge = false): BattleState {
  return createBattleState({
    sideA: { ...makeSide(troops, { maxHpPerUnit: 1_000_000_000 }),
      heroStates: createConfirmedHeroFormation([{ heroId, position: "leader" }]) },
    sideB: { ...makeSide(enemyTroops, { maxHpPerUnit: 1_000_000_000 }),
      heroStates: dodge
        ? createConfirmedHeroFormation([{ heroId: "hero.s4.lingnai", position: "leader" }])
        : [] },
  });
}

function system(overrides: HeroSkillTriggerOverrides = {},
  randomSource = { next: () => .99 },
  onProbabilityDecision?: (skillId: string) => void) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    triggerOverrides: overrides,
    randomSource,
    ...(onProbabilityDecision === undefined ? {} : {
      onProbabilityDecision: ({ skillId }: { skillId: string }) => onProbabilityDecision(skillId),
    }),
  });
}

function main(round: ReturnType<typeof resolveRound>["trace"], side: "A" | "B", troop: TroopType) {
  return round.damageEvents.find((event) => event.sourceSide === side &&
    event.sourceTroop === troop && event.damageType === "normalAttack")!;
}

function stun(state: BattleState, troop: TroopType): BattleState {
  const current = state.sideA.troops[troop];
  const debuff = createActiveEffect({
    identity: { sourceId: `test:stun:${troop}`, sourceSkillId: "test:stun",
      effectId: `test:stun:${troop}` },
    definition: { id: `test:stun:${troop}`, name: "stun",
      kind: "skipNextRoundAction", ruleStatus: "supported",
      lifecycle: { activationTiming: "immediate", durationRounds: 1,
        refreshMode: "replace" } },
    appliedRound: state.round,
    holderScope: troop,
  });
  return { ...state, sideA: { ...state.sideA, troops: { ...state.sideA.troops,
    [troop]: { ...current, debuffs: [...current.debuffs, debuff] } } } };
}

function reduction(round: ReturnType<typeof resolveRound>["trace"],
  side: "A" | "B", troop: TroopType, group: string) {
  return main(round, side, troop).reductionGroups
    .find((entry) => entry.group === group)?.summedValue ?? 0;
}

function penetrationReduction(round: ReturnType<typeof resolveRound>["trace"],
  side: "A" | "B", troop: TroopType) {
  return main(round, side, troop).attributeResolutions
    ?.find((attribute) => attribute.attribute === "penetration")
    ?.reductionGroups.find((group) => group.group === "enemyPenetrationReduction")
    ?.summedValue ?? 0;
}

describe("confirmed S11 expedition timing", () => {
  it("counts Eleonora's dodged fifth shield attempt and starts a two-round buff on R6", () => {
    const result = simulateBattle(
      battle(ELEONORA, { shield: 100 }, { shield: 100 }, true),
      { maxRounds: 8, heroSkillSystem: system({
        [`B:${DODGE}`]: false,
        [`5:B:shield:${DODGE}`]: true,
      }) },
    );
    const fifth = result.trace.rounds[4]!;
    expect(main(fifth, "A", "shield").mainHitCancelled).toBe(true);
    expect(fifth.heroSkills.find((entry) => entry.skillId === SOARING))
      .toMatchObject({ shieldMainAttackAttemptCount: 5,
        shieldNormalAttackDodged: true, soaringFlameTriggered: true,
        activationRound: 6, activeRounds: [6, 7] });
    for (const round of [6, 7]) {
      const trace = result.trace.rounds[round - 1]!;
      expect(main(trace, "A", "shield").increaseGroups
        .find((group) => group.group === "commonDamageIncrease")?.summedValue)
        .toBeCloseTo(.25);
      expect(reduction(trace, "B", "shield", "receivedDamageReduction"))
        .toBeCloseTo(.35);
    }
    expect(main(result.trace.rounds[7]!, "A", "shield").increaseGroups
      .find((group) => group.group === "commonDamageIncrease")?.summedValue ?? 0).toBe(0);
  });

  it("does not count a stunned shield and triggers on its next real fifth attempt", () => {
    let state = battle(ELEONORA, { shield: 100 }, { shield: 100 });
    const heroSkillSystem = system();
    for (let round = 1; round <= 4; round += 1) {
      state = resolveRound(state, { heroSkillSystem }).stateAfter;
    }
    const skipped = resolveRound(stun(state, "shield"), { heroSkillSystem });
    expect(skipped.trace.damageEvents.some((event) =>
      event.sourceSide === "A" && event.sourceTroop === "shield")).toBe(false);
    expect(skipped.stateAfter.sideA.heroStates[0]!.skillStates.find((entry) =>
      entry.skillId === SOARING)?.mainAttackCounts.shield).toBe(4);
    expect(skipped.trace.heroSkills.some((entry) =>
      entry.skillId === SOARING && entry.triggered)).toBe(false);
    const fifth = resolveRound(skipped.stateAfter, { heroSkillSystem });
    expect(fifth.trace.heroSkills.find((entry) => entry.skillId === SOARING))
      .toMatchObject({ shieldMainAttackAttemptCount: 5,
        soaringFlameTriggered: true, activationRound: 7 });
  });

  it("adds Eleonora's shield reduction to the common group and raises maximum HP", () => {
    const round = resolveRound(battle(ELEONORA, { shield: 100, marksman: 100 }),
      { heroSkillSystem: system() });
    expect(reduction(round.trace, "B", "shield", "receivedDamageReduction"))
      .toBeCloseTo(.10);
    expect(round.snapshot.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(1_250_000_000);
    expect(main(round.trace, "A", "marksman").increaseGroups
      .find((group) => group.group === "commonDamageIncrease")?.summedValue)
      .toBeCloseTo(.10);
  });

  it("runs Lloyd's ice fog exactly on R3/R6 and adds both penetration reductions", () => {
    const result = simulateBattle(battle(LLOYD, { lancer: 100 }),
      { maxRounds: 6, heroSkillSystem: system() });
    for (const roundNumber of [1, 2, 4, 5]) {
      const round = result.trace.rounds[roundNumber - 1]!;
      expect(main(round, "A", "lancer").increaseGroups
        .find((group) => group.group === "commonDamageIncrease")?.summedValue ?? 0)
        .toBe(0);
      expect(penetrationReduction(round, "B", "shield")).toBeCloseTo(.20);
    }
    for (const roundNumber of [3, 6]) {
      const round = result.trace.rounds[roundNumber - 1]!;
      expect(main(round, "A", "lancer").increaseGroups
        .find((group) => group.group === "commonDamageIncrease")?.summedValue)
        .toBeCloseTo(1.50);
      expect(penetrationReduction(round, "B", "shield")).toBeCloseTo(.50);
    }
  });

  it("checks Lloyd's 40% round-start penetration afresh each round", () => {
    const rolls = [.2, .8, .1];
    let checks = 0;
    const result = simulateBattle(battle(LLOYD, { shield: 100 }), {
      maxRounds: 3,
      heroSkillSystem: system({}, { next: () => rolls.shift()! },
        (skillId) => { if (skillId === INGENUITY) checks += 1; }),
    });
    expect(checks).toBe(3);
    expect(result.trace.rounds.map((round) => main(round, "A", "shield")
      .attributeResolutions?.find((attribute) => attribute.attribute === "penetration")
      ?.modifierGroups.find((group) => group.group === "heroPenetrationBonus")
      ?.summedValue ?? 0)).toEqual([.5, 0, .5]);
  });

  it("makes Rufus's 0.6B and next-round vulnerability only after a marksman hit", () => {
    const result = simulateBattle(battle(RUFUS, { marksman: 100 }, { shield: 100 }),
      { maxRounds: 2, heroSkillSystem: system({ [`A:${BLAST}`]: false }) });
    const first = result.trace.rounds[0]!;
    const normal = main(first, "A", "marksman");
    const extra = first.damageEvents.find((event) => event.sourceSkillId === ARMOR)!;
    expect(normal.mainHitCancelled).toBe(false);
    expect(extra).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage",
      damageBasis: "parentBaseDamage", skillCoefficient: .6,
      targetTroop: normal.targetTroop });
    expect(extra.baseDamage).toBeCloseTo(normal.baseDamage * .6);
    expect(first.heroSkills.find((entry) => entry.skillId === ARMOR))
      .toMatchObject({ armorBreakingStrikeEligible: true,
        vulnerabilityTarget: normal.targetTroop, vulnerabilityActivationRound: 2 });
    expect(main(result.trace.rounds[1]!, "A", "marksman").increaseGroups
      .find((group) => group.group === "vulnerability")?.summedValue)
      .toBeCloseTo(.25);
  });

  it("cancels Rufus's 0.6B and vulnerability on dodge or stun", () => {
    const dodged = simulateBattle(
      battle(RUFUS, { marksman: 100 }, { shield: 100 }, true),
      { maxRounds: 2, heroSkillSystem: system({
        [`B:${DODGE}`]: false,
        [`1:B:marksman:${DODGE}`]: true,
        [`A:${BLAST}`]: false,
      }) },
    );
    expect(main(dodged.trace.rounds[0]!, "A", "marksman").mainHitCancelled)
      .toBe(true);
    expect(dodged.trace.rounds[0]!.damageEvents.filter((event) =>
      event.sourceSkillId === ARMOR)).toHaveLength(0);
    expect(dodged.trace.rounds[0]!.heroSkills.find((entry) => entry.skillId === ARMOR))
      .toMatchObject({ armorBreakingStrikeEligible: false,
        normalAttackDodged: true });
    expect(main(dodged.trace.rounds[1]!, "A", "marksman").increaseGroups
      .find((group) => group.group === "vulnerability")?.summedValue ?? 0)
      .toBe(0);

    const skipped = resolveRound(stun(battle(RUFUS, { marksman: 100 }), "marksman"),
      { heroSkillSystem: system() });
    expect(skipped.trace.damageEvents.some((event) =>
      event.sourceSide === "A" && event.sourceTroop === "marksman")).toBe(false);
    expect(skipped.trace.heroSkills.some((entry) => entry.skillId === ARMOR)).toBe(false);
  });

  it("rolls Rufus blast before dodge, refreshes without stacking, and skips stunned actions", () => {
    let checks = 0;
    const heroSkillSystem = system({
      [`A:${BLAST}`]: true,
      [`B:${DODGE}`]: true,
    }, { next: () => .99 }, (skillId) => {
      if (skillId === BLAST) checks += 1;
    });
    let state = battle(RUFUS, { shield: 100 }, { shield: 100 }, true);
    const first = resolveRound(state, { heroSkillSystem });
    expect(main(first.trace, "A", "shield").mainHitCancelled).toBe(true);
    expect(checks).toBe(1);
    expect(first.trace.heroSkills.find((entry) => entry.skillId === BLAST))
      .toMatchObject({ mainAttackAttempted: true, normalAttackDodged: true,
        violentBlastEligible: true, violentBlastTriggered: true,
        debuffTarget: "shield", refreshedExistingState: false });
    expect(penetrationReduction(first.trace, "B", "shield")).toBeCloseTo(.5);
    state = first.stateAfter;
    const second = resolveRound(state, { heroSkillSystem });
    expect(checks).toBe(2);
    expect(second.trace.heroSkills.find((entry) => entry.skillId === BLAST))
      .toMatchObject({ refreshedExistingState: true });
    expect(penetrationReduction(second.trace, "B", "shield")).toBeCloseTo(.5);
    expect(second.stateAfter.sideB.troops.shield.debuffs.filter((effect) =>
      effect.identity.sourceSkillId === BLAST)).toHaveLength(1);

    const third = resolveRound(stun(second.stateAfter, "shield"), { heroSkillSystem });
    expect(checks).toBe(2);
    expect(third.trace.heroSkills.some((entry) => entry.skillId === BLAST)).toBe(false);
  });

  it("keeps Rufus blast debuffs independent on shield and ambushed marksman targets", () => {
    const round = resolveRound(
      battle(RUFUS, { shield: 100, lancer: 100 },
        { shield: 100, marksman: 100 }),
      { heroSkillSystem: system({ [`A:${BLAST}`]: true }),
        ambushTriggered: { A: true } },
    );
    const targets = round.trace.heroSkills.filter((entry) =>
      entry.skillId === BLAST && entry.triggered).map((entry) => entry.debuffTarget);
    expect(targets).toEqual(["shield", "marksman"]);
    expect(round.stateAfter.sideB.troops.shield.debuffs.some((effect) =>
      effect.identity.sourceSkillId === BLAST)).toBe(true);
    expect(round.stateAfter.sideB.troops.marksman.debuffs.some((effect) =>
      effect.identity.sourceSkillId === BLAST)).toBe(true);
  });

  it("adds Lloyd and Rufus penetration reductions in one attribute denominator", () => {
    const base = battle(RUFUS, { shield: 100, marksman: 100 }, { shield: 100 });
    const state: BattleState = { ...base, sideA: { ...base.sideA,
      heroStates: createConfirmedHeroFormation([
        { heroId: LLOYD, position: "leader" },
        { heroId: RUFUS, position: "leader" },
      ]) } };
    const round = resolveRound(state, {
      heroSkillSystem: system({ [`A:${BLAST}`]: true }),
    });
    expect(penetrationReduction(round.trace, "B", "shield")).toBeCloseTo(.70);
    expect(main(round.trace, "B", "shield").attributeResolutions
      ?.find((attribute) => attribute.attribute === "penetration")
      ?.divisionFactor).toBeCloseTo(1.70);
  });

  it.each([ELEONORA, LLOYD, RUFUS])(
    "does not double count %s's static or weapon attributes in final-report mode", (heroId) => {
      const troopLevel = "T10-FC10";
      const troopConstant = getTroopConstant(troopLevel);
      const troop = (count: number, damageCoefficient: number) => ({ count,
        attack: .5, penetration: .5, defense: .5, life: .5,
        troopLevel, troopConstant, damageCoefficient });
      const side = { shield: troop(1, 1), lancer: troop(1, 3),
        marksman: troop(1, 4) };
      const scenario = { id: `s11-final-report-${heroId}`,
        battleContext: "rallyDefense" as const,
        sideA: { ...side, attributeInputMode: "finalReport" as const,
          heroes: [{ heroId, position: "leader" as const, weaponLevel: 10 }] },
        sideB: { ...side, attributeInputMode: "finalReport" as const },
        maxRounds: 1 };
      const final = createPureTroopBattleState(scenario);
      expect(final.sideA.heroStates[0]!.weaponLevel).toBe(0);
      expect(final.sideA.heroStates[0]!.skillStates).toHaveLength(3);
      expect(final.sideA.troops.shield.attack).toBe(.5);
      expect(final.sideA.troops.shield.penetration).toBe(.5);
      expect(final.sideA.troops.shield.life).toBe(.5);
    },
  );
});
