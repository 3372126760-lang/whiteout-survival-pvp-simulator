import { CONFIRMED_HERO_SKILL_DEFINITIONS, type HeroSkillDefinition } from "../heroSkills";
import { isBattleContextAllowedForSide, type BattleContext, type BattleState, type SideId } from "../types";
import type { ValidationBattleInput } from "../validationUi";

export type OptimizationBattleScenario = "single" | "333" | "cityDefense" | "rally" | "threeQueue";
export type RallyOptimizationRole = "attacker" | "defender";
/** Candidate identity is independent of role. SINGLE/333/ThreeQueue have no
 * attack/defense role. The formal rally adapter currently maps A to attack and
 * B to defense; changing the optimized side never swaps the battle input. */
export interface OptimizationContext {
  readonly battleScenario: OptimizationBattleScenario;
  readonly candidateSide: SideId;
  readonly rallyRole: RallyOptimizationRole | null;
  readonly fixedOpponentSide: SideId;
  readonly optimizationObjective: "candidateSideWinRate";
}
export function createOptimizationContext(input: Pick<ValidationBattleInput, "scenarioType" | "battleContext">,
  candidateSide: SideId = "A"): OptimizationContext {
  const battleScenario: OptimizationBattleScenario = input.scenarioType === "CITY_DEFENSE" ? "cityDefense" : input.scenarioType === "RALLY" ? "rally" :
    input.scenarioType === "THREE_QUEUE" ? "threeQueue" : input.scenarioType === "THREE_THREE_THREE" ? "333" : "single";
  return { battleScenario, candidateSide, rallyRole: battleScenario === "rally" || battleScenario === "cityDefense" ? candidateSide === "A" ? "attacker" : "defender" : null,
    fixedOpponentSide: candidateSide === "A" ? "B" : "A", optimizationObjective: "candidateSideWinRate" };
}
/** Same context as toEngineScenario; explicit legacy contexts remain available
 * to standalone formal-state tests, but the normal rally adapter uses rally. */
export function optimizationBattleContext(context: OptimizationContext): BattleContext {
  return context.battleScenario === "cityDefense" ? "cityDefense" : context.battleScenario === "rally" ? "rally" : "challenge";
}
export interface OptimizationContextAudit {
  readonly battleScenario: OptimizationBattleScenario;
  readonly candidateSide: SideId;
  readonly candidateRole: RallyOptimizationRole | null;
  readonly fixedOpponentSide: SideId;
  readonly optimizationObjective: "candidateSideWinRate";
}
export function optimizationContextAudit(context: OptimizationContext): OptimizationContextAudit {
  return { battleScenario: context.battleScenario, candidateSide: context.candidateSide,
    candidateRole: context.rallyRole, fixedOpponentSide: context.fixedOpponentSide,
    optimizationObjective: context.optimizationObjective };
}
/** This is role/context eligibility, not a promise that a probabilistic or
 * periodic effect has fired. Disabled and missing-level effects are separately
 * listed as inactive, using the actual formal runtime binding when available. */
export interface SkillRoleApplicability {
  readonly skillId: string;
  readonly activeInCurrentRole: boolean;
  readonly reason: "activeInCurrentRole" | "inactiveInCurrentRallyRole" | "inactiveInCurrentScenario" | "disabled" | "levelValueMissing";
  readonly activeEffectIds: readonly string[];
  readonly inactiveEffectIds: readonly string[];
}
export function skillRoleApplicability(definition: HeroSkillDefinition, level: number,
  context: OptimizationContext, enabled = true, battleContext = optimizationBattleContext(context)): SkillRoleApplicability {
  const effects = definition.levelValues[level]?.effects ?? [], ids = effects.map((effect) => effect.id);
  const roleMatches = isBattleContextAllowedForSide(definition.battleContexts, battleContext, context.candidateSide);
  const reason: SkillRoleApplicability["reason"] = !enabled ? "disabled" : !definition.levelValues[level] ? "levelValueMissing" :
    !roleMatches ? context.rallyRole === null ? "inactiveInCurrentScenario" : "inactiveInCurrentRallyRole" : "activeInCurrentRole";
  const activeInCurrentRole = reason === "activeInCurrentRole";
  return { skillId: definition.id, activeInCurrentRole, reason,
    activeEffectIds: activeInCurrentRole ? ids : [], inactiveEffectIds: activeInCurrentRole ? [] : ids };
}
export interface OptimizationEffectRoleRow extends SkillRoleApplicability {
  readonly heroDefinitionId: string;
  readonly runtimeInstanceId: string;
  readonly level: number;
  readonly source: "head" | "weapon" | "body";
}
export interface OptimizationRoleAudit extends OptimizationContextAudit {
  readonly headEffectsActiveByRole: readonly string[];
  readonly headEffectsInactiveByRole: readonly string[];
  readonly weaponEffectsActiveByRole: readonly string[];
  readonly weaponEffectsInactiveByRole: readonly string[];
  readonly bodyEffectsActiveByRole: readonly string[];
  readonly bodyEffectsInactiveByRole: readonly string[];
  readonly roleEffectApplicability: readonly OptimizationEffectRoleRow[];
}
/** Reads formal prepared state, preserving true skill tiers and instance IDs. */
export function auditOptimizationRoleState(state: BattleState, context: OptimizationContext,
  definitions: readonly HeroSkillDefinition[] = CONFIRMED_HERO_SKILL_DEFINITIONS,
  disabledSkillIds: readonly string[] = []): OptimizationRoleAudit {
  const registry = new Map(definitions.map((definition) => [definition.id, definition]));
  const own = context.candidateSide === "A" ? state.sideA : state.sideB;
  const rows = own.heroStates.flatMap((hero) => hero.skillStates.flatMap((runtime): OptimizationEffectRoleRow[] => {
    const definition = registry.get(runtime.skillId); if (!definition) return [];
    return [{ ...skillRoleApplicability(definition, runtime.level, context, runtime.enabled && !disabledSkillIds.includes(runtime.skillId), state.battleContext),
      heroDefinitionId: hero.heroDefinitionId ?? hero.heroId, runtimeInstanceId: hero.runtimeInstanceId ?? hero.heroId,
      level: runtime.level, source: hero.position === "member" ? "body" :
        definition.positionRule.kind === "exclusiveWeapon" ? "weapon" : "head" }];
  }));
  const ids = (source: OptimizationEffectRoleRow["source"], active: boolean) => [...new Set(rows.filter((row) => row.source === source)
    .flatMap((row) => active ? row.activeEffectIds : row.inactiveEffectIds))].sort();
  return { ...optimizationContextAudit(context), headEffectsActiveByRole: ids("head", true), headEffectsInactiveByRole: ids("head", false),
    weaponEffectsActiveByRole: ids("weapon", true), weaponEffectsInactiveByRole: ids("weapon", false),
    bodyEffectsActiveByRole: ids("body", true), bodyEffectsInactiveByRole: ids("body", false), roleEffectApplicability: rows };
}
