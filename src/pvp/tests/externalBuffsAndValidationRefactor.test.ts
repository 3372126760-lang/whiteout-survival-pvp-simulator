import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_BUFF_DATA_SOURCE_MISSING,
  PET_DEFENSE_REDUCTION_LEVELS,
  PET_LIFE_REDUCTION_LEVELS,
  PET_PENETRATION_REDUCTION_LEVELS,
  STANDARD_PET_LEVELS,
  STANDARD_PET_STAT_LEVELS,
  allocateRallyTroopsByRatio,
  createValidationPreviewState,
  generateValidationRandomSeed,
  getActiveSkillUniverse,
  getGarethPenetrationReduction,
  prepareValidationRunInput,
  previewExpectedReportBonuses,
  replayValidationSeed,
  resolveExternalBuffs,
  resolveReportAttributeBonus,
  runValidationBattle,
  sortActiveSkillsForUi,
  toEngineScenario,
  validateExclusiveWeaponLevel,
  type ExternalBuffConfig,
  type TroopType,
  type ValidationBattleInput,
  type ValidationActiveSkillOption,
  type ValidationSideInput,
} from "../../pvp";
import { createDefaultValidationInput as createUiDefaultInput } from "../../ui/defaultInput";

const createDefaultValidationInput = (): ValidationBattleInput => ({
  ...createUiDefaultInput(), attributeInputMode: "prediction",
});
import { doesValidationScopeAffectInput } from "../../ui/resultRevision";

const standard = [0, .025, .03, .035, .04, .05, .06, .07, .08, .09, .10];

