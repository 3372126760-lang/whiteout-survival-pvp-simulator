import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { candidateToInput, currentRallyRatios } from "../optimizer/candidateGenerator";
import { runRallyOptimization, defaultOptimizationConfig, verifyRallyCandidate } from "../optimizer";
import { enumerateCanonicalBodyPool } from "../optimizer/jointPipeline/canonicalBodies";
import { resolveSearchDimensions } from "../optimizer/searchDimensions";
import { createOptimizationContext, optimizationBattleContext } from "../optimizer/optimizationContext";
import { runValidationBattle, resolveBodySkillConfigs, validationStageId } from "../validationUi";
import type { ValidationBattleInput, RallyCandidate, SideId } from "../../pvp";

const head = { shield: "hero.s3.luogen", lancer: "hero.s3.miya", marksman: "hero.s1.jinman" };
function fixture(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  return { ...base, scenarioType: "CITY_DEFENSE", battleContext: "cityDefense", defenderInTerritory: true,
    attributeInputMode: "prediction", maxRounds: 1, randomSeed: 12345, simulationMode: "fixedSeed",
    rallyBodyPoolIds: ["hero.body.jiexi", "hero.body.shuyun", "hero.body.jiesaier"],
    sideA: { ...base.sideA, leaderHeroIds: head, simulationWeaponLevels: { "hero.s3.luogen":10,"hero.s3.miya":10 } },
    sideB: { ...base.sideB, leaderHeroIds: head, simulationWeaponLevels: { "hero.s3.luogen":10,"hero.s3.miya":10 } } };
}
function config(side: SideId) {
  return { ...defaultOptimizationConfig(), candidateSide: side, objectiveMode: "minRallies" as const,
    verificationTrials: 2, topN: 1, constraints: { fixedLeaders: head },
    jointPipeline: { criterionKeep: 1, criterionFineKeep: 1, theoryKeep: 1,
      formalStages: [{ trials:20,keep:1 },{ trials:50,keep:1 },{ trials:100,keep:1 },{ trials:300,keep:1 }] } };
}

describe("city defense optimization", () => {
  it("keeps asymmetric scene, territory, counts and opponent when applying a recommendation", () => {
    const base = fixture();
    const candidate: RallyCandidate = { leaderHeroIds: head, memberSkillIds: [], ratios: { shield:49,lancer:1,marksman:50 } };
    for (const side of ["A","B"] as const) {
      const applied = candidateToInput(base,candidate,side), own = side === "A" ? applied.sideA : applied.sideB;
      expect(applied.scenarioType).toBe("CITY_DEFENSE");
      expect(applied.defenderInTerritory).toBe(true);
      expect(side === "A" ? applied.sideB : applied.sideA).toEqual(side === "A" ? base.sideB : base.sideA);
      expect(Object.values(own.troops).reduce((s,r)=>s+r.count,0)).toBe(36000);
      expect(currentRallyRatios(applied,side).shield).toBeCloseTo(49);
    }
  });

  it("searches no attacker bodies and four defender bodies with the correct role context", () => {
    const base = fixture();
    expect(resolveSearchDimensions(base,{side:"A"}).bodySearchEnabled).toBe(false);
    expect(resolveSearchDimensions(base,{side:"B"}).bodySearchEnabled).toBe(true);
    for (const side of ["A","B"] as const) {
      const pool = enumerateCanonicalBodyPool(base,{},head,side);
      expect(pool.rows.length).toBeGreaterThan(0);
      expect(pool.rows.every(r=>r.memberSkillIds.length === (side === "A" ? 0 : 4))).toBe(true);
      expect(optimizationBattleContext(createOptimizationContext(base,side))).toBe("cityDefense");
    }
  });

  it.each(["A","B"] as const)("runs real search and independent verification for %s", side => {
    const base = fixture();
    const result = runRallyOptimization(base,config(side));
    expect(result.selectedMode).toBe("singleWin");
    expect(result.multiWaveTop).toEqual([]);
    expect(result.optimizationContext).toMatchObject({ battleScenario:"cityDefense",candidateSide:side,rallyRole:side === "A" ? "attacker" : "defender" });
    expect(result.singleWaveTop.length).toBeGreaterThan(0);
    for (const row of result.singleWaveTop) {
      expect(row.candidate.memberSkillIds).toHaveLength(side === "A" ? 0 : 4);
      const applied = candidateToInput(base,row.candidate,side);
      const battle = runValidationBattle(applied);
      expect(battle.postBattleCasualties.A.mode).toBe("FURNACE");
      expect(battle.postBattleCasualties.B.mode).toBe("NORMAL");
      if (side === "B") expect(resolveBodySkillConfigs(row.candidate.memberSkillIds,Object.values(head),validationStageId(base),"B")).toHaveLength(4);
      const checked = verifyRallyCandidate(base,row.candidate,2,12345,side);
      expect(checked.trials).toBe(2);
    }
  });
});
