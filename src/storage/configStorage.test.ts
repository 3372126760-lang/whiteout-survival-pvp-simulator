import { describe, expect, it } from "vitest";
import {
  CONFIRMED_HERO_SKILL_DEFINITIONS, defaultOptimizationConfig,
  defaultSimpleScenarioOptimizationOptions,
  defaultThreeQueueOptimizationOptions,
  getValidationThreeQueues,
  getValidationCatalog, runValidationBattle, sanitizeConfigForStage,
  toEngineScenario,
} from "../pvp";
import { createDefaultValidationInput } from "../ui/defaultInput";
import {
  AUTOSAVE_STORAGE_KEY,
  LocalStorageConfigStorage,
  copySavedProfile,
  createPersistedEnvelope,
  createSavedProfile,
  exportPersistedJson,
  parsePersistedJson,
  renameSavedProfile,
  restorePersistedConfig,
  type KeyValueStorage,
} from "./index";

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function validInput() {
  const base = sanitizeConfigForStage(createDefaultValidationInput(), "s5_fc8").input;
  return { ...base, scenarioType: "THREE_QUEUE" as const,
    attributeInputMode: "prediction" as const,
    sideA: { ...base.sideA,
      highestTroopLevels: { shield: "T10-FC5", lancer: "T11-FC8",
        marksman: "T11-FC5" },
      threeQueues: [
        { ratios: { shield: 33.33, lancer: 33.33, marksman: 33.34 },
          leaderHeroIds: { shield: "hero.s1.heluonimo" } },
        base.sideA.threeQueues![1]!, base.sideA.threeQueues![2]!,
      ] as NonNullable<typeof base.sideA.threeQueues>,
    } };
}

