import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { renderInnerEarthForm, updateInnerEarthField } from "../../ui/innerEarthView";
import { createDefaultInnerEarthConfig, normalizeInnerEarthInput, materializeInnerEarthInput } from "../innerEarth";
import { expandAttributeInput } from "../validationUi/attributeSchema";
import { ATTRIBUTE_STATS } from "../validationUi/attributeSchema";
import { TROOP_TYPES } from "../types";
import { normalizeRecognitionResult } from "../battleReportRecognition/recognize";
import { applyRecognizedAttributes, attributePreviewGroups, confirmAttributeGroup } from "../battleReportRecognition/attributeImport";
import { parsePercent } from "../battleReportRecognition/values";
import type { OcrImage, OcrLine } from "../battleReportRecognition/types";
function fixture(mode: Parameters<typeof createDefaultInnerEarthConfig>[1]) {
  const input=createDefaultValidationInput();return normalizeInnerEarthInput(input,createDefaultInnerEarthConfig(input,mode));
}
function line(text:string,y:number,confidence=.98):OcrLine {return {text,confidence,box:[[20,y],[210,y],[210,y+18],[20,y+18]]};}
function image(confidence=.98):OcrImage {return {imageId:"attributes-only",width:800,height:1200,lines:[
  ...["盾兵","矛兵","射手"].flatMap((troop,i)=>["攻击力","防御力","穿透力","生命值"].map((stat,j)=>line(`${troop}${stat} 468.0%`,40+(i*4+j)*28,confidence))),
  line("盾兵数量 999999",700),line("盾兵火晶等级 10",740),line("盾兵兵种等级 T12",780),line("官职赐予部队攻击力 5%",820)]};}
