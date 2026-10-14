import { getTroopConstant } from "../data";
import { createSeededRandomSource } from "../troopSkills";
import { TROOP_TYPES, type SideId, type TroopType } from "../types/combat";
import { resolvePostBattleCasualties, type PostBattleCasualtyMode,
  type PostBattleCasualtyResult, type PostBattleGradeComposition } from "../postBattle";
import type { RallyTroopRatios } from "../validationUi/rallyDeployment";
import type { InnerEarthMode } from "../innerEarth/types";
import { highestConfiguredTroopLevel, type TroopCounts } from "./scenarioTypes";
import { allocateThreeQueueTroops, toThreeQueueBasisPoints,
  type TroopRatioBasisPoints } from "./threeQueueRatios";
import { runPureTroopBattleScenario, type PureTroopBattleScenario,
  type PureTroopScenarioResult, type PureTroopScenarioSideInput } from "./pureTroopScenario";
import { createThreeQueueScheduler, resolveThreeQueueMode, threeQueueSchedulerType,
  type ThreeQueueMode, type ThreeQueueScheduler, type ThreeQueueSchedulerType } from "./threeQueueScheduler";

export interface ThreeQueueConfig {
  readonly id: string;
  /** Exact preset allocation for Inner Earth enemies; avoids rounding repeating ratios to basis points. */
  readonly initialTroopCounts?: TroopCounts;
  /** Canonical exact ratio representation; sums to 10,000. */
  readonly ratiosBp?: TroopRatioBasisPoints;
  /** Legacy percentage representation, accepted when reading older configs. */
  readonly ratios?: RallyTroopRatios;
  /** Queue-specific levels; legacy configs use the player-level ceiling. */
  readonly troopLevels?: Readonly<Record<TroopType, string>>;
  /** Explicit imported real-level groups; absent retains legacy single-level queues. */
  readonly troopLevelCompositions?: Readonly<Partial<Record<TroopType,
    readonly { readonly level: string; readonly aliveCount: number }[]>>>;
  /** Player-level inputs and this queue's own leader lineup, already assembled. */
  readonly side: PureTroopScenarioSideInput;
}

export interface ThreeQueueSideConfig {
  /** Capacity of each of the three queues, not a shared three-queue pool. */
  readonly deploymentCapacity: number;
  /** Canonical player level ceiling, independently selected for each troop type. */
  readonly highestTroopLevels?: Readonly<Record<TroopType, string>>;
  /** Legacy shared ceiling, read only for older saved configs. */
  readonly highestTroopLevel?: string;
  /** Legacy unlocked-level list, read only for older saved configs. */
  readonly availableTroopLevels?: readonly string[];
  readonly queues: readonly [ThreeQueueConfig, ThreeQueueConfig, ThreeQueueConfig];
}

export interface ThreeQueueScenarioConfig {
  readonly battleScenario?: "THREE_QUEUE" | "ICE_FIRE_LEAGUE" | "INNER_EARTH";
  readonly innerEarthMode?: InnerEarthMode;
  readonly threeQueueMode?: ThreeQueueMode;
  readonly id: string;
  readonly seed: number;
  readonly maxRoundsPerBattle: number;
  readonly casualtyMode: PostBattleCasualtyMode;
  readonly attacker: ThreeQueueSideConfig;
  readonly defender: ThreeQueueSideConfig;
}

export interface ThreeQueueBattleResult {
  readonly battleNumber: number;
  readonly attackerQueueId: string;
  readonly defenderQueueId: string;
  readonly battleSeed: number;
  readonly winner: SideId;
  readonly battle: PureTroopScenarioResult;
  readonly attackerSurvivors: TroopCounts;
  readonly defenderSurvivors: TroopCounts;
}

export interface ThreeQueueSchedulerAudit {
    readonly battleScenario: "THREE_QUEUE" | "ICE_FIRE_LEAGUE" | "INNER_EARTH";
    readonly innerEarthMode: InnerEarthMode | null;
    readonly threeQueueMode: ThreeQueueMode;
    readonly schedulerType: ThreeQueueSchedulerType;
    readonly rule: ThreeQueueScheduler["rule"];
    readonly ruleStatus: ThreeQueueScheduler["ruleStatus"];
    readonly seed: number;
    readonly queueCursorA: number | null;
    readonly queueCursorB: number | null;
    readonly matchSequence: readonly string[];
    /** Zero-based cursors before the first duel and after each completed duel. */
    readonly cursorHistoryA: readonly (number | null)[];
    readonly cursorHistoryB: readonly (number | null)[];
}

