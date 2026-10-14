import {readFileSync,writeFileSync} from "node:fs";
import {createEvaluationExecutor,type TrajectoryObservation} from "../src/pvp/optimizer/execution";
import type {ValidationBattleInput} from "../src/pvp/validationUi/types";
import type {summarizeTrajectoryScheduler} from "../src/pvp/optimizer/trajectorySamples";
type Statistics=ReturnType<typeof summarizeTrajectoryScheduler>;
interface Audit {formalStages:{selection:{candidateKey:string}[];schedulerStatistics:Statistics}[];scheduler:Statistics;
  recommendedScheduler:Statistics;failureContextReplay?:unknown}
const path="examples/ice-fire-schema-audit.json";
const audit=JSON.parse(readFileSync(path,"utf8")) as Audit;
const input=JSON.parse(readFileSync("examples/ice-fire-search-validation-input.json","utf8")) as ValidationBattleInput;
const execute=createEvaluationExecutor();let replayed=0;
for(const stage of audit.formalStages){
  const seeds=[...new Set(stage.schedulerStatistics.failedTrials.map((row)=>row.seed))];
  const failures:TrajectoryObservation[]=[];
  for(const {candidateKey} of stage.selection){
    if(!seeds.length)break;
    const parts=candidateKey.split("|");
    if(parts.some((part)=>part.split(":")[0]!=="//"))throw new Error("This recovery script applies only to the saved EMPTY_HEAD fixture.");
    const queues=input.sideA.threeQueues!.map((queue,index)=>{
      const ratio=parts[index]!.split(":")[1]!.split("/").map(Number);
      return {...queue,ratios:{shield:ratio[0]!/100,lancer:ratio[1]!/100,marksman:ratio[2]!/100}};
    }) as unknown as NonNullable<typeof input.sideA.threeQueues>;
    const result=execute({kind:"threeQueue",input:{...input,sideA:{...input.sideA,threeQueues:queues}},side:"A",seeds,collectTrajectories:true});
    replayed+=seeds.length;
    failures.push(...result.samples.trajectories!.filter((row)=>row.outcome==="failed").map((row)=>({...row,candidateKey})));
  }
  if(failures.length!==stage.schedulerStatistics.failedTrajectories)throw new Error("Failure replays must exactly reproduce the recorded aggregate.");
  stage.schedulerStatistics={...stage.schedulerStatistics,failedTrials:failures,
    simultaneousEliminationCount:failures.filter((row)=>row.failureReason==="simultaneousElimination").length,
    unknownFailureCount:failures.filter((row)=>row.failureReason==="unknown").length};
}
audit.scheduler=audit.formalStages.at(-1)!.schedulerStatistics;
const bestKey=audit.formalStages.at(-1)!.selection[0]!.candidateKey;
const bestFailures=audit.scheduler.failedTrials.filter((row)=>row.candidateKey===bestKey);
audit.recommendedScheduler={...audit.recommendedScheduler,failedTrials:bestFailures,
  simultaneousEliminationCount:bestFailures.filter((row)=>row.failureReason==="simultaneousElimination").length,
  unknownFailureCount:bestFailures.filter((row)=>row.failureReason==="unknown").length};
audit.failureContextReplay={replayedTrajectories:replayed,scope:"only recorded failed seeds × recorded candidate identities; no additional optimizer samples or ranking change"};
writeFileSync(path,JSON.stringify(audit,null,2));
console.log(JSON.stringify({replayed,finalFailures:audit.scheduler.failedTrajectories,
  simultaneousEliminations:audit.scheduler.simultaneousEliminationCount,maxRoundHitCount:audit.scheduler.maxRoundHitCount,
  example:audit.scheduler.failedTrials[0]},null,2));
