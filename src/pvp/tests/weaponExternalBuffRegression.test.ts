import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS,
  TROOP_TYPES,
  compileValidationBattle,
  createValidationPreviewState,
  previewExpectedReportBonuses,
  resolveReportAttributeBonus,
  runValidationBattle,
  type ValidationBattleInput,
  type TroopType,
  type SideId,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { zeroReportBonuses } from "../validationUi/reportBonusContexts";
import { expectedAttributeAuditIsConsistent } from "../validationUi/expectedReportAttribute";

const RUFUS = "hero.s11.rufus";
const disabled = [
  "hero-skill.rufus.fire-brigade",
  "hero-skill.rufus.armor-breaking-strike",
  "hero-skill.rufus.violent-blast",
];

function rufusInput(town: "none" | "small" | "large",
  petAttackLevel: number): ValidationBattleInput {
  const base = createDefaultValidationInput();
  return { ...base, attributeInputMode: "prediction", battleContext: "rally",
    maxRounds: 1, disabledSkillIds: disabled,
    sideA: { ...base.sideA,
      troops: { ...base.sideA.troops,
        marksman: { ...base.sideA.troops.marksman, attack: 0 } },
      reportHeroByTroop: { ...base.sideA.reportHeroByTroop, marksman: RUFUS },
      reportWeaponLevels: { [RUFUS]: 10 },
      leaderHeroIds: { ...base.sideA.leaderHeroIds, marksman: RUFUS },
      simulationWeaponLevels: { [RUFUS]: 10 },
      externalBuffs: { ...base.sideA.externalBuffs!,
        town: { ...base.sideA.externalBuffs!.town, attack: town },
        pet: { ...base.sideA.externalBuffs!.pet, attackLevel: petAttackLevel } },
    } };
}

describe("S11 marksman weapon and normal Buff in one external group", () => {
  it.each([
    ["none", 5, .05, .20],
    ["small", 0, .10, .25],
    ["small", 5, .15, .30],
    ["large", 0, .20, .35],
    ["large", 5, .25, .40],
    ["large", 10, .30, .45],
  ] as const)("adds %s town and pet Lv%i: external %d plus weapon -> %d",
    (town, pet, external, expected) => {
      const input = rufusInput(town, pet);
      const state = createValidationPreviewState(input);
      const preview = previewExpectedReportBonuses(input);
      expect(state.sideA.troops.marksman.attack).toBeCloseTo(external, 12);
      expect(preview.A.breakdown.marksman.attack.ownBuffRate).toBeCloseTo(expected, 12);
      expect(preview.A.breakdown.marksman.attack.finalBonus).toBeCloseTo(expected, 12);
      expect(preview.A.troops.marksman.attack).toBeCloseTo(expected, 12);

      const battle = runValidationBattle(input);
      expect(battle.initialState.sideA.troops.marksman.attack).toBeCloseTo(external, 12);
      const attack = battle.trace.rounds[0]?.damageEvents.find((event) =>
        event.sourceSide === "A" && event.sourceTroop === "marksman" &&
        event.damageType === "normalAttack");
      const attackAttribute = attack?.attributeResolutions?.find((entry) =>
        entry.attribute === "attack");
      expect(attackAttribute?.baseAttribute).toBeCloseTo(external, 12);
      expect(attackAttribute?.finalAttribute).toBeCloseTo(expected, 12);
      expect(attack?.baseDamageFormula?.attackMultiplier).toBeCloseTo(1 + expected, 12);
    });

  it("applies the current buff factor after a weapon's static formation correction", () => {
    const input = rufusInput("none", 0);
    const sideA = { ...input.sideA,
      reportWeaponLevels: { [RUFUS]: 0 },
      troops: { ...input.sideA.troops,
        marksman: { ...input.sideA.troops.marksman, penetration: 0 } },
      externalBuffs: { ...input.sideA.externalBuffs!,
        pet: { ...input.sideA.externalBuffs!.pet, penetrationLevel: 10 } },
    };
    const state = createValidationPreviewState({ ...input, sideA });
    expect(state.sideA.troops.marksman.penetration).toBeCloseTo(3.62, 12);
    expect(resolveReportAttributeBonus({ baseBonus: 0, additiveBonus: 3.2,
      specialBuff: .1 }).finalBonus).toBeCloseTo(3.3, 12);
  });

  it("does not add prediction buffs or weapon effects to final-report inputs", () => {
    const input = rufusInput("large", 10);
    const sideA = { ...input.sideA,
      troops: { ...input.sideA.troops,
        marksman: { ...input.sideA.troops.marksman, attack: 45 } },
    };
    const state = createValidationPreviewState({ ...input,
      attributeInputMode: "finalReport", sideA });
    expect(state.sideA.troops.marksman.attack).toBeCloseTo(.45, 12);
    expect(state.sideA.heroStates.find((hero) => hero.heroId === RUFUS)?.weaponLevel).toBe(0);
    const row = previewExpectedReportBonuses({ ...input,
      attributeInputMode: "finalReport", sideA }).A.breakdown.marksman.attack;
    expect(row.currentWeaponBuff).toBe(0);
    expect(row.currentExternalBuffTotal).toBe(0);
    expect(row.finalBonus).toBeCloseTo(.45, 12);
  });
});