export interface ThreeQueueScenarioTrace {
  readonly threeQueueScheduler: ThreeQueueSchedulerAudit;
  readonly battles: readonly {
    readonly battleIndex: number;
    readonly attackerQueueId: string;
    readonly defenderQueueId: string;
    readonly battleSeed: number;
    readonly attackerBefore: TroopCounts;
    readonly defenderBefore: TroopCounts;
    readonly attackerAfter: TroopCounts;
    readonly defenderAfter: TroopCounts;
    readonly winner: SideId;
    readonly eliminatedQueue: string;
    readonly queueCursorA: number | null;
    readonly queueCursorB: number | null;
    readonly nextQueueCursorA: number | null;
    readonly nextQueueCursorB: number | null;
  }[];
}

export interface ThreeQueueScenarioResult {
  readonly winner: SideId;
  readonly battleResults: readonly ThreeQueueBattleResult[];
  readonly initialAttackerOrder: readonly string[];
  readonly initialDefenderOrder: readonly string[];
  readonly remainingAttackerQueues: readonly { readonly id: string; readonly survivors: TroopCounts }[];
  readonly remainingDefenderQueues: readonly { readonly id: string; readonly survivors: TroopCounts }[];
  readonly totalBattles: number;
  readonly scenarioTrace: ThreeQueueScenarioTrace;
  readonly threeQueueScheduler: ThreeQueueScenarioTrace["threeQueueScheduler"] & {
    readonly battles: ThreeQueueScenarioTrace["battles"] };
  readonly aggregateCasualties: Readonly<Record<SideId, PostBattleCasualtyResult>>;
}

interface QueueState {
  readonly config: ThreeQueueConfig;
  readonly ratiosBp: TroopRatioBasisPoints;
  survivors: TroopCounts;
}

export class ThreeQueueUnresolvedError extends Error {
  constructor(battleId: string) {
    super(`Queue battle ${battleId} was inconclusive; increase maxRoundsPerBattle.`);
    this.name = "ThreeQueueUnresolvedError";
  }
}

export function resolveThreeQueueTroopLevels(config: ThreeQueueSideConfig):
  Readonly<Record<TroopType, string>> {
  if (config.highestTroopLevels !== undefined) {
    for (const troop of TROOP_TYPES) {
      highestConfiguredTroopLevel([config.highestTroopLevels[troop]]);
    }
    return config.highestTroopLevels;
  }
  const legacy = config.highestTroopLevel ?? highestConfiguredTroopLevel(
    config.availableTroopLevels ?? []);
  return { shield: legacy, lancer: legacy, marksman: legacy };
}

export interface ThreeQueueDuelResolution {
  readonly winner: SideId;
  readonly attackerSurvivors: TroopCounts;
  readonly defenderSurvivors: TroopCounts;
  readonly battle: PureTroopScenarioResult;
}

export interface FastThreeQueueDuelResolution {
  readonly winner: SideId;
  readonly attackerSurvivors: TroopCounts;
  readonly defenderSurvivors: TroopCounts;
  readonly roundCount: number;
}
export interface FastThreeQueueScenarioResult {
  /** At most five compact pair labels; no BattleTrace or damage/skill details. */
  readonly threeQueueScheduler: ThreeQueueSchedulerAudit;
  readonly winner: SideId;
  readonly totalBattles: number;
  readonly roundCount: number;
  readonly remaining: Readonly<Record<SideId, TroopCounts>>;
  readonly remainingQueues: Readonly<Record<SideId, readonly {
    readonly id: string; readonly survivors: TroopCounts }[]>>;
}

/** The optional executor is an injection seam for queue-control tests; production uses the single BattleEngine. */
export function runThreeQueueScenario(
  config: ThreeQueueScenarioConfig,
  executeBattle: (scenario: PureTroopBattleScenario, seed: number) => ThreeQueueDuelResolution =
    executeEngineBattle,
  scheduler: ThreeQueueScheduler = schedulerForConfig(config),
): ThreeQueueScenarioResult {
  return resolveThreeQueueScenario(config, executeBattle, true, scheduler) as ThreeQueueScenarioResult;
}

