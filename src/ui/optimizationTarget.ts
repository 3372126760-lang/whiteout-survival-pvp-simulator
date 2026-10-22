import type { OptimizationConfig } from "../pvp/optimizer/types";
import { TROOP_TYPES, type SideId } from "../pvp/types";
import type { ValidationBattleInput } from "../pvp/validationUi";

/** Existing saved rally configurations optimize A until they explicitly select B. */
export function rallyOptimizationSide(config: Pick<OptimizationConfig, "candidateSide">): SideId {
  return config.candidateSide ?? "A";
}

/** Display names follow scenario semantics; single and 333 sides have no rally role. */
export function optimizationTargetLabel(scenario: ValidationBattleInput["scenarioType"] | "single" | "333" | "rally" | "threeQueue",
  side: SideId): string {
  if (scenario === "CITY_DEFENSE") return side === "A" ? "单撞进攻方" : "守城防守方";
  return scenario === "RALLY" || scenario === "rally" ? side === "A" ? "集结进攻方" : "集结防守方" : `${side}方`;
}

/** Switching the candidate preserves effort/search settings, but fixed current
 * selections must be read from the newly optimized side. Protected candidates
 * were authored against the previous opponent and cannot cross that boundary. */
export function updateRallyOptimizationSide(input: ValidationBattleInput, config: OptimizationConfig,
  newSide: SideId): OptimizationConfig {
  if (newSide !== "A" && newSide !== "B") throw new RangeError("优化对象必须为 A 方或 B 方。");
  const changed = rallyOptimizationSide(config) !== newSide;
  if (!changed) return newSide === "B" && config.objectiveMode !== "singleWin" ?
    { ...config, candidateSide: newSide, objectiveMode: "singleWin" } : config;
  const own = newSide === "A" ? input.sideA : input.sideB;
  const constraints = { ...config.constraints };
  // A full locked head represents "fixed current head". Preserve partial
  // explicit locks as locks while binding their selected roles to the new side.
  if (constraints.fixedLeaders) constraints.fixedLeaders = Object.fromEntries(TROOP_TYPES.flatMap((troop) =>
    constraints.fixedLeaders?.[troop] === undefined ? [] : [[troop, own.leaderHeroIds?.[troop] ?? null]]));
  if (constraints.fixedBodyExact || constraints.fixedMemberSkillIds !== undefined) {
    const selected = own.bodySkills?.map((body) => body.skillId) ?? own.selectedMemberSkillIds;
    constraints.fixedMemberSkillIds = constraints.fixedBodyExact ? [...selected] : selected.slice(0, constraints.fixedMemberSkillIds?.length ?? 0);
  }
  const { protectedCandidates: previousSideReferences, ...rest } = config;
  void previousSideReferences;
  return { ...rest, constraints, candidateSide: newSide,
    ...(newSide === "B" ? { objectiveMode: "singleWin" as const } : {}) };
}