describe("external buffs and validation UI refactor", () => {
  it("1. mirrors all ten pet attack levels", () => {
    expect([...STANDARD_PET_LEVELS]).toEqual(standard);
    for (let level = 1; level <= 10; level += 1) {
      expect(external({ attackLevel: level }).selfBuffs.attack)
        .toBeCloseTo(standard[level]!);
    }
  });

  it("2. mirrors all ten pet penetration levels", () => {
    for (let level = 1; level <= 10; level += 1) {
      expect(external({ penetrationLevel: level }).selfBuffs.penetration)
        .toBeCloseTo(standard[level]!);
    }
  });

  it("3. mirrors all ten pet defense-reduction levels", () => {
    expect([...PET_DEFENSE_REDUCTION_LEVELS]).toEqual(standard);
    for (let level = 1; level <= 10; level += 1) {
      expect(external({ enemyDefenseReductionLevel: level }).enemyDebuffs.defense)
        .toBeCloseTo(standard[level]!);
    }
  });

  it("4. resolves all eight pet penetration-reduction levels", () => {
    expect([...PET_PENETRATION_REDUCTION_LEVELS]).toEqual([
      0, .015, .02, .025, .03, .035, .04, .045, .05,
    ]);
  });

  it("5. resolves all seven pet life-reduction levels", () => {
    expect([...PET_LIFE_REDUCTION_LEVELS]).toEqual([
      0, .015, .02, .025, .03, .035, .04, .05,
    ]);
  });

  it("6. resolves Gareth level 20 to enemy penetration -5%", () => {
    expect(getGarethPenetrationReduction(20)).toBeCloseTo(.05);
    expect(configured({ expert: { garethFourthSkillLevel: 20 } }).enemyDebuffs.penetration)
      .toBeCloseTo(.05);
  });

  it("7. applies enemy life reduction to report life rather than final HP", () => {
    const resolved = resolveReportAttributeBonus({
      baseBonus: 2,
      specialDebuff: .05,
    });
    expect(resolved.finalBonus).toBeCloseTo(1.8571428571428572, 12);

    const input = baseInput();
    const withLifeDebuff: ValidationBattleInput = {
      ...input,
      sideA: withExternal(input.sideA, {
        pet: { ...externalConfig().pet, enemyLifeReductionLevel: 7 },
      }),
      sideB: withTroopStats(input.sideB, { life: 200 }),
    };
    const state = createValidationPreviewState(withLifeDebuff);
    expect(state.sideB.troops.shield.life).toBeCloseTo(1.8571428571428572, 12);
    expect(state.sideB.troops.shield.maxHpPerUnit).toBeCloseTo(
      state.sideB.troops.shield.baseHpPerUnit *
        (1 + state.sideB.troops.shield.life),
      10,
    );
  });

  it("8. keeps single-hit exclusive weapon scene skills off", () => {
    const result = runValidationBattle(withSceneHeroes(baseInput(), "challenge"));
    expect(sceneWeapon(result, "A", "hero-weapon-skill.heluonimo.rally-attack")?.triggered)
      .toBe(false);
    expect(sceneWeapon(result, "B", "hero-weapon-skill.moli.defense-penetration")?.triggered)
      .toBe(false);
  });

  it("9. maps rally A to rallyAttack and B to defensive scene skills", () => {
    const result = runValidationBattle(withSceneHeroes(baseInput(), "rally"));
    expect(sceneWeapon(result, "A", "hero-weapon-skill.heluonimo.rally-attack")?.triggered)
      .toBe(true);
    expect(sceneWeapon(result, "B", "hero-weapon-skill.moli.defense-penetration")?.triggered)
      .toBe(true);
  });

  it("10. allocates rally ratios with deterministic largest remainder and conservation", () => {
    const counts = allocateRallyTroopsByRatio({
      totalTroops: 10,
      ratios: { shield: 33.34, lancer: 33.33, marksman: 33.33 },
    });
    expect(counts).toEqual({ shield: 4, lancer: 3, marksman: 3 });
    expect(counts.shield + counts.lancer + counts.marksman).toBe(10);
  });

  it("11. normalizes rally troops to one level and ignores hidden mixed composition", () => {
    const input = baseInput();
    const sideA: ValidationSideInput = {
      ...input.sideA,
      rallyDeployment: {
        totalTroops: 100,
        ratios: { shield: 50, lancer: 20, marksman: 30 },
      },
      troops: {
        ...input.sideA.troops,
        shield: {
          ...input.sideA.troops.shield,
          troopLevel: "T10",
          levelMode: "mixed",
          levelComposition: [
            { level: "T3", aliveCount: 1 },
            { level: "T4", aliveCount: 1 },
          ],
        },
      },
    };
    const scenario = toEngineScenario({ ...input, battleContext: "rally", sideA });
    expect(scenario.sideA.shield.count).toBe(50);
    expect(scenario.sideA.shield.levelComposition).toEqual([
      { level: "T10", aliveCount: 50 },
    ]);
  });

  it("12. preserves fixed seeds, creates random seeds, and replays them", () => {
    const fixed = baseInput();
    expect(prepareValidationRunInput(fixed, () => 7)).toBe(fixed);
    const random = { ...fixed, simulationMode: "random" as const };
    const prepared = prepareValidationRunInput(random, () => 987654321);
    expect(prepared.randomSeed).toBe(987654321);
    expect(generateValidationRandomSeed(() => 123)).toBe(123);
    expect(replayValidationSeed(random, prepared.randomSeed)).toMatchObject({
      simulationMode: "fixedSeed",
      randomSeed: 987654321,
    });
    expect(runValidationBattle(replayValidationSeed(random, prepared.randomSeed)).trace)
      .toEqual(runValidationBattle(replayValidationSeed(random, prepared.randomSeed)).trace);
  });

  it("13. excludes impossible zero-stack and absent-hero skills from activeSkillUniverse", () => {
    const input = baseInput();
    const sideA = setCounts(input.sideA, { shield: 100, lancer: 0, marksman: 0 });
    const state = createValidationPreviewState({ ...input, sideA });
    const active = getActiveSkillUniverse(state).filter((skill) => skill.side === "A");
    const marksmanSkillIds = new Set(
      state.sideA.troops.marksman.skillStates.map((runtime) => runtime.skillId),
    );
    expect(active.some((skill) => marksmanSkillIds.has(skill.id))).toBe(false);
    expect(active.some((skill) => skill.id.includes("miya"))).toBe(false);
  });

  it("14. summarizes probability checks, successes and actual activations", () => {
    const skillId = "hero-skill.baxiti.unstable-field";
    const input = baseInput();
    const sideA: ValidationSideInput = {
      ...input.sideA,
      leaderHeroIds: { ...input.sideA.leaderHeroIds, marksman: "hero.sr.baxiti" },
    };
    const result = runValidationBattle({
      ...input,
      sideA,
      triggerOverrides: {
        [`A:shield:${skillId}`]: "FORCE_TRIGGER",
        [`A:lancer:${skillId}`]: "FORCE_TRIGGER",
        [`A:marksman:${skillId}`]: "FORCE_TRIGGER",
      },
    });
    const summary = result.skillSummary.find((entry) =>
      entry.side === "A" && entry.skillId === skillId
    );
    expect(summary).toMatchObject({
      probabilityCheckCount: 3,
      procSuccessCount: 3,
      actualActivationCount: 3,
    });
    expect(summary?.activationBySourceTroop).toEqual({
      shield: 1,
      lancer: 1,
      marksman: 1,
    });
    expect(result.summary.rounds).toBe(result.trace.rounds.length);
  });

  it("15. keeps detailed trace folded by default in the ordinary UI", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('<details class="panel trace-panel">');
    expect(source).toContain('lazyDetails.render(`trace-round-${round.round}`');
    expect(source).not.toContain('<details class="trace-round" open>');
    expect(source).toContain('input.battleContext === "rally"');
  });

  it("16. makes expected report bonuses identical to engine report attributes", () => {
    const input = baseInput();
    const sideA = withExternal(withTroopStats(input.sideA, { attack: 200 }), {
      town: { ...externalConfig().town, attack: "small" },
      pet: { ...externalConfig().pet, attackLevel: 10 },
    });
    const configuredInput = { ...input, sideA };
    const preview = previewExpectedReportBonuses(configuredInput);
    const state = createValidationPreviewState(configuredInput);
    expect(preview.A.troops.shield.attack).toBeCloseTo(2.6, 12);
    expect(preview.A.troops.shield.attack).toBeCloseTo(
      state.sideA.troops.shield.attack,
      12,
    );
  });

  it("17. removes all five resolved external-buff data gaps", () => {
    expect(EXTERNAL_BUFF_DATA_SOURCE_MISSING).toEqual([]);
  });

  it("18. invalidates old results for every new battle-input control group", () => {
    expect(doesValidationScopeAffectInput("simulation-mode")).toBe(true);
    expect(doesValidationScopeAffectInput("rally-deployment")).toBe(true);
    expect(doesValidationScopeAffectInput("external")).toBe(true);
    expect(doesValidationScopeAffectInput("battle-context")).toBe(true);
    expect(doesValidationScopeAffectInput("trigger-override")).toBe(true);
  });

  it("19. supports none/small/large for town defense, life, and enemy attack", () => {
    for (const [size, expected] of [
      ["none", 0], ["small", .1], ["large", .2],
    ] as const) {
      const resolved = configured({ town: {
        ...externalConfig().town,
        defense: size,
        life: size,
        enemyAttackReduction: size,
      } });
      expect(resolved.selfBuffs.defense).toBeCloseTo(expected);
      expect(resolved.selfBuffs.life).toBeCloseTo(expected);
      expect(resolved.enemyDebuffs.attack).toBeCloseTo(expected);
    }
  });

  it("20. shares the confirmed standard table for pet defense and life", () => {
    expect(STANDARD_PET_STAT_LEVELS).toBe(STANDARD_PET_LEVELS);
    expect(external({ defenseLevel: 1 }).selfBuffs.defense).toBeCloseTo(.025);
    expect(external({ defenseLevel: 10 }).selfBuffs.defense).toBeCloseTo(.10);
    expect(external({ lifeLevel: 1 }).selfBuffs.life).toBeCloseTo(.025);
    expect(external({ lifeLevel: 10 }).selfBuffs.life).toBeCloseTo(.10);
  });

  it("21. accepts only integer exclusive-weapon levels from 0 through 10", () => {
    for (let level = 0; level <= 10; level += 1) {
      expect(() => validateExclusiveWeaponLevel(level)).not.toThrow();
    }
    for (const level of [-1, .5, 11]) {
      expect(() => validateExclusiveWeaponLevel(level)).toThrow();
    }
    const source = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("<select data-scope=\"${scope}\"");
    expect(source).not.toContain("<input type=\"number\" min=\"0\" max=\"10\"");
  });

  it("22. exposes own buffs and opponent debuffs in the expected-report breakdown", () => {
    const input = baseInput();
    const configuredInput: ValidationBattleInput = {
      ...input,
      sideA: withExternal(withTroopStats(input.sideA, { defense: 200 }), {
        town: { ...externalConfig().town, defense: "small", enemyAttackReduction: "large" },
      }),
      sideB: withTroopStats(input.sideB, { attack: 200 }),
    };
    const preview = previewExpectedReportBonuses(configuredInput);
    expect(preview.A.breakdown.shield.defense.inputReportBonus).toBe(2);
    expect(preview.A.breakdown.shield.defense.ownBuffRate).toBeCloseTo(.1, 12);
    expect(preview.A.breakdown.shield.defense.enemyDebuffRate).toBe(0);
    expect(preview.A.breakdown.shield.defense.finalBonus).toBeCloseTo(2.3, 12);
    expect(preview.B.breakdown.shield.attack.inputReportBonus).toBe(2);
    expect(preview.B.breakdown.shield.attack.ownBuffRate).toBeCloseTo(0, 12);
    expect(preview.B.breakdown.shield.attack.enemyDebuffRate).toBeCloseTo(.2, 12);
    expect(preview.B.breakdown.shield.attack.finalBonus).toBeCloseTo(1.5, 12);
    expect(preview.B.troops.shield.attack).toBeCloseTo(
      createValidationPreviewState(configuredInput).sideB.troops.shield.attack,
      12,
    );
  });

  it("23. applies stable A/B, troop/hero, and shield/lancer/marksman UI ordering", () => {
    const sorted = sortActiveSkillsForUi([
      skillOption("b-shield", "B", "troop", "shield", "base"),
      skillOption("a-marksman", "A", "troop", "marksman", "base"),
      skillOption("a-hero-shield", "A", "hero", "shield", "expedition"),
      skillOption("a-lancer", "A", "troop", "lancer", "base"),
      skillOption("a-shield", "A", "troop", "shield", "base"),
      skillOption("a-hero-marksman", "A", "hero", "marksman", "expedition"),
    ]);
    expect(sorted.map((skill) => skill.id)).toEqual([
      "a-shield",
      "a-lancer",
      "a-marksman",
      "a-hero-shield",
      "a-hero-marksman",
      "b-shield",
    ]);
  });

  it("24. gives every displayed skill summary one shared UI description", () => {
    const result = runValidationBattle(baseInput());
    expect(result.skillSummary.length).toBeGreaterThan(0);
    expect(result.skillSummary.every((entry) => entry.uiSummary.trim().length > 0))
      .toBe(true);
    expect(result.trace.rounds.flatMap((round) => [
      ...round.troopSkills,
      ...round.heroSkills,
    ]).every((entry) => entry.uiSummary.trim().length > 0)).toBe(true);
  });
});

