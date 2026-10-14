import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIMULATION_COUNT,
  defaultSimpleScenarioOptimizationOptions,
  defaultThreeQueueOptimizationOptions,
  generateFormations,
  getValidationCatalog,
  getValidationThreeQueues,
  resolveBodySkillConfigs,
  resolveValidationTroopCounts,
  toValidationThreeQueueConfig,
  toThreeQueueBasisPoints,
  type ValidationQueueConfig,
} from "../../pvp";
import { bodyPrimaryEffectFamily } from "../optimizer/criterion/bodyPreprocess";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { rallyHeadSearchFixture } from "./fixtures/rallyHeadSearch";

describe("post-summary configuration rules", () => {
  it("validates each three-queue ratio independently and preserves per-queue sources", () => {
    const base = createDefaultValidationInput();
    const leaders = [{ lancer: "hero.s4.lingnai" }, { shield: "hero.s5.heketuo" }, { marksman: "hero.s6.weien" }];
    const skillIds = ["hero-skill.lingnai.shadow-blade", "hero-skill.heketuo.thunder-strike", "hero-skill.weien.thunder-raid"];
    const queues = getValidationThreeQueues(base.sideA).map((queue, index):
      ValidationQueueConfig => ({ ...queue,
      leaderHeroIds: leaders[index]!,
      attributes: { ...queue.attributes!, shield: { ...queue.attributes!.shield,
        attack: 1_000 + index * 500 } },
      externalBuffs: { ...queue.externalBuffs!, town: { ...queue.externalBuffs!.town,
        attack: index === 0 ? "small" : index === 1 ? "large" : "none" } },
      heroSkillLevels: { [skillIds[index]!]: index === 1 ? 5 : 4 },
    })) as [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
    const input = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA, threeQueues: queues } };
    expect(queues.reduce((sum, queue) => sum + queue.ratios.shield +
      queue.ratios.lancer + queue.ratios.marksman, 0)).toBe(300);
    queues.forEach((queue) => expect(toThreeQueueBasisPoints(queue.ratios)).toBeDefined());
    const scenario = toValidationThreeQueueConfig(input);
    expect(scenario.attacker.queues.map((queue) =>
      queue.side.shield.attack)).toEqual([10, 15, 20]);
    expect(scenario.attacker.queues.map((queue) =>
      queue.side.targetBattleBonuses?.shield.attack.buff)).toEqual([10, 20, 0]);
    expect(scenario.attacker.queues.map((queue, index) => queue.side.heroes?.find(
      (hero) => Object.values(leaders[index]!).includes(hero.heroId))?.skillLevels?.[skillIds[index]!])).toEqual([4, 5, 4]);
    const restored = restorePersistedConfig(createPersistedEnvelope(input, 1000));
    expect(getValidationThreeQueues(restored.input.sideA).map((queue, index) =>
      queue.heroSkillLevels?.[skillIds[index]!])).toEqual([4, 5, 4]);
    expect(getValidationThreeQueues(restored.input.sideA).map((queue) =>
      queue.externalBuffs?.town.attack)).toEqual(["small", "large", "none"]);
  });

  it("copies legacy shared external buffs into each queue when loading old queue data", () => {
    const base = createDefaultValidationInput();
    const legacy = { ...base, scenarioType: "THREE_QUEUE" as const,
      attributeInputMode: "prediction" as const,
      sideA: { ...base.sideA,
        externalBuffs: { ...base.sideA.externalBuffs!,
          town: { ...base.sideA.externalBuffs!.town, attack: "large" as const } } } };
    const restored = restorePersistedConfig(createPersistedEnvelope(legacy, 1000));
    expect(getValidationThreeQueues(restored.input.sideA).map((queue) =>
      queue.externalBuffs?.town.attack)).toEqual(["large", "large", "large"]);
  });

  it("adds fixed rally and pet capacity before the percentage factor", () => {
    const base = createDefaultValidationInput();
    const side = { ...base.sideA,
      rallyDeployment: { totalTroops: 100_000,
        ratios: { shield: 50, lancer: 20, marksman: 30 } },
      rallyFixedCapacityBonus: 50_000,
      petMarchCapacityLevel: 2,
      rallyCapacityBonus: .2 };
    const counts = resolveValidationTroopCounts(side, "rally", "prediction");
    expect(counts).toEqual({ shield: 91_800, lancer: 36_720, marksman: 55_080 });
    expect(resolveValidationTroopCounts(side, "rally", "finalReport"))
      .toEqual({ shield: 12_000, lancer: 12_000, marksman: 12_000 });
    const march = resolveValidationTroopCounts({ ...base.sideA,
      petMarchCapacityLevel: 1, marchCapacityBonus: .1 }, "challenge", "prediction");
    expect(march).toEqual({ shield: 13_750, lancer: 13_750, marksman: 13_750 });
  });

  it("allows four identical manual body slots while restricting optimizer formations", () => {
    const skill = "hero-skill.heluonimo.penetration";
    expect(resolveBodySkillConfigs([skill, skill, skill, skill], [], "s11"))
      .toHaveLength(4);
    const formations = generateFormations({ ...rallyHeadSearchFixture(),
      scenarioType: "RALLY", battleContext: "rally" }, {}, 30);
    const sourceBySkill = new Map(getValidationCatalog().memberSkills.flatMap((group) =>
      group.sourceSkillIds.map((id, index) => [id, group.sourceHeroIds[index]!] as const)));
    expect(formations.length).toBeGreaterThan(0);
    for (const formation of formations) {
      const counts=new Map<string,number>();
      for(const id of formation.memberSkillIds){const family=bodyPrimaryEffectFamily(id);counts.set(family,(counts.get(family)??0)+1);}
      expect([...counts.values()].every((count)=>count<=2)).toBe(true);
    }
    expect(formations.some((formation)=>new Set(formation.memberSkillIds.map((id)=>sourceBySkill.get(id))).size>2)).toBe(true);
  });

  it("uses the requested Monte Carlo defaults", () => {
    expect(DEFAULT_BATCH_SIMULATION_COUNT).toBe(1000);
    expect(defaultSimpleScenarioOptimizationOptions(1)).toMatchObject({
      initialBattleTrials: 10, coarseTrials: 20, intermediateTrials: 50,
      middleTrials: 150, verificationTrials: 1000, topN: 5,
    });
    expect(defaultThreeQueueOptimizationOptions(1)).toMatchObject({
      coarseSimulationCount: 20, refinementSimulationCount: 100,
      finalValidationCount: 1000, finalCandidateCount: 5, beamRounds: 2,
    });
  });
});