describe("versioned battle config storage", () => {
  it("roundtrips theory parameters, explicit halving schedule and protected manual references", () => {
    const input = { ...createDefaultValidationInput(), serverStage: "s11" as const };
    const config = { ...defaultOptimizationConfig(6543), initialBattleTrials: 7,
      stages: [ { ratioStep: 5, trials: 20, keep: 2000, maxCandidates: 2 },
        { ratioStep: 2, trials: 50, keep: 400, maxCandidates: 3 },
        { ratioStep: 1, trials: 200, keep: 30, maxCandidates: 4 } ] as const,
      theory: { ...defaultOptimizationConfig().theory!, localPeaksPerLineup: 4,
        calibratedEquivalents: { "hero-effect.baxiti.unstable-field": .18 } },
      monteCarloStages: [{ trials: 7, keep: 100 }, { trials: 100, keep: 10 }],
      protectedCandidates: [{ leaderHeroIds: { shield: "hero.s1.heluonimo" },
        memberSkillIds: [], ratios: { shield: 50, lancer: 20, marksman: 30 } }] };
    const simple = { ...defaultSimpleScenarioOptimizationOptions(1),
      initialBattleTrials: 6, intermediateTrials: 60, theory: config.theory,
      monteCarloStages: config.monteCarloStages };
    const restored = restorePersistedConfig(createPersistedEnvelope(input, 1000, config, 123, simple));
    expect(restored.optimizationConfig).toEqual(config);
    expect(restored.simpleOptimizerOptions).toEqual(simple);
    const malformed = JSON.parse(JSON.stringify(createPersistedEnvelope(input, 1000, config)));
    malformed.data.optimizationConfig.theory.ratioStep = 3;
    expect(() => restorePersistedConfig(malformed)).toThrow(/theory options/);
  });

  it("keeps queue-specific OCR modifiers through autosave", () => {
    const base = validInput();
    const first = getValidationThreeQueues(base.sideA)[0];
    const modifiers = Object.fromEntries((["shield", "lancer", "marksman"] as const)
      .map((troop) => [troop, Object.fromEntries(
        (["attack", "defense", "penetration", "life"] as const)
          .map((stat) => [stat, { additive: troop === "lancer" &&
            stat === "attack" ? 5 : 0, buff: 0, debuff: 0 }]))])) as
              NonNullable<typeof first.importedReportModifiers>;
    const input = { ...base, sideA: { ...base.sideA,
      threeQueues: [{ ...first, importedReportModifiers: modifiers },
        base.sideA.threeQueues![1]!, base.sideA.threeQueues![2]!] as
          NonNullable<typeof base.sideA.threeQueues> } };
    const backend = new MemoryStorage();
    new LocalStorageConfigStorage(backend).saveAutosave(input, 100,
      defaultOptimizationConfig(1));
    const restored = new LocalStorageConfigStorage(backend).loadAutosave()!;
    expect(restored.input.sideA.threeQueues?.[0].historicalBonusMigration?.conflicts).toContainEqual({ attribute: "attack", field: "additive", values: { shield: 0, lancer: 5, marksman: 0 } });
    expect(restored.input.sideA.threeQueues?.[1].importedReportModifiers)
      .toBeUndefined();
  });
  it("roundtrips autosave across store instances without battle runtime state", () => {
    const backend = new MemoryStorage();
    const input = validInput();
    const config = defaultOptimizationConfig(4567);
    const simpleOptions = { ...defaultSimpleScenarioOptimizationOptions(6543),
      side: "B" as const, fixedRatio: true };
    const threeQueueOptions = { ...defaultThreeQueueOptimizationOptions(2468),
      side: "B" as const, beamWidth: 5,
      lockHeroes: [true, false, false] as const };
    new LocalStorageConfigStorage(backend).saveAutosave(input, 321, config,
      simpleOptions, threeQueueOptions);
    const raw = JSON.parse(backend.getItem(AUTOSAVE_STORAGE_KEY)!);
    expect(raw.schemaVersion).toBe(4);
    expect(raw.data.input.sideA.threeQueues[0].ratiosBp).toEqual({
      shield: 3333, lancer: 3333, marksman: 3334,
    });
    expect(raw.data.input.sideA.threeQueues[0].attributes.shield.attack)
      .toBe(input.sideA.troops.shield.attack);
    expect(JSON.stringify(raw)).not.toMatch(/BattleTrace|currentHp|rngState|skillCounters/);
    const restored = new LocalStorageConfigStorage(backend).loadAutosave()!;
    expect(restored.input.serverStage).toBe("s5_fc8");
    expect(restored.input.scenarioType).toBe("INNER_EARTH");
    expect(restored.input.innerEarth?.subMode).toBe("HEART_OF_EARTH");
    expect(restored.sceneMigrationWarnings?.length).toBeGreaterThan(0);
    expect(restored.input.sideA.highestTroopLevels).toEqual(
      input.sideA.highestTroopLevels);
    expect(restored.input.sideA.threeQueues?.[0].ratios).toEqual({
      shield: 33.33, lancer: 33.33, marksman: 33.34,
    });
    expect(restored.input.sideA.threeQueues?.[0].leaderHeroIds.shield)
      .toBe("hero.s1.heluonimo");
    expect(restored.queueAttributesMigrated).toBe(false);
    expect(restored.simulationCount).toBe(321);
    expect(restored.optimizationConfig.firstSeed).toBe(4567);
    expect(restored.simpleOptimizerOptions).toEqual(simpleOptions);
    expect(restored.threeQueueOptimizerOptions).toEqual(threeQueueOptions);
    expect(restored.adjusted).toBe(false);
  });

  it("migrates v1 shared report attributes into all three queues and preserves distinct v2 values", () => {
    const input = validInput();
    const envelope = createPersistedEnvelope(input, 100,
      defaultOptimizationConfig(), 123);
    const legacy = JSON.parse(JSON.stringify(envelope));
    legacy.schemaVersion = 1;
    legacy.data.input.sideA.attributes = { shieldAttack: 7777 };
    for (const side of [legacy.data.input.sideA, legacy.data.input.sideB]) {
      for (const queue of side.threeQueues) {
        delete queue.attributes;
        delete queue.troopLevels;
      }
    }
    const restored = restorePersistedConfig(legacy);
    expect(restored.migrated).toBe(true);
    expect(restored.queueAttributesMigrated).toBe(true);
    for (const queue of getValidationThreeQueues(restored.input.sideA)) {
      expect(queue.attributes?.shield.attack).toBe(7777);
      expect(queue.troopLevels?.shield).toBe(
        input.sideA.highestTroopLevels!.shield);
    }
    const queues = [...getValidationThreeQueues(restored.input.sideA)];
    queues[1] = { ...queues[1]!, attributes: { ...queues[1]!.attributes!,
      shield: { ...queues[1]!.attributes!.shield, attack: 9876 } } };
    const distinct = { ...restored.input, sideA: { ...restored.input.sideA,
      threeQueues: queues as unknown as NonNullable<typeof restored.input.sideA.threeQueues> } };
    const roundtrip = restorePersistedConfig(createPersistedEnvelope(distinct, 100));
    expect(roundtrip.queueAttributesMigrated).toBe(false);
    expect(roundtrip.input.sideA.threeQueues?.[1].attributes?.shield.attack)
      .toBe(9876);
    expect(roundtrip.input.sideA.threeQueues?.[0].attributes?.shield.attack)
      .not.toBe(9876);
  });

  it("marks a legacy named three-queue profile for the UI migration notice", () => {
    const envelope = createPersistedEnvelope(validInput(), 100);
    const legacy = JSON.parse(JSON.stringify(envelope));
    legacy.schemaVersion = 1;
    for (const side of [legacy.data.input.sideA, legacy.data.input.sideB]) {
      for (const queue of side.threeQueues) {
        delete queue.attributes;
        delete queue.troopLevels;
      }
    }
    const backend = new MemoryStorage();
    backend.setItem("wos-pvp.profiles", JSON.stringify([{
      id: "legacy-profile", name: "旧三队列", createdAt: 100,
      updatedAt: 123, schemaVersion: 1, data: legacy.data,
    }]));
    const profile = new LocalStorageConfigStorage(backend).getProfile("legacy-profile");
    expect(profile?.schemaVersion).toBe(4);
    expect(profile?.queueAttributesMigrated).toBe(true);
    expect(profile?.data.input.sideA.threeQueues?.[0].attributes.shield.attack)
      .toBe(validInput().sideA.troops.shield.attack);
  });

  it("retains integer basis points through export and import", () => {
    const options = { ...defaultThreeQueueOptimizationOptions(321),
      finalValidationCount: 73, lockRatios: [false, true, false] as const };
    const json = exportPersistedJson(validInput(), 100,
      defaultOptimizationConfig(), undefined, options);
    const restored = parsePersistedJson(json);
    expect(restored.threeQueueOptimizerOptions).toEqual(options);
    const exported = createPersistedEnvelope(restored.input, 100,
      restored.optimizationConfig);
    expect(exported.data.input.sideA.threeQueues?.[0].ratiosBp).toEqual({
      shield: 3333, lancer: 3333, marksman: 3334,
    });
  });

  it("migrates legacy shared troop ceiling and full body hero to slot 1 only", () => {
    const base = createDefaultValidationInput();
    const legacy = { schemaVersion: 0, savedAt: 123,
      data: { input: { ...base, scenarioType: "RALLY",
        battleContext: "rally",
        sideA: { ...base.sideA,
          highestTroopLevel: "T10-FC8",
          bodyHero: { heroId: "hero.s1.heluonimo", skillLevel: 5,
            weaponLevel: 10, stats: { attack: 999 },
            skill2: "hero-skill.heluonimo.attack",
            skill3: "hero-skill.heluonimo.periodic-damage" },
        } }, simulationCount: 100 } };
    const restored = restorePersistedConfig(legacy);
    expect(restored.migrated).toBe(true);
    expect(restored.input.sideA.highestTroopLevels).toEqual({
      shield: "T10-FC8", lancer: "T10-FC8", marksman: "T10-FC8",
    });
    expect(restored.input.sideA.bodySkills).toEqual([{
      heroId: "hero.s1.heluonimo",
      heroDefinitionId: "hero.s1.heluonimo", runtimeInstanceId: "A-body-0",
      skillId: "hero-skill.heluonimo.penetration",
      expeditionSkillSlot: 1, skillLevel: 5,
    }]);
    const scenario = toEngineScenario(restored.input);
    expect(scenario.sideA.heroes?.find((hero) => hero.position === "member"))
      .toEqual({ heroId: "hero.s1.heluonimo", heroDefinitionId: "hero.s1.heluonimo",
        runtimeInstanceId: "A-body-0", position: "member",
        selectedMemberSkillId: "hero-skill.heluonimo.penetration",
        skillLevels: { "hero-skill.heluonimo.penetration": 5 } });
    expect(JSON.stringify(scenario)).not.toMatch(/bodyHero|weaponLevel":10|periodic-damage/);
  });

  it("keeps a supported legacy body skill level through migration", () => {
    const source = getValidationCatalog().memberSkills.flatMap((group) =>
      group.sourceSkillIds.map((skillId, index) => ({ skillId,
        heroId: group.sourceHeroIds[index]! })))
      .find((entry) => CONFIRMED_HERO_SKILL_DEFINITIONS.find((definition) =>
        definition.id === entry.skillId)?.levelValues[4] !== undefined)!;
    const base = createDefaultValidationInput();
    const restored = restorePersistedConfig({ schemaVersion: 0, savedAt: 100,
      data: { input: { ...base, scenarioType: "RALLY",
        sideA: { ...base.sideA,
          bodyHero: { heroId: source.heroId, skillId: source.skillId,
            skillLevel: 4, weaponLevel: 10 } } },
      simulationCount: 100 } });
    expect(restored.input.sideA.bodySkills?.[0]?.skillLevel).toBe(4);
    const scenario = toEngineScenario(restored.input);
    expect(scenario.sideA.heroes?.find((hero) => hero.position === "member")
      ?.skillLevels?.[source.skillId]).toBe(4);
  });

  it("sanitizes a lower stage before restored config reaches the scenario adapter", () => {
    const base = createDefaultValidationInput();
    const highHero = getValidationCatalog().leaderHeroes.find((hero) =>
      hero.generation === 12 && hero.troopType === "shield")!.heroId;
    const highBody = getValidationCatalog().memberSkills.flatMap((group) =>
      group.sourceSkillIds.map((skillId, index) => ({ skillId,
        heroId: group.sourceHeroIds[index]! })))
      .find((entry) => entry.heroId !== highHero &&
        getValidationCatalog().leaderHeroes.find((hero) =>
          hero.heroId === entry.heroId)?.generation === 12)!;
    const raw = structuredClone(createPersistedEnvelope({ ...base,
      serverStage: "s16", scenarioType: "SINGLE" }, 100));
    (raw.data.input as { serverStage: string }).serverStage = "s5_fc8";
    (raw.data.input.sideA.troops.shield as { troopLevel: string }).troopLevel = "T12-FC10";
    (raw.data.input.sideA.leaderHeroIds as { shield: string | null }).shield = highHero;
    (raw.data.input.sideA as { bodySkills: unknown }).bodySkills = [{
      heroId: highBody.heroId, skillId: highBody.skillId,
      expeditionSkillSlot: 1, skillLevel: 5 }];
    const restored = restorePersistedConfig(raw);
    expect(restored.adjusted).toBe(true);
    expect(restored.input.sideA.troops.shield.troopLevel).toBe("T11-FC8");
    expect(restored.input.sideA.leaderHeroIds?.shield).toBeNull();
    expect(restored.input.sideA.selectedMemberSkillIds).toEqual([]);
    expect(restored.input.sideA.bodySkills).toEqual([]);
    expect(() => toEngineScenario(restored.input)).not.toThrow();
  });

  it("removes overstage optimizer constraints and reports the adjustment", () => {
    const input = createDefaultValidationInput();
    const highHero = getValidationCatalog().leaderHeroes.find((hero) =>
      hero.generation === 12 && hero.troopType === "shield")!.heroId;
    const config = { ...defaultOptimizationConfig(), constraints: {
      requiredHeroIds: [highHero], heroPoolIds: [highHero],
      fixedLeaders: { shield: highHero },
      allowedPositions: { [highHero]: ["leader" as const] },
      minGeneration: 12 } };
    const raw = structuredClone(createPersistedEnvelope({ ...input,
      serverStage: "s16" }, 100, config));
    (raw.data.input as { serverStage: string }).serverStage = "s5_fc8";
    const restored = restorePersistedConfig(raw);
    expect(restored.adjusted).toBe(true);
    expect(restored.optimizationConfig.constraints.requiredHeroIds).toEqual([]);
    expect(restored.optimizationConfig.constraints.heroPoolIds).toEqual([]);
    expect(restored.optimizationConfig.constraints.fixedLeaders).toEqual({});
    expect(restored.optimizationConfig.constraints.allowedPositions).toEqual({});
    expect(restored.optimizationConfig.constraints.minGeneration).toBe(5);
  });

  it("supports profile save, load, rename, copy and delete independently of autosave", () => {
    const backend = new MemoryStorage();
    const storage = new LocalStorageConfigStorage(backend);
    const input = validInput();
    storage.saveAutosave(input, 100, defaultOptimizationConfig());
    const autosave = backend.getItem(AUTOSAVE_STORAGE_KEY);
    const profile = createSavedProfile("三队列进攻", input, 100,
      defaultOptimizationConfig(), "id-1", 1000);
    storage.saveProfile(profile);
    expect(storage.getProfile("id-1")?.name).toBe("三队列进攻");
    const restoredProfile = restorePersistedConfig({ schemaVersion: profile.schemaVersion,
      savedAt: profile.updatedAt, data: storage.getProfile("id-1")!.data });
    expect(restoredProfile.input.sideA.highestTroopLevels)
      .toEqual(input.sideA.highestTroopLevels);
    const renamed = renameSavedProfile(profile, "新名称", 1100);
    storage.saveProfile(renamed);
    const copy = copySavedProfile(renamed, "id-2", 1200);
    storage.saveProfile(copy);
    expect(copy.id).not.toBe(profile.id);
    expect(copy.createdAt).not.toBe(profile.createdAt);
    expect(copy.data).toEqual(profile.data);
    expect(storage.listProfiles()).toHaveLength(2);
    storage.deleteProfile("id-1");
    expect(storage.getProfile("id-1")).toBeNull();
    expect(storage.getProfile("id-2")?.name).toContain("副本");
    expect(backend.getItem(AUTOSAVE_STORAGE_KEY)).toBe(autosave);
  });

  it("rejects corrupt JSON, future schemas and malformed battle inputs cleanly", () => {
    expect(() => parsePersistedJson("{bad")).toThrow(/JSON 格式损坏/);
    const base = createPersistedEnvelope(validInput(), 100);
    expect(() => restorePersistedConfig({ ...base, schemaVersion: 999 }))
      .toThrow(/版本无法读取/);
    expect(() => restorePersistedConfig({ ...base, schemaVersion: undefined }))
      .toThrow(/版本无法读取/);
    type MutableRecord = Record<string, unknown>;
    const at = (root: MutableRecord, ...keys: string[]): MutableRecord =>
      keys.reduce((value, key) => value[key] as MutableRecord, root);
    const altered = (change: (value: MutableRecord) => void) => {
      const value = structuredClone(base) as unknown as MutableRecord;
      change(at(value, "data", "input"));
      return restorePersistedConfig(value);
    };
    expect(() => altered((input) => { delete at(input, "sideA").troops; }))
      .toThrow(/troops/);
    expect(() => altered((input) => { input.scenarioType = "UNKNOWN"; }))
      .toThrow(/scenarioType/);
    expect(() => altered((input) => { at(input, "sideA", "leaderHeroIds").shield = "bad-id"; }))
      .toThrow(/未知英雄/);
    expect(() => altered((input) => { at(input, "sideA", "troops", "shield").troopLevel = "T99"; }))
      .toThrow(/未知兵种等级/);
    expect(() => altered((input) => {
      const queues = at(input, "sideA").threeQueues as MutableRecord[];
      at(queues[0]!, "ratiosBp").shield = 9999;
    }))
      .toThrow(/10000 基点/);
    expect(() => altered((input) => { at(input, "sideA").bodySkills = [{ heroId: "hero.s1.heluonimo",
      skillId: "hero-skill.heluonimo.attack", expeditionSkillSlot: 2, skillLevel: 5 }]; }))
      .toThrow(/非一技能/);
    const invalidOptimization = structuredClone(base) as unknown as MutableRecord;
    at(invalidOptimization, "data").optimizationConfig = {
      ...defaultOptimizationConfig(), maxWaves: 1_000_000,
    };
    expect(() => restorePersistedConfig(invalidOptimization)).toThrow(/maxWaves/);
  });

  it("preserves deterministic battle results after storage restore", () => {
    const base = createDefaultValidationInput();
    const input = { ...base, scenarioType: "SINGLE" as const,
      maxRounds: 2, randomSeed: 991 };
    const restored = parsePersistedJson(exportPersistedJson(input, 100));
    expect(runValidationBattle(restored.input).summary)
      .toEqual(runValidationBattle(input).summary);
    expect(runValidationBattle(restored.input).roundDamage)
      .toEqual(runValidationBattle(input).roundDamage);
  });
});
