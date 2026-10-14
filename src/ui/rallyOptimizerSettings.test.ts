import { describe, expect, it } from "vitest";
import { defaultOptimizationConfig } from "../pvp/optimizer";
import { rallyCriterionSettings, updateRallyCriterionSetting } from "./rallyOptimizerSettings";

describe("Rally global racing controls",()=>{
  it("shows the new five-stage default and global C0 budget",()=>{
    const value=rallyCriterionSettings(defaultOptimizationConfig());
    expect(value.screeningTrials).toEqual([5,20,50,100,300]);
    expect(value.screeningKeep).toEqual([300,80,25,10,5]);
    expect(value.headRatioLimit).toBe(2000);
  });
  it("shows an explicit schedule and editing replaces its override without losing stage values",()=>{
    const config={...defaultOptimizationConfig(81),monteCarloStages:[{trials:7,keep:50},{trials:21,keep:8}]};
    expect(rallyCriterionSettings(config).screeningKeep).toEqual([50,8]);
    const next=updateRallyCriterionSetting(config,"criterion-keep-0",60);
    expect(next.monteCarloStages).toBeUndefined();
    expect(next.criterion!.screeningKeep).toEqual([60,8]);
    expect(next.criterion!.screeningTrials).toEqual([7,21]);
    expect(next.initialBattleTrials).toBe(7);
    expect(config.monteCarloStages).toEqual([{trials:7,keep:50},{trials:21,keep:8}]);
    expect(next.constraints).toBe(config.constraints);
  });
  it("edits C0, cumulative trials and candidate confidence thresholds separately",()=>{
    let next=updateRallyCriterionSetting(defaultOptimizationConfig(),"criterion-headRatioLimit",1700);
    next=updateRallyCriterionSetting(next,"criterion-trials-1",25);
    next=updateRallyCriterionSetting(next,"criterion-uncertainHeadRuns",50);
    expect(next.criterion).toMatchObject({headRatioLimit:1700,screeningTrials:[5,25,50,100,300],
      screeningKeep:[300,80,25,10,5],minimumHeadRuns:20,uncertainHeadRuns:50});
  });
  it("keeps monotone stage and sample validation",()=>{
    expect(()=>updateRallyCriterionSetting(defaultOptimizationConfig(),"criterion-trials-1",4)).toThrow(/screening/);
    expect(()=>updateRallyCriterionSetting(defaultOptimizationConfig(),"criterion-keep-0",.5)).toThrow(/screening/);
    expect(()=>updateRallyCriterionSetting(defaultOptimizationConfig(),"criterion-keep-9",1)).toThrow(/阶段/);
    expect(()=>updateRallyCriterionSetting(defaultOptimizationConfig(),"criterion-minimumHeadRuns",5)).toThrow(/20\/40/);
  });
  it("shows the actual legacy API fallback, not unrelated default Criterion values",()=>{
    const {criterion:previous,...base}=defaultOptimizationConfig();void previous;
    const config={...base,initialBattleTrials:5,verificationTrials:100,verificationTop:3,
      stages:[{ratioStep:5,trials:20,keep:77,maxCandidates:20},
        {ratioStep:5,trials:40,keep:22,maxCandidates:10},
        {ratioStep:1,trials:80,keep:8,maxCandidates:8}] as const};
    expect(rallyCriterionSettings(config)).toMatchObject({screeningTrials:[5,20,40,80],screeningKeep:[77,22,8,3]});
  });
  it("keeps editable sequential cuts at an equal cumulative budget",()=>{
    const config={...defaultOptimizationConfig(),monteCarloStages:[{trials:1,keep:8},{trials:1,keep:3}]};
    const next=updateRallyCriterionSetting(config,"criterion-keep-0",10);
    expect(next.monteCarloStages).toEqual([{trials:1,keep:10},{trials:1,keep:3}]);
    expect(rallyCriterionSettings(next).screeningKeep).toEqual([10,3]);
  });
});
