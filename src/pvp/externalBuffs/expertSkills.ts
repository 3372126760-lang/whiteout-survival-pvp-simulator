import type { ReportAttribute } from "./types";

export const GARETH_FOURTH_SKILL_ID = "expert.gareth.penetration";

export interface ExpertSkillEffect {
  readonly attribute: ReportAttribute;
  readonly effectTarget: "self" | "enemy";
  readonly troopScope: "all";
  readonly category: "buff" | "debuff";
  readonly multiplierGroup: "externalBuff" | "externalDebuff";
  /** Decimal rate, not percentage points. */
  readonly value: number;
}

export interface ExpertSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly levels: Readonly<Record<number, readonly ExpertSkillEffect[] | undefined>>;
}

// Preserve the existing PVP Gareth rule (level * .0025) exactly as an explicit
// level table. No new skill values are inferred or supplied by the UI.
const garethRates = [
  0, .0025, .005, .0075, .01, .0125, .015, .0175, .02, .0225,
  .025, .0275, .03, .0325, .035, .0375, .04, .0425, .045, .0475, .05,
] as const;

export const EXPERT_SKILL_DEFINITIONS: Readonly<Record<string, ExpertSkillDefinition | undefined>> = {
  [GARETH_FOURTH_SKILL_ID]: {
    name: "加雷斯四技能",
    description: "降低敌方全军穿透力，属于外部穿透减益乘区。",
    levels: Object.fromEntries(garethRates.map((value, level) => [level, [{
      attribute: "penetration", effectTarget: "enemy", troopScope: "all",
      category: "debuff", multiplierGroup: "externalDebuff", value,
    } satisfies ExpertSkillEffect]])),
  },
};

interface ResolvedExpertSkillBase {
  readonly skillId: string;
  readonly skillName: string;
  readonly level: number;
  readonly displayText: string;
  readonly effectText: string;
}
export type ResolvedExpertSkillEffect = ResolvedExpertSkillBase & (
  { readonly effectResolved: true; readonly effects: readonly ExpertSkillEffect[] } |
  { readonly effectResolved: false; readonly effects: null }
);

const attributes: Readonly<Record<ReportAttribute, string>> = {
  attack: "攻击", defense: "防御", penetration: "穿透", life: "生命",
};
const percent = (value: number) => `${(value * 100).toFixed(2).replace(/0$/, "")}%`;

export function expertSkillLevels(skillId: string): readonly number[] {
  return Object.keys(EXPERT_SKILL_DEFINITIONS[skillId]?.levels ?? {}).map(Number).sort((a, b) => a - b);
}

/** Shared by display and the external-attribute resolver used by all evaluators. */
export function resolveExpertSkillEffect(skillId: string, level: number): ResolvedExpertSkillEffect {
  const definition = EXPERT_SKILL_DEFINITIONS[skillId];
  const effects = Number.isSafeInteger(level) && level >= 0 ? definition?.levels[level] : undefined;
  if (!effects?.length || effects.some((effect) => !Number.isFinite(effect.value) || effect.value < 0)) {
    return { skillId, skillName: definition?.name ?? skillId, level, effectResolved: false,
      effects: null, displayText: `Lv${level} · 数值未配置`, effectText: "数值未配置，无法用于战斗或优化计算。" };
  }
  const effectText = effects.map((effect) =>
    `${effect.effectTarget === "enemy" ? "敌方" : "我方"}全军${attributes[effect.attribute]}${effect.category === "debuff" ? "降低" : "提升"}${percent(effect.value)}`).join("；");
  const summary = effects.length === 1 ? percent(effects[0]!.value) : effectText;
  return { skillId, skillName: definition!.name, level, effects, effectResolved: true,
    displayText: `Lv${level} · ${summary}`, effectText };
}

export class UnresolvedExpertSkillEffectError extends RangeError {
  constructor(readonly resolution: ResolvedExpertSkillEffect) {
    super(`${resolution.skillName} ${resolution.displayText}；expertSkillEffectResolved=false，不能使用默认等级或零值。`);
    this.name = "UnresolvedExpertSkillEffectError";
  }
}
