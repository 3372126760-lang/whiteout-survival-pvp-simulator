import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_ENGINE_RULE_UNKNOWNS,
  TROOP_DAMAGE_COEFFICIENTS,
  TROOP_TYPES,
  compareActualDamage,
  createConfirmedTroopSkillLoadout,
  createValidationPreviewState,
  decimalToUiPercent,
  formatValidationHeroOption,
  getTroopConstant,
  getValidationTroopSkillDisplay,
  getValidationCatalog,
  resolveValidationMemberSkillSelections,
  runValidationBattle,
  toEngineScenario,
  uiPercentToDecimal,
  type DebugOverrideMode,
  type ValidationBattleInput,
  type ValidationSideInput,
} from "../../pvp";
import { createDefaultValidationInput as createUiDefaultInput } from "../../ui/defaultInput";

const createDefaultValidationInput = (): ValidationBattleInput => ({
  ...createUiDefaultInput(), attributeInputMode: "prediction",
});

const bahitiSkillId = "hero-skill.baxiti.unstable-field";

describe("PVP validation UI adapter", () => {
  it("1. converts UI BattleInput to the canonical engine scenario", () => {
    const input = makeInput();
    const scenario = toEngineScenario(input);

    expect(scenario).toMatchObject({ id: "pvp-validation-ui", maxRounds: 1 });
    expect(scenario.sideA.shield.count).toBe(120);
    expect(scenario.sideA.lancer.damageCoefficient).toBe(
      TROOP_DAMAGE_COEFFICIENTS.lancer,
    );
    expect(scenario.sideA.marksman.troopLevel).toBe("T7");
  });

  it("2. keeps the heroStatCorrection preview identical to engine state", () => {
    const input = withSide(makeInput(), "A", {
      ...makeInput().sideA,
      reportHeroIds: ["hero.r.youjin"],
      leaderHeroId: "hero.sr.xieergai",
    });
    const preview = createValidationPreviewState(input);
    const result = runValidationBattle(input);

    expect(result.heroStatCorrections.A).toEqual(preview.sideA.heroStatCorrection);
    expect(result.heroStatCorrections.A?.delta.shield.attack).toBeCloseTo(.5004);
  });

  it("3. activates every combat-relevant expedition skill for the leader", () => {
    const input = withLeader(makeInput(), "A", "hero.sr.xieergai");
    const state = createValidationPreviewState(input);

    expect(state.sideA.heroStates[0]?.skillStates.map((skill) => skill.skillId))
      .toEqual([
        "hero-skill.xieergai.guardian-power",
        "hero-skill.xieergai.weakening-strike",
      ]);
  });

  it("4. rejects a fifth selected member combat skill", () => {
    const five = getValidationCatalog().memberSkills.slice(0, 5);
    const input = withSide({ ...makeInput(), battleContext: "rally" }, "A", {
      ...makeInput().sideA,
      selectedMemberSkillIds: five.map((skill) => skill.skillId),
    });

    expect(() => createValidationPreviewState(input)).toThrow(/at most four/);
  });

  it("5. omits non-combat expedition skill 1 from the member selector", () => {
    const memberIds = getValidationCatalog().memberSkills.map((skill) => skill.skillId);

    expect(memberIds).not.toContain("expedition.youjin.ancestral-craft");
    expect(memberIds).toContain("hero-skill.xieergai.guardian-power");
    expect(getValidationCatalog().memberSkills.every((skill) =>
      skill.skillId.startsWith("hero-skill."),
    )).toBe(true);
  });

  it("6. reproduces the complete trace with the same seed and input", () => {
    const input = withLeader(makeInput(), "A", "hero.sr.baxiti");

    expect(runValidationBattle(input).trace).toEqual(runValidationBattle(input).trace);
  });

  it("7. honors a round-and-troop FORCE_TRIGGER override", () => {
    const input = withOverrides(withLeader(makeInput(), "A", "hero.sr.baxiti"), {
      [`1:A:shield:${bahitiSkillId}`]: "FORCE_TRIGGER",
    });
    const trace = runValidationBattle(input).trace.rounds[0]!.heroSkills.find(
      (entry) => entry.skillId === bahitiSkillId && entry.sourceTroop === "shield",
    );

    expect(trace).toMatchObject({ triggered: true, rngRoll: null, reason: "forcedTrigger" });
  });

  it("8. honors a round-and-troop FORCE_NOT_TRIGGER override", () => {
    const input = withOverrides(withLeader(makeInput(), "A", "hero.sr.baxiti"), {
      [`1:A:shield:${bahitiSkillId}`]: "FORCE_NOT_TRIGGER",
    });
    const trace = runValidationBattle(input).trace.rounds[0]!.heroSkills.find(
      (entry) => entry.skillId === bahitiSkillId && entry.sourceTroop === "shield",
    );

    expect(trace).toMatchObject({ triggered: false, rngRoll: null, reason: "forcedNoTrigger" });
  });

  it("9. disables a selected skill source only for the validation run", () => {
    const skillId = "marksman-rapid-fire";
    const normal = runValidationBattle(makeInput());
    const disabled = runValidationBattle({
      ...makeInput(),
      disabledSkillIds: [skillId],
    });

    expect(normal.initialState.sideA.troops.marksman.skillStates.some(
      (runtime) => runtime.skillId === skillId,
    )).toBe(true);
    expect(disabled.initialState.sideA.troops.marksman.skillStates.some(
      (runtime) => runtime.skillId === skillId,
    )).toBe(false);
    expect(disabled.trace.rounds[0]!.troopSkills.some(
      (entry) => entry.skillId === skillId,
    )).toBe(false);
  });

  it("10. exposes raw, modified, rounded, and applied damage for the trace UI", () => {
    const event = runValidationBattle(makeInput()).trace.rounds[0]!.damageEvents[0]!;
    const formula = event.baseDamageFormula!;
    const reconstructed = formula.fixedInitialCountFactor * formula.aliveCountFactor *
      formula.damageCoefficient * formula.troopConstant *
      formula.penetrationMultiplier * formula.attackMultiplier;

    expect(event.rawDamage).toBeCloseTo(reconstructed);
    expect(event).toEqual(expect.objectContaining({
      modifiedDamage: expect.any(Number),
      roundedDamage: expect.any(Number),
      appliedDamage: expect.any(Number),
    }));
  });

  it("11. exposes enemy attribute reduction details for rendering", () => {
    const result = runValidationBattle(withLeader(
      makeInput(),
      "A",
      "hero.sr.xieergai",
    ));
    const incoming = result.trace.rounds[0]!.damageEvents.find(
      (event) => event.sourceSide === "B",
    )!;
    const attack = incoming.attributeResolutions?.find(
      (resolution) => resolution.attribute === "attack",
    );

    expect(attack?.reductionGroups).toEqual([
      expect.objectContaining({
        group: "enemyAttackReduction",
        summedValue: .2,
        divisionFactor: 1.2,
      }),
    ]);
  });

  it("12. keeps RoundStart and RoundEnd troop states aligned with engine state", () => {
    const result = runValidationBattle(makeInput());
    const round = result.trace.rounds[0]!;
    const resolved = result.simulation.rounds[0]!;

    expect(round.roundStart.sides.A.shield.aliveCount).toBe(
      result.initialState.sideA.troops.shield.aliveCount,
    );
    expect(round.roundEnd.troops.find((row) =>
      row.side === "B" && row.troop === "shield"
    )).toMatchObject({
      aliveCount: resolved.stateAfter.sideB.troops.shield.aliveCount,
      frontUnitHp: resolved.stateAfter.sideB.troops.shield.frontUnitHp,
    });
  });

  it("13. calculates actual/model difference and signed error rate", () => {
    expect(compareActualDamage(
      [{ round: 1, AtoB: 120, BtoA: 80 }],
      [{ round: 1, AtoB: 100, BtoA: 100 }],
    )).toEqual([
      expect.objectContaining({ direction: "AtoB", difference: 20, errorRate: .2 }),
      expect.objectContaining({ direction: "BtoA", difference: -20, errorRate: -.2 }),
    ]);
  });

  it("14. publishes all current RULE_UNKNOWN warnings for the UI banner", () => {
    expect(CURRENT_ENGINE_RULE_UNKNOWNS).toEqual([
      "futureEffectActivationTiming",
      "targetingOverrideConflictPrecedence",
      "reservedTriggerScheduling",
      "complexInitiativeOrdering",
    ]);
  });

  it("15. keeps damage and casualty calculations out of the UI layer", () => {
    const uiSource = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );

    expect(uiSource).toContain("runValidationBattle(input)");
    expect(uiSource).not.toMatch(
      /Math\.sqrt|calculateBaseTroopDamage|calculateTroopHp|applyDamageToTroopStack|resolvePendingDamage/,
    );
  });

  it("16. exposes S1 heroes and exclusive-weapon metadata from engine data", () => {
    expect(getValidationCatalog().reportHeroes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        heroId: "hero.s1.heluonimo",
        generation: 1,
        weaponMaxStat: .625,
      }),
      expect.objectContaining({
        heroId: "hero.s1.nataliya",
        generation: 1,
        weaponMaxStat: .55,
      }),
    ]));
  });

  it("16b. exposes all S3 heroes and their 70% weapon maximum in the validation UI", () => {
    expect(getValidationCatalog().reportHeroes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        heroId: "hero.s3.luogen", generation: 3, weaponMaxStat: .70,
      }),
      expect.objectContaining({
        heroId: "hero.s3.miya", generation: 3, weaponMaxStat: .70,
      }),
      expect.objectContaining({
        heroId: "hero.s3.gelaige", generation: 3, weaponMaxStat: .70,
      }),
    ]));
  });

  it("17. converts BattleContext and report/simulation weapon levels", () => {
    const base = makeInput();
    const input: ValidationBattleInput = {
      ...base,
      battleContext: "garrisonDefense",
      sideA: {
        ...base.sideA,
        reportHeroIds: ["hero.s1.heluonimo"],
        reportWeaponLevels: { "hero.s1.heluonimo": 5 },
        leaderHeroId: "hero.s1.heluonimo",
        simulationWeaponLevels: { "hero.s1.heluonimo": 9 },
      },
    };
    const scenario = toEngineScenario(input);
    const state = createValidationPreviewState(input);

    expect(scenario.battleContext).toBe("garrisonDefense");
    expect(scenario.sideA.reportHeroes).toEqual([
      { heroId: "hero.s1.heluonimo", weaponLevel: 5 },
    ]);
    expect(scenario.sideA.heroes?.[0]).toMatchObject({
      heroId: "hero.s1.heluonimo",
      weaponLevel: 9,
    });
    expect(state.sideA.heroStatCorrection?.delta.shield.penetration)
      .toBeCloseTo(.25);
  });

  it("17b. carries S3 Lv10 weapon base stats into the UI preview correction", () => {
    const base = makeInput();
    const input = withSide(base, "A", {
      ...base.sideA,
      reportHeroByTroop: { lancer: "hero.s3.miya" },
      reportWeaponLevels: { "hero.s3.miya": 0 },
      leaderHeroIds: { lancer: "hero.s3.miya" },
      simulationWeaponLevels: { "hero.s3.miya": 10 },
    });
    const preview = createValidationPreviewState(input);
    expect(preview.sideA.heroStatCorrection?.delta.lancer.penetration).toBeCloseTo(.70);
    expect(preview.sideA.heroStatCorrection?.delta.lancer.life).toBeCloseTo(.70);
  });

  it("18. converts UI percentage points to engine decimals", () => {
    expect(uiPercentToDecimal(240.19)).toBeCloseTo(2.4019);
    expect(toEngineScenario(makeInput(240.19)).sideA.shield.attack).toBeCloseTo(2.4019);
  });

  it("19. converts engine decimals back to UI percentage points", () => {
    expect(decimalToUiPercent(2.4019)).toBeCloseTo(240.19);
  });

  it("20. accepts three independent report hero slots", () => {
    const base = makeInput();
    const scenario = toEngineScenario(withSide(base, "A", {
      ...base.sideA,
      reportHeroByTroop: {
        shield: "hero.head.fulinte",
        lancer: "hero.s2.feilande",
        marksman: "hero.s2.alongsuo",
      },
    }));
    expect(scenario.sideA.reportHeroes?.map((entry) => entry.heroId)).toEqual([
      "hero.head.fulinte", "hero.s2.feilande", "hero.s2.alongsuo",
    ]);
  });

  it("21. accepts shield/lancer/marksman leader slots together", () => {
    const base = makeInput();
    const scenario = toEngineScenario(withSide(base, "A", {
      ...base.sideA,
      leaderHeroIds: {
        shield: "hero.head.fulinte",
        lancer: "hero.s2.feilande",
        marksman: "hero.s2.alongsuo",
      },
    }));
    expect(scenario.sideA.heroes?.filter((hero) => hero.position === "leader"))
      .toHaveLength(3);
  });

  it("22. passes direct T12 level 24 into the skill runtime", () => {
    const base = makeInput();
    const input = withSide(base, "A", {
      ...base.sideA,
      troops: {
        ...base.sideA.troops,
        marksman: {
          ...base.sideA.troops.marksman,
          troopLevel: "T12-FC10",
          t12Level: 24,
        },
      },
    });
    const runtime = createValidationPreviewState(input).sideA.troops.marksman.skillStates
      .find((skill) => skill.skillId === "marksman-blazing-star-t12");
    expect(runtime?.level).toBe(24);
  });

  it("23. derives read-only troop constant C from troop level", () => {
    const base = makeInput();
    const input = withSide(base, "A", {
      ...base.sideA,
      troops: {
        ...base.sideA.troops,
        shield: { ...base.sideA.troops.shield, troopLevel: "T10-FC8", troopConstant: 999 },
      },
    });
    const engineConstant = toEngineScenario(input).sideA.shield.troopConstant;
    expect(Number(engineConstant.toFixed(4))).toBe(10.8632);
    expect(engineConstant).toBe(getTroopConstant("T10-FC8"));
    const uiSource = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(uiSource).toContain(
      "有效等级常数 C（只读）",
    );
  });

  it("23b. converts mixed-level UI input into one canonical BattleInput stack", () => {
    const base = makeInput();
    const input = withSide(base, "A", {
      ...base.sideA,
      troops: {
        ...base.sideA.troops,
        shield: {
          ...base.sideA.troops.shield,
          count: 999,
          levelMode: "mixed",
          levelComposition: [
            { level: "T3", aliveCount: 255 },
            { level: "T4", aliveCount: 65 },
          ],
        },
      },
    });
    const scenario = toEngineScenario(input);
    const state = createValidationPreviewState(input);
    const expectedC = (255 * 2.1 + 65 * 2.73) / 320;

    expect(scenario.sideA.shield.count).toBe(320);
    expect(scenario.sideA.shield.levelComposition).toEqual([
      { level: "T3", aliveCount: 255 },
      { level: "T4", aliveCount: 65 },
    ]);
    expect(scenario.sideA.shield.troopConstant).toBeCloseTo(expectedC);
    expect(state.sideA.troops.shield.aliveCount).toBe(320);
    expect(state.sideA.troops.shield.troopConstant).toBeCloseTo(expectedC);
    expect(state.sideA.troops.shield.maxHpPerUnit).toBeCloseTo(
      expectedC * 300 * 1.012,
    );
  });

  it("23c. rejects duplicate levels in mixed-level UI input", () => {
    const base = makeInput();
    const input = withSide(base, "A", {
      ...base.sideA,
      troops: {
        ...base.sideA.troops,
        shield: {
          ...base.sideA.troops.shield,
          levelMode: "mixed",
          levelComposition: [
            { level: "T3", aliveCount: 10 },
            { level: "T3", aliveCount: 20 },
          ],
        },
      },
    });
    expect(() => toEngineScenario(input)).toThrow(/Duplicate mixed troop level/);
  });

  it("23d. exposes single/mixed modes and keeps effective C read-only", () => {
    const uiSource = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(uiSource).toContain(">单等级</option>");
    expect(uiSource).toContain(">混等级</option>");
    expect(uiSource).toContain("+ 添加等级");
    expect(uiSource).toContain("有效等级常数 C（只读）");
    expect(uiSource).not.toMatch(/data-field="effectiveTroopConstant"/);
  });

  it("24. supports the confirmed 1500-round upper bound", () => {
    expect(toEngineScenario({ ...makeInput(), maxRounds: 1500 }).maxRounds).toBe(1500);
    expect(() => toEngineScenario({ ...makeInput(), maxRounds: 1501 })).toThrow(/1500/);
  });

  it("25. exposes Chinese battle-context labels and developer-only internal ids", () => {
    const uiSource = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(uiSource).toContain('? "单撞 / 挑战"');
    expect(uiSource).toContain('? "集结进攻"');
    expect(uiSource).toContain("developerMode ? { eventId:");
    expect(uiSource).toContain("显示内部 ID、小数与原始 JSON");
  });

  it("26. challenge disables scene weapon buffs but keeps normal and troop skills", () => {
    const base = makeInput();
    const input = withSide({ ...base, battleContext: "challenge" }, "A", {
      ...base.sideA,
      leaderHeroIds: {
        shield: "hero.s3.luogen",
        lancer: "hero.s3.miya",
        marksman: "hero.s3.gelaige",
      },
      simulationWeaponLevels: {
        "hero.s3.luogen": 10,
        "hero.s3.miya": 10,
        "hero.s3.gelaige": 10,
      },
      troops: {
        ...base.sideA.troops,
        shield: {
          ...base.sideA.troops.shield,
          troopLevel: "T12-FC10",
          t12Level: 1,
        },
      },
    });
    const round = runValidationBattle(input).trace.rounds[0]!;
    const weaponTraces = round.heroSkills.filter((trace) =>
      trace.skillId.startsWith("hero-weapon-skill.")
    );

    expect(weaponTraces).toHaveLength(3);
    expect(weaponTraces.every((trace) =>
      !trace.triggered && trace.reason === "battleContextMismatch"
    )).toBe(true);
    expect(round.heroSkills.some((trace) =>
      trace.skillId === "hero-skill.luogen.burning-body" && trace.triggered
    )).toBe(true);
    expect(round.troopSkills.some((trace) =>
      trace.skillId === "shield-lightforged-body" && trace.triggered
    )).toBe(true);
    expect(round.troopSkills.some((trace) =>
      trace.skillId === "shield-immortal-wall-t12" && trace.triggered
    )).toBe(true);
    const crystalChecks = round.troopSkills.filter((trace) =>
      trace.skillId === "shield-crystal-shield"
    );
    expect(crystalChecks).toHaveLength(3);
    expect(new Set(crystalChecks.map((trace) =>
      round.damageEvents.find((event) => event.id === trace.parentEventId)
        ?.sourceTroop
    ))).toEqual(new Set(["shield", "lancer", "marksman"]));
  });

  it("27. rallyAttack still activates rallyAttack weapon effects", () => {
    const base = makeInput();
    const result = runValidationBattle(withSide(
      { ...base, battleContext: "rallyAttack" },
      "A",
      {
        ...base.sideA,
        leaderHeroIds: { lancer: "hero.s3.miya" },
        simulationWeaponLevels: { "hero.s3.miya": 10 },
      },
    ));
    expect(result.trace.rounds[0]!.heroSkills).toContainEqual(
      expect.objectContaining({
        skillId: "hero-weapon-skill.miya.rally-attack",
        triggered: true,
      }),
    );
  });

  it.each(["rallyDefense", "garrisonDefense"] as const)(
    "28. %s still activates defense/garrison weapon effects",
    (battleContext) => {
      const base = makeInput();
      const result = runValidationBattle(withSide(
        { ...base, battleContext },
        "A",
        {
          ...base.sideA,
          leaderHeroIds: { shield: "hero.s3.luogen" },
          simulationWeaponLevels: { "hero.s3.luogen": 10 },
        },
      ));
      expect(result.trace.rounds[0]!.heroSkills).toContainEqual(
        expect.objectContaining({
          skillId: "hero-weapon-skill.luogen.defense-defense",
          triggered: true,
        }),
      );
    },
  );

  it("29. preserves 100 / 0 / 0 from UI through scenario and BattleState", () => {
    const base = makeInput();
    const troops = {
      ...base.sideA.troops,
      shield: { ...base.sideA.troops.shield, count: 100 },
      lancer: { ...base.sideA.troops.lancer, count: 0 },
      marksman: { ...base.sideA.troops.marksman, count: 0 },
    };
    const input = withSide(base, "A", { ...base.sideA, troops });
    const scenario = toEngineScenario(input);
    const state = createValidationPreviewState(input);

    expect([
      scenario.sideA.shield.count,
      scenario.sideA.lancer.count,
      scenario.sideA.marksman.count,
    ]).toEqual([100, 0, 0]);
    expect([
      state.sideA.troops.shield.aliveCount,
      state.sideA.troops.lancer.aliveCount,
      state.sideA.troops.marksman.aliveCount,
    ]).toEqual([100, 0, 0]);
    expect(state.fixedInitialMinTroops).toBe(100);
  });

  it("30. never replaces a legal zero count with a UI default", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../validationUi/adapter.ts", import.meta.url)),
      "utf8",
    );
    expect(toEngineScenario(makeInput()).sideA.shield.count).toBe(120);
    expect(source).not.toMatch(/source\.count\s*\|\|/);
  });

  it("31. converts game-panel 3100% to internal 31", () => {
    expect(uiPercentToDecimal(3100)).toBe(31);
    expect(toEngineScenario(makeInput(3100)).sideA.shield.attack).toBe(31);
  });

  it("32. keeps FC10 fire-crystal display and runtime at legal Lv2", () => {
    const loadout = createConfirmedTroopSkillLoadout("marksman", "T10-FC10");
    const powder = loadout.find((runtime) =>
      runtime.skillId === "marksman-crystal-powder"
    )!;
    const flame = loadout.find((runtime) =>
      runtime.skillId === "marksman-flame-impact"
    )!;

    expect(powder.level).toBe(2);
    expect(getValidationTroopSkillDisplay(powder)).toMatchObject({
      levelLabel: "Lv2",
      internalRuntimeLevel: 2,
    });
    expect(getValidationTroopSkillDisplay(flame).levelLabel).toBe("Lv2");
  });

  it("maps each troop's two fire-crystal skills to the troop FC level", () => {
    const ids = {
      shield: ["shield-crystal-shield", "shield-lightforged-body"],
      lancer: ["lancer-crystal-spear", "lancer-crimson-field"],
      marksman: ["marksman-crystal-powder", "marksman-flame-impact"],
    } as const;
    for (const troop of TROOP_TYPES) {
      for (const [fc, expected] of [
        [2, []], [3, [1]], [4, [1]], [5, [2]], [7, [2]],
        [8, [2, 1]], [9, [2, 1]], [10, [2, 2]],
      ] as const) {
        const crystal = createConfirmedTroopSkillLoadout(troop, `T10-FC${fc}`)
          .filter((runtime) => ids[troop].includes(runtime.skillId as never));
        expect(crystal.map((runtime) => runtime.level)).toEqual(expected);
        expect(crystal.map((runtime) => getValidationTroopSkillDisplay(runtime).levelLabel))
          .toEqual(expected.map((level) => `Lv${level}`));
      }
    }
  });

  it("33. hides levels for base and T7 troop skills in ordinary UI", () => {
    const displays = createConfirmedTroopSkillLoadout("marksman", "T7")
      .map(getValidationTroopSkillDisplay);
    expect(displays).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "远程打击", levelLabel: null }),
      expect.objectContaining({ name: "连射", levelLabel: null }),
    ]));
  });

  it("34. uses the corrected T12 title and read-only effective C", () => {
    const uiSource = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(uiSource).toContain("T12 兵种技能等级");
    expect(uiSource).not.toContain("T12 聚合等级");
    expect(uiSource).toContain("有效等级常数 C（只读）");
    expect(uiSource).not.toMatch(/data-field="effectiveTroopConstant"/);
  });

  it("35. labels SSR heroes by generation while keeping R/SR rarity", () => {
    const heroes = getValidationCatalog().reportHeroes;
    expect(formatValidationHeroOption(heroes.find(
      (hero) => hero.heroId === "hero.s1.moli"
    )!)).toBe("茉莉（S1）");
    expect(formatValidationHeroOption(heroes.find(
      (hero) => hero.heroId === "hero.head.fulinte"
    )!)).toBe("弗林特（S2）");
    expect(formatValidationHeroOption(heroes.find(
      (hero) => hero.heroId === "hero.s3.luogen"
    )!)).toBe("罗根（S3）");
    expect(formatValidationHeroOption(heroes.find(
      (hero) => hero.heroId === "hero.sr.xieergai"
    )!)).toBe("谢尔盖（SR）");
  });

  it("36. groups equivalent member effects but binds rally body slots to exact heroes", () => {
    const options = getValidationCatalog().memberSkills;
    const penetration = options.find((option) =>
      option.sourceSkillIds.includes("hero-skill.jiexi.penetration")
    )!;
    expect(penetration.effectLabel).toBe("全军穿透 +25%");
    expect(penetration.sourceSkillIds).toEqual(expect.arrayContaining([
      "hero-skill.jiexi.penetration",
      "hero-skill.jiesaier.penetration",
    ]));
    expect(options.filter((option) => option.effectKey === penetration.effectKey))
      .toHaveLength(1);
    const resolved = resolveValidationMemberSkillSelections([
      penetration.skillId,
      penetration.skillId,
    ]);
    expect(new Set(resolved.map((entry) => entry.heroId)).size).toBe(2);
    const base = makeInput();
    const rallyInput = withSide({ ...base, battleContext: "rally" }, "A", {
      ...base.sideA,
      selectedMemberSkillIds: ["hero-skill.jiexi.penetration", "hero-skill.jiesaier.penetration"],
    });
    const scenario = toEngineScenario(rallyInput);
    const members = scenario.sideA.heroes?.filter(
      (hero) => hero.position === "member",
    ) ?? [];
    expect(members).toHaveLength(2);
    expect(new Set(members.map((hero) => hero.heroId)).size).toBe(2);
    expect(members.map((hero) => hero.selectedMemberSkillId)).toEqual([
      "hero-skill.jiexi.penetration", "hero-skill.jiesaier.penetration",
    ]);
    const repeated = toEngineScenario(withSide({ ...base, battleContext: "rally" }, "A", {
      ...base.sideA,
      selectedMemberSkillIds: [penetration.skillId, penetration.skillId],
    }));
    expect(repeated.sideA.heroes?.filter((hero) => hero.position === "member"))
      .toHaveLength(2);
  });

  it("37. keeps internal enum/id details behind developer mode", () => {
    const uiSource = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(uiSource).toContain("developerMode && effect.group !== null");
    expect(uiSource).toContain("developerMode ? group.group");
    expect(uiSource).toContain("developerMode ? { eventId:");
    expect(uiSource).toContain("本场退出战斗");
  });

  it("38. defaults the validation UI to challenge with a 1500-round limit", () => {
    const defaults = createDefaultValidationInput();
    const uiSource = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    expect(defaults.battleContext).toBe("challenge");
    expect(defaults.maxRounds).toBe(1500);
    expect(uiSource).toContain("相同输入会得到相同的概率技能触发结果");
    expect(uiSource).toContain("仅用于基础公式调试，不适用于真实战报复现");
  });
});

