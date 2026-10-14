import { createBattleState } from "../battle/createBattleState";
import {
  simulateBattle,
  type BattleSimulationResult,
} from "../battle/simulateBattle";
import { calculateTroopHp, type TroopHpFormulaResult } from "../formulas";
import { resolveTroopConstant } from "../data";
import { formatBattleTrace } from "../logging";
import { deriveExpectedReportAttribute } from "../validationUi/expectedReportAttribute";
import type { BattleReportAttributeModifiers } from "../externalBuffs";
import type { BattleState, BattleSideSetup } from "../types/battle";
import type { BattleContext, SideId, TroopType } from "../types/combat";
import type { TroopSetup } from "../types/troop";
import type { TroopLevelCompositionEntry } from "../types/troop";
import type {
  CasualtyRoundingStrategy,
  MixedLevelCasualtyAllocationStrategy,
  OverflowDamageStrategy,
} from "../strategies";
import {
  CONFIRMED_TROOP_SKILL_DEFINITIONS,
  createConfirmedTroopSkillLoadout,
  createTroopSkillSystem,
  type RandomSource,
  type TroopSkillTriggerOverrides,
} from "../troopSkills";
import {
  CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS,
  createConfirmedHeroFormation,
  createHeroSkillSystem,
  calculateHeroStatCorrection,
  type HeroFormationInput,
  type HeroStatCorrection,
  type HeroStatLineupEntry,
  type HeroSkillTriggerOverrides,
} from "../heroSkills";

export interface PureTroopScenarioTroopInput {
  readonly count: number;
  readonly attack: number;
  readonly penetration: number;
  readonly defense: number;
  readonly life: number;
  readonly troopLevel: string;
  readonly troopConstant: number;
  readonly damageCoefficient: number;
  readonly levelComposition?: readonly TroopLevelCompositionEntry[];
  readonly t12Level?: number;
}

export interface PureTroopScenarioSideInput {
  readonly shield: PureTroopScenarioTroopInput;
  readonly lancer: PureTroopScenarioTroopInput;
  readonly marksman: PureTroopScenarioTroopInput;
  /** Optional heroes; omitting this preserves the original pure-troop mode. */
  readonly heroes?: readonly HeroFormationInput[];
  /** Heroes already included in the entered battle-report attributes. */
  readonly reportHeroIds?: readonly string[];
  /** Preferred report lineup form when exclusive-weapon levels are known. */
  readonly reportHeroes?: readonly HeroStatLineupEntry[];
  /** Report-panel special buff/debuff inputs, resolved after hero additive correction. */
  readonly reportAttributeModifiers?: BattleReportAttributeModifiers;
  /** Current battle context only: additive points and multiplicative special groups. */
  readonly targetBattleBonuses?: Readonly<Record<TroopType,
    Readonly<Record<"attack" | "defense" | "penetration" | "life",
      { readonly additive: number; readonly buff: number; readonly debuff: number }>>>>;
  /** Final report values already include static heroes, equipment and external buffs. */
  readonly attributeInputMode?: "finalReport" | "prediction";
}

export interface PureTroopBattleScenario {
  readonly id: string;
  readonly sideA: PureTroopScenarioSideInput;
  readonly sideB: PureTroopScenarioSideInput;
  readonly maxRounds: number;
  readonly battleContext?: BattleContext;
  /** Legacy explicit debug switch; normal skill mode uses confirmed 20% RNG. */
  readonly ambushTriggered?:
    | boolean
    | Readonly<Partial<Record<SideId, boolean>>>;
}

export interface PureTroopScenarioRunOptions {
  readonly casualtyRoundingStrategy?: CasualtyRoundingStrategy;
  readonly overflowDamageStrategy?: OverflowDamageStrategy;
  readonly mixedLevelCasualtyAllocationStrategy?: MixedLevelCasualtyAllocationStrategy;
  readonly randomSource?: RandomSource;
  readonly triggerOverrides?: TroopSkillTriggerOverrides;
  readonly heroTriggerOverrides?: HeroSkillTriggerOverrides;
}

