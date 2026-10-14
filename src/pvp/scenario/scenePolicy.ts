import type { ValidationBattleInput } from "../validationUi/types";

/** Internal legacy queue scenarios remain callable; the public IceFire route is fixed. */
export function isThreeQueueBattleInput(input: ValidationBattleInput): boolean {
  if (input.scenarioType === "THREE_QUEUE" || input.scenarioType === "ICE_FIRE_LEAGUE") return true;
  return input.scenarioType === "INNER_EARTH" &&
    (input.innerEarth?.subMode === "HEART_OF_EARTH" || input.innerEarth?.subMode === "HERO_LAND");
}

export function battleSceneLabel(input: ValidationBattleInput): string {
  switch (input.scenarioType) {
    case "THREE_THREE_THREE": return "333模式";
    case "ICE_FIRE_LEAGUE": return "冰火战歌模式";
    case "INNER_EARTH": return "地心模式";
    case "RALLY": return "集结模式";
    case "THREE_QUEUE": return "旧版内部队列模式";
    default: return "单撞模式";
  }
}
