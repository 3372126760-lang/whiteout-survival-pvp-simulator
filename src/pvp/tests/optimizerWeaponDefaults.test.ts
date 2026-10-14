import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { initializeOptimizerWeaponLevels } from "../../ui/optimizerWeaponDefaults";
import { applySimpleScenarioCandidate, createValidationPreviewState, getValidationCatalog } from "../../pvp";
import { setOptimizationPoolEnabled } from "../optimizer/heroPools";
const id="hero.s11.rufus";
describe("optimizer exclusive weapon defaults",()=>{
  it("initializes only optimizer levels and leaves the actual battle Lv6 intact",()=>{
    const base=createDefaultValidationInput();const input={...base,sideA:{...base.sideA,simulationWeaponLevels:{[id]:6}}};
    const next=initializeOptimizerWeaponLevels(input,getValidationCatalog().leaderHeroes);
    expect(next.optimizerHeroPool?.A?.[id]?.weaponLevel).toBe(10);
    expect(next.optimizerHeroPool?.B?.[id]?.weaponLevel).toBe(10);
    expect(next.sideA.simulationWeaponLevels?.[id]).toBe(6);
    for(const hero of getValidationCatalog().leaderHeroes.filter((h)=>h.weaponMaxStat===null))
      if(next.optimizerHeroPool?.A?.[hero.heroId])expect(next.optimizerHeroPool.A[hero.heroId]!.weaponLevel).toBeNull();
  });
  it("retains edits and zero levels through reopen and select all/none",()=>{
    const first=initializeOptimizerWeaponLevels(createDefaultValidationInput(),getValidationCatalog().leaderHeroes);
    const edited={...first,optimizerHeroPool:{...first.optimizerHeroPool,A:{...first.optimizerHeroPool!.A,[id]:{enabled:true,weaponLevel:6}},B:{...first.optimizerHeroPool!.B,[id]:{enabled:true,weaponLevel:0}}}};
    const next=setOptimizationPoolEnabled(setOptimizationPoolEnabled(edited,"A",false),"A",true);
    expect(next.optimizerHeroPool?.A?.[id]?.weaponLevel).toBe(6);
    expect(initializeOptimizerWeaponLevels(next,getValidationCatalog().leaderHeroes)).toBe(next);
    expect(next.optimizerHeroPool?.B?.[id]?.weaponLevel).toBe(0);
  });
  it("ScenarioRunner's real prepared state reads the optimizer candidate level",()=>{
    const base=createDefaultValidationInput();const initialized=initializeOptimizerWeaponLevels(base,getValidationCatalog().leaderHeroes);
    const configured={...initialized,scenarioType:"SINGLE" as const,attributeInputMode:"prediction" as const,
      sideA:{...base.sideA,simulationWeaponLevels:{[id]:6}}};
    const make=()=>applySimpleScenarioCandidate(configured,"A",{leaderHeroIds:{marksman:id},ratios:{shield:20,lancer:30,marksman:50}});
    expect(createValidationPreviewState(make()).sideA.heroStates.find((h)=>h.heroId===id)?.weaponLevel).toBe(10);
    const edited={...configured,optimizerHeroPool:{...configured.optimizerHeroPool,A:{...configured.optimizerHeroPool!.A,[id]:{enabled:true,weaponLevel:4}}}};
    const candidate=applySimpleScenarioCandidate(edited,"A",{leaderHeroIds:{marksman:id},ratios:{shield:20,lancer:30,marksman:50}});
    expect(createValidationPreviewState(candidate).sideA.heroStates.find((h)=>h.heroId===id)?.weaponLevel).toBe(4);
    expect(configured.sideA.simulationWeaponLevels[id]).toBe(6);
  });
});
