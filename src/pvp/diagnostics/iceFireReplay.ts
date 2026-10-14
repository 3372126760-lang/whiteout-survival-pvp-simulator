import { runThreeQueueScenario, ThreeQueueUnresolvedError, type ThreeQueueScenarioConfig } from "../scenario/threeQueueScenario";
import { runPureTroopBattleScenario, type PureTroopScenarioResult } from "../scenario/pureTroopScenario";
import { createSeededRandomSource } from "../troopSkills";
import { SIDE_IDS, TROOP_TYPES } from "../types/combat";
import type { BattleReadState } from "../types/battle";

export const KNOWN_ICE_FIRE_FAILURE_SEEDS = [3010811274,3010811334,3010811340,3010811341,3010811481] as const;

function stateContext(state: BattleReadState) {
  return Object.fromEntries(SIDE_IDS.map((id) => {
    const side = id === "A" ? state.sideA : state.sideB;
    return [id, { aliveMask: TROOP_TYPES.map((troop) => Number(side.troops[troop].aliveCount > 0)),
      troops: Object.fromEntries(TROOP_TYPES.map((troop) => {
        const value = side.troops[troop];
        return [troop, { count: value.aliveCount, currentHp: value.aliveCount > 0 ?
          (value.aliveCount-1)*value.maxHpPerUnit+value.frontUnitHp : 0,
          frontUnitHp: value.frontUnitHp, maxHpPerUnit: value.maxHpPerUnit,
          temporaryShield: value.temporaryShieldHp, shieldLayers: value.temporaryShields,
          buffs: value.buffs, debuffs: value.debuffs, skillRuntime: value.skillStates }];
      })), heroRuntime: side.heroStates, armyEffects: side.armyEffects }];
  })) as unknown as Record<"A" | "B", { aliveMask: number[]; troops: Record<typeof TROOP_TYPES[number],
    { count: number; currentHp: number; frontUnitHp: number; maxHpPerUnit: number; temporaryShield: number }> }>;
}