/** Uses the same queue scheduler while omitting battle/scenario traces and reports. */
export function runThreeQueueScenarioFast(config: ThreeQueueScenarioConfig,
  executeBattle: (scenario: PureTroopBattleScenario, seed: number) => FastThreeQueueDuelResolution,
  scheduler: ThreeQueueScheduler = schedulerForConfig(config),
): FastThreeQueueScenarioResult {
  return resolveThreeQueueScenario(config, executeBattle, false, scheduler) as FastThreeQueueScenarioResult;
}

function resolveThreeQueueScenario(config: ThreeQueueScenarioConfig,
  executeBattle: (scenario: PureTroopBattleScenario, seed: number) =>
    ThreeQueueDuelResolution | FastThreeQueueDuelResolution,
  retainTrace: boolean,
  scheduler: ThreeQueueScheduler,
): ThreeQueueScenarioResult | FastThreeQueueScenarioResult {
  if (!config.id.trim() || !Number.isSafeInteger(config.seed)) {
    throw new RangeError("Three-queue scenario needs an id and safe integer seed.");
  }
  if (!Number.isSafeInteger(config.maxRoundsPerBattle) || config.maxRoundsPerBattle < 1 ||
    config.maxRoundsPerBattle > 1500) {
    throw new RangeError("Invalid maximum rounds per queue battle.");
  }
  const attacker = prepareSide(config.attacker, "A");
  const defender = prepareSide(config.defender, "B");
  const random = createSeededRandomSource(config.seed ^ 0x4b3d_2719);
  const attackerOrder = attacker;
  const defenderOrder = defender;
  const initialAttackerOrder = attackerOrder.map((queue) => queue.config.id);
  const initialDefenderOrder = defenderOrder.map((queue) => queue.config.id);
  const aliveA = new Set(initialAttackerOrder);
  const aliveB = new Set(initialDefenderOrder);
  const battleResults: ThreeQueueBattleResult[] = [];
  const traces: ThreeQueueScenarioTrace["battles"][number][] = [];
  const matchSequence: string[] = [];
  const cursorHistoryA: (number | null)[] = [scheduler.queueCursorA ?? null];
  const cursorHistoryB: (number | null)[] = [scheduler.queueCursorB ?? null];
  let battleCount = 0;
  let roundCount = 0;

  const duel = (a: QueueState, b: QueueState, queueCursorA: number | null,
    queueCursorB: number | null): void => {
    const battleNumber = ++battleCount;
    const battleSeed = Math.floor(random.next() * 0x1_0000_0000);
    const attackerBefore = a.survivors;
    const defenderBefore = b.survivors;
    const scenario: PureTroopBattleScenario = {
      id: `${config.id}:battle-${battleNumber}:${a.config.id}-vs-${b.config.id}`,
      sideA: withCounts(a.config.side, attackerBefore),
      sideB: withCounts(b.config.side, defenderBefore),
      maxRounds: config.maxRoundsPerBattle,
      battleContext: "challenge",
    };
    const resolved = executeBattle(scenario, battleSeed);
    matchSequence.push(`${a.config.id}-${b.config.id}`);
    const winnerBefore = resolved.winner === "A" ? attackerBefore : defenderBefore;
    const winnerAfter = resolved.winner === "A" ? resolved.attackerSurvivors :
      resolved.defenderSurvivors;
    if (TROOP_TYPES.some((troop) => !Number.isSafeInteger(winnerAfter[troop]) ||
      winnerAfter[troop] < 0 || winnerAfter[troop] > winnerBefore[troop]) ||
      TROOP_TYPES.every((troop) => winnerAfter[troop] === 0)) {
      throw new RangeError("Winning queue must retain valid surviving troops.");
    }
    if (resolved.winner === "A") {
      a.survivors = resolved.attackerSurvivors;
      aliveB.delete(b.config.id);
      b.survivors = ZERO_COUNTS;
    } else {
      b.survivors = resolved.defenderSurvivors;
      aliveA.delete(a.config.id);
      a.survivors = ZERO_COUNTS;
    }
    if ("roundCount" in resolved) roundCount += resolved.roundCount;
    if (retainTrace && "battle" in resolved) {
      battleResults.push({ battleNumber, attackerQueueId: a.config.id,
        defenderQueueId: b.config.id, battleSeed, winner: resolved.winner,
        battle: resolved.battle, attackerSurvivors: a.survivors,
        defenderSurvivors: b.survivors });
      traces.push({ battleIndex: battleNumber, attackerQueueId: a.config.id,
        defenderQueueId: b.config.id, battleSeed, attackerBefore,
        defenderBefore, attackerAfter: a.survivors,
        defenderAfter: b.survivors, winner: resolved.winner,
        eliminatedQueue: resolved.winner === "A" ? b.config.id : a.config.id,
        queueCursorA, queueCursorB, nextQueueCursorA: scheduler.queueCursorA ?? null,
        nextQueueCursorB: scheduler.queueCursorB ?? null });
    }
  };

  while (aliveA.size > 0 && aliveB.size > 0 && battleCount < 5) {
    const queueCursorA = scheduler.queueCursorA ?? null;
    const queueCursorB = scheduler.queueCursorB ?? null;
    const selection = scheduler.pick([...aliveA], [...aliveB]);
    const a = attackerOrder.find((queue) => queue.config.id === selection.attackerQueueId &&
      aliveA.has(queue.config.id));
    const b = defenderOrder.find((queue) => queue.config.id === selection.defenderQueueId &&
      aliveB.has(queue.config.id));
    if (a === undefined || b === undefined) throw new RangeError("Scheduler selected an eliminated queue.");
    duel(a, b, queueCursorA, queueCursorB);
    cursorHistoryA.push(scheduler.queueCursorA ?? null);
    cursorHistoryB.push(scheduler.queueCursorB ?? null);
  }
  const schedulerAudit: ThreeQueueSchedulerAudit = {
    battleScenario: config.battleScenario ?? "THREE_QUEUE",
    innerEarthMode: config.innerEarthMode ?? null,
    threeQueueMode: scheduler.threeQueueMode ?? resolveThreeQueueMode(config.threeQueueMode),
    schedulerType: scheduler.schedulerType ?? threeQueueSchedulerType(config.threeQueueMode),
    rule: scheduler.rule, ruleStatus: scheduler.ruleStatus, seed: scheduler.seed,
    queueCursorA: scheduler.queueCursorA ?? null, queueCursorB: scheduler.queueCursorB ?? null,
    matchSequence, cursorHistoryA, cursorHistoryB,
  };
  const remainingAttackerQueues = attackerOrder.filter((queue) =>
    aliveA.has(queue.config.id)).map((queue) => ({ id: queue.config.id, survivors: queue.survivors }));
  const remainingDefenderQueues = defenderOrder.filter((queue) =>
    aliveB.has(queue.config.id)).map((queue) => ({ id: queue.config.id, survivors: queue.survivors }));
  if (!retainTrace) {
    const sumRemaining = (queues: typeof remainingAttackerQueues): TroopCounts => ({
      shield: queues.reduce((sum, queue) => sum + queue.survivors.shield, 0),
      lancer: queues.reduce((sum, queue) => sum + queue.survivors.lancer, 0),
      marksman: queues.reduce((sum, queue) => sum + queue.survivors.marksman, 0),
    });
    return { winner: aliveA.size > 0 ? "A" : "B", totalBattles: battleCount,
      threeQueueScheduler: schedulerAudit,
      roundCount, remaining: { A: sumRemaining(remainingAttackerQueues),
        B: sumRemaining(remainingDefenderQueues) },
      remainingQueues: { A: remainingAttackerQueues, B: remainingDefenderQueues } };
  }
  const initialPopulation = (side: ThreeQueueSideConfig): TroopCounts => {
    const allocations = side.queues.map((queue) => resolveInitialCounts(queue,
      side.deploymentCapacity));
    return {
      shield: allocations.reduce((sum, counts) => sum + counts.shield, 0),
      lancer: allocations.reduce((sum, counts) => sum + counts.lancer, 0),
      marksman: allocations.reduce((sum, counts) => sum + counts.marksman, 0),
    };
  };
  const remainingPopulation = (queues: readonly { readonly survivors: TroopCounts }[]): TroopCounts =>
    Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      queues.reduce((sum, queue) => sum + queue.survivors[troop], 0)])) as TroopCounts;
  const gradeComposition = (side: ThreeQueueSideConfig,
    remaining: readonly { readonly id: string; readonly survivors: TroopCounts }[]):
    PostBattleGradeComposition => {
    const fallback = resolveThreeQueueTroopLevels(side);
    return Object.fromEntries(TROOP_TYPES.map((troop) => {
      const byLevel = new Map<string, { initial: number; survivors: number }>();
      for (const queue of side.queues) {
        const level = queue.troopLevels?.[troop] ?? fallback[troop];
        const previous = byLevel.get(level) ?? { initial: 0, survivors: 0 };
        byLevel.set(level, { initial: previous.initial + resolveInitialCounts(queue,
          side.deploymentCapacity)[troop],
        survivors: previous.survivors + (remaining.find((entry) =>
          entry.id === queue.id)?.survivors[troop] ?? 0) });
      }
      return [troop, [...byLevel].map(([level, counts]) => ({ level, ...counts }))];
    })) as unknown as PostBattleGradeComposition;
  };
  const remainingA = remainingPopulation(remainingAttackerQueues);
  const remainingB = remainingPopulation(remainingDefenderQueues);
  return {
    winner: aliveA.size > 0 ? "A" : "B",
    battleResults,
    initialAttackerOrder,
    initialDefenderOrder,
    remainingAttackerQueues,
    remainingDefenderQueues,
    totalBattles: battleResults.length,
    scenarioTrace: { threeQueueScheduler: schedulerAudit, battles: traces },
    threeQueueScheduler: { ...schedulerAudit, battles: traces },
    aggregateCasualties: {
      A: resolvePostBattleCasualties(initialPopulation(config.attacker),
        remainingA, config.casualtyMode, gradeComposition(config.attacker,
          remainingAttackerQueues)),
      B: resolvePostBattleCasualties(initialPopulation(config.defender),
        remainingB, config.casualtyMode, gradeComposition(config.defender,
          remainingDefenderQueues)),
    },
  };
}

