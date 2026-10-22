import type { BattleScenarioType } from "../pvp";

export type OptimizerRoute = "single" | "333" | "threeQueue" | "rally" | "innerEarth";

export function optimizerRoute(scenarioType: BattleScenarioType | undefined): OptimizerRoute {
  switch (scenarioType) {
    case "THREE_THREE_THREE": return "333";
    case "THREE_QUEUE": return "threeQueue";
    case "ICE_FIRE_LEAGUE": return "threeQueue";
    case "INNER_EARTH": return "innerEarth";
    case "CITY_DEFENSE":
    case "RALLY": return "rally";
    default: return "single";
  }
}