function skillOption(
  id: string,
  side: "A" | "B",
  source: "troop" | "hero",
  troopType: TroopType,
  category: string,
): ValidationActiveSkillOption {
  return {
    id,
    name: id,
    uiSummary: id,
    source,
    troopType,
    heroId: source === "hero" ? `hero.${id}` : null,
    expeditionSkillSlot: source === "hero" ? 1 : null,
    definitionOrder: 0,
    category,
    probability: .1,
    perTroop: false,
    side,
    applicableTroops: [],
    position: source === "hero" ? "leader" : null,
  };
}

function baseInput(): ValidationBattleInput {
  return { ...createDefaultValidationInput(), maxRounds: 1 };
}

function external(overrides: Partial<ExternalBuffConfig["pet"]>) {
  return resolveExternalBuffs(withConfig({
    pet: { ...externalConfig().pet, ...overrides },
  }));
}

function configured(overrides: Partial<ExternalBuffConfig>) {
  return resolveExternalBuffs(withConfig(overrides));
}

function externalConfig(): ExternalBuffConfig {
  return structuredClone(createDefaultValidationInput().sideA.externalBuffs!);
}

function withConfig(overrides: Partial<ExternalBuffConfig>): ExternalBuffConfig {
  const base = externalConfig();
  return {
    ...base,
    ...overrides,
    town: { ...base.town, ...overrides.town },
    pet: { ...base.pet, ...overrides.pet },
    expert: { ...base.expert, ...overrides.expert },
  };
}