function schedulerForConfig(config: ThreeQueueScenarioConfig): ThreeQueueScheduler {
  return createThreeQueueScheduler(config.seed,
    config.battleScenario === "ICE_FIRE_LEAGUE" ? "ICE_FIRE_LEAGUE" : config.threeQueueMode, {
    attacker: config.attacker.queues.map((queue) => queue.id),
    defender: config.defender.queues.map((queue) => queue.id),
  });
}

const ZERO_COUNTS: TroopCounts = { shield: 0, lancer: 0, marksman: 0 };

function prepareSide(config: ThreeQueueSideConfig, side: SideId): QueueState[] {
  // Each queue gets the full capacity and the player's own per-troop level ceilings.
  if (!Number.isSafeInteger(config.deploymentCapacity) || config.deploymentCapacity < 1) {
    throw new RangeError(`Invalid ${side} three-queue capacity.`);
  }
  const levels = resolveThreeQueueTroopLevels(config);
  for (const troop of TROOP_TYPES) getTroopConstant(levels[troop]);
  const ids = new Set<string>();
  const heroIds = new Set<string>();
  return config.queues.map((queue) => {
    if (!queue.id.trim() || ids.has(queue.id)) {
      throw new RangeError(`Duplicate or empty ${side} queue id.`);
    }
    ids.add(queue.id);
    for (const hero of queue.side.heroes ?? []) {
      if (hero.position !== "leader") continue;
      if (heroIds.has(hero.heroId)) {
        throw new RangeError(`${side} 方三队列英雄不能重复：${hero.heroId}`);
      }
      heroIds.add(hero.heroId);
    }
    const ratiosBp = resolveQueueBasisPoints(queue);
    const survivors = resolveInitialCounts(queue, config.deploymentCapacity);
    const queueLevels = queue.troopLevels ?? levels;
    for (const troop of TROOP_TYPES) getTroopConstant(queueLevels[troop]);
    return { config: { ...queue, side: withLevels(queue.side, queueLevels, queue.troopLevelCompositions) },
      ratiosBp, survivors };
  });
}

