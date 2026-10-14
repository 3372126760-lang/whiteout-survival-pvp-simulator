import { CONFIRMED_HERO_SKILL_DEFINITIONS, DEFAULT_HERO_SKILL_LEVEL } from "../heroSkills";
import type { ServerStageId } from "../progression";
import { getAvailableMemberSkills } from "./catalog";
import { bodyRuntimeId } from "../heroSkills/identity";
import type { SideId } from "../types/combat";

/** The only battle-facing data retained for a rally body slot. */
export interface BodySkillConfig {
  readonly heroId: string;
  readonly heroDefinitionId?: string;
  readonly runtimeInstanceId?: string;
  readonly skillId: string;
  readonly expeditionSkillSlot: 1;
  readonly skillLevel: number;
}

export function resolveBodySkillConfigs(
  selectedSkillIds: readonly string[],
  _reservedLeaderIds: readonly string[],
  stageId: ServerStageId,
  side: SideId = "A",
): readonly BodySkillConfig[] {
  if (selectedSkillIds.length > 4) {
    throw new RangeError("A battle side can select at most four member combat skills.");
  }
  const available = getAvailableMemberSkills(stageId);
  return selectedSkillIds.map((skillId, slot) => {
      const option = available.find((entry) => entry.sourceSkillIds.includes(skillId));
      const heroId = option?.sourceHeroIds[option.sourceSkillIds.indexOf(skillId)];
      if (heroId === undefined) {
        throw new RangeError(`Body skill ${skillId} is unavailable at server stage ${stageId}.`);
      }
      const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((entry) =>
        entry.id === skillId && entry.heroId === heroId);
      if (definition?.positionRule.kind !== "expeditionSkillSlot" ||
        definition.positionRule.expeditionSkillSlot !== 1 ||
        !definition.positionRule.allowedPositions.includes("member")) {
        throw new Error(`Body skill ${skillId} must be a member expedition skill 1.`);
      }
      return { heroId, heroDefinitionId: heroId, runtimeInstanceId: bodyRuntimeId(side, slot),
        skillId, expeditionSkillSlot: 1, skillLevel: DEFAULT_HERO_SKILL_LEVEL };
    });
}

export function validateBodySkillConfigs(
  configs: readonly BodySkillConfig[],
  reservedLeaderIds: readonly string[],
  stageId: ServerStageId,
  side: SideId = "A",
): readonly BodySkillConfig[] {
  const resolved = resolveBodySkillConfigs(configs.map((entry) => entry.skillId),
    reservedLeaderIds, stageId, side);
  const runtimeIds = new Set<string>();
  return configs.map((entry, index) => {
    const expected = resolved[index]!;
    const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((skill) =>
      skill.id === entry.skillId);
    if (entry.heroId !== expected.heroId ||
      entry.heroDefinitionId !== undefined && entry.heroDefinitionId !== expected.heroId ||
      entry.expeditionSkillSlot !== 1 ||
      !Number.isSafeInteger(entry.skillLevel) ||
      definition?.levelValues[entry.skillLevel] === undefined) {
      throw new RangeError(`Invalid body skill config: ${entry.skillId}.`);
    }
    const runtimeInstanceId = entry.runtimeInstanceId === undefined ||
      /^[AB]-body-\d+$/.test(entry.runtimeInstanceId)
      ? bodyRuntimeId(side, index) : entry.runtimeInstanceId;
    // Validate explicit IDs before canonical slot migration; never hide duplicates.
    const suppliedId = entry.runtimeInstanceId ?? runtimeInstanceId;
    if (!suppliedId.trim() || runtimeIds.has(suppliedId)) {
      throw new Error("Body runtimeInstanceId must be non-empty and unique per side.");
    }
    runtimeIds.add(suppliedId);
    return { heroId: entry.heroId, heroDefinitionId: entry.heroId, runtimeInstanceId,
      skillId: entry.skillId,
      expeditionSkillSlot: 1, skillLevel: entry.skillLevel };
  });
}
