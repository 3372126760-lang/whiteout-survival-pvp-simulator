import type { BattleSimulationResult } from "../battle/simulateBattle";
/** Reporting-only diagnostic; consumes an existing detailed trace and never runs
 * another battle or changes resolution. Rounded attempted damage includes
 * shield absorption and discarded overflow. */
export function auditDamageMetrics(simulation:BattleSimulationResult) {
  const empty=()=>({attemptedDamage:0,effectiveHpDamage:0,shieldAbsorbedDamage:0,discardedOverflowDamage:0});
  const totals={A:empty(),B:empty()};
  for(const round of simulation.rounds)for(const target of round.casualties){
    const side=target.sourceEvents[0]?.sourceSide;if(!side)continue;
    const shield=target.temporaryShieldApplications.reduce((n,a)=>n+a.absorbedDamage,0);
    totals[side].attemptedDamage+=target.resolvedDamage;
    totals[side].shieldAbsorbedDamage+=shield;
    totals[side].effectiveHpDamage+=Math.max(0,target.absorbedDamage-shield);
    totals[side].discardedOverflowDamage+=target.discardedOverflowDamage;
  }
  return totals;
}
