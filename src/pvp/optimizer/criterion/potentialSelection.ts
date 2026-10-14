/** Global theoretical selection. There is deliberately no per-head floor. */
export interface PotentialCandidate {
  readonly key:string; readonly headKey:string; readonly baseCriterion:number;
  readonly optimisticBodyPotential:number; readonly potentialScore:number;
  readonly uncertainty:number; readonly specialMechanism:boolean;
  readonly disagreement:number; readonly structuralKey:string;
  readonly protected?:boolean;
}
export interface PotentialSelectionOptions {
  readonly limit:number; readonly mainShare:number; readonly protectionShare:number; readonly diversityShare:number;
}
export function selectGlobalPotential<T extends PotentialCandidate>(rows:readonly T[],options:PotentialSelectionOptions) {
  const ranked=[...rows].sort((a,b)=>b.potentialScore-a.potentialScore||a.key.localeCompare(b.key));
  const selected=new Map<string,T>(), reasons=new Map<string,string[]>();
  const add=(row:T,reason:string)=>{selected.set(row.key,row);reasons.set(row.key,[...(reasons.get(row.key)??[]),reason]);};
  const limit=Math.min(rows.length,Math.max(1,options.limit)), main=Math.max(1,Math.floor(limit*options.mainShare));
  for(const row of ranked.slice(0,main))add(row,"potentialTop");
  const mainCutoff=ranked[Math.min(main,ranked.length)-1]?.potentialScore??-Infinity;
  // Rescue theory disagreement and difficult mechanisms within a plausible
  // potential band. A wholly noncompetitive head is not rescued for coverage.
  const plausible=ranked.filter((row)=>row.potentialScore>=mainCutoff-.75);
  const protectionQuota=Math.floor(limit*options.protectionShare);
  const rescueLanes=[
    {reason:"uncertainty",score:(row:T)=>row.uncertainty},
    {reason:"specialMechanism",score:(row:T)=>row.specialMechanism?1:0},
    {reason:"disagreement",score:(row:T)=>Math.min(1,row.disagreement)},
  ];
  let added=0;
  for(const [index,lane]of rescueLanes.entries()) {
    const quota=Math.floor(protectionQuota/3)+(index<protectionQuota%3?1:0);
    const ordered=plausible.filter((row)=>lane.score(row)>0)
      .sort((a,b)=>lane.score(b)-lane.score(a)||b.potentialScore-a.potentialScore||a.key.localeCompare(b.key));
    let laneAdded=0;for(const row of ordered)if(!selected.has(row.key)&&laneAdded<quota){
      add(row,lane.reason);reasons.get(row.key)!.push("uncertaintySpecialDisagreement");laneAdded++;added++;
    }
  }
  const structures=new Set([...selected.values()].map((row)=>row.structuralKey));added=0;
  for(const row of plausible)if(!structures.has(row.structuralKey)&&!selected.has(row.key)&&added<Math.floor(limit*options.diversityShare)) {
    structures.add(row.structuralKey);add(row,"structuralDiversity");added++;
  }
  for(const row of ranked)if(selected.size<limit&&!selected.has(row.key))add(row,"potentialFill");
  for(const row of ranked)if(row.protected)add(row,"protectedReference");
  const retained=ranked.filter((row)=>selected.has(row.key)), survivingHeads=new Set(retained.map((row)=>row.headKey));
  const bestByHead=new Map<string,number>();for(const row of ranked)if(!bestByHead.has(row.headKey))bestByHead.set(row.headKey,row.potentialScore);
  const cutoff=retained.length?Math.min(...retained.map((row)=>row.potentialScore)):null;
  return {retained,reasons,cutoff,mainCutoff,eliminatedHeads:[...bestByHead].filter(([head])=>!survivingHeads.has(head))
    .map(([headKey,bestPotential])=>({headKey,bestPotential,cutoff,reason:bestPotential<mainCutoff?"belowMainPotentialCutoff" as const:"theoreticalGlobalQuota" as const}))};
}
