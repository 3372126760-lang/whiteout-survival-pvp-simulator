import { runThreeQueueScenario,ThreeQueueUnresolvedError,type ThreeQueueScenarioConfig } from "../scenario/threeQueueScenario";
import { runPureTroopBattleScenario } from "../scenario/pureTroopScenario";
import { createSeededRandomSource } from "../troopSkills";
import { TROOP_TYPES } from "../types/combat";

/** Observer around the existing injection seam. Every duel creates fresh formal
 * state and skills. Completion checks are identical to the production runner. */
export function runObservedQueueScenario(config:ThreeQueueScenarioConfig,onDuel:(duel:{battleId:string;battleSeed:number;roundCount:number;endReason:string;bothSidesEliminated:boolean})=>void){
  return runThreeQueueScenario(config,(scenario,seed)=>{
    const battle=runPureTroopBattleScenario(scenario,{randomSource:createSeededRandomSource(seed)});
    const counts=(side:typeof battle.simulation.finalState.sideA)=>Object.fromEntries(TROOP_TYPES.map((troop)=>[troop,side.troops[troop].aliveCount])) as Record<typeof TROOP_TYPES[number],number>;
    const attackerSurvivors=counts(battle.simulation.finalState.sideA),defenderSurvivors=counts(battle.simulation.finalState.sideB);
    const alive=(side:typeof attackerSurvivors)=>Object.values(side).some((n)=>n>0);
    onDuel({battleId:scenario.id,battleSeed:seed,roundCount:battle.simulation.rounds.length,endReason:battle.simulation.endReason,
      bothSidesEliminated:!alive(attackerSurvivors)&&!alive(defenderSurvivors)});
    if(battle.simulation.endReason!=="elimination" || alive(attackerSurvivors)===alive(defenderSurvivors))throw new ThreeQueueUnresolvedError(scenario.id);
    return {battle,winner:alive(attackerSurvivors)?"A":"B",attackerSurvivors,defenderSurvivors};
  });
}
