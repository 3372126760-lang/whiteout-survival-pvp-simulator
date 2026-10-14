import type { ReportAttribute } from "../externalBuffs";
import type { TroopType } from "../types/combat";

export const REPORT_TROOPS: readonly TroopType[] = ["shield", "lancer", "marksman"];
export const REPORT_ATTRIBUTES: readonly ReportAttribute[] =
  ["attack", "defense", "penetration", "life"];

export function troopOf(text: string): TroopType | undefined {
  if (/盾|步兵/.test(text)) return "shield";
  if (/矛|枪兵/.test(text)) return "lancer";
  if (/射|弓兵/.test(text)) return "marksman";
  return undefined;
}

export function attributeOf(text: string): ReportAttribute | undefined {
  if (/攻击/.test(text)) return "attack";
  if (/防御/.test(text)) return "defense";
  if (/穿透/.test(text)) return "penetration";
  if (/生命/.test(text)) return "life";
  return undefined;
}