/** Reads full formal output. The guard emits diagnostics and never ends a battle. */
export function diagnoseIceFireDuel(battle: PureTroopScenarioResult, noProgressThreshold = 30) {
  if (!Number.isSafeInteger(noProgressThreshold) || noProgressThreshold < 1) throw new Error("No-progress diagnostic threshold must be a positive integer.");
  let streak = 0;
  const guards: { code: "NO_PROGRESS_STALEMATE"; round: number; consecutiveRounds: number; context: unknown }[] = [];
  const tail: unknown[] = [];
  for (const [index, round] of battle.simulation.rounds.entries()) {
    const beforeState = index === 0 ? battle.initialState : battle.simulation.rounds[index-1]!.stateAfter;
    const before = stateContext(beforeState), after = stateContext(round.stateAfter);
    const deltas = Object.fromEntries(SIDE_IDS.map((side) => [side,Object.fromEntries(TROOP_TYPES.map((troop) => [troop,{
      hpDelta: after[side].troops[troop].currentHp-before[side].troops[troop].currentHp,
      countDelta: after[side].troops[troop].count-before[side].troops[troop].count,
      frontHpDelta: after[side].troops[troop].frontUnitHp-before[side].troops[troop].frontUnitHp,
    }]))]));
    const unchanged = SIDE_IDS.every((side) => TROOP_TYPES.every((troop) =>
      before[side].troops[troop].count === after[side].troops[troop].count &&
      before[side].troops[troop].currentHp === after[side].troops[troop].currentHp &&
      before[side].troops[troop].frontUnitHp === after[side].troops[troop].frontUnitHp));
    streak = unchanged ? streak+1 : 0;
    const context = { round: round.round, before, after, deltas, attackEventCount: round.trace.damageEvents.length,
      attacks: round.trace.damageEvents.map((event) => ({ id:event.id,attacker:`${event.sourceSide}.${event.sourceTroop}`,
        target:`${event.targetSide}.${event.targetTroop}`,rawDamage:event.rawDamage,roundedDamage:event.roundedDamage,
        actualHpDelta:-event.hpAppliedDamage,shieldAbsorbed:event.temporaryShieldAbsorbed,overflow:event.overflowDiscarded,
        targetResult:after[event.targetSide].troops[event.targetTroop],damageType:event.damageType,skillId:event.sourceSkillId })),
      actions: SIDE_IDS.flatMap((side) => TROOP_TYPES.map((troop) => ({ side,troop,alive:before[side].troops[troop].count>0,
        emittedAttack:round.trace.damageEvents.some((event)=>event.sourceSide===side&&event.sourceTroop===troop),
        targetResult: round.trace.damageEvents.filter((event)=>event.sourceSide===side&&event.sourceTroop===troop)
          .map((event)=>`${event.targetSide}.${event.targetTroop}`),
        skipAction: round.trace.heroSkills.some((entry)=>entry.reason===`skipNextRoundAction:${side}.${troop}` ||
          entry.side===side && entry.sourceTroop===troop && entry.skippedMainAttack),
        stunDecisions: round.trace.heroSkills.filter((entry)=>entry.reason===`skipNextRoundAction:${side}.${troop}`),
        // Explicit skill decisions plus runtime distinguish stun/skip/no target.
        troopSkills:round.trace.troopSkills.filter((entry)=>entry.side===side&&entry.troop===troop),
        heroSkills:round.trace.heroSkills.filter((entry)=>entry.side===side) }))),
      noProgressStreak:streak };
    tail.push(context); if(tail.length>20)tail.shift();
    if(streak===noProgressThreshold) guards.push({code:"NO_PROGRESS_STALEMATE",round:round.round,consecutiveRounds:streak,context});
  }
  const last = battle.simulation.rounds.slice(-20);
  const events = last.flatMap((round)=>round.trace.damageEvents);
  const end = stateContext(battle.simulation.finalState);
  const empty = SIDE_IDS.some((side)=>end[side].aliveMask.every((n)=>n===0));
  const bothEmpty = SIDE_IDS.every((side)=>end[side].aliveMask.every((n)=>n===0));
  const classification = battle.simulation.endReason === "elimination" ? bothEmpty ? "SIMULTANEOUS_ELIMINATION_DRAW" : "RESOLVED" : empty ? "D_EMPTY_SIDE_NOT_TERMINATED"
    : streak >= noProgressThreshold && events.length && events.every((event)=>event.roundedDamage===0) ? "A_ZERO_DAMAGE_STALEMATE"
    : streak >= noProgressThreshold && events.length ? "B_EVENTS_WITHOUT_HP_PROGRESS"
    : streak >= noProgressThreshold && !events.length ? "C_NO_ATTACK_EVENTS_REQUIRES_TARGET_SKIP_REVIEW"
    : "ROUND_LIMIT_WITH_PROGRESS_REQUIRES_REVIEW";
  return { battleId:battle.scenario.id,endReason:battle.simulation.endReason,roundCount:battle.simulation.rounds.length,
    classification,guards,last20Rounds:tail,initialRuntime:stateContext(battle.initialState),
    runtimeReset:{round:battle.initialState.round,pendingEvents:battle.initialState.pendingDamageEvents.length,
      temporaryShieldHp:SIDE_IDS.flatMap((side)=>TROOP_TYPES.map((troop)=>stateContext(battle.initialState)[side].troops[troop].temporaryShield))},
    guardAffectsOutcome:false };
}

/** Runs the unchanged scheduler with newly constructed formal engines per duel.
 * Only the scheduler's per-troop survivor vectors flow into the next scenario. */
export function replayIceFireTrial(config: ThreeQueueScenarioConfig, seed: number) {
  const duels: { battleSeed:number; report:ReturnType<typeof diagnoseIceFireDuel> }[] = [];
  try {
    const trial = runThreeQueueScenario({...config,seed},(scenario,battleSeed)=>{
      const battle=runPureTroopBattleScenario(scenario,{randomSource:createSeededRandomSource(battleSeed)});
      duels.push({battleSeed,report:diagnoseIceFireDuel(battle)});
      const counts=(side:typeof battle.simulation.finalState.sideA)=>Object.fromEntries(TROOP_TYPES.map((troop)=>[troop,side.troops[troop].aliveCount])) as Record<typeof TROOP_TYPES[number],number>;
      const attackerSurvivors=counts(battle.simulation.finalState.sideA),defenderSurvivors=counts(battle.simulation.finalState.sideB);
      if(battle.simulation.endReason!=="elimination" || Object.values(attackerSurvivors).some((n)=>n>0) === Object.values(defenderSurvivors).some((n)=>n>0))throw new ThreeQueueUnresolvedError(scenario.id);
      return {battle,winner:Object.values(attackerSurvivors).some((n)=>n>0)?"A":"B",attackerSurvivors,defenderSurvivors};
    });
    return {seed,status:"completed",winner:trial.winner,matchSequence:trial.threeQueueScheduler.matchSequence,duels};
  } catch(error) {
    if(!(error instanceof ThreeQueueUnresolvedError))throw error;
    return {seed,status:"unresolved",error:error.message,duels};
  }
}