export interface PureTroopScenarioResult {
  readonly scenario: PureTroopBattleScenario;
  readonly initialState: BattleState;
  readonly hpBySide: Readonly<
    Record<SideId, Readonly<Record<TroopType, TroopHpFormulaResult>>>
  >;
  readonly simulation: BattleSimulationResult;
  readonly readableTrace: string;
}

export function createPureTroopBattleState(
  scenario: PureTroopBattleScenario,
): BattleState {
  if (!scenario.id.trim()) throw new Error("Scenario id cannot be empty.");
  return createBattleState({
    sideA: toBattleSideSetup(scenario.sideA),
    sideB: toBattleSideSetup(scenario.sideB),
    battleContext: scenario.battleContext ?? "unspecified",
  });
}

export function runPureTroopBattleScenario(
  scenario: PureTroopBattleScenario,
  options: PureTroopScenarioRunOptions = {},
): PureTroopScenarioResult {
  const initialState = createPureTroopBattleState(scenario);
  const hasTroopSkills = [initialState.sideA, initialState.sideB].some((side) =>
    Object.values(side.troops).some((troop) => troop.skillStates.length > 0),
  );
  const hasHeroSkills = [initialState.sideA, initialState.sideB].some((side) =>
    side.heroStates.some((hero) => hero.skillStates.length > 0),
  );
  const simulation = simulateBattle(initialState, {
    maxRounds: scenario.maxRounds,
    ...(scenario.ambushTriggered === undefined
      ? {}
      : { ambushTriggered: scenario.ambushTriggered }),
    ...(options.casualtyRoundingStrategy === undefined
      ? {}
      : { casualtyRoundingStrategy: options.casualtyRoundingStrategy }),
    ...(options.overflowDamageStrategy === undefined
      ? {}
      : { overflowDamageStrategy: options.overflowDamageStrategy }),
    ...(options.mixedLevelCasualtyAllocationStrategy === undefined
      ? {}
      : {
          mixedLevelCasualtyAllocationStrategy:
            options.mixedLevelCasualtyAllocationStrategy,
        }),
    ...(hasTroopSkills
      ? {
          troopSkillSystem: createTroopSkillSystem({
            definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS,
            ...(options.randomSource === undefined
              ? {}
              : { randomSource: options.randomSource }),
            ...(options.triggerOverrides === undefined
              ? {}
              : { triggerOverrides: options.triggerOverrides }),
          }),
        }
      : {}),
    ...(hasHeroSkills
      ? {
          heroSkillSystem: createHeroSkillSystem({
            definitions: CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS,
            ...(options.randomSource === undefined
              ? {}
              : { randomSource: options.randomSource }),
            ...(options.heroTriggerOverrides === undefined
              ? {}
              : { triggerOverrides: options.heroTriggerOverrides }),
          }),
        }
      : {}),
  });
  return {
    scenario,
    initialState,
    hpBySide: {
      A: calculateStateHp(initialState.sideA),
      B: calculateStateHp(initialState.sideB),
    },
    simulation,
    readableTrace: formatBattleTrace(simulation.trace),
  };
}