function resolveQueueBasisPoints(queue: ThreeQueueConfig): TroopRatioBasisPoints {
  if (queue.ratiosBp !== undefined) return queue.ratiosBp;
  if (queue.ratios !== undefined) return toThreeQueueBasisPoints(queue.ratios);
  throw new RangeError(`Queue ${queue.id} needs troop ratios.`);
}

function resolveInitialCounts(queue: ThreeQueueConfig, capacity: number): TroopCounts {
  const exact = queue.initialTroopCounts;
  if (exact === undefined) return allocateThreeQueueTroops(capacity, resolveQueueBasisPoints(queue));
  if (TROOP_TYPES.some((troop) => !Number.isSafeInteger(exact[troop]) || exact[troop] < 0) ||
    TROOP_TYPES.reduce((sum, troop) => sum + exact[troop], 0) !== capacity)
    throw new RangeError(`Queue ${queue.id} exact troop counts must equal its capacity.`);
  return { ...exact };
}

function withLevels(side: PureTroopScenarioSideInput,
  levels: Readonly<Record<TroopType, string>>,
  compositions?: ThreeQueueConfig["troopLevelCompositions"]): PureTroopScenarioSideInput {
  const change = (troop: TroopType) => {
    const base = { ...side[troop] };
    delete base.levelComposition;
    return { ...base, ...(compositions?.[troop] === undefined ? {} : {
      levelComposition: compositions[troop] }), troopLevel: levels[troop],
      troopConstant: getTroopConstant(levels[troop]) };
  };
  return {
    ...side,
    shield: change("shield"), lancer: change("lancer"), marksman: change("marksman"),
  };
}

