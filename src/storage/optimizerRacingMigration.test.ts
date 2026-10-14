import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../ui/defaultInput";
import { defaultOptimizationConfig } from "../pvp/optimizer";
import { DEFAULT_CRITERION_SEARCH, resolveCriterionSearchOptions } from "../pvp/optimizer/criterion/searchTypes";
import { resolveJointRacingSchedule } from "../pvp/optimizer/criterion/racingSchedule";
import { createPersistedEnvelope, restorePersistedConfig } from "./configCodec";

function legacyEnvelope(version?:number) {
  const value=JSON.parse(JSON.stringify(createPersistedEnvelope(createDefaultValidationInput(),100,
    defaultOptimizationConfig(17))));
  const config=value.data.optimizationConfig;
  config.criterion.screeningTrials=[5,20,50];config.criterion.screeningKeep=[12,8,5];
  if(version===undefined)delete config.criterion.racingVersion;else config.criterion.racingVersion=version;
  config.monteCarloStages=[{trials:5,keep:12},{trials:20,keep:8},{trials:50,keep:5}];
  config.initialBattleTrials=10;config.verificationTop=12;
  return value;
}

describe("persisted Rally racing upgrade",()=>{
  it.each([undefined,1,2])("upgrades legacy version %s budgets only on restore",(version)=>{
    const value=legacyEnvelope(version),before=JSON.stringify(value.data.input);
    const restored=restorePersistedConfig(value);
    expect(restored.optimizationConfig.criterion).toMatchObject({racingVersion:3,
      screeningTrials:[5,20,50,100,300],screeningKeep:[300,80,25,10,5]});
    expect(restored.optimizationConfig.monteCarloStages).toBeUndefined();
    expect(restored.optimizationConfig.initialBattleTrials).toBe(5);
    expect(restored.optimizationConfig.verificationTop).toBe(5);
    expect(restored.optimizerRacingMigrated).toBe(true);
    expect(JSON.stringify(value.data.input)).toBe(before);
    expect(restored.input.sideA.leaderHeroIds).toEqual(value.data.input.sideA.leaderHeroIds);
    expect(restored.input.sideA.troops).toEqual(value.data.input.sideA.troops);
    expect(restored.optimizationConfig.criterion!.headRatioLimit).toBe(value.data.optimizationConfig.criterion.headRatioLimit);
  });
  it("upgrades legacy presets without any Criterion metadata",()=>{
    const value=legacyEnvelope();delete value.data.optimizationConfig.criterion;
    const restored=restorePersistedConfig(value);
    expect(restored.optimizationConfig.criterion).toEqual(DEFAULT_CRITERION_SEARCH);
    expect(restored.optimizationConfig.monteCarloStages).toBeUndefined();
    expect(restored.optimizerRacingMigrated).toBe(true);
  });
  it("stamps new exports as v3 and preserves explicit direct API schedules",()=>{
    const config={...defaultOptimizationConfig(91),initialBattleTrials:7,verificationTop:2,
      criterion:{screeningTrials:[7,30,90],screeningKeep:[77,22,4]},
      monteCarloStages:[{trials:7,keep:77},{trials:30,keep:22},{trials:90,keep:4}]};
    const envelope=createPersistedEnvelope(createDefaultValidationInput(),100,config);
    expect(envelope.data.optimizationConfig!.criterion!.racingVersion).toBe(3);
    const restored=restorePersistedConfig(envelope);
    expect(restored.optimizerRacingMigrated).toBeUndefined();
    expect(restored.optimizationConfig.criterion).toEqual(resolveCriterionSearchOptions(config.criterion));
    expect(restored.optimizationConfig.monteCarloStages).toEqual(config.monteCarloStages);
    expect(restored.optimizationConfig.initialBattleTrials).toBe(7);
    expect(restored.optimizationConfig.verificationTop).toBe(2);
  });
  it("resaving an upgraded legacy setup is idempotent",()=>{
    const first=restorePersistedConfig(legacyEnvelope(2));
    const second=restorePersistedConfig(createPersistedEnvelope(first.input,first.simulationCount,first.optimizationConfig));
    expect(second.optimizationConfig).toEqual(first.optimizationConfig);
    expect(second.optimizerRacingMigrated).toBeUndefined();
  });
  it.each([false,true])("preserves a new API legacy-stage override, including equal cumulative budgets (%s)",(repeated)=>{
    const {criterion:previous,...withoutCriterion}=defaultOptimizationConfig(81);void previous;
    const config={...withoutCriterion,initialBattleTrials:repeated?1:5,
      stages:[{ratioStep:5,trials:repeated?1:20,keep:77,maxCandidates:20},
        {ratioStep:5,trials:repeated?1:40,keep:22,maxCandidates:10},
        {ratioStep:1,trials:repeated?1:80,keep:8,maxCandidates:8}] as const,
      verificationTop:3,verificationTrials:100};
    const expected=resolveJointRacingSchedule(config);
    const restored=restorePersistedConfig(createPersistedEnvelope(createDefaultValidationInput(),100,config));
    expect(restored.optimizerRacingMigrated).toBeUndefined();
    expect(resolveJointRacingSchedule(restored.optimizationConfig)).toEqual(expected);
    expect(restored.optimizationConfig.criterion!.racingVersion).toBe(3);
  });
  it("rejects unsupported future racing versions",()=>{
    expect(()=>restorePersistedConfig(legacyEnvelope(4))).toThrow(/racingVersion/);
  });
});