function toBattleSideSetup(input: PureTroopScenarioSideInput): BattleSideSetup {
  const finalReport = input.attributeInputMode === "finalReport";
  const heroStates = createConfirmedHeroFormation((input.heroes ?? []).map((hero) =>
    finalReport ? { ...hero, weaponLevel: 0 } : hero));
  const reportHeroes = finalReport ? undefined : input.reportHeroes ?? input.reportHeroIds;
  const correction = reportHeroes === undefined
    ? undefined
    : calculateHeroStatCorrection(
        reportHeroes,
        heroStates.filter((hero) => hero.position === "leader").map((hero) => ({
          heroId: hero.heroId,
          weaponLevel: hero.weaponLevel,
        })),
      );
  return {
    troops: {
      shield: toTroopSetup("shield", input.shield, correction, finalReport ? undefined : input.reportAttributeModifiers,
        finalReport ? undefined : input.targetBattleBonuses),
      lancer: toTroopSetup("lancer", input.lancer, correction, finalReport ? undefined : input.reportAttributeModifiers,
        finalReport ? undefined : input.targetBattleBonuses),
      marksman: toTroopSetup("marksman", input.marksman, correction, finalReport ? undefined : input.reportAttributeModifiers,
        finalReport ? undefined : input.targetBattleBonuses),
    },
    armyEffects: [],
    heroStates,
    ...(correction === undefined ? {} : { heroStatCorrection: correction }),
  };
}

function toTroopSetup(
  troopType: TroopType,
  input: PureTroopScenarioTroopInput,
  correction: HeroStatCorrection | undefined,
  reportAttributeModifiers: BattleReportAttributeModifiers | undefined,
  targetBattleBonuses: PureTroopScenarioSideInput["targetBattleBonuses"],
): TroopSetup {
  const delta = correction?.delta[troopType];
  const modifiers = reportAttributeModifiers ?? ZERO_REPORT_ATTRIBUTE_MODIFIERS;
  const attributes = ["attack", "defense", "penetration", "life"] as const;
  const reportAttributeContext = Object.fromEntries(attributes.map((attribute) => {
    const target = targetBattleBonuses?.[troopType][attribute];
    return [attribute, {
      raw: input[attribute] * 100, formationDelta: (delta?.[attribute] ?? 0) * 100,
      targetAdditive: target?.additive ?? 0,
      targetBuff: target === undefined ? modifiers.selfBuffs[attribute] : target.buff / 100,
      targetDebuff: target === undefined ? modifiers.receivedDebuffs[attribute] : target.debuff / 100,
    }];
  })) as NonNullable<TroopSetup["reportAttributeContext"]>;
  const attributeBonus = (attribute: typeof attributes[number]): number =>
    deriveExpectedReportAttribute(reportAttributeContext[attribute]) / 100;
  return {
    count: input.count,
    attack: attributeBonus("attack"),
    penetration: attributeBonus("penetration"),
    defense: attributeBonus("defense"),
    life: attributeBonus("life"),
    reportAttributeContext,
    troopLevel: input.troopLevel,
    troopConstant: resolveTroopConstant(input.troopLevel, input.troopConstant),
    ...(input.levelComposition === undefined
      ? {}
      : { levelComposition: input.levelComposition }),
    damageCoefficient: input.damageCoefficient,
    buffs: [],
    debuffs: [],
    skillStates: createConfirmedTroopSkillLoadout(
      troopType,
      input.troopLevel,
      input.t12Level ?? 0,
    ),
  };
}

const ZERO_REPORT_ATTRIBUTE_MODIFIERS: BattleReportAttributeModifiers = {
  selfBuffs: { attack: 0, defense: 0, penetration: 0, life: 0 },
  receivedDebuffs: { attack: 0, defense: 0, penetration: 0, life: 0 },
};

function calculateStateHp(
  side: BattleState["sideA"],
): Readonly<Record<TroopType, TroopHpFormulaResult>> {
  return {
    shield: calculateStateTroopHp(side.troops.shield),
    lancer: calculateStateTroopHp(side.troops.lancer),
    marksman: calculateStateTroopHp(side.troops.marksman),
  };
}

function calculateStateTroopHp(
  troop: BattleState["sideA"]["troops"][TroopType],
): TroopHpFormulaResult {
  return calculateTroopHp({
    troopConstant: troop.troopConstant,
    troopHpCoefficient: troop.troopHpCoefficient,
    defense: troop.defense,
    life: troop.life,
  });
}
