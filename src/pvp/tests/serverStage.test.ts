import { describe, expect, it } from "vitest";
import {
  SERVER_STAGES,
  getServerStage,
  getAvailableHeroes,
  getAvailableTroopLevels,
  getAvailableMemberSkills,
  getValidationCatalog,
  isHeroAvailableAtStage,
  isTroopLevelAvailableAtStage,
  sanitizeConfigForStage,
  assertValidationInputStage,
  toEngineScenario,
  toValidationThreeQueueConfig,
  generateFormations,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const heroAt = (generation: number) => {
  const hero = getValidationCatalog().leaderHeroes.find((item) =>
    item.generation === generation);
  if (hero === undefined) throw new Error(`Missing S${generation} test hero.`);
  return hero.heroId;
};

describe("global server progression", () => {
  it("defines the ordered stages and exact hero/troop caps", () => {
    expect(SERVER_STAGES).toHaveLength(21);
    const checks = [
      ["s1_t10", 1, "T10"],
      ["s2_fc3", 2, "T10-FC3"],
      ["s4_t11", 4, "T11-FC5"],
      ["s5_fc8", 5, "T11-FC8"],
      ["s7_fc10", 7, "T11-FC10"],
      ["s10_t12", 10, "T12-FC10"],
      ["s12", 12, "T12-FC10"],
      ["s16", 16, "T12-FC10"],
    ] as const;
    for (const [id, generation, level] of checks) {
      const stage = getServerStage(id);
      expect(stage.maxHeroGeneration).toBe(generation);
      expect(stage.maxTroopLevel).toBe(level);
      expect(isHeroAvailableAtStage(heroAt(generation), id)).toBe(true);
      if (generation < 16) {
        expect(isHeroAvailableAtStage(heroAt(generation + 1), id)).toBe(false);
      }
      expect(isTroopLevelAvailableAtStage(level, id)).toBe(true);
    }
  });

  it("exposes historical troop levels below the stage without early fire-crystal unlocks", () => {
    expect(getAvailableTroopLevels("s1_t10")).toContain("T10");
    expect(getAvailableTroopLevels("s1_t10")).not.toContain("T10-FC1");
    expect(getAvailableTroopLevels("s2_fc3")).toContain("T10-FC3");
    expect(getAvailableTroopLevels("s2_fc3")).not.toContain("T10-FC4");
    expect(getAvailableTroopLevels("s4_t11")).toContain("T11-FC5");
    expect(getAvailableTroopLevels("s4_t11")).not.toContain("T10-FC6");
    expect(getAvailableTroopLevels("s5_fc8")).toContain("T10-FC5");
    expect(getAvailableTroopLevels("s5_fc8")).toContain("T11-FC8");
    expect(getAvailableTroopLevels("s5_fc8")).not.toContain("T11-FC9");
    expect(getAvailableTroopLevels("s7_fc10")).toContain("T11-FC10");
    expect(getAvailableTroopLevels("s10_t12")).toContain("T12-FC10");
    expect(getAvailableTroopLevels("s12")).not.toContain("T13");
  });

  it("filters leaders and slot-1 member sources through the same stage", () => {
    const available = getAvailableHeroes("s5_t11");
    expect(available.every((hero) => (hero.generation ?? 1) <= 5)).toBe(true);
    expect(available.some((hero) => (hero.generation ?? 1) === 5)).toBe(true);
    const members = getAvailableMemberSkills("s5_t11");
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(member.sourceHeroIds.every((id) =>
        isHeroAvailableAtStage(id, "s5_t11"))).toBe(true);
    }
    const all = getValidationCatalog().memberSkills;
    const highSource = all.flatMap((member) => member.sourceHeroIds.map((id, index) => ({
      id, skillId: member.sourceSkillIds[index]!,
    }))).find((item) => !isHeroAvailableAtStage(item.id, "s5_t11"));
    expect(highSource).toBeDefined();
    const base = createDefaultValidationInput();
    const injected = { ...base, serverStage: "s5_t11" as const,
      scenarioType: "RALLY" as const,
      sideA: { ...base.sideA, selectedMemberSkillIds: [highSource!.skillId] } };
    expect(() => toEngineScenario(injected)).toThrow(/stage/);
  });

  it("uses independent troop ceilings in 333 and three-queue within the global cap", () => {
    const base = sanitizeConfigForStage(createDefaultValidationInput(), "s5_fc8").input;
    const levels = { shield: "T10-FC5", lancer: "T11-FC8", marksman: "T11-FC5" };
    const sideA = { ...base.sideA, highestTroopLevels: levels };
    const input = { ...base, serverStage: "s5_fc8" as const, sideA };
    const scenario = toEngineScenario({ ...input, scenarioType: "THREE_THREE_THREE" });
    expect([scenario.sideA.shield.troopLevel, scenario.sideA.lancer.troopLevel,
      scenario.sideA.marksman.troopLevel]).toEqual([
      "T10-FC5", "T11-FC8", "T11-FC5",
    ]);
    const queues = toValidationThreeQueueConfig({ ...input, scenarioType: "THREE_QUEUE",
      attributeInputMode: "prediction" });
    expect(queues.attacker.highestTroopLevels).toEqual(levels);
    const illegal = { ...input, sideA: { ...sideA,
      highestTroopLevels: { ...levels, lancer: "T11-FC9" } } };
    expect(() => toValidationThreeQueueConfig({ ...illegal,
      scenarioType: "THREE_QUEUE", attributeInputMode: "prediction" })).toThrow(/stage/);
  });

  it("cleans a downgraded S15 lineup and rejects unsanitized injections", () => {
    const base = createDefaultValidationInput();
    const high = heroAt(15);
    const highMember = getValidationCatalog().memberSkills.flatMap((member) =>
      member.sourceHeroIds.map((id, index) => ({ id,
        skillId: member.sourceSkillIds[index]! })))
      .find((source) => !isHeroAvailableAtStage(source.id, "s5_fc8"))!;
    const highTroop = { ...base.sideA.troops.shield, troopLevel: "T12-FC10" };
    const sideA = { ...base.sideA,
      troops: { shield: highTroop, lancer: { ...base.sideA.troops.lancer,
        troopLevel: "T12-FC10" }, marksman: { ...base.sideA.troops.marksman,
        troopLevel: "T12-FC10" } },
      highestTroopLevels: { shield: "T12-FC10", lancer: "T12-FC10",
        marksman: "T12-FC10" },
      leaderHeroIds: { shield: high, lancer: null, marksman: null },
      reportHeroByTroop: { shield: high, lancer: null, marksman: null },
      selectedMemberSkillIds: [highMember.skillId],
      threeQueues: [
        { ...base.sideA.threeQueues![0]!, leaderHeroIds: { shield: high } },
        base.sideA.threeQueues![1]!, base.sideA.threeQueues![2]!,
      ] as const,
    };
    const configured = { ...base, serverStage: "s16" as const, sideA };
    const lowered = { ...configured, serverStage: "s5_fc8" as const };
    expect(() => assertValidationInputStage(lowered)).toThrow(/stage/);
    const cleaned = sanitizeConfigForStage(configured, "s5_fc8");
    expect(cleaned.changed).toBe(true);
    expect(cleaned.input.sideA.leaderHeroIds?.shield).toBeNull();
    expect(cleaned.input.sideA.reportHeroByTroop?.shield).toBeNull();
    expect(cleaned.input.sideA.threeQueues?.[0].leaderHeroIds.shield).toBeNull();
    expect(cleaned.input.sideA.selectedMemberSkillIds).toEqual([]);
    for (const troop of ["shield", "lancer", "marksman"] as const) {
      expect(cleaned.input.sideA.troops[troop].troopLevel).toBe("T11-FC8");
      expect(cleaned.input.sideA.highestTroopLevels?.[troop]).toBe("T11-FC8");
    }
    expect(() => assertValidationInputStage(cleaned.input)).not.toThrow();
    expect(() => toEngineScenario({ ...cleaned.input,
      scenarioType: "SINGLE" })).not.toThrow();
  });

  it("merges mixed troop grades after a stage downgrade without losing soldiers", () => {
    const base = createDefaultValidationInput();
    const shield = { ...base.sideA.troops.shield, levelMode: "mixed" as const,
      troopLevel: "T12-FC10",
      levelComposition: [
        { level: "T12-FC10", aliveCount: 700 },
        { level: "T11-FC9", aliveCount: 200 },
        { level: "T10-FC5", aliveCount: 100 },
      ] };
    const input = { ...base, sideA: { ...base.sideA,
      troops: { ...base.sideA.troops, shield } } };
    const lowered = sanitizeConfigForStage(input, "s5_fc8").input;
    expect(lowered.sideA.troops.shield.levelComposition).toEqual([
      { level: "T11-FC8", aliveCount: 900 },
      { level: "T10-FC5", aliveCount: 100 },
    ]);
    expect(() => assertValidationInputStage(lowered)).not.toThrow();
  });

  it("keeps an already valid partial lineup unchanged when changing stages", () => {
    const base = createDefaultValidationInput();
    const configured = { ...base, sideA: { ...base.sideA,
      leaderHeroIds: { shield: null },
    } };
    const result = sanitizeConfigForStage(configured, "s12");
    expect(result.changed).toBe(false);
    expect(result.input.sideA.leaderHeroIds).toEqual({ shield: null });
  });

  it("uses the stage as the optimizer hero ceiling", () => {
    const base = createDefaultValidationInput();
    const formations = generateFormations({ ...base, serverStage: "s1_t10" }, {}, 5);
    expect(formations.length).toBeGreaterThan(0);
    const ids = formations.flatMap((formation) => [
      ...Object.values(formation.leaderHeroIds).filter((id): id is string => !!id),
      ...formation.memberSkillIds.flatMap((skillId) => {
        const option = getValidationCatalog().memberSkills.find((member) =>
          member.sourceSkillIds.includes(skillId));
        const index = option?.sourceSkillIds.indexOf(skillId) ?? -1;
        return index < 0 ? [] : [option!.sourceHeroIds[index]!];
      }),
    ]);
    expect(ids.every((id) => isHeroAvailableAtStage(id, "s1_t10"))).toBe(true);
    const highSkillId = getValidationCatalog().memberSkills.flatMap((member) =>
      member.sourceHeroIds.map((id, index) => ({ id,
        skillId: member.sourceSkillIds[index]! })))
      .find((source) => !isHeroAvailableAtStage(source.id, "s1_t10"))!.skillId;
    expect(() => generateFormations({ ...base, serverStage: "s1_t10" },
      { fixedMemberSkillIds: [highSkillId] }, 5)).toThrow(/server stage/);
  });
});
