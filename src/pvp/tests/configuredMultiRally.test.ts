import {expect,it} from "vitest";
import {createConfiguredMultiRallyEvaluator,optimizeConfiguredMultiRally} from "../optimizer/configuredMultiRally";
import {rallyHeadSearchFixture} from "./fixtures/rallyHeadSearch";
import {compileValidationBattle} from "../validationUi/adapter";
import {deriveWaveSeed} from "../optimizer/seedSet";

it("carries the actual defender counts across differently configured attacks without mutation",()=>{
 const input=rallyHeadSearchFixture(),second={...input.sideA,leaderHeroIds:{...input.sideB.leaderHeroIds},rallyDeployment:{totalTroops:18000,ratios:{shield:10,lancer:20,marksman:70}}};
 const attacks=[input.sideA,second],before=JSON.stringify(input),seed=91;
 const evaluate=createConfiguredMultiRallyEvaluator(input),row=evaluate(attacks,[seed]);
 const enemy=compileValidationBattle(input).initialState.sideB;
 let counts={shield:enemy.troops.shield.aliveCount,lancer:enemy.troops.lancer.aliveCount,marksman:enemy.troops.marksman.aliveCount};
 for(let i=0;i<attacks.length;i++)if(Object.values(counts).some(n=>n>0))counts=compileValidationBattle({...input,sideA:attacks[i]!}).runFastFreshTrial(deriveWaveSeed(seed,i),counts).remaining.B;
 expect(row.enemyRemainingMean).toEqual(counts);
 expect(row.attacks).toEqual(attacks);
 expect(row.trials).toBe(1);
 expect(row.waveWinRates[1]).toBeGreaterThanOrEqual(row.waveWinRates[0]!);
 expect(JSON.stringify(input)).toBe(before);
});
it("keeps the configured wave count and optimizes only the fixed-length sequence win rate",()=>{
 const input=rallyHeadSearchFixture(),attacks=[input.sideA,input.sideA];
 const result=optimizeConfiguredMultiRally({...input,rallyMode:"multi",rallyAttacks:attacks},[[input.sideA],[input.sideA]],11,2,3);
 expect(result.recommended.attacks).toHaveLength(2);
 expect(result.recommended.trials).toBe(3);
 expect(result.current.winRate).toBe(result.recommended.winRate);
 expect(result.recommended).not.toHaveProperty("targetWaves");
});
