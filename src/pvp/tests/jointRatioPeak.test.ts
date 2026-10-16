import { describe,expect,it } from "vitest";
import { findRatioPeak,createRatioRegion,ratioInRegion,ratioObjective } from "../optimizer/jointPipeline/ratioPeak";
import type { Triple } from "../optimizer/criterion/types";
describe("Joint simplex peak and connected regions",()=>{
  it("finds the analytic equal-survival optimum proportional to O squared",()=>{
    const peak=findRatioPeak([2,2,2],[1,2,3]);
    expect(peak.bestRatio.shield).toBeCloseTo(100/14,7);expect(peak.bestRatio.lancer).toBeCloseTo(400/14,7);
    expect(peak.bestScore).toBeCloseTo(2*Math.sqrt(14),9);
  });
  it("finds the 50% shield/marksman survival-only frontline limiting example",()=>{
    const peak=findRatioPeak([3,0,1],[0,0,4]);expect(peak.bestRatio.shield).toBeCloseTo(50,7);expect(peak.bestRatio.lancer).toBe(0);
  });
  it("finds the 54.545% shield/lancer limiting example",()=>{
    const peak=findRatioPeak([3.75,1,0],[0,3,0]);expect(peak.bestRatio.shield).toBeCloseTo(54.5454545,5);expect(peak.bestRatio.marksman).toBe(0);
  });
  it("different fixed starts converge to the same global peak",()=>{
    const s:Triple=[7,.5,3],o:Triple=[.2,4,1],expected=findRatioPeak(s,o);
    for(const start of [.001,.1,.5,.9,.999]){
      const peak=findRatioPeak(s,o,start);expect(peak.bestScore).toBeCloseTo(expected.bestScore,9);
      expect(peak.bestRatio.shield).toBeCloseTo(expected.bestRatio.shield,5);
    }
  });
  it("beats an independent dense grid on 20 deterministic coefficient sets",()=>{
    for(let k=1;k<=20;k++){
      const s:Triple=[.01+k%7,1+k%3,.3+k%11],o:Triple=[k%4+.001,k%6+.05,k%2+2];
      const peak=findRatioPeak(s,o);
      for(let a=0;a<=100;a+=2)for(let b=0;b<=100-a;b+=2)expect(peak.bestScore+1e-8).toBeGreaterThanOrEqual(ratioObjective(s,o,[a/100,b/100,(100-a-b)/100]));
      expect(peak.objectiveEvaluationCount).toBeLessThanOrEqual(32);
    }
  });
  it("includes narrow and boundary peaks; bounds do not replace J membership",()=>{
    const s:Triple=[1,1,1],o:Triple=[1,.0001,.0001],peak=findRatioPeak(s,o),region=createRatioRegion(s,o,peak,.99);
    expect(ratioInRegion(region,peak.bestRatio)).toBe(true);expect(region.shieldMax).toBeGreaterThanOrEqual(peak.bestRatio.shield);
    expect(region.shieldMin).toBeLessThan(peak.bestRatio.shield);expect(region.shieldMax-region.shieldMin).toBeLessThan(3);
    const equal=findRatioPeak([1,1,1],[1,1,1]),round=createRatioRegion([1,1,1],[1,1,1],equal,.99);
    expect(ratioInRegion(round,equal.bestRatio)).toBe(true);
    expect(ratioInRegion(round,{shield:round.shieldMin,lancer:round.lancerMax,marksman:100-round.shieldMin-round.lancerMax})).toBe(false);
  });
  it("handles zero and tiny output, all-zero survival, and legal all-positive interiors",()=>{
    for(const o of [[0,0,0],[1e-300,0,0],[1,1e-12,1],[0,1,0]] as Triple[]){
      const peak=findRatioPeak([3,1,1],o);expect(Number.isFinite(peak.bestScore)).toBe(true);
      expect(Object.values(peak.bestRatio).reduce((a,b)=>a+b,0)).toBeCloseTo(100,8);
    }
    const peak=findRatioPeak([0,0,0],[1,2,3]);expect(peak.bestScore).toBe(0);
    expect(()=>findRatioPeak([-1,1,1],[1,1,1])).toThrow();
  });
});
