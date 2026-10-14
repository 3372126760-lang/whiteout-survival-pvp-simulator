import { createSeededRandomSource } from "../troopSkills";

export const THREE_QUEUE_MODES = ["ICE_FIRE_LEAGUE", "EARTH_HEART_BRAVE_LAND"] as const;
export type ThreeQueueMode = typeof THREE_QUEUE_MODES[number];
/** Old configurations represented the random challenge activity. */
export const DEFAULT_THREE_QUEUE_MODE: ThreeQueueMode = "EARTH_HEART_BRAVE_LAND";
export type ThreeQueueSchedulerType = "IceFireLeagueScheduler" | "RandomAliveQueueScheduler";

export function resolveThreeQueueMode(mode?: ThreeQueueMode): ThreeQueueMode {
  if (mode === undefined) return DEFAULT_THREE_QUEUE_MODE;
  if (!THREE_QUEUE_MODES.includes(mode)) throw new RangeError("Invalid three-queue activity mode.");
  return mode;
}

export function threeQueueSchedulerType(mode?: ThreeQueueMode): ThreeQueueSchedulerType {
  return resolveThreeQueueMode(mode) === "ICE_FIRE_LEAGUE"
    ? "IceFireLeagueScheduler" : "RandomAliveQueueScheduler";
}

export interface ThreeQueuePick {
  readonly attackerQueueId: string;
  readonly defenderQueueId: string;
}

export interface ThreeQueueOriginalOrders {
  readonly attacker: readonly string[];
  readonly defender: readonly string[];
}

export interface ThreeQueueScheduler {
  readonly rule: "uniformAliveRandom" | "independentCircularCursors";
  readonly ruleStatus: "confirmed" | "provisional";
  readonly seed: number;
  /** Optional metadata keeps scripted scheduler injection compatible. */
  readonly threeQueueMode?: ThreeQueueMode;
  readonly schedulerType?: ThreeQueueSchedulerType;
  /** Zero-based index of the next original slot to scan; random scheduling has no cursor. */
  readonly queueCursorA?: number | null;
  readonly queueCursorB?: number | null;
  pick(attackerAlive: readonly string[], defenderAlive: readonly string[]): ThreeQueuePick;
}

function assertSeed(seed: number): void {
  if (!Number.isSafeInteger(seed)) throw new RangeError("Invalid three-queue scheduler seed.");
}

/** Preserves the previous RNG and its two draws per matchup exactly. */
export class RandomAliveQueueScheduler implements ThreeQueueScheduler {
  readonly rule = "uniformAliveRandom";
  readonly ruleStatus = "confirmed";
  readonly threeQueueMode = "EARTH_HEART_BRAVE_LAND";
  readonly schedulerType = "RandomAliveQueueScheduler";
  readonly queueCursorA = null;
  readonly queueCursorB = null;
  private readonly random: ReturnType<typeof createSeededRandomSource>;
  constructor(readonly seed: number) {
    assertSeed(seed);
    this.random = createSeededRandomSource(seed);
  }
  pick(attackerAlive: readonly string[], defenderAlive: readonly string[]): ThreeQueuePick {
    if (attackerAlive.length === 0 || defenderAlive.length === 0) {
      throw new RangeError("Cannot schedule an eliminated queue side.");
    }
    return {
      attackerQueueId: attackerAlive[Math.floor(this.random.next() * attackerAlive.length)]!,
      defenderQueueId: defenderAlive[Math.floor(this.random.next() * defenderAlive.length)]!,
    };
  }
}

/** Each side advances past its used original slot, irrespective of the duel winner. */
export class IceFireLeagueScheduler implements ThreeQueueScheduler {
  readonly rule = "independentCircularCursors";
  readonly ruleStatus = "confirmed";
  readonly threeQueueMode = "ICE_FIRE_LEAGUE";
  readonly schedulerType = "IceFireLeagueScheduler";
  private cursorA = 0;
  private cursorB = 0;
  private readonly orders: ThreeQueueOriginalOrders;
  constructor(readonly seed: number, orders: ThreeQueueOriginalOrders = {
    attacker: ["A1", "A2", "A3"], defender: ["B1", "B2", "B3"],
  }) {
    assertSeed(seed);
    for (const ids of [orders.attacker, orders.defender]) {
      if (ids.length !== 3 || new Set(ids).size !== 3 || ids.some((id) => !id.trim())) {
        throw new RangeError("IceFire requires three distinct original queue slots per side.");
      }
    }
    this.orders = { attacker: [...orders.attacker], defender: [...orders.defender] };
  }
  get queueCursorA(): number { return this.cursorA; }
  get queueCursorB(): number { return this.cursorB; }
  private nextAlive(order: readonly string[], alive: readonly string[], cursor: number): number {
    for (let offset = 0; offset < 3; offset += 1) {
      const index = (cursor + offset) % 3;
      if (alive.includes(order[index]!)) return index;
    }
    throw new RangeError("Cannot schedule an eliminated queue side.");
  }
  pick(attackerAlive: readonly string[], defenderAlive: readonly string[]): ThreeQueuePick {
    const a = this.nextAlive(this.orders.attacker, attackerAlive, this.cursorA);
    const b = this.nextAlive(this.orders.defender, defenderAlive, this.cursorB);
    this.cursorA = (a + 1) % 3;
    this.cursorB = (b + 1) % 3;
    return { attackerQueueId: this.orders.attacker[a]!, defenderQueueId: this.orders.defender[b]! };
  }
}

export function createThreeQueueScheduler(seed: number, mode?: ThreeQueueMode,
  orders?: ThreeQueueOriginalOrders): ThreeQueueScheduler {
  return resolveThreeQueueMode(mode) === "ICE_FIRE_LEAGUE"
    ? new IceFireLeagueScheduler(seed, orders) : new RandomAliveQueueScheduler(seed);
}
