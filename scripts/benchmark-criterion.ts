import { performance,PerformanceObserver } from "node:perf_hooks";
import { Session } from "node:inspector";
import { writeFileSync } from "node:fs";
import { bodySignature } from "../src/pvp/optimizer/criterion/signatures";
import { prepareCriterionHead,compileCriterionTemplate } from "../src/pvp/optimizer/criterion/compiler";
import { roughBodyCriterion } from "../src/pvp/optimizer/criterion/jointPreFilter";
import { criterionBattle } from "../src/pvp/optimizer/criterion/solver";
import { createTheoryTemplateBuilder,defaultTheoryOptions,estimateTheoryCandidate } from "../src/pvp/optimizer/theory";
import { candidateToInput,generateAllHeadFormations } from "../src/pvp/optimizer/candidateGenerator";
import { optimizerHeadWeaponLevels } from "../src/pvp/optimizer/heroPools";
import { compileValidationBattle,createStageSeeds,TROOP_TYPES } from "../src/pvp";
import { rallyHeadSearchFixture,OPPONENT_HEAD } from "../src/pvp/tests/fixtures/rallyHeadSearch";
import type { Triple } from "../src/pvp/optimizer/criterion/types";
const input=rallyHeadSearchFixture(),ids=["hero-skill.wuming.wind-shelter","hero-skill.wuming.wind-shelter","hero-skill.nuola.multi-troop-combat","hero-skill.nuola.multi-troop-combat"];
const roughSignatures=Array.from({length:16},(_,i)=>bodySignature(Array.from({length:4},(_,slot)=>i&1<<slot?ids[0]!:ids[2]!)));
const signature=bodySignature(ids),battleInput=candidateToInput(input,{leaderHeroIds:OPPONENT_HEAD,headWeaponLevels:optimizerHeadWeaponLevels(input,OPPONENT_HEAD),memberSkillIds:ids,ratios:{shield:57,lancer:3,marksman:40}});
const head=prepareCriterionHead(battleInput),template=compileCriterionTemplate(head),theory=createTheoryTemplateBuilder(defaultTheoryOptions())(battleInput),formal=compileValidationBattle(battleInput);
let sink=0;
const gcEntries:{start:number;duration:number}[]=[],observer=new PerformanceObserver((list)=>{for(const e of list.getEntries())gcEntries.push({start:e.startTime,duration:e.duration});});observer.observe({entryTypes:["gc"]});
const tick=()=>new Promise<void>((resolve)=>setImmediate(resolve));
const quantile=(sorted:readonly number[],p:number)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]!;
async function allocationSample(run:(i:number)=>void,count:number){
  const session=new Session();session.connect();
  const post=(method:string,params:Record<string,unknown>={})=>new Promise<unknown>((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
  try {await post("HeapProfiler.startSampling",{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
    for(let i=0;i<count;i++)run(i);
    const data=await post("HeapProfiler.stopSampling") as {profile:{samples:{size:number}[]}};
    const sampledBytes=data.profile.samples.reduce((n,s)=>n+s.size,0);
    return {method:"V8 statistical heap sampling; separate instrumented pass",runs:count,sampledBytes,estimatedBytesPerRun:sampledBytes/count,exactObjectCount:null};
  }catch(error){return {method:"unavailable",reason:String(error),runs:count,sampledBytes:null,estimatedBytesPerRun:null,exactObjectCount:null};}finally{session.disconnect();}
}
async function bench(name:string,count:number,run:(i:number)=>void,batchSize=1){
  for(let i=0;i<Math.min(count,100);i++)run(i);
  await tick();const heapBefore=process.memoryUsage().heapUsed,start=performance.now(),latencies:number[]=[];
  for(let i=0;i<count;i+=batchSize){const n=Math.min(batchSize,count-i),before=performance.now();for(let k=0;k<n;k++)run(i+k);latencies.push((performance.now()-before)*1000/n);}
  const wallMs=performance.now()-start,heapAfter=process.memoryUsage().heapUsed;await tick();
  const gc=gcEntries.filter((e)=>e.start>=start&&e.start<=start+wallMs);latencies.sort((a,b)=>a-b);
  const allocations=await allocationSample(run,Math.min(count,2000));
  const row={wallStartMs:start,name,runs:count,batchSize,latencyUnit:"microseconds per evaluation",meanUs:wallMs*1000/count,p50Us:quantile(latencies,.5),p95Us:quantile(latencies,.95),wallMs,
    heapNetDeltaBytes:heapAfter-heapBefore,allocations,gc:{events:gc.length,durationMs:gc.reduce((n,e)=>n+e.duration,0)}};
  process.stdout.write(`${name}: ${row.meanUs.toFixed(2)} us, ${(wallMs/1000).toFixed(2)} s\n`);return row;
}
const measurements=[];
measurements.push(await bench("BodyEffectSignature aggregate",2000,(i)=>{sink+=bodySignature(ids).rough[i%4]!;}));
measurements.push(await bench("rough body criterion single",10000,()=>{sink+=roughBodyCriterion(100,90,signature);}));
measurements.push(await bench("MatrixCriterion single",3000,()=>{sink+=criterionBattle(template).margin;}));
measurements.push(await bench("100k MatrixCriterion",100000,(i)=>{const q=i%3,counts:Triple=q===0?[18000,7200,10800]:q===1?[20520,1080,14400]:[25200,0,10800];sink+=criterionBattle(template,counts).margin;},100));
measurements.push(await bench("1M rough body criterion",1000000,(i)=>{sink+=roughBodyCriterion(100+i%17,90,roughSignatures[i%16]!,i%11/10);},1000));
measurements.push(await bench("Criterion official coefficient compilation",300,()=>{sink+=compileCriterionTemplate(head).a.normal[0]!;}));
measurements.push(await bench("DeterministicTheory",1000,()=>{sink+=estimateTheoryCandidate(theory,[57,3,40]).theoryScore;}));
measurements.push(await bench("BattleEngine fast",300,(i)=>{sink+=formal.runFastTrial(i+500000).roundCount;}));
// Small real-engine ranking study: same opponent/panels/seeds, varied heads/ratios.
const ratios=[{shield:50,lancer:20,marksman:30},{shield:70,lancer:5,marksman:25},{shield:20,lancer:20,marksman:60}],seeds=createStageSeeds(91,100,500000),correlation=[];
for(const formation of generateAllHeadFormations(input,{fixedBodyExact:true,fixedMemberSkillIds:[]}))for(const ratio of ratios){
  const candidate={...formation,headWeaponLevels:optimizerHeadWeaponLevels(input,formation.leaderHeroIds),ratios:ratio},configured=candidateToInput(input,candidate),t=compileCriterionTemplate(prepareCriterionHead(configured)),counts=TROOP_TYPES.map((kind)=>t.a.counts.reduce((n,v)=>n+v,0)*ratio[kind]/100) as unknown as Triple;
  const estimate=criterionBattle(t,counts),compiled=compileValidationBattle(configured),wins=seeds.filter((seed)=>compiled.runFastTrial(seed).outcome==="A").length;
  correlation.push({candidate,criterionMargin:estimate.margin,uncertainty:estimate.uncertainty,formalWins:wins,formalTrials:seeds.length,formalWinRate:wins/seeds.length});
}
const ranks=(values:number[])=>values.map((v)=>1+values.filter((w)=>w<v).length+(values.filter((w)=>w===v).length-1)/2);
const pearson=(a:number[],b:number[])=>{const ma=a.reduce((n,v)=>n+v,0)/a.length,mb=b.reduce((n,v)=>n+v,0)/b.length,cov=a.reduce((n,v,i)=>n+(v-ma)*(b[i]!-mb),0),den=Math.sqrt(a.reduce((n,v)=>n+(v-ma)**2,0)*b.reduce((n,v)=>n+(v-mb)**2,0));return den?cov/den:null;};
await new Promise<void>((resolve)=>setTimeout(resolve,50));
for(const row of measurements){const events=gcEntries.filter((e)=>e.start>=row.wallStartMs&&e.start<=row.wallStartMs+row.wallMs);row.gc={events:events.length,durationMs:events.reduce((n,e)=>n+e.duration,0)};}
const report={recordedAt:new Date().toISOString(),node:process.version,provenance:"Synthetic six-hero equal panels; real numeric functions and real formal BattleEngine; single-thread. Timing excludes allocation sampling pass. No real 89.8% configuration supplied.",
  measurements,rankingStudy:{candidates:correlation.length,trialsPerCandidate:100,formalRuns:correlation.length*100,spearman:pearson(ranks(correlation.map((r)=>r.criterionMargin)),ranks(correlation.map((r)=>r.formalWinRate))),rows:correlation},
  notes:["heapNetDelta is retained/net heap, not allocation count","allocations are statistical V8 estimates; exact object count unavailable","batched p50/p95 are batch-average per evaluation, not individual tail latency","includes timer overhead; microbench targets are not acceptance assertions"],sink};
writeFileSync("examples/criterion-microbenchmark.json",JSON.stringify(report,null,2));observer.disconnect();process.stdout.write(`ranking study ${correlation.length} candidates completed\n`);
