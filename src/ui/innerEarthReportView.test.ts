import { describe,it,expect } from "vitest";
import { createDefaultValidationInput } from "./defaultInput";
import { normalizeInnerEarthInput } from "../pvp/innerEarth";
import { renderInnerEarthReport } from "./innerEarthReportView";
describe("inner earth report presentation",()=>{
 it("renders three queue comparisons without changing saved configuration",()=>{
  const input=normalizeInnerEarthInput({...createDefaultValidationInput(),scenarioType:"INNER_EARTH"});
  const before=JSON.stringify(input), html=renderInnerEarthReport(input);
  expect((html.match(/class="earth-battle-report"/g)??[])).toHaveLength(3);
  expect((html.match(/<caption>属性加成<\/caption>/g)??[])).toHaveLength(3);
  expect(html).toContain("射手生命值");
  expect(html).not.toContain("<input");
  expect(JSON.stringify(input)).toBe(before);
 });
});
