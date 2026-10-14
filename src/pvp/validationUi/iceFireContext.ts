import { DEFAULT_EXTERNAL_BUFF_CONFIG, type ExternalBuffConfig } from "../externalBuffs";
import { GARETH_FOURTH_SKILL_ID, resolveExpertSkillEffect } from "../externalBuffs/expertSkills";
import type { ValidationBattleInput, ValidationSideInput, IceFireSideSharedContext } from "./types";

export function isIceFireInput(input: ValidationBattleInput): boolean {
  return input.scenarioType === "ICE_FIRE_LEAGUE" || input.scenarioType === "THREE_QUEUE" && input.threeQueueMode === "ICE_FIRE_LEAGUE";
}
export function iceFireSharedContext(side: ValidationSideInput): IceFireSideSharedContext {
  if (side.shared) return side.shared;
  const legacy = side.externalBuffs ?? side.threeQueues?.find((q) => q.externalBuffs)?.externalBuffs ?? DEFAULT_EXTERNAL_BUFF_CONFIG;
  const different = side.threeQueues?.some((q) => q.externalBuffs &&
    JSON.stringify([q.externalBuffs.pet, q.externalBuffs.expert]) !== JSON.stringify([legacy.pet, legacy.expert]));
  return { petContext: legacy.pet, expertContext: legacy.expert,
    ...(different ? { migrationWarnings: ["旧队列宠物/专家配置不一致，已采用本侧配置或首队配置作为共享值，请核对。"] } : {}) };
}
export function iceFireExternalConfig(side: ValidationSideInput): ExternalBuffConfig {
  const shared = iceFireSharedContext(side);
  return { town: DEFAULT_EXTERNAL_BUFF_CONFIG.town, pet: shared.petContext, expert: shared.expertContext };
}
export function iceFireExpertSkillAudit(side: ValidationSideInput) {
  const resolved = resolveExpertSkillEffect(GARETH_FOURTH_SKILL_ID, iceFireSharedContext(side).expertContext.garethFourthSkillLevel);
  return { expertSkillId: resolved.skillId, expertSkillLevel: resolved.level,
    resolvedExpertSkillEffects: resolved.effects, resolvedExpertSkillDisplay: resolved.displayText,
    expertSkillEffectResolved: resolved.effectResolved };
}
/** Storage contains one context, not three copied queue inputs. */
export function normalizeIceFireShared(input: ValidationBattleInput): ValidationBattleInput {
  if (!isIceFireInput(input)) return input;
  const normalize = (side: ValidationSideInput): ValidationSideInput => {
    const { externalBuffs: _old, ...rest } = side;
    void _old;
    return { ...rest, shared: iceFireSharedContext(side),
      ...(side.threeQueues ? { threeQueues: side.threeQueues.map((queue) => {
        const { externalBuffs: _external, ...local } = queue;
        void _external; return local;
      }) as unknown as NonNullable<ValidationSideInput["threeQueues"]> } : {}) };
  };
  return { ...input, sideA: normalize(input.sideA), sideB: normalize(input.sideB) };
}
