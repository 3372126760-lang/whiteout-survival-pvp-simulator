import { describe, expect, it } from "vitest";
import { orderedLifetimePotential, integrateOrderedLifetime, sqrtIntegralAverage } from "../optimizer/criterion/ordered";
import { buildTargetFlow } from "../optimizer/criterion/flow";
import { criterionBattle } from "../optimizer/criterion/solver";
import { createCriterionTemplate } from "../optimizer/criterion/compiler";
import type { CriterionSide } from "../optimizer/criterion/types";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createValidationPreviewState } from "../validationUi";
import { OptimizerProfiler } from "../optimizer/profiling";
import { optimizerProgressText } from "../../ui/optimizerPerformanceView";
import { initializeOptimizationHeroPool, setOptimizationPoolEnabled, optimizerWeaponLevel } from "../optimizer/heroPools";
import { candidateToInput, generateAllHeadFormations } from "../optimizer/candidateGenerator";
import { buildHeroPoolAudit } from "../optimizer/heroSearchPolicy";
import { getValidationCatalog } from "../validationUi";
import { bodySignature } from "../optimizer/criterion/signatures";
const side = (counts: CriterionSide["counts"] = [100, 0, 0]): CriterionSide => ({ counts, hp: [100, 100, 100],
  normal: Array(9).fill(1), skill: Array(9).fill(1), priorities: [[0,2,1],[0,2,1],[0,2,1]],
  channels: [0,1,2].map((source) => ({ source, kind: "normalAttack", coefficient: 1, target: "priority" })),
  uncertainty: 0, omittedMechanisms: [], flags: { probabilityApproximation: false, roundSkillApproximation: false, targetRedirect: false, hardToStaticize: false } });