describe("mode attribute schemas and attributes-only import",()=>{
  it.each([
    ["UNDERGROUND_LAB",12,1],["GEM_MINE",6,2],["EQUIPMENT_FORGE",9,2],
    ["BEAST_CAVE",12,4],["HEART_OF_EARTH",12,4],["HERO_LAND",12,4],
  ] as const)("%s renders %s ally and %s enemy input fields",(mode,ally,enemy)=>{
    const input=fixture(mode),html=renderInnerEarthForm(input);
    const inputs=[...html.matchAll(/<input[^>]+data-field="(?:compact-attribute|attribute)"[^>]+>/g)].map((match)=>match[0]);
    expect(inputs.filter((field)=>field.includes('data-side="ally"'))).toHaveLength(ally);
    expect(inputs.filter((field)=>field.includes('data-side="enemy"'))).toHaveLength(enemy);
    if(mode==="HEART_OF_EARTH"||mode==="HERO_LAND") for(let q=0;q<3;q++)expect(inputs.filter((field)=>field.includes(`data-queue="${q}"`))).toHaveLength(4);
  });
  it.each([
    ["ALL_SHARED_1",{allStats:244},[244,244,244,244]],
    ["ATTACK_DEFENSE__PEN_LIFE_2",{attackDefense:500,penetrationLife:700},[500,500,700,700]],
    ["SHARED_BY_STAT_4",{attack:101,defense:102,penetration:103,life:104},[101,102,103,104]],
  ] as const)("%s expands to twelve independent formal cells",(schema,compact,values)=>{
    const full=expandAttributeInput(schema,compact);
    for(const troop of TROOP_TYPES)expect(ATTRIBUTE_STATS.map((stat)=>full[troop][stat])).toEqual(values);
    expect(full.shield).not.toBe(full.lancer);
    expect(()=>expandAttributeInput(schema,{})).toThrow();
  });
  it("passes shared values to the existing engine adapter while retaining queue independence",()=>{
    const original=fixture("HEART_OF_EARTH");
    const changed=updateInnerEarthField(original,{field:"compact-attribute",side:"ally",queue:"1",stat:"attack"},"2612.80");
    const enemy=updateInnerEarthField(changed,{field:"compact-attribute",side:"enemy",stat:"defense"},"244");
    const formal=materializeInnerEarthInput(enemy);
    for(const troop of TROOP_TYPES){expect(formal.sideA.threeQueues![1].attributes![troop].attack).toBe(2612.8);
      expect(formal.sideA.threeQueues![0].attributes![troop].attack).toBe(original.innerEarth!.ally.queues[0].expectedReportStats[troop].attack);
      formal.sideB.threeQueues!.forEach((queue)=>expect(queue.attributes![troop].defense).toBe(244));}
  });
  it("exposes T12 skill only for selected ally T12 and cannot edit enemy tiers",()=>{
    const lab=fixture("UNDERGROUND_LAB");expect(renderInnerEarthForm(lab)).not.toContain('data-field="t12"');
    expect(renderInnerEarthForm(lab)).toContain("敌方兵种等级：T10（固定）");
    const selected=updateInnerEarthField(lab,{field:"tier",side:"ally",troop:"lancer"},"LAB_T12");
    expect(renderInnerEarthForm(selected).match(/data-field="t12"/g)).toHaveLength(1);
    const trained=updateInnerEarthField(selected,{field:"t12",troop:"lancer"},"3");
    const reset=updateInnerEarthField(trained,{field:"tier",troop:"lancer"},"LAB_T11");
    expect(reset.innerEarth!.ally.t12SkillLevels.lancer).toBe(0);
    expect(()=>updateInnerEarthField(lab,{field:"tier",side:"enemy",troop:"shield"},"LAB_T12")).toThrow(/固定/);
    expect(()=>updateInnerEarthField(lab,{field:"tier",troop:"shield"},"T12-FC7")).toThrow(/无火晶/);
  });
  it("OCR ignores troop tokens while retaining historical special bonuses",()=>{
    const parsed=normalizeRecognitionResult(image());expect(parsed.left).toBeDefined();
    expect(parsed.left!.troopSetup).toEqual({shield:{},lancer:{},marksman:{}});
    expect(parsed.left!.specialBonuses!.additive).toHaveLength(1);
    expect(parsed.left!.specialBonuses!.additive[0]).toMatchObject({ attribute:"attack", category:"additive", activeInThisBattle:true });
    expect(parsed.warnings.some((warning)=>/火晶|兵种|特殊/.test(warning))).toBe(false);
    expect(attributePreviewGroups(parsed.left,"FULL_12")).toHaveLength(12);
  });
  it.each(["ALL_SHARED_1","ATTACK_DEFENSE__PEN_LIFE_2","SHARED_BY_STAT_4"] as const)("groups repeated OCR values with %s",(schema)=>{
    const groups=attributePreviewGroups(normalizeRecognitionResult(image(),schema).left,schema);
    expect(groups.every((group)=>group.item?.value===468&&!group.needsConfirmation)).toBe(true);
  });
  it("reads generic four-stat anchors using row geometry and repairs numeric O without troop inference",()=>{
    const parsed=normalizeRecognitionResult({...image(),lines:[line("攻击 468.O%",20),line("防御 468.0%",50),line("穿透 468.0%",80),line("生命 468.0%",110)]},"SHARED_BY_STAT_4");
    expect(parsePercent("468.O%")).toBe(468);
    expect(attributePreviewGroups(parsed.left,"SHARED_BY_STAT_4").map((group)=>group.item?.value)).toEqual([468,468,468,468]);
  });
  it("blocks low confidence and conflicting shared values until explicit review",()=>{
    const input=fixture("GEM_MINE"),report=normalizeRecognitionResult(image(.4));
    expect(()=>applyRecognizedAttributes(input,report.left!,"A")).toThrow(/确认/);
    let reviewed=report.left!;
    for(const troop of TROOP_TYPES){reviewed=confirmAttributeGroup(reviewed,"PER_TROOP_PAIRED_6",`${troop}AttackDefense`,500);
      reviewed=confirmAttributeGroup(reviewed,"PER_TROOP_PAIRED_6",`${troop}PenetrationLife`,700);}
    const applied=applyRecognizedAttributes(input,reviewed,"A");expect(applied.innerEarth!.ally.reportStats.lancer.attack).toBe(500);
    const good=normalizeRecognitionResult(image()).left!;
    const conflict={...good,attributes:{...good.attributes,shield:{...good.attributes.shield,defense:{...good.attributes.shield!.defense!,value:468.01}}}};
    expect(attributePreviewGroups(conflict,"PER_TROOP_PAIRED_6")[0]!.conflict).toBe(true);
    expect(()=>applyRecognizedAttributes(input,conflict,"A")).toThrow(/确认/);
  });
  it("keeps preview isolated and commits attributes atomically without touching troop configuration",()=>{
    const input=createDefaultValidationInput(),before=structuredClone(input),parsed=normalizeRecognitionResult(image());
    expect(input).toEqual(before);
    const applied=applyRecognizedAttributes(input,parsed.left!,"A");
    for(const troop of TROOP_TYPES){expect(applied.sideA.troops[troop].attack).toBe(468);
      expect(applied.sideA.troops[troop].count).toBe(input.sideA.troops[troop].count);
      expect(applied.sideA.troops[troop].troopLevel).toBe(input.sideA.troops[troop].troopLevel);}
    expect(applied.sideB).toBe(input.sideB);expect(applied.sideA.leaderHeroIds).toEqual(input.sideA.leaderHeroIds);expect(input).toEqual(before);
  });
  it("allows explicit manual completion of missing OCR attributes while enforcing 0.01% precision",()=>{
    const blank = {sourceSide:"left" as const,attributes:{},troopSetup:{},specialEvidence:false};
    expect(()=>confirmAttributeGroup(blank,"ALL_SHARED_1","allStats",244.001)).toThrow(/两位/);
    const reviewed=confirmAttributeGroup(blank,"ALL_SHARED_1","allStats",244.01);
    expect(attributePreviewGroups(reviewed,"ALL_SHARED_1")[0]!.needsConfirmation).toBe(false);
    expect(applyRecognizedAttributes(fixture("UNDERGROUND_LAB"),reviewed,"B").innerEarth!.enemy.shared.expectedReportStats.marksman.life).toBe(244.01);
  });
  it("applies only the selected Heart ally queue and all shared enemy stats, leaving pets and base fields fixed",()=>{
    const input=fixture("HEART_OF_EARTH"),before=structuredClone(input.innerEarth!),parsed=normalizeRecognitionResult(image()).left!;
    const ally=applyRecognizedAttributes(input,parsed,"A",1);
    expect(ally.innerEarth!.ally.queues[1].expectedReportStats.shield.attack).toBe(468);
    expect(ally.innerEarth!.ally.queues[0]).toEqual(before.ally.queues[0]);
    expect(ally.innerEarth!.ally.queues[2]).toEqual(before.ally.queues[2]);
    expect(ally.innerEarth!.ally.reportStats).toEqual(before.ally.reportStats);
    expect(ally.innerEarth!.petContext).toEqual(before.petContext);
    const enemy=materializeInnerEarthInput(applyRecognizedAttributes(ally,parsed,"B"));
    enemy.sideB.threeQueues!.forEach((queue)=>TROOP_TYPES.forEach((troop)=>expect(queue.attributes![troop].life).toBe(468)));
  });
});
