import { describe, expect, it } from "vitest";
import {
  createConfirmedHeroState,
  createValidationPreviewState,
  resolveBodySkillConfigs,
  runValidationBattle,
  toEngineScenario,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const BODY_HERO = "hero.s1.heluonimo";
const FIRST = "hero-skill.heluonimo.penetration";
const SECOND = "hero-skill.heluonimo.attack";
const THIRD = "hero-skill.heluonimo.periodic-damage";
const WEAPON = "hero-weapon-skill.heluonimo.rally-attack";

function rallyInput(weaponLevel: number) {
  const base = createDefaultValidationInput();
  return { ...base, scenarioType: "RALLY" as const,
    battleContext: "rally" as const,
    attributeInputMode: "prediction" as const,
    maxRounds: 2,
    sideA: { ...base.sideA,
      selectedMemberSkillIds: [FIRST],
      simulationWeaponLevels: { [BODY_HERO]: weaponLevel },
      // Older saved payloads can contain an entire body hero; only slot 1 is read.
      bodyHero: { heroId: BODY_HERO, weaponLevel,
        skillLevels: { [SECOND]: 5, [THIRD]: 5 },
        stats: { attack: 9999 } },
    },
  };
}

describe("rally body skill boundary", () => {
  it("converts the exact source into a slot-1-only body config", () => {
    expect(resolveBodySkillConfigs([FIRST], [], "s1_t10")).toEqual([{
      heroId: BODY_HERO, heroDefinitionId: BODY_HERO, runtimeInstanceId: "A-body-0",
      skillId: FIRST, expeditionSkillSlot: 1, skillLevel: 5,
    }]);
    expect(() => resolveBodySkillConfigs([SECOND], [], "s1_t10"))
      .toThrow(/unavailable/);
    expect(resolveBodySkillConfigs([FIRST, FIRST, FIRST, FIRST], [BODY_HERO], "s1_t10"))
      .toHaveLength(4);
  });

  it("ignores a body's weapon level, weapon skill, other skills and legacy hero data", () => {
    const zero = rallyInput(0);
    const max = rallyInput(10);
    const scenarioZero = toEngineScenario(zero);
    const scenarioMax = toEngineScenario(max);
    expect(scenarioMax.sideA).toEqual(scenarioZero.sideA);
    const member = scenarioMax.sideA.heroes?.find((hero) => hero.position === "member");
    expect(member).toEqual({ heroId: BODY_HERO, heroDefinitionId: BODY_HERO,
      runtimeInstanceId: "A-body-0", position: "member",
      selectedMemberSkillId: FIRST, skillLevels: { [FIRST]: 5 } });

    const stateZero = createValidationPreviewState(zero);
    const stateMax = createValidationPreviewState(max);
    expect(stateMax.sideA).toEqual(stateZero.sideA);
    expect(stateMax.sideA.heroStatCorrection?.simulationHeroIds).toEqual([]);
    expect(stateMax.sideA.heroStates[0]?.weaponLevel).toBe(0);
    expect(stateMax.sideA.heroStates[0]?.skillStates.map((skill) => skill.skillId))
      .toEqual([FIRST]);

    const trace = JSON.stringify(runValidationBattle(max).trace);
    expect(trace).toContain(FIRST);
    for (const excluded of [SECOND, THIRD, WEAPON]) {
      expect(trace).not.toContain(excluded);
    }
  });

  it("runs four identical manual body slots as four member skill sources", () => {
    const base = rallyInput(10);
    const selectedMemberSkillIds = [FIRST, FIRST, FIRST, FIRST];
    const configured = { ...base, sideA: { ...base.sideA,
      selectedMemberSkillIds,
      bodySkills: resolveBodySkillConfigs(selectedMemberSkillIds, [], "s1_t10") } };
    const state = createValidationPreviewState(configured);
    expect(state.sideA.heroStates.filter((hero) => hero.position === "member"))
      .toHaveLength(4);
    expect(runValidationBattle(configured).trace.rounds.length).toBeGreaterThan(0);
  });

  it("keeps member loadouts weapon free even when called directly", () => {
    const state = createConfirmedHeroState({ heroId: BODY_HERO,
      position: "member", selectedMemberSkillId: FIRST, weaponLevel: 10,
      skillLevels: { [FIRST]: 5, [SECOND]: 5, [THIRD]: 5 } });
    expect(state.weaponLevel).toBe(0);
    expect(state.skillStates.map((skill) => skill.skillId)).toEqual([FIRST]);
  });

  it("does not carry body skills into a non-rally scenario", () => {
    const input = rallyInput(10);
    const scenario = toEngineScenario({ ...input, scenarioType: "SINGLE",
      battleContext: "challenge" });
    expect(scenario.sideA.heroes?.some((hero) => hero.position === "member"))
      .toBe(false);
  });
});
