import {expect,it} from "vitest";
import {adaptiveSeedPools} from "../optimizer/adaptiveSampling";
import {recallFormalCandidates} from "../optimizer/jointPipeline/formalRecall";
import type {RallyCandidate} from "../optimizer/types";

it("uses entirely independent final draws without changing the requested budget",()=>{
 for(const seed of [0,91,20261023]){
  const pools=adaptiveSeedPools(seed,300,1000,true);
  expect(pools.final).toHaveLength(1000);
  expect(new Set(pools.final).size).toBe(1000);
  expect(pools.final.some(value=>pools.screeningSet.has(value))).toBe(false);
  expect(pools.finalScreeningPrefix).toBe(0);
 }
});
it("keeps the formal budget and strongest rows while recalling omitted heads",()=>{
 const candidate=(head:string,n:number):RallyCandidate=>({leaderHeroIds:{shield:head,lancer:null,marksman:null},memberSkillIds:[],ratios:{shield:n,lancer:0,marksman:100-n}});
 const primary=Array.from({length:30},(_,i)=>candidate("head.a",i));
 const alternative=candidate("head.b",50);
 const rows=recallFormalCandidates(primary,[alternative,...primary],20);
 expect(rows).toHaveLength(20);
 expect(rows.slice(0,18)).toEqual(primary.slice(0,18));
 expect(rows).toContain(alternative);
 expect(new Set(rows.map(row=>JSON.stringify(row))).size).toBe(20);
});