describe("Criterion numeric boundaries", () => {
  it("reduces to PDF 5.21 without a bracket square and integrates sqrt output exactly", () => {
    expect(sqrtIntegralAverage(1,0)).toBeCloseTo(2/3,14);
    expect(orderedLifetimePotential([0,0,7],[11,0,13])).toBeCloseTo(7*(11+2/3*13),12);
    expect(integrateOrderedLifetime([0,0,7],[11,0,13])).toBeCloseTo(7*(11+2/3*13),12);
    expect(orderedLifetimePotential([0,7,0],[11,13,0],[0,1,2])).toBeCloseTo(7*(11+2/3*13),12);
  });
  it("agrees with the ordered three-type closed integral while retaining shield output", () => {
    const o = [2,3,4], h = [7,11,13];
    const expected = 2/3*2*7 + 4*(7+2/3*13)+3*(7+13+2/3*11);
    expect(integrateOrderedLifetime(o,h)).toBeCloseTo(expected,12);
    expect(orderedLifetimePotential(o,h)).toBeCloseTo(expected,12);
  });
  it("has the n^(3/2) single-troop winner and exact remaining invariant", () => {
    const a = side([200,0,0]), b = side([100,0,0]);
    const result = criterionBattle({ a,b });
    expect(result.predictedWinner).toBe("A");
    expect(result.aRemaining.shield).toBeCloseTo((200**1.5-100**1.5)**(2/3),9);
    expect(result.bRemaining.shield).toBe(0);
    expect(criterionBattle({a:b,b:a}).margin).toBeCloseTo(-result.margin,12);
  });
  it("redirects only lancer main 80/20 and retargets after marksman dies", () => {
    const a = { ...side([100,100,100]), channels: [{ source: 1, kind: "normalAttack" as const, coefficient: 1,
      target: "priority" as const, redirectProbability: .2, redirectPriority: [2,0,1] }] };
    expect([...buildTargetFlow(a,7,7)]).toEqual([0,0,0,.8,0,.2,0,0,0]);
    expect([...buildTargetFlow(a,7,3)]).toEqual([0,0,0,1,0,0,0,0,0]);
  });
  it("keeps 100% main on shield plus an independent 40% extra rear channel", () => {
    const a = { ...side(), channels: [ {source:2,kind:"normalAttack" as const,coefficient:1,target:"priority" as const},
      {source:2,kind:"extraDamage" as const,coefficient:.4,target:2} ] };
    const matrix=buildTargetFlow(a,7,7);
    expect(matrix[6]).toBe(1); expect(matrix[8]).toBe(.4); expect(matrix[6]!+matrix[8]!).toBe(1.4);
  });
  it("matrix kernel reports ordered potential matching PDF and three-type closed boundaries",()=>{
    const a={...side([100,0,100]),normal:[0,0,0,0,0,0,7,7,7]};
    const result=criterionBattle({a,b:side([100,0,100])});
    const scale=Math.sqrt(200),output=scale*Math.sqrt(100)*7;
    expect(result.lifetimeOutputPotentialA).toBeCloseTo(output*(10000+2/3*10000),7);
    const all=side([100,100,100]),r=criterionBattle({a:all,b:all});
    expect(r.lifetimeOutputPotentialA).toBeCloseTo(orderedLifetimePotential([1,1,1].map(()=>Math.sqrt(300)*10),[10000,10000,10000]),7);
    expect(r.eventCount).toBeLessThanOrEqual(6);
  });
  it("current-target extra inherits main retargeting while explicit rear extra remains separate",()=>{
    const a={...side(),channels:[{source:1,kind:"normalAttack" as const,coefficient:1,target:"priority" as const,redirectProbability:.2,redirectPriority:[2,0,1]},
      {source:1,kind:"extraDamage" as const,coefficient:.5,target:"current" as const}]};
    const m=buildTargetFlow(a,7,7);expect(m[3]).toBeCloseTo(1.2);expect(m[5]).toBeCloseTo(.3);
    expect([...buildTargetFlow(a,7,0)]).toEqual(Array(9).fill(0));
  });
  it("uses actual skill unlocks and shared official attribute/HP functions", () => {
    const input=createDefaultValidationInput(), before=JSON.stringify(input);
    const template=createCriterionTemplate(input), state=createValidationPreviewState(input);
    expect(template.a.hp.every((n)=>n>0&&Number.isFinite(n))).toBe(true);
    if(state.sideA.troops.lancer.skillStates.some((r)=>r.skillId==="lancer-ambush"&&r.enabled))
      expect(template.a.channels.find((c)=>c.source===1&&c.kind==="normalAttack")!.redirectProbability).toBe(.2);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("keeps per-runtime body levels and excludes disabled skills from numeric signatures", () => {
    const id="hero-skill.shuyun.attack",mixed=bodySignature([id,id],[1,5]);
    expect(mixed.effects.map((entry)=>"value" in entry.effect.definition?entry.effect.definition.value:undefined)).toEqual([.05,.25]);
    expect(mixed.rough[0]).toBeCloseTo(.30,12);
    const disabled=bodySignature([id,id],[1,5],[id]);
    expect(disabled.effects).toHaveLength(0);expect(disabled.rough[0]).toBe(0);
    expect(disabled.key).not.toBe(mixed.key);
  });
});
describe("optimizer pool and ETA isolation", () => {
  it("keeps battle Rufus Lv6 independent, initializes pool Lv10, preserves edits through all/none", () => {
    const base=createDefaultValidationInput(), id="hero.s11.rufus";
    const input={...base,serverStage:"s11" as const,sideA:{...base.sideA,simulationWeaponLevels:{[id]:6}}};
    let next=initializeOptimizationHeroPool(input);
    expect(optimizerWeaponLevel(next,id)).toBe(10);expect(next.sideA.simulationWeaponLevels![id]).toBe(6);
    next=setOptimizationPoolEnabled(setOptimizationPoolEnabled(next,"A",false),"A",true);
    expect(optimizerWeaponLevel(next,id)).toBe(10);
    next={...next,optimizerHeroPool:{...next.optimizerHeroPool,A:{...next.optimizerHeroPool!.A,[id]:{enabled:true,weaponLevel:6}}}};
    next=setOptimizationPoolEnabled(setOptimizationPoolEnabled(next,"A",false),"A",true);
    expect(optimizerWeaponLevel(next,id)).toBe(6);
    const rally={...next,sideA:{...next.sideA,rallyDeployment:{totalTroops:30000,ratios:{shield:50,lancer:20,marksman:30}}}};
    expect(candidateToInput(rally,{leaderHeroIds:{marksman:id},memberSkillIds:[],ratios:{shield:50,lancer:20,marksman:30}}).sideA.simulationWeaponLevels![id]).toBe(6);
  });
  it("server11 and an owned max8 pool accept a head containing S8 alongside old heroes", () => {
    const base=createDefaultValidationInput();const ids=["hero.s1.nataliya","hero.s3.miya","hero.s8.hengdelike"];
    const input={...base,serverStage:"s11" as const,ownedHeroIds:ids,availableHeroIds:ids};
    expect(generateAllHeadFormations(input,{fixedBodyExact:true,fixedMemberSkillIds:[]})).toHaveLength(1);
    const pool=buildHeroPoolAudit(input,getValidationCatalog().leaderHeroes.filter((h)=>ids.includes(h.heroId)));
    expect(pool.effectiveSearchGeneration).toBe(8);expect(pool.counts.legalCombinations).toBe(1);
    expect(pool.exclusions.some((e)=>e.exclusionReason==="recentGenerationRule")).toBe(false);
  });
  it("520/876 at 60s uses inclusive wall scope and cannot claim 1.5s remaining", () => {
    let clock=0;const profiler=new OptimizerProfiler(undefined,()=>clock);profiler.begin("C0",876);
    profiler.measure("child",1,()=>{clock+=57800;});clock+=2200;
    profiler.progress({stage:"C0",completed:520,total:876});const report=profiler.snapshot();
    expect(report.stages[0]!.wallElapsedMs).toBe(60000);expect(report.stages[0]!.elapsedMs).toBe(2200);
    expect(report.stages[0]!.estimatedRemainingMs).toBeCloseTo(60000/520*356,9);
    expect(optimizerProgressText({stage:"C0",completed:520,total:876},report)).toContain("41.1 s");
  });
});
