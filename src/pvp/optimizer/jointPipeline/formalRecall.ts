import {candidateKey} from "../candidateGenerator";
import {TROOP_TYPES} from "../../types";
import type {RallyCandidate} from "../types";

/** Keep the formal budget fixed, reserving at most 10% for candidates which
 * numerical cutoffs would omit. Prefer unrepresented heads, then boundary rows.
 * The formal engine, rather than this recall policy, determines promotion. */
export function recallFormalCandidates(ranked:readonly RallyCandidate[],alternatives:readonly RallyCandidate[],budget:number):RallyCandidate[]{
 const slots=Math.max(1,Math.floor(budget*.1)),keep=Math.max(1,budget-slots);
 const rows=ranked.slice(0,keep),keys=new Set(rows.map(row=>candidateKey(row)));
 const head=(row:RallyCandidate)=>TROOP_TYPES.map(t=>row.leaderHeroIds[t]??"").join("|");
 const heads=new Set(rows.map(head));
 const add=(row:RallyCandidate)=>{if(rows.length>=budget||keys.has(candidateKey(row)))return;rows.push(row);keys.add(candidateKey(row));heads.add(head(row));};
 for(const row of alternatives)if(!heads.has(head(row)))add(row);
 for(const row of ranked.slice(keep,budget+slots))add(row);
 for(const row of alternatives)add(row);
 return rows;
}
