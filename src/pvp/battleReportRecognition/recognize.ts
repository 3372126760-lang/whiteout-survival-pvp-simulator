import { allValues, reportWarnings, mergeBattleReports } from "./reportData";
export { reportWarnings, mergeBattleReports } from "./reportData";
import { parseAttributePage } from "./attributeParser";
import { parseSpecialBonusPage } from "./specialBonusParser";
import type { AttributeSchema } from "../validationUi/attributeSchema";
import type { OcrImage, ParsedBattleReport, ParsedBattleReportSide,
  ReportSourceSide } from "./types";

const SIDES: readonly ReportSourceSide[] = ["left", "right"];

function emptySide(sourceSide: ReportSourceSide): ParsedBattleReportSide {
  return { sourceSide, attributes: { shield: {}, lancer: {}, marksman: {} },
    troopSetup: { shield: {}, lancer: {}, marksman: {} },
    specialBonuses: { additive: [], buffs: [], debuffs: [] },
    unmatchedBonuses: [], specialEvidence: false };
}

function hasContent(side: ParsedBattleReportSide): boolean {
  return allValues(side).length > 0 || side.specialEvidence;
}

export function normalizeRecognitionResult(image: OcrImage, schema: AttributeSchema = "FULL_12"): ParsedBattleReport {
  const attributes = parseAttributePage(image, schema);
  const special = parseSpecialBonusPage(image);
  const hasAttributes = SIDES.some((name) => Object.values(attributes[name]).some((troop) => Object.keys(troop).length > 0));
  const hasSpecial = SIDES.some((name) => special.sides[name].evidence);
  const pageType = hasAttributes ? "attributes" as const : hasSpecial ? "specialBonuses" as const : "unknown" as const;
  const pageTypes = [ ...(hasAttributes ? ["attributes" as const] : []), ...(hasSpecial ? ["specialBonuses" as const] : []) ];
  const sides = Object.fromEntries(SIDES.map((name) => {
    const blank = emptySide(name);
    const data: ParsedBattleReportSide = { ...blank,
      attributes: attributes[name],
      specialBonuses: { additive: special.sides[name].additive, buffs: special.sides[name].buffs, debuffs: special.sides[name].debuffs },
      unmatchedBonuses: special.sides[name].unmatchedBonuses,
      specialEvidence: special.sides[name].evidence,
    };
    return [name, data];
  })) as Record<ReportSourceSide, ParsedBattleReportSide>;
  const result: ParsedBattleReport = { imageId: image.imageId,
    imageIds: [image.imageId], pageType, pageTypes,
    ...(hasContent(sides.left) ? { left: sides.left } : {}),
    ...(hasContent(sides.right) ? { right: sides.right } : {}),
    warnings: [], confidence: 0 };
  const values = SIDES.flatMap((name) => result[name] === undefined ? [] :
    allValues(result[name]!));
  return { ...result, warnings: [...special.warnings, ...(schema === "FULL_12" ? reportWarnings(result) : [])],
    confidence: values.length === 0 ? 0 : Math.min(...values.map((value) =>
      value.finalConfidence ?? value.confidence)) };
}

/** Public importer entry point; OCR tokens remain independent of battle state. */
export function importBattleReportImages(images: readonly OcrImage[]): ParsedBattleReport {
  return mergeBattleReports(images.map((image) => normalizeRecognitionResult(image)));
}
