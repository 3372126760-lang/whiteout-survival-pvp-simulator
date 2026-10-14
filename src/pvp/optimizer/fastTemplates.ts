import { createTroopState } from "../battle/createBattleState";
import { FastBattleMode, type FastTroopCounts } from "../battle/fastBattleMode";
import { CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS, createHeroSkillSystem } from "../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS, createSeededRandomSource,
  createTroopSkillSystem } from "../troopSkills";
import { createPureTroopBattleState, type PureTroopBattleScenario } from "../scenario/pureTroopScenario";
import { runThreeQueueScenarioFast, ThreeQueueUnresolvedError,
  type ThreeQueueScenarioConfig } from "../scenario/threeQueueScenario";
import { TROOP_TYPES } from "../types/combat";
import type { BattleSide } from "../types/battle";

/** Search/session scoped LRU: never shares mutable RNG between concurrent workers. */
export class TemplateCache<T> {
  private readonly entries = new Map<string, T>();
  builds = 0;
  hits = 0;
  constructor(private readonly limit = 128) {}
  get(key: string, create: () => T): T {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.hits += 1;
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry;
    }
    const value = create();
    this.builds += 1;
    this.entries.set(key, value);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }
}

function createQueueSkillTemplate() {
  let random = createSeededRandomSource(0);
  const sharedRandom = { next: () => random.next() };
  const troopSkillSystem = createTroopSkillSystem({
    definitions: CONFIRMED_TROOP_SKILL_DEFINITIONS, randomSource: sharedRandom,
    recordTrace: false,
  });
  const heroSkillSystem = createHeroSkillSystem({
    definitions: CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS, randomSource: sharedRandom,
    recordTrace: false,
  });
  return { troopSkillSystem, heroSkillSystem,
    reset(seed: number) { random = createSeededRandomSource(seed); } };
}

function compileQueueDuel(scenario: PureTroopBattleScenario,
  skills: ReturnType<typeof createQueueSkillTemplate>) {
  const template = createPureTroopBattleState(scenario);
  const { troopSkillSystem, heroSkillSystem } = skills;
  const withCounts = (side: BattleSide, counts: FastTroopCounts): BattleSide => ({
    ...side,
    initialTotalCount: counts.shield + counts.lancer + counts.marksman,
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      createTroopState(troop, { ...side.troops[troop], count: counts[troop],
        levelComposition: [{ level: side.troops[troop].troopLevel, aliveCount: counts[troop] }] })
    ])) as BattleSide["troops"],
  });
  return (seed: number, countsA: FastTroopCounts, countsB: FastTroopCounts) => {
    skills.reset(seed);
    const sideA = withCounts(template.sideA, countsA);
    const sideB = withCounts(template.sideB, countsB);
    return FastBattleMode.run({ ...template, sideA, sideB,
      fixedInitialMinTroops: Math.min(sideA.initialTotalCount, sideB.initialTotalCount) },
    { maxRounds: scenario.maxRounds, troopSkillSystem, heroSkillSystem });
  };
}

/** Lazily builds at most nine static pair templates per three-queue candidate. */
export function compileFastThreeQueue(config: ThreeQueueScenarioConfig,
  skills = createQueueSkillTemplate()) {
  const pairs = new TemplateCache<ReturnType<typeof compileQueueDuel>>(9);
  return {
    pairs,
    run(seed: number, onBattleMeasured?: (elapsedMs: number) => void,
      onDuel?: (duel: { battleId: string; battleSeed: number; roundCount: number; outcome: string }) => void) {
      return runThreeQueueScenarioFast({ ...config, seed }, (scenario, battleSeed) => {
        const counts = (side: PureTroopBattleScenario["sideA"]): FastTroopCounts => ({
          shield: side.shield.count, lancer: side.lancer.count, marksman: side.marksman.count,
        });
        // Battle number and surviving populations vary; heroes/attributes/levels do not.
        const pairId = scenario.id.slice(scenario.id.lastIndexOf(":") + 1);
        const run = pairs.get(pairId, () => compileQueueDuel(scenario, skills));
        const start = onBattleMeasured === undefined ? 0 : performance.now();
        const trial = run(battleSeed, counts(scenario.sideA), counts(scenario.sideB));
        onDuel?.({ battleId: scenario.id, battleSeed, roundCount: trial.roundCount, outcome: trial.outcome });
        onBattleMeasured?.(performance.now() - start);
        if (trial.outcome !== "A" && trial.outcome !== "B") {
          throw new ThreeQueueUnresolvedError(scenario.id);
        }
        return { winner: trial.outcome, attackerSurvivors: trial.remaining.A,
          defenderSurvivors: trial.remaining.B, roundCount: trial.roundCount };
      });
    },
  };
}

export function createFastThreeQueueCompiler() {
  const skills = createQueueSkillTemplate();
  return (config: ThreeQueueScenarioConfig) => compileFastThreeQueue(config, skills);
}