function withExternal(
  side: ValidationSideInput,
  overrides: Partial<ExternalBuffConfig>,
): ValidationSideInput {
  return { ...side, externalBuffs: withConfig(overrides) };
}

function withTroopStats(
  side: ValidationSideInput,
  stats: Partial<Pick<ValidationSideInput["troops"][TroopType], "attack" | "defense" | "penetration" | "life">>,
): ValidationSideInput {
  return {
    ...side,
    troops: Object.fromEntries((["shield", "lancer", "marksman"] as const).map(
      (troop) => [troop, { ...side.troops[troop], ...stats }],
    )) as ValidationSideInput["troops"],
  };
}

function setCounts(
  side: ValidationSideInput,
  counts: Readonly<Record<TroopType, number>>,
): ValidationSideInput {
  return {
    ...side,
    troops: Object.fromEntries((["shield", "lancer", "marksman"] as const).map(
      (troop) => [troop, { ...side.troops[troop], count: counts[troop] }],
    )) as ValidationSideInput["troops"],
  };
}

function withSceneHeroes(
  input: ValidationBattleInput,
  context: "challenge" | "rally",
): ValidationBattleInput {
  return {
    ...input,
    battleContext: context,
    sideA: {
      ...input.sideA,
      leaderHeroIds: { ...input.sideA.leaderHeroIds, shield: "hero.s1.heluonimo" },
      simulationWeaponLevels: { "hero.s1.heluonimo": 10 },
    },
    sideB: {
      ...input.sideB,
      leaderHeroIds: { ...input.sideB.leaderHeroIds, marksman: "hero.s1.moli" },
      simulationWeaponLevels: { "hero.s1.moli": 10 },
    },
  };
}

function sceneWeapon(
  result: ReturnType<typeof runValidationBattle>,
  side: "A" | "B",
  skillId: string,
) {
  return result.trace.rounds[0]?.heroSkills.find(
    (entry) => entry.side === side && entry.skillId === skillId,
  );
}