const weaponCases = [
  { stat: "attack", side: "A", role: "marksman", hero: RUFUS,
    skill: "hero-weapon-skill.rufus.rally-attack" },
  { stat: "defense", side: "B", role: "shield", hero: "hero.s8.jiatuo",
    skill: "hero-weapon-skill.jiatuo.defense-defense" },
  { stat: "penetration", side: "B", role: "lancer", hero: "hero.s8.suoniya",
    skill: "hero-weapon-skill.suoniya.defense-penetration" },
  { stat: "life", side: "B", role: "shield", hero: "hero.s11.eleonora",
    skill: "hero-weapon-skill.eleonora.defense-life" },
] as const;
type WeaponCase = typeof weaponCases[number];

function weaponAttributeInput(testCase: WeaponCase, normalBuff: number,
  debuff: number, weaponLevel = 10): ValidationBattleInput {
  const base = createDefaultValidationInput();
  const key = testCase.side === "A" ? "sideA" : "sideB";
  const side = base[key];
  return { ...base, attributeInputMode: "prediction", battleContext: "rally", maxRounds: 2,
    disabledSkillIds: CONFIRMED_HERO_SKILL_DEFINITIONS.filter((definition) =>
      definition.positionRule.kind !== "exclusiveWeapon").map((definition) => definition.id),
    [testCase.side === "A" ? "sideB" : "sideA"]: { ...base[testCase.side === "A" ? "sideB" : "sideA"], externalBuffs: {
      ...side.externalBuffs!, town: { ...side.externalBuffs!.town,
        ...(testCase.stat === "attack" ? { enemyAttackReduction: debuff ? "large" : "none" } : {}),
        ...(testCase.stat === "defense" ? { enemyDefenseReduction: debuff ? "large" : "none" } : {}) },
      pet: { ...side.externalBuffs!.pet,
        enemyPenetrationReductionLevel: testCase.stat === "penetration" && debuff ? 8 : 0,
        enemyLifeReductionLevel: testCase.stat === "life" && debuff ? 7 : 0 } } },
    [key]: { ...side, reportHeroByTroop: { [testCase.role]: testCase.hero },
      leaderHeroIds: { [testCase.role]: testCase.hero },
      reportWeaponLevels: { [testCase.hero]: weaponLevel },
      simulationWeaponLevels: { [testCase.hero]: weaponLevel },
      externalBuffs: { ...side.externalBuffs!,
        town: { ...side.externalBuffs!.town, [testCase.stat]: normalBuff ? "large" : "none" },
        pet: { ...side.externalBuffs!.pet, [`${testCase.stat}Level`]: normalBuff ? 10 : 0 } },
      troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
        { ...side.troops[troop], attack: 200, defense: 200, penetration: 200, life: 200 }])) as typeof side.troops,
    } };
}

function assertBattleAttribute(input: ValidationBattleInput, side: SideId,
  stat: WeaponCase["stat"], expected: number, troop: TroopType = "shield"): void {
  const battle = runValidationBattle(input);
  const round = battle.trace.rounds[0]!;
  if (stat === "life") {
    const original = side === "A" ? battle.initialState.sideA : battle.initialState.sideB;
    for (const troop of TROOP_TYPES) expect(round.roundStart.sides[side][troop].maxHpPerUnit)
      .toBeCloseTo(original.troops[troop].baseHpPerUnit * (1 + expected), 8);
  } else {
    const event = round.damageEvents.find((event) => stat === "defense"
      ? event.targetSide === side && event.targetTroop === troop
      : event.sourceSide === side && event.sourceTroop === troop);
    expect(event?.attributeResolutions?.find((row) => row.attribute === stat)?.finalAttribute)
      .toBeCloseTo(expected, 12);
  }
  const compiled = compileValidationBattle(input);
  const fast = compiled.runFastTrial(input.randomSeed);
  expect(fast.outcome).toBe(battle.summary.outcome);
  expect(fast.remaining).toEqual(battle.summary.remaining);
  expect(compiled.runFastTrial(input.randomSeed)).toEqual(fast);
}

