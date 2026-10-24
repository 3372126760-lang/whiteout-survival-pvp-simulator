import {readFileSync,readdirSync,writeFileSync} from "node:fs";
import {Worker as NodeWorker} from "node:worker_threads";
import {performance} from "node:perf_hooks";
import {createDefaultValidationInput} from "../src/ui/defaultInput";
import {createEvaluationExecutor,type EvaluationJob} from "../src/pvp/optimizer/execution";
import {createStageSeeds} from "../src/pvp/optimizer/seedSet";
import {createOptimizerWorkerPool} from "../src/ui/optimizerWorkerPool";

const assets=new URL("../dist-ui/assets/",import.meta.url);
const name=readdirSync(assets).find(n=>/^optimizerCandidateWorker-.*\.js$/.test(n))!;
const source=readFileSync(new URL(name,assets),"utf8");
const wrapper=`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};${source}\nparentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});`;
let readiness:Promise<void>[]=[];
class WorkerBridge {
 onmessage:((event:{data:unknown})=>void)|null=null;
 onerror:((event:{message:string})=>void)|null=null;
 node=new NodeWorker(wrapper,{eval:true});
 constructor(){readiness.push(new Promise<void>((resolve,reject)=>{
  this.node.on("message",data=>{if(data.ready)resolve();else this.onmessage?.({data});});
  this.node.on("error",error=>{reject(error);this.onerror?.({message:error.message});});
 }));}
 postMessage(data:unknown){this.node.postMessage(data);}
 terminate(){void this.node.terminate();}
}
Object.defineProperty(globalThis,"Worker",{value:WorkerBridge,configurable:true});
Object.defineProperty(globalThis,"navigator",{value:{hardwareConcurrency:8},configurable:true});
const legacy=await import(new URL("../.tmp/overnight-baseline/src/ui/optimizerWorkerPool.ts",import.meta.url).href);
const base=createDefaultValidationInput();
const jobs:EvaluationJob[]=Array.from({length:24},(_,i)=>({kind:"battle",side:"A",collectOutcomes:true,
 input:{...base,maxRounds:30,randomSeed:i},seeds:createStageSeeds(91+i,15)}));
const expected=jobs.map(createEvaluationExecutor()).map(r=>JSON.stringify(r.samples));
async function run(factory:typeof createOptimizerWorkerPool,label:string){
 readiness=[];const pool=factory();await Promise.all(readiness);
 const times:number[]=[],builds:number[]=[],hits:number[]=[];
 try{for(let repeat=0;repeat<3;repeat++){
  const start=performance.now(),rows=[];
  for(let i=0;i<jobs.length;i+=4)rows.push(...await pool.run(jobs.slice(i,i+4)));
  times.push(performance.now()-start);builds.push(rows.reduce((n,r)=>n+r.performance.templateBuilds,0));hits.push(rows.reduce((n,r)=>n+r.performance.templateHits,0));
  if(rows.some((r,i)=>JSON.stringify(r.samples)!==expected[i]))throw new Error(label+" changed seeded results");
 }}finally{pool.close();}
 return {label,times,templateBuilds:builds,templateHits:hits,seededResultsMatch:true,jobs:jobs.length,trials:360};
}
const rows=[];
rows.push(await run(legacy.createOptimizerWorkerPool,"baseline"));
rows.push(await run(createOptimizerWorkerPool,"balanced"));
writeFileSync(new URL("../.tmp/overnight-worker-benchmark.json",import.meta.url),JSON.stringify(rows,null,2));
process.stdout.write(JSON.stringify(rows,null,2)+"\n");