function makeInput(stat = 1.2): ValidationBattleInput {
  return {
    sideA: makeSide(120, stat),
    sideB: makeSide(100, 1.0),
    maxRounds: 1,
    attributeInputMode: "prediction",
    randomSeed: 12_345,
    triggerOverrides: {},
    disabledSkillIds: [],
    actualRounds: [],
  };
}

function makeSide(count: number, stat: number): ValidationSideInput {
  return {
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
      count,
      attack: stat,
      defense: stat,
      penetration: stat,
      life: stat,
      troopLevel: "T7",
      troopConstant: getTroopConstant("T7"),
    }])) as unknown as ValidationSideInput["troops"],
    reportHeroIds: [],
    leaderHeroId: null,
    selectedMemberSkillIds: [],
  };
}

function withSide(
  input: ValidationBattleInput,
  side: "A" | "B",
  value: ValidationSideInput,
): ValidationBattleInput {
  return side === "A" ? { ...input, sideA: value } : { ...input, sideB: value };
}

function withLeader(
  input: ValidationBattleInput,
  side: "A" | "B",
  heroId: string,
): ValidationBattleInput {
  const current = side === "A" ? input.sideA : input.sideB;
  return withSide(input, side, { ...current, leaderHeroId: heroId });
}

function withOverrides(
  input: ValidationBattleInput,
  overrides: Readonly<Record<string, DebugOverrideMode>>,
): ValidationBattleInput {
  return { ...input, triggerOverrides: overrides };
}
