import { createDefaultValidationInput } from "../../../ui/defaultInput";
import type { ValidationBattleInput, RallyCandidate } from "../../index";

export const OLD_HEAD = { shield: "hero.s1.nataliya", lancer: "hero.s1.moli", marksman: "hero.s1.jinman" };
export const OPPONENT_HEAD = { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" };
export function rallyHeadSearchFixture(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  const common = { ...base.sideA, reportHeroByTroop: {}, reportHeroIds: [],
    rallyDeployment: { totalTroops: 36000, ratios: { shield: 50, lancer: 20, marksman: 30 } },
    bodySkills: [], selectedMemberSkillIds: [] };
  return { ...base, scenarioType: "RALLY", battleContext: "rally", maxRounds: 300,
    // Keep panels identical to isolate battle skills; optimizer candidates use their separate Lv10 weapon pool.
    attributeInputMode: "prediction",
    availableHeroIds: [...Object.values(OLD_HEAD), ...Object.values(OPPONENT_HEAD)],
    sideA: { ...common, leaderHeroIds: OLD_HEAD }, sideB: { ...common, leaderHeroIds: OPPONENT_HEAD } };
}
export function opponentCandidate(): RallyCandidate {
  return { leaderHeroIds: OPPONENT_HEAD, headWeaponLevels: Object.fromEntries(Object.values(OPPONENT_HEAD).map((id)=>[id,10])), memberSkillIds: [],
    ratios: { shield: 50, lancer: 20, marksman: 30 } };
}
