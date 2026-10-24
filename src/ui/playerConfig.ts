import { DEFAULT_HERO_SKILL_LEVEL } from "../pvp/heroSkills/runtime";
import type { ValidationBattleInput, ValidationQueueConfig, ValidationSideInput } from "../pvp/validationUi/types";
import { createDefaultValidationInput } from "./defaultInput";

/** New player sessions start randomly; restored preferences keep their saved mode. */
export function createPlayerDefaultInput(): ValidationBattleInput {
  return { ...createDefaultValidationInput(), simulationMode: "random" };
}

/** Apply the player policy to the one canonical input, including older saved overrides.
 * Developer sessions bypass this function; the engine's omitted-level default stays Lv5. */
export function normalizePlayerHeroLevels(input: ValidationBattleInput): ValidationBattleInput {
  const levels = (value: Readonly<Record<string, number>>) => Object.values(value).every((level) => level === DEFAULT_HERO_SKILL_LEVEL)
    ? value : Object.fromEntries(Object.keys(value).map((id) => [id, DEFAULT_HERO_SKILL_LEVEL]));
  const side = (value: ValidationSideInput): ValidationSideInput => {
    const leaderSkillLevels = value.leaderSkillLevels === undefined ? undefined : levels(value.leaderSkillLevels);
    const bodySkills = value.bodySkills?.every((body) => body.skillLevel === DEFAULT_HERO_SKILL_LEVEL)
      ? value.bodySkills : value.bodySkills?.map((body) => ({ ...body, skillLevel: DEFAULT_HERO_SKILL_LEVEL }));
    const queues = value.threeQueues?.map((queue) => {
      const heroSkillLevels = queue.heroSkillLevels === undefined ? undefined : levels(queue.heroSkillLevels);
      return heroSkillLevels === queue.heroSkillLevels ? queue : { ...queue, heroSkillLevels: heroSkillLevels! };
    }) as [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig] | undefined;
    const queuesChanged = queues?.some((queue, index) => queue !== value.threeQueues?.[index]) ?? false;
    if (leaderSkillLevels === value.leaderSkillLevels && bodySkills === value.bodySkills && !queuesChanged) return value;
    return { ...value,
      ...(leaderSkillLevels === undefined ? {} : { leaderSkillLevels }),
      ...(bodySkills === undefined ? {} : { bodySkills }),
      ...(!queuesChanged ? {} : { threeQueues: queues! }) };
  };
  const sideA = side(input.sideA), sideB = side(input.sideB);
  const rallyAttacks = input.rallyAttacks?.map(side);
  const changed = rallyAttacks?.some((value, i) => value !== input.rallyAttacks?.[i]);
  const rallySingleAttack = input.rallySingleAttack && side(input.rallySingleAttack);
  return sideA === input.sideA && sideB === input.sideB && !changed && rallySingleAttack === input.rallySingleAttack ? input : { ...input, sideA, sideB,
    ...(rallySingleAttack ? {rallySingleAttack} : {}),
    ...(changed ? { rallyAttacks: rallyAttacks! } : {}) };
}
