import {afterEach,expect,it,vi} from "vitest";
import {createOptimizerWorkerPool} from "./optimizerWorkerPool";
import {createDefaultValidationInput} from "./defaultInput";
import type {EvaluationJob} from "../pvp/optimizer/execution";
afterEach(()=>vi.unstubAllGlobals());
it("balances even identical-affinity jobs and preserves returned order",async()=>{
 const slots: Stub[]=[];
 class Stub {
  onmessage: ((event: {data:unknown})=>void)|null=null; onerror=null;
  jobs:{id:number,job:EvaluationJob}[]=[];
  constructor(){slots.push(this);}
  terminate(){}
  postMessage(message:{id:number,job:EvaluationJob}){this.jobs.push(message);}
 }
 vi.stubGlobal("Worker",Stub);vi.stubGlobal("navigator",{hardwareConcurrency:5});
 const pool=createOptimizerWorkerPool();
 const job:EvaluationJob={kind:"battle",input:createDefaultValidationInput(),side:"A",seeds:[1]};
 const work=pool.run([job,job,job,job]);
 await Promise.resolve();await Promise.resolve();
 expect(slots.map(s=>s.jobs.length)).toEqual([1,1,1,1]);
 slots.slice().reverse().forEach(slot=>{const message=slot.jobs[0]!;slot.onmessage!({data:{id:message.id,result:{samples:{trials:message.id},performance:{}}}});});
 const result=await work;
 expect(result.map(r=>r.samples.trials)).toEqual([0,1,2,3]);
 pool.close();
});
