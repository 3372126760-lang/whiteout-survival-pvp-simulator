import type { DamageEvent } from "../types/damage";
import type { SideId, TroopType } from "../types/combat";

export type BattleLogEntry =
  | {
      readonly type: "roundStart";
      readonly round: number;
      readonly aliveCounts: Readonly<
        Record<SideId, Readonly<Record<TroopType, number>>>
      >;
    }
  | {
      readonly type: "damageQueued";
      readonly round: number;
      readonly event: DamageEvent;
    }
  | {
      readonly type: "casualtyResolved";
      readonly round: number;
      readonly targetSide: SideId;
      readonly targetTroop: TroopType;
      readonly incomingDamage: number;
      readonly resolvedDamage: number;
      readonly casualties: number;
      readonly aliveCountAfter: number;
      readonly frontUnitHpAfter: number;
      readonly unabsorbedDamage: number;
    }
  | {
      readonly type: "roundEnd";
      readonly round: number;
      readonly battleStatus: "ready" | "completed";
    };
