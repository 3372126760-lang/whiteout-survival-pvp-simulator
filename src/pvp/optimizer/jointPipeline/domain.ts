import { TROOP_TYPES } from "../../types";
import { resolveBodySkillConfigs, validationStageId } from "../../validationUi";
import { resolveSearchDimensions } from "../searchDimensions";
import type { OptimizationConfig, OptimizationInput } from "../types";

/** Shared by the real workflow and complete-fixture export; frozen Body heroes
 * must not accidentally become requirements for the independent Head domain. */
export function jointHeadPolicy(input: OptimizationInput, config: OptimizationConfig) {
  const side = config.candidateSide ?? "A", own = input[side === "A" ? "sideA" : "sideB"];
  const dimensions = resolveSearchDimensions(input, { side,
    fixedHead: TROOP_TYPES.every((troop) => config.constraints.fixedLeaders?.[troop] !== undefined),
    fixedBody: config.constraints.fixedBodyExact === true || config.constraints.fixedMemberSkillIds?.length === 4 });
  const fixedBodyIds = config.constraints.fixedMemberSkillIds ?? own.bodySkills?.map((body) => body.skillId) ?? own.selectedMemberSkillIds;
  const fixedBodyHeroes = dimensions.bodySearchEnabled ? [] : resolveBodySkillConfigs(fixedBodyIds, [], validationStageId(input), side).map((body) => body.heroId);
  const headConstraints = dimensions.bodySearchEnabled ? config.constraints : { ...config.constraints,
    fixedBodyExact: true, fixedMemberSkillIds: [],
    ...(config.constraints.requiredHeroIds ? { requiredHeroIds: config.constraints.requiredHeroIds.filter((id) => !fixedBodyHeroes.includes(id)) } : {}) };
  return { dimensions, headConstraints };
}
