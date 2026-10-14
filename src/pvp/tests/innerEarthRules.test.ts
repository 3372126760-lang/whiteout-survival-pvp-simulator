import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { INNER_EARTH_MODES, getInnerEarthRule, normalizeInnerEarthInput,
  createDefaultInnerEarthConfig, assertInnerEarthInput, materializeInnerEarthInput,
  innerEarthEnemyCounts, auditInnerEarthInput, sanitizeInnerEarthForStage, type InnerEarthConfig, type InnerEarthMode } from "../innerEarth";
import { createValidationPreviewState, compileValidationBattle, toEngineScenario,
  toValidationThreeQueueConfig, runValidationBattle, getValidationCatalog } from "../validationUi";
import { runThreeQueueScenario, createPureTroopBattleState, type PureTroopScenarioResult } from "../scenario";
import { TROOP_TYPES } from "../types";
import { SUPPORTED_TROOP_LEVELS } from "../data";
import { DEFAULT_EXTERNAL_BUFF_CONFIG } from "../externalBuffs";

function inputFor(mode: InnerEarthMode) {
  const base = createDefaultValidationInput();
  return normalizeInnerEarthInput(base, createDefaultInnerEarthConfig(base, mode));
}
describe("Inner Earth configured mode boundaries", () => {
  it.each(INNER_EARTH_MODES)("binds %s to its single allowed attribute mode", (mode) => {
    const input = inputFor(mode), rule = getInnerEarthRule(mode);
    expect(input.scenarioType).toBe("INNER_EARTH");
    expect(input.attributeInputMode).toBe(rule.inputMode);
    expect(() => assertInnerEarthInput(input)).not.toThrow();
    expect(() => assertInnerEarthInput({ ...input,
      attributeInputMode: rule.inputMode === "prediction" ? "finalReport" : "prediction" })).toThrow(/仅允许/);
    expect(auditInnerEarthInput(input).searchDimensions).toEqual(
      rule.heroMode === "empty" ? ["ratio"] : ["head", "ratio"]);
  });
  it.each(["GEM_MINE", "EQUIPMENT_FORGE"] as const)("fixes %s enemy capacity and rejects bypasses", (mode) => {
    const input = inputFor(mode);
    expect(input.innerEarth!.enemy.shared.capacity).toBe(150000);
    const malformed = { ...input, innerEarth: { ...input.innerEarth!, enemy: {
      ...input.innerEarth!.enemy, shared: { ...input.innerEarth!.enemy.shared, capacity: 149999 } } } };
    expect(() => assertInnerEarthInput(malformed)).toThrow(/固定150000/);
    const counts = materializeInnerEarthInput(input).sideB.troops;
    expect(TROOP_TYPES.reduce((sum, troop) => sum + counts[troop].count, 0)).toBe(150000);
  });
  it("accepts exactly two enemy presets and uses exact allocation rather than rounded percentages", () => {
    expect(innerEarthEnemyCounts(150000, "BALANCED")).toEqual({ shield: 50000, lancer: 50000, marksman: 50000 });
    expect(innerEarthEnemyCounts(150000, "SHIELD_HEAVY")).toEqual({ shield: 80000, lancer: 40000, marksman: 30000 });
    expect(innerEarthEnemyCounts(8, "BALANCED")).toEqual({ shield: 3, lancer: 3, marksman: 2 });
    expect(() => innerEarthEnemyCounts(10, "CUSTOM" as never)).toThrow(/只允许两个/);
    const input = inputFor("BEAST_CAVE");
    const malformed = { ...input, innerEarth: { ...input.innerEarth!, enemy: { ...input.innerEarth!.enemy,
      shared: { ...input.innerEarth!.enemy.shared, troopRatioPreset: "CUSTOM" as never } } } };
    expect(() => materializeInnerEarthInput(malformed)).toThrow(/只允许两个/);
  });
  it.each(["BEAST_CAVE", "GEM_MINE", "UNDERGROUND_LAB", "EQUIPMENT_FORGE"] as const)(
    "%s creates one EMPTY_HEAD without inherited weapons, members or external inputs", (mode) => {
      const input = inputFor(mode);
      const derived = materializeInnerEarthInput(input);
      for (const side of [derived.sideA, derived.sideB]) {
        expect(Object.values(side.leaderHeroIds!)).toEqual([null, null, null]);
        expect(side.selectedMemberSkillIds).toEqual([]);
        expect(side.simulationWeaponLevels).toEqual({});
        expect(side.externalBuffs).toEqual(DEFAULT_EXTERNAL_BUFF_CONFIG);
      }
      const preview = createValidationPreviewState(input);
      expect(preview.sideA.heroStates).toEqual([]);
      expect(preview.sideB.heroStates).toEqual([]);
      expect(auditInnerEarthInput(input).heroSearchEnabled).toBe(false);
    });
  it("rejects hidden expert, drug, capacity pet and queue-capacity fields", () => {
    const input = inputFor("HEART_OF_EARTH");
    for (const key of ["expert", "drug", "petMarchCapacityLevel"]) {
      expect(() => assertInnerEarthInput({ ...input,
        innerEarth: { ...input.innerEarth!, [key]: 1 } as InnerEarthConfig })).toThrow(/不接受/);
    }
    expect(() => assertInnerEarthInput({ ...input, innerEarth: { ...input.innerEarth!,
      petContext: { ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet, marchCapacityLevel: 1 } as never } })).toThrow(/非容量/);
  });
  it("mode transitions preserve edited stats while binding fixed rules and removing laboratory-only tiers", () => {
    const input = inputFor("UNDERGROUND_LAB");
    const original = input.innerEarth!;
    const edited = { ...original, ally: { ...original.ally,
      troopTiers: { shield: "LAB_T12", lancer: "LAB_T11", marksman: "T10" },
      reportStats: { ...original.ally.reportStats, shield: { ...original.ally.reportStats.shield, attack: 2612.8 } } } };
    const moved = normalizeInnerEarthInput(input, { ...edited, subMode: "HEART_OF_EARTH" });
    expect(moved.innerEarth!.ally.reportStats.shield.attack).toBe(2612.8);
    expect(moved.innerEarth!.ally.troopTiers).toEqual({ shield: "T10", lancer: "T10", marksman: "T10" });
    expect(moved.attributeInputMode).toBe("prediction");
  });
});
describe("Underground Lab dedicated constants and existing runtimes", () => {
  function lab(tier: string, level: number) {
    const input = inputFor("UNDERGROUND_LAB");
    return { ...input, innerEarth: { ...input.innerEarth!, ally: { ...input.innerEarth!.ally,
      troopTiers: { shield: tier, lancer: tier, marksman: tier },
      t12SkillLevels: { shield: level, lancer: level, marksman: level } } } };
  }
  it.each([["T10", 7.4947], ["LAB_T11", 8.8437], ["LAB_T12", 10.4356]] as const)(
    "uses exact %s constants without registering normal-game virtual tiers", (tier, constant) => {
      const input = lab(tier, 0), scenario = toEngineScenario(input), state = createValidationPreviewState(input);
      for (const troop of TROOP_TYPES) {
        expect(scenario.sideA[troop].troopConstant).toBe(constant);
        expect(state.sideA.troops[troop].troopConstant).toBe(constant);
        expect(state.sideB.troops[troop].troopConstant).toBe(7.4947);
        expect(state.sideA.troops[troop].skillStates).toHaveLength(2);
        expect(state.sideA.troops[troop].damageCoefficient).toBe({ shield: 1, lancer: 3, marksman: 4 }[troop]);
        expect(state.sideA.troops[troop].troopHpCoefficient).toBe({ shield: 300, lancer: 100, marksman: 75 }[troop]);
      }
      expect(SUPPORTED_TROOP_LEVELS).not.toContain("T11");
      expect(SUPPORTED_TROOP_LEVELS).not.toContain("T12");
      expect(SUPPORTED_TROOP_LEVELS).not.toContain("LAB_T11");
    });
  it.each([0, 1, 2, 3])("accepts T12 skill level %i and excludes FC skills", (level) => {
    const input = lab("LAB_T12", level);
    const state = createValidationPreviewState(input);
    for (const troop of TROOP_TYPES) {
      const runtimes = state.sideA.troops[troop].skillStates;
      expect(runtimes.some((runtime) => /crystal|lightforged|crimson|flame-impact/.test(runtime.skillId))).toBe(false);
      expect(runtimes.filter((runtime) => runtime.skillId.endsWith("-t12")).map((runtime) => runtime.level))
        .toEqual(level === 0 ? [] : [level]);
    }
  });
  it("rejects level 4, FC tiers and T12 skills on T10", () => {
    expect(() => toEngineScenario(lab("LAB_T12", 4))).toThrow(/0-3/);
    expect(() => toEngineScenario(lab("T12-FC7", 0))).toThrow(/仅允许T10/);
    expect(() => toEngineScenario(lab("T10", 1))).toThrow(/只有T12/);
  });
  it("uses one lab state boundary for preview, compact engine and traced engine", () => {
    const input = { ...lab("LAB_T12", 3), maxRounds: 3 };
    const compiled = compileValidationBattle(input);
    const traced = runValidationBattle(input);
    expect(compiled.initialState.sideA.troops.shield.troopConstant).toBe(10.4356);
    expect(compiled.initialState.sideA.troops.shield.skillStates).toEqual(traced.initialState.sideA.troops.shield.skillStates);
    expect(compiled.runFastTrial(input.randomSeed).outcome).toBe(traced.summary.outcome);
    expect(compiled.runFastTrial(input.randomSeed).remaining).toEqual(traced.summary.remaining);
  });
});
describe("Inner Earth shared capacity and independent queue report data", () => {
  it("keeps each queue's weapon baseline independent of the old shared report configuration", () => {
    const input = inputFor("HERO_LAND"), config = input.innerEarth!;
    const heroes = getValidationCatalog().leaderHeroes.filter((hero) => hero.troopType === "shield" &&
      hero.category === "S" && hero.weaponMaxStat !== null && (hero.sGeneration ?? Infinity) <= 11).slice(0, 3);
    expect(heroes).toHaveLength(3);
    const queues = config.ally.queues.map((queue, i) => ({ ...queue,
      heroes: { shield: heroes[i]!.heroId }, reportHeroes: { shield: heroes[i]!.heroId },
      weaponLevels: { [heroes[i]!.heroId]: i + 1 }, reportWeaponLevels: { [heroes[i]!.heroId]: i + 1 },
    })) as unknown as InnerEarthConfig["ally"]["queues"];
    const configured = { ...input, sideA: { ...input.sideA,
      reportWeaponLevels: Object.fromEntries(heroes.map((hero) => [hero.heroId, 10])) },
      innerEarth: { ...config, ally: { ...config.ally, queues } } };
    const scenario = toValidationThreeQueueConfig(configured);
    for (let i = 0; i < 3; i += 1) {
      const state = createPureTroopBattleState({ id: `weapon-baseline-${i}`, maxRounds: 1,
        sideA: scenario.attacker.queues[i]!.side, sideB: scenario.defender.queues[i]!.side, battleContext: "challenge" });
      expect(scenario.attacker.queues[i]!.side.reportHeroes).toEqual([{ heroId: heroes[i]!.heroId, weaponLevel: i + 1 }]);
      expect(state.sideA.heroStatCorrection!.delta.shield.attack).toBe(0);
      expect(state.sideA.heroStatCorrection!.delta.shield.life).toBe(0);
    }
  });
  it("rejects repeated or unavailable queue heroes at the configuration boundary", () => {
    const input = inputFor("HEART_OF_EARTH"), config = input.innerEarth!;
    const hero = "hero.s11.eleonora";
    const repeated = { ...input, innerEarth: { ...config, ally: { ...config.ally,
      queues: [{ ...config.ally.queues[0], heroes: { shield: hero } },
        { ...config.ally.queues[1], heroes: { shield: hero } }, config.ally.queues[2]] as const } } };
    expect(() => assertInnerEarthInput(repeated)).toThrow(/不能重复/);
    const legal = { ...input, innerEarth: { ...config, ally: { ...config.ally,
      queues: [{ ...config.ally.queues[0], heroes: { shield: hero }, reportHeroes: { shield: hero },
        weaponLevels: { [hero]: 10 }, reportWeaponLevels: { [hero]: 10 } },
        config.ally.queues[1], config.ally.queues[2]] as const } } };
    expect(() => assertInnerEarthInput({ ...legal, serverStage: "s8_fc10" })).toThrow(/超出服务器阶段/);
    const lower = sanitizeInnerEarthForStage(legal, "s8_fc10");
    expect(lower.innerEarth!.ally.queues[0].heroes.shield).toBeNull();
    expect(lower.innerEarth!.ally.queues[0].reportHeroes?.shield).toBeNull();
    expect(lower.innerEarth!.ally.queues[0].weaponLevels).toEqual({});
    expect(lower.innerEarth!.ally.queues[0].reportWeaponLevels).toEqual({});
    expect(lower.innerEarth!.ally.queues[0].expectedReportStats).toEqual(legal.innerEarth.ally.queues[0].expectedReportStats);
    expect(() => assertInnerEarthInput(lower)).not.toThrow();
  });
  it("keeps each queue's own report lineup as the static baseline when candidate heroes change", () => {
    const input = inputFor("HERO_LAND"), config = input.innerEarth!;
    const heroes = getValidationCatalog().leaderHeroes.filter((hero) => hero.troopType === "shield" &&
      hero.category === "S" && (hero.sGeneration ?? Infinity) <= 11);
    const queues = config.ally.queues.map((queue, i) => ({ ...queue,
      heroes: { shield: heroes[i]!.heroId }, reportHeroes: { shield: heroes[i]!.heroId },
    })) as unknown as InnerEarthConfig["ally"]["queues"];
    const configured = { ...input, innerEarth: { ...config, ally: { ...config.ally, queues } } };
    const scenario = toValidationThreeQueueConfig(configured);
    const preview = (index: number, value = scenario) => createPureTroopBattleState({
      id: `queue${index}`, sideA: value.attacker.queues[index]!.side,
      sideB: value.defender.queues[index]!.side, maxRounds: 1, battleContext: "challenge" });
    for (let i = 0; i < 3; i += 1) {
      expect(preview(i).sideA.heroStatCorrection!.reportHeroIds).toEqual([heroes[i]!.heroId]);
      expect(preview(i).sideA.heroStatCorrection!.delta.shield.attack).toBe(0);
    }
    const candidate = { ...configured, innerEarth: { ...configured.innerEarth, ally: { ...configured.innerEarth.ally,
      queues: [queues[0], { ...queues[1], heroes: { shield: heroes[3]!.heroId } }, queues[2]] as
        InnerEarthConfig["ally"]["queues"] } } };
    const changed = preview(1, toValidationThreeQueueConfig(candidate));
    expect(changed.sideA.heroStatCorrection!.reportHeroIds).toEqual([heroes[1]!.heroId]);
    expect(changed.sideA.heroStatCorrection!.simulationHeroIds).toEqual([heroes[3]!.heroId]);
    expect(changed.sideA.heroStatCorrection!.delta.shield.attack).not.toBe(0);
    expect(candidate.innerEarth.ally.queues[1].expectedReportStats).toEqual(queues[1].expectedReportStats);
  });
  it("keeps ally stats/ratios independent and enemy input shared with exact preset counts", () => {
    const input = inputFor("HEART_OF_EARTH");
    const config = input.innerEarth!;
    const queues = config.ally.queues.map((queue, i) => ({ ...queue,
      ratio: [{ shield: 100, lancer: 0, marksman: 0 }, { shield: 0, lancer: 100, marksman: 0 },
        { shield: 0, lancer: 0, marksman: 100 }][i]!,
      expectedReportStats: { ...queue.expectedReportStats, shield: {
        ...queue.expectedReportStats.shield, attack: 1000 * (i + 1) } },
    })) as unknown as InnerEarthConfig["ally"]["queues"];
    const modified = { ...input, innerEarth: { ...config, ally: { ...config.ally,
      shared: { capacity: 150000 }, queues }, enemy: { ...config.enemy, shared: {
        ...config.enemy.shared, capacity: 150000, troopRatioPreset: "SHIELD_HEAVY" as const } } } };
    const scenario = toValidationThreeQueueConfig(modified);
    expect(scenario.attacker.queues.map((queue) => queue.side.shield.attack)).toEqual([10, 20, 30]);
    expect(scenario.attacker.deploymentCapacity).toBe(150000);
    expect(scenario.defender.queues.every((queue) => queue.side.shield.troopLevel === "T10")).toBe(true);
    const actualCounts: unknown[] = [];
    runThreeQueueScenario(scenario, (battle) => {
      actualCounts.push({ shield: battle.sideB.shield.count, lancer: battle.sideB.lancer.count,
        marksman: battle.sideB.marksman.count });
      return { winner: "A", attackerSurvivors: { shield: battle.sideA.shield.count,
        lancer: battle.sideA.lancer.count, marksman: battle.sideA.marksman.count },
        defenderSurvivors: { shield: 0, lancer: 0, marksman: 0 }, battle: {} as PureTroopScenarioResult };
    });
    expect(actualCounts).toEqual(Array(3).fill({ shield: 80000, lancer: 40000, marksman: 30000 }));
  });
  it("binds Hero Land to 190410 ally troops, T10 both sides and no pets", () => {
    const input = inputFor("HERO_LAND"), derived = materializeInnerEarthInput(input);
    expect(derived.sideA.deploymentCapacity).toBe(190410);
    expect(derived.sideA.threeQueues!.every((queue) => TROOP_TYPES.every((troop) => queue.troopLevels![troop] === "T10"))).toBe(true);
    expect(input.innerEarth!.petContext).toBeUndefined();
    expect(() => assertInnerEarthInput({ ...input, innerEarth: { ...input.innerEarth!,
      petContext: { ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet, attackLevel: 1 } } })).toThrow(/不允许宠物/);
  });
  it("applies eligible pet combat modifiers to every effective candidate queue without changing base stats", () => {
    const input = inputFor("HEART_OF_EARTH");
    const withPet = { ...input, innerEarth: { ...input.innerEarth!, petContext: {
      ...DEFAULT_EXTERNAL_BUFF_CONFIG.pet, attackLevel: 10, enemyDefenseReductionLevel: 10 } } };
    const snapshot = structuredClone(withPet);
    const plain = toValidationThreeQueueConfig(input);
    const effective = toValidationThreeQueueConfig(withPet);
    expect(withPet).toEqual(snapshot);
    for (let i = 0; i < 3; i += 1) {
      const a = createValidationPreviewState({ ...materializeInnerEarthInput(withPet), scenarioType: "SINGLE" });
      expect(a.sideA.troops.shield.attack).toBeGreaterThan(createValidationPreviewState({
        ...materializeInnerEarthInput(input), scenarioType: "SINGLE" }).sideA.troops.shield.attack);
      expect(effective.attacker.queues[i]!.side.targetBattleBonuses!.shield.attack.buff).toBe(10);
      expect(plain.attacker.queues[i]!.side.targetBattleBonuses!.shield.attack.buff).toBe(0);
      expect(effective.defender.queues[i]!.side.targetBattleBonuses!.shield.defense.debuff).toBe(10);
    }
    expect(auditInnerEarthInput(withPet)).toMatchObject({ petEnabled: true,
      petAppliedToBaseStats: false, petAppliedToOptimization: true });
  });
});
