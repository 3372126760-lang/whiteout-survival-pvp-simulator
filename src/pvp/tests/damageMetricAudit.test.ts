import { describe,expect,it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { auditDamageMetrics,runValidationBattle,runBatchSimulation } from "../validationUi";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../heroSkills";
import { CONFIRMED_TROOP_SKILL_DEFINITIONS } from "../troopSkills";
describe("reported attempted damage semantics",()=>{
  it("separates HP damage and discarded overflow without changing the battle",()=>{
    const base=createDefaultValidationInput(),a={...base.sideA,leaderHeroIds:{},selectedMemberSkillIds:[],bodySkills:[],troops:{...base.sideA.troops,shield:{...base.sideA.troops.shield,count:0},lancer:{...base.sideA.troops.lancer,count:0},marksman:{...base.sideA.troops.marksman,count:10000,attack:10000,penetration:10000}}};
    const b={...base.sideB,leaderHeroIds:{},selectedMemberSkillIds:[],bodySkills:[],troops:{...base.sideB.troops,shield:{...base.sideB.troops.shield,count:1},lancer:{...base.sideB.troops.lancer,count:0},marksman:{...base.sideB.troops.marksman,count:0}}};
    const input={...base,scenarioType:"SINGLE" as const,sideA:a,sideB:b,maxRounds:3,disabledSkillIds:[...CONFIRMED_HERO_SKILL_DEFINITIONS,...CONFIRMED_TROOP_SKILL_DEFINITIONS].map((s)=>s.id)};
    const detailed=runValidationBattle(input),audit=auditDamageMetrics(detailed.simulation),batch=runBatchSimulation(input,1);
    expect(audit.A.discardedOverflowDamage).toBeGreaterThan(0);
    expect(audit.A.attemptedDamage).toBeCloseTo(audit.A.effectiveHpDamage+audit.A.shieldAbsorbedDamage+audit.A.discardedOverflowDamage,8);
    expect(batch.averageDamage.A).toBe(audit.A.attemptedDamage);
    expect(batch.averageDamage.A).toBeGreaterThan(audit.A.effectiveHpDamage);
    expect(detailed.simulation.finalState.sideB.troops.shield.aliveCount).toBe(0);
  });
});
