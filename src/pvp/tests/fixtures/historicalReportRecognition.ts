// Historical report/parser fixtures only. The application OCR entry point is attributes-only.
import { parseAttributePage } from "../../battleReportRecognition/attributeParser";
import { parseSpecialBonusPage } from "../../battleReportRecognition/specialBonusParser";
import { parseTroopPage } from "../../battleReportRecognition/troopParser";
import { detectPageType } from "../../battleReportRecognition/layout";
import { allValues, reportWarnings } from "../../battleReportRecognition/reportData";
import { TROOP_APPROXIMATION_WARNING } from "../../battleReportRecognition/troopResolution";
import type { OcrImage, ParsedBattleReport, ParsedBattleReportSide } from "../../battleReportRecognition/types";
export function normalizeRecognitionResult(image: OcrImage): ParsedBattleReport {
  const pageType = detectPageType(image), attributes = parseAttributePage(image), special = parseSpecialBonusPage(image), troops = parseTroopPage(image);
  const column = (source: "left" | "right"): ParsedBattleReportSide => ({ sourceSide: source,
    attributes: attributes[source], troopSetup: troops[source] ?? {shield:{},lancer:{},marksman:{}},
    specialBonuses: {additive:special.sides[source].additive,buffs:special.sides[source].buffs,debuffs:special.sides[source].debuffs},
    unmatchedBonuses:special.sides[source].unmatchedBonuses,specialEvidence:special.sides[source].evidence });
  const left = column("left"), right = column("right");
  const report: ParsedBattleReport = {imageId:image.imageId,imageIds:[image.imageId],pageType,pageTypes:[pageType],
    ...(allValues(left).length || left.specialEvidence ? {left} : {}), ...(allValues(right).length || right.specialEvidence ? {right} : {}), warnings:[],confidence:0};
  const values = [left,right].flatMap(allValues);
  return {...report,warnings:[...reportWarnings(report),...special.warnings,
    ...([left,right].some((side)=>Object.values(side.troopSetup).some((setup)=>setup.resolutionSource==="battleReportApproximation"))?[TROOP_APPROXIMATION_WARNING]:[]),
    ...(pageType==="unknown"?["未能识别页面类型，请核对图片。"]:[])],confidence:values.length?Math.min(...values.map((v)=>v.finalConfidence??v.confidence)):0};
}