describe.each(weaponCases)("$stat scene weapon external group", (testCase) => {
  it.each([
    { normal: .30, weaponLevel: 0, weapon: 0, debuff: 0, expected: 2.90 },
    { normal: 0, weaponLevel: 10, weapon: .15, debuff: 0, expected: 2.45 },
    { normal: .30, weaponLevel: 10, weapon: .15, debuff: 0, expected: 3.35 },
    { normal: .30, weaponLevel: 10, weapon: .15, debuff: .20, expected: 2.625 },
  ])("normal $normal + weapon $weapon with debuff $debuff", (values) => {
    const input = weaponAttributeInput(testCase, values.normal, values.debuff, values.weaponLevel);
    const expected = values.debuff && ["penetration", "life"].includes(testCase.stat) ? 3.142857142857143 : values.expected;
    const preview = previewExpectedReportBonuses(input)[testCase.side];
    for (const troop of TROOP_TYPES) {
      const row = preview.breakdown[troop][testCase.stat];
      expect(row.lineupCorrection).toBeCloseTo(0, 12);
      expect(row.currentExternalBuffBase).toBeCloseTo(values.normal, 12);
      expect(row.currentWeaponBuff).toBeCloseTo(values.weapon, 12);
      expect(row.weaponScenarioContribution).toBeCloseTo(values.weapon, 12);
      expect(row.currentExternalBuffTotal).toBeCloseTo(values.normal + values.weapon, 12);
      expect(row.calculationAudit.actualTargetBuffUsed).toBeCloseTo(values.normal + values.weapon, 12);
      expect(row.finalBonus).toBeCloseTo(expected, 12);
      expect(preview.troops[troop][testCase.stat]).toBeCloseTo(expected, 12);
      expect(expectedAttributeAuditIsConsistent(row.calculationAudit)).toBe(true);
    }
    assertBattleAttribute(input, testCase.side, testCase.stat, expected);
  });

  it("respects disabled weapon effects and ineligible battle contexts", () => {
    const input = weaponAttributeInput(testCase, .30, .20);
    for (const inactive of [
      { ...input, disabledSkillIds: [...input.disabledSkillIds, testCase.skill] },
      { ...input, battleContext: "challenge" as const },
    ]) {
      const row = previewExpectedReportBonuses(inactive)[testCase.side].breakdown.shield[testCase.stat];
      expect(row.currentWeaponBuff).toBe(0);
      expect(row.currentExternalBuffTotal).toBeCloseTo(.30, 12);
      expect(row.finalBonus).toBeCloseTo(["penetration", "life"].includes(testCase.stat) ? 2.714285714285714 : 2.25, 12);
    }
  });
});

it("sums two eligible weapon sources once without multiplying them", () => {
  const input = weaponAttributeInput(weaponCases[0], .30, .20);
  const heroByTroop: Partial<Record<TroopType, string>> = {
    lancer: "hero.s11.lloyd", marksman: RUFUS,
  };
  const levels = { [RUFUS]: 10, "hero.s11.lloyd": 10 };
  const sideA = { ...input.sideA, reportHeroByTroop: heroByTroop, leaderHeroIds: heroByTroop,
    reportWeaponLevels: levels, simulationWeaponLevels: levels };
  const combined = { ...input, sideA };
  const row = previewExpectedReportBonuses(combined).A.breakdown.shield.attack;
  expect(row.currentWeaponBuff).toBeCloseTo(.30, 12);
  expect(row.currentExternalBuffTotal).toBeCloseTo(.60, 12);
  expect(row.finalBonus).toBeCloseTo(3, 12);
  assertBattleAttribute(combined, "A", "attack", 3);
});

it("ignores removed officer additive while retaining formation correction before external buffs", () => {
  const input = weaponAttributeInput(weaponCases[0], .30, .20);
  const bonuses = zeroReportBonuses();
  const sideA = { ...input.sideA,
    reportHeroByTroop: { marksman: "hero.s1.jinman" },
    reportWeaponLevels: { "hero.s1.jinman": 0 },
    targetBattleBonuses: { ...bonuses, marksman: { ...bonuses.marksman,
      attack: { ...bonuses.marksman.attack, additive: 5 } } },
    troops: { ...input.sideA.troops, marksman: { ...input.sideA.troops.marksman, attack: 2541.3 } },
  };
  const changed = { ...input, sideA };
  const row = previewExpectedReportBonuses(changed).A.breakdown.marksman.attack;
  expect(row.lineupCorrection).toBeGreaterThan(0);
  const expected = ((100 + 2541.3 + row.lineupCorrection * 100) * 1.45 / 1.20 - 100) / 100;
  expect(row.currentWeaponBuff).toBeCloseTo(.15, 12);
  expect(row.finalBonus).toBeCloseTo(expected, 12);
  expect(expectedAttributeAuditIsConsistent(row.calculationAudit)).toBe(true);
  assertBattleAttribute(changed, "A", "attack", expected, "marksman");
});
