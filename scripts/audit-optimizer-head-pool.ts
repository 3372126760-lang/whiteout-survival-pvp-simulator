import { writeFileSync } from "node:fs";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { getValidationCatalog, validationStageId } from "../src/pvp/validationUi";
import { isHeroAvailableAtStage } from "../src/pvp/progression";
import { optimizationHeroIds, optimizationHeroPoolFilterAudit, optimizerHeadHeroAllowed, optimizerServerGeneration, ownedHeroIds } from "../src/pvp/optimizer/heroPools";
import { optimizerGeneration } from "../src/pvp/optimizer/heroSearchPolicy";
import { TROOP_TYPES } from "../src/pvp/types";

const catalog=getValidationCatalog(),base=createDefaultValidationInput();
const {ownedHeroIds:previousOwned,availableHeroIds:previousAvailable,optimizerHeroPool:previousPool,...unrestrictedBase}=base;
void previousOwned;void previousAvailable;void previousPool;
function describe(input:typeof base) {
  const owned=new Set(ownedHeroIds(input)),pool=input.optimizerHeroPool?.A;
  const before=catalog.leaderHeroes.filter((hero)=>isHeroAvailableAtStage(hero,validationStageId(input))&&owned.has(hero.heroId)&&
    (pool?pool[hero.heroId]?.enabled===true:input.availableHeroIds===undefined||input.availableHeroIds.includes(hero.heroId)));
  const ids=new Set(optimizationHeroIds(input)),after=before.filter((hero)=>ids.has(hero.heroId)),generation=optimizerGeneration(input),minimum=Math.max(1,generation-2);
  function headCount(heroes:typeof before) {
    const total=TROOP_TYPES.reduce((v,troop)=>v*heroes.filter((hero)=>hero.troopType===troop).length,1);
    const old=TROOP_TYPES.reduce((v,troop)=>v*heroes.filter((hero)=>hero.troopType===troop&&(hero.generation??0)<minimum).length,1);
    return {allLegalHeads:total,recentEligibleHeads:total-old};
  }
  const old=headCount(before),current=headCount(after);
  return {stage:validationStageId(input),...optimizationHeroPoolFilterAudit(input),effectiveHeroGeneration:generation,
    recentGenerationWindow:[minimum,generation],...current,oldRecentEligibleHeads:old.recentEligibleHeads,
    oldRecentHeadsRemovedByRarity:old.recentEligibleHeads-current.recentEligibleHeads,rawHeadRatioCount:current.recentEligibleHeads*231,
    excludedHeroes:before.filter((hero)=>!optimizerHeadHeroAllowed(hero, optimizerServerGeneration(input))).map((hero)=>({id:hero.heroId,name:hero.name,rarity:hero.rarity,generation:hero.generation,troopType:hero.troopType}))};
}
const ssrPool=TROOP_TYPES.flatMap((troop)=>catalog.leaderHeroes.filter((hero)=>hero.troopType===troop&&hero.rarity==="SSR")
  .sort((a,b)=>(b.generation??0)-(a.generation??0)).slice(0,troop==="shield"?15:16).map((hero)=>hero.heroId));
const report={recordedAt:new Date().toISOString(),defaultUi:describe(base),allCatalogS11:describe({...unrestrictedBase,serverStage:"s11"}),
  allCatalogS16:describe({...unrestrictedBase,serverStage:"s16"}),
  oldLargeSsrFixture:describe({...unrestrictedBase,serverStage:"s16",ownedHeroIds:ssrPool,availableHeroIds:ssrPool})};
writeFileSync("examples/criterion-head-pool-round3-audit.json",JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify(report,null,2));
