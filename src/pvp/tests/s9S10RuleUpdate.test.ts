import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
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

const DODGE = "hero-skill.lingnai.swift-shadow-dance";
const MAGNUS_PROC = "hero-skill.magenusi.steel-phalanx";
const FRED_PROC = "hero-skill.fuleide.tidal-offensive";
const SHURA_PROC = "hero-skill.xiula.piercing-arrow";
const FREYA_PROC = "hero-skill.freya.crescent-scythe";
const BLANCHE_BURST = "hero-skill.blanchette.crimson-burst";
const BLANCHE_SNIPER = "hero-skill.blanchette.dawn-sniper";

function battle(
  heroId: string,
  troops: Partial<Record<TroopType, number>>,
  enemyTroops: Partial<Record<TroopType, number>> = { shield: 100, lancer: 100, marksman: 100 },
  dodge = false,
): BattleState {
  return createBattleState({
    sideA: {
      ...makeSide(troops, { maxHpPerUnit: 1_000_000_000 }),
      heroStates: createConfirmedHeroFormation([{ heroId, position: "leader" }]),
    },
    sideB: {
      ...makeSide(enemyTroops, { maxHpPerUnit: 1_000_000_000 }),
      heroStates: dodge
        ? createConfirmedHeroFormation([{ heroId: "hero.s4.lingnai", position: "leader" }])
        : [],
    },
  });
}

function system(
  overrides: HeroSkillTriggerOverrides = {},
  onProbabilityDecision?: (skillId: string) => void,
) {
  return createHeroSkillSystem({
    definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
    randomSource: { next: () => .39 },
    triggerOverrides: overrides,
    ...(onProbabilityDecision === undefined ? {} : {
      onProbabilityDecision: ({ skillId }: { skillId: string }) => onProbabilityDecision(skillId),
    }),
  });
}

function main(round: ReturnType<typeof resolveRound>["trace"], side: "A" | "B", troop: TroopType) {
  return round.damageEvents.find((event) => event.sourceSide === side &&
    event.sourceTroop === troop && event.damageType === "normalAttack")!;
}