function withCounts(side: PureTroopScenarioSideInput, counts: TroopCounts): PureTroopScenarioSideInput {
  const change = (troop: TroopType) => {
    const entries = side[troop].levelComposition;
    const total = entries?.reduce((sum, entry) => sum + entry.aliveCount, 0) ?? 0;
    if (entries === undefined || entries.length < 2 || total === 0)
      return { ...side[troop], count: counts[troop],
        levelComposition: [{ level: side[troop].troopLevel, aliveCount: counts[troop] }] };
    const exact = entries.map((entry) => entry.aliveCount * counts[troop] / total);
    const allocated = exact.map(Math.floor);
    const order = entries.map((_, index) => index).sort((a, b) =>
      exact[b]! - allocated[b]! - (exact[a]! - allocated[a]!) || a - b);
    const remainder = counts[troop] - allocated.reduce((sum, value) => sum + value, 0);
    for (let i = 0; i < remainder; i += 1) allocated[order[i]!]! += 1;
    return { ...side[troop], count: counts[troop], levelComposition: entries.map((entry, index) =>
      ({ level: entry.level, aliveCount: allocated[index]! })) };
  };
  return {
    ...side,
    shield: change("shield"), lancer: change("lancer"), marksman: change("marksman"),
  };
}

function executeEngineBattle(scenario: PureTroopBattleScenario,
  seed: number): ThreeQueueDuelResolution {
  const battle = runPureTroopBattleScenario(scenario, {
    randomSource: createSeededRandomSource(seed),
  });
  const counts = (side: typeof battle.simulation.finalState.sideA): TroopCounts => ({
    shield: side.troops.shield.aliveCount,
    lancer: side.troops.lancer.aliveCount,
    marksman: side.troops.marksman.aliveCount,
  });
  const attackerSurvivors = counts(battle.simulation.finalState.sideA);
  const defenderSurvivors = counts(battle.simulation.finalState.sideB);
  const sum = (value: TroopCounts) => TROOP_TYPES.reduce((total, troop) => total + value[troop], 0);
  if (battle.simulation.endReason !== "elimination" ||
    (sum(attackerSurvivors) > 0) === (sum(defenderSurvivors) > 0)) {
    throw new ThreeQueueUnresolvedError(scenario.id);
  }
  return { battle, winner: sum(attackerSurvivors) > 0 ? "A" : "B",
    attackerSurvivors, defenderSurvivors };
}