describe("confirmed S9/S10 attack timing and kB rules", () => {
  it("adds Magnus shield and Shura army reductions in one received-damage denominator", () => {
    const base = battle("hero.s9.magenusi", { shield: 100, marksman: 100 });
    const state: BattleState = { ...base, sideA: { ...base.sideA,
      heroStates: createConfirmedHeroFormation([
        { heroId: "hero.s9.magenusi", position: "leader" },
        { heroId: "hero.s9.xiula", position: "member",
          selectedMemberSkillId: "hero-skill.xiula.mist-spores" },
      ]) } };
    const round = resolveRound(state, { heroSkillSystem: system() });
    const incoming = main(round.trace, "B", "shield");
    expect(incoming.receivedDamageReductionTotal).toBeCloseTo(.30);
    expect(incoming.receivedDamageReductionDenominator).toBeCloseTo(1.30);
  });

  it("checks Magnus on all 100 shield attempts including 20 dodged normals", () => {
    const overrides: Record<string, boolean> = { [`B:${DODGE}`]: false };
    for (let round = 5; round <= 100; round += 5) {
      overrides[`${round}:B:shield:${DODGE}`] = true;
    }
    let eligibleRolls = 0;
    const result = simulateBattle(
      battle("hero.s9.magenusi", { shield: 100 }, { shield: 100 }, true),
      { maxRounds: 100, heroSkillSystem: system(overrides, (skillId) => {
        if (skillId === MAGNUS_PROC) eligibleRolls += 1;
      }) },
    );
    expect(eligibleRolls).toBe(100);
    expect(result.trace.rounds.filter((round) => main(round, "A", "shield").mainHitCancelled))
      .toHaveLength(20);
    expect(result.trace.rounds.filter((round) => round.heroSkills.some((skill) =>
      skill.skillId === MAGNUS_PROC && skill.steelPhalanxEligible))).toHaveLength(100);
    expect(result.trace.rounds[4]!.heroSkills.find((skill) => skill.skillId === MAGNUS_PROC))
      .toMatchObject({ mainAttackAttemptCount: 5, normalAttackDodged: true,
        steelPhalanxTriggered: true, defenseBuffCurrentRoundOnly: true });
  });

  it("fires Fred's fourth 2B on a dodged attempt and schedules next-round outgoing reduction", () => {
    const result = simulateBattle(
      battle("hero.s9.fuleide", { lancer: 100 }, { shield: 100 }, true),
      { maxRounds: 5, heroSkillSystem: system({
        [`B:${DODGE}`]: false,
        [`4:B:lancer:${DODGE}`]: true,
      }) },
    );
    const fourth = result.trace.rounds[3]!;
    const normal = main(fourth, "A", "lancer");
    expect(normal.mainHitCancelled).toBe(true);
    expect(normal.finalDamage).toBe(0);
    const extra = fourth.damageEvents.find((event) => event.sourceSkillId === FRED_PROC)!;
    expect(extra).toMatchObject({ damageType: "skillDamage", damageSubtype: "extraDamage",
      damageBasis: "parentBaseDamage", skillCoefficient: 2, targetTroop: normal.targetTroop });
    expect(extra.baseDamage).toBeCloseTo(normal.baseDamage * 2);
    expect(fourth.heroSkills.find((skill) => skill.skillId === FRED_PROC))
      .toMatchObject({ lancerAttackAttemptCount: 4, tidalOffensiveTriggered: true,
        nextRoundOutgoingReductionScheduled: true });
    expect(main(result.trace.rounds[4]!, "B", "shield").reductionGroups
      .find((group) => group.group === "enemyOutgoingDamageReduction")?.summedValue).toBeCloseTo(.2);
  });

  it("fires Shura's second 1B after dodge and binds next-round vulnerability to that target", () => {
    const result = simulateBattle(
      battle("hero.s9.xiula", { marksman: 100 }, { shield: 100 }, true),
      { maxRounds: 3, heroSkillSystem: system({
        [`B:${DODGE}`]: false,
        [`2:B:marksman:${DODGE}`]: true,
      }) },
    );
    const second = result.trace.rounds[1]!;
    const normal = main(second, "A", "marksman");
    expect(normal.mainHitCancelled).toBe(true);
    const extra = second.damageEvents.find((event) => event.sourceSkillId === SHURA_PROC)!;
    expect(extra.baseDamage).toBeCloseTo(normal.baseDamage);
    expect(extra.damageBasis).toBe("parentBaseDamage");
    expect(second.heroSkills.find((skill) => skill.skillId === SHURA_PROC))
      .toMatchObject({ marksmanAttackAttemptCount: 2,
        vulnerabilityTarget: normal.targetTroop, vulnerabilityActivationRound: 3 });
    expect(main(result.trace.rounds[2]!, "A", "marksman").increaseGroups
      .find((group) => group.group === "vulnerability")?.summedValue).toBeCloseTo(.25);
  });

  it("does not roll Freya on a dodged lancer main", () => {
    let rolls = 0;
    const round = resolveRound(
      battle("hero.s10.freya", { lancer: 100 }, { shield: 100 }, true),
      { heroSkillSystem: system({ [`B:${DODGE}`]: true }, (skillId) => {
        if (skillId === FREYA_PROC) rolls += 1;
      }) },
    );
    expect(main(round.trace, "A", "lancer").mainHitCancelled).toBe(true);
    expect(rolls).toBe(0);
    expect(round.trace.damageEvents.filter((event) => event.sourceSkillId === FREYA_PROC))
      .toHaveLength(0);
    expect(round.trace.heroSkills.find((skill) => skill.skillId === FREYA_PROC))
      .toMatchObject({ lancerMainAttackAttempted: true, lancerNormalAttackHit: false,
        crescentScytheEligible: false, crescentScytheTriggered: false });
  });

  it("keeps Blanche's R3/R6 natural cycle and Wayne's two target split", () => {
    const result = simulateBattle(
      battle("hero.s10.blanchette", { marksman: 100 }),
      { maxRounds: 6, heroSkillSystem: system() },
    );
    for (const roundNumber of [1, 2, 4, 5]) {
      expect(result.trace.rounds[roundNumber - 1]!.damageEvents.filter((event) =>
        event.sourceSkillId === BLANCHE_BURST)).toHaveLength(0);
    }
    for (const roundNumber of [3, 6]) {
      const round = result.trace.rounds[roundNumber - 1]!;
      const normal = main(round, "A", "marksman");
      const burst = round.damageEvents.find((event) => event.sourceSkillId === BLANCHE_BURST)!;
      expect(burst.baseDamage).toBeCloseTo(normal.baseDamage * .75);
      expect(burst.damageBasis).toBe("parentBaseDamage");
    }
    const second = result.trace.rounds[1]!;
    const sniper = second.damageEvents.filter((event) => event.sourceSkillId === BLANCHE_SNIPER);
    expect(sniper.map((event) => [event.targetTroop, event.skillCoefficient]))
      .toEqual([["lancer", .4], ["marksman", .2]]);
    const absent = simulateBattle(
      battle("hero.s10.blanchette", { marksman: 100 }, { shield: 100, marksman: 100 }),
      { maxRounds: 2, heroSkillSystem: system() },
    );
    expect(absent.trace.rounds[1]!.damageEvents.filter((event) =>
      event.sourceSkillId === BLANCHE_SNIPER).map((event) => event.targetTroop))
      .toEqual(["marksman"]);
  });

  it.each(["hero.s9.magenusi", "hero.s9.fuleide", "hero.s9.xiula",
    "hero.s10.gregory", "hero.s10.freya", "hero.s10.blanchette"])(
    "does not add %s weapon stats twice in final-report mode", (heroId) => {
      const troopLevel = "T10-FC10";
      const troopConstant = getTroopConstant(troopLevel);
      const troop = (count: number, damageCoefficient: number) => ({ count,
        attack: .5, penetration: .5, defense: .5, life: .5,
        troopLevel, troopConstant, damageCoefficient });
      const side = { shield: troop(1, 1), lancer: troop(1, 3),
        marksman: troop(1, 4) };
      const scenario = { id: `s9-s10-final-report-${heroId}`,
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
      expect(final.sideA.troops.shield.defense).toBe(.5);
    },
  );
});
