import type { ReportAttribute } from "../externalBuffs";
import type { TroopType } from "../types/combat";
import { attributeOf, REPORT_ATTRIBUTES, REPORT_TROOPS, troopOf } from "./anchors";
import { bounds, sameRow } from "./layout";
import { makeValue, parsePercent } from "./values";
import type { OcrImage, OcrLine, RecognizedValue, ReportSourceSide } from "./types";
import type { AttributeSchema } from "../validationUi/attributeSchema";

export type ParsedAttributes = Record<ReportSourceSide,
  Record<TroopType, Partial<Record<ReportAttribute, RecognizedValue<number>>>>>;

function inlinePercents(text: string): number[] {
  const matches = text.matchAll(/[+\-－]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s*[%％]/g);
  return [...matches].flatMap((match) => {
    const value = parsePercent(match[0]);
    return value === undefined ? [] : [value];
  });
}

function assign(result: ParsedAttributes, side: ReportSourceSide, troop: TroopType,
  attribute: ReportAttribute, value: RecognizedValue<number>): void {
  const prior = result[side][troop][attribute];
  if (prior === undefined || value.confidence > prior.confidence) {
    result[side][troop][attribute] = value;
  }
}

export function parseAttributePage(image: OcrImage, schema: AttributeSchema = "FULL_12"): ParsedAttributes {
  if (schema !== "FULL_12") {
    // Attribute-table order, relative to OCR rows, identifies troops when their
    // names are omitted. An incomplete/ambiguous table is left for manual review.
    const generic = image.lines.filter((line) => troopOf(line.text) === undefined &&
      attributeOf(line.text) !== undefined && !/官职|专家|罪人|宠物|守城|集结|增益|减益|降低/.test(line.text))
      .sort((a, b) => bounds(a).centerY - bounds(b).centerY);
    const rows: OcrLine[][] = [];
    for (const line of generic) {
      const last = rows.at(-1);
      if (last && sameRow(last[0]!, line)) last.push(line); else rows.push([line]);
    }
    const perTroopSchema = schema === "PER_TROOP_PAIRED_6" || schema === "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9";
    const completePairedTable = perTroopSchema && rows.length === 12 &&
      rows.every((row, index) => row.every((line) => attributeOf(line.text) === REPORT_ATTRIBUTES[index % 4]));
    const orderedTroops = new Map<OcrLine, string>();
    if (completePairedTable) rows.forEach((row, index) => row.forEach((line) =>
      orderedTroops.set(line, ["盾兵", "矛兵", "射手"][Math.floor(index / 4)]!)));
    const genericAnchor = (line: OcrLine): OcrLine => {
      if (troopOf(line.text) !== undefined || /官职|专家|罪人|宠物|守城|集结|增益|减益|降低/.test(line.text)) return line;
      if (perTroopSchema) return orderedTroops.has(line)
        ? { ...line, text: `${orderedTroops.get(line)}${line.text}` } : line;
      const text = /全属性/.test(line.text) ? line.text.replace("全属性", "盾兵攻击")
        : attributeOf(line.text) !== undefined ? `盾兵${line.text}` : line.text;
      return { ...line, text };
    };
    image = { ...image, lines: image.lines.map(genericAnchor) };
  }
  const blank = (): Record<TroopType, Partial<Record<ReportAttribute, RecognizedValue<number>>>> =>
    ({ shield: {}, lancer: {}, marksman: {} });
  const result: ParsedAttributes = { left: blank(), right: blank() };
  const labels = image.lines.filter((line) => troopOf(line.text) !== undefined &&
    attributeOf(line.text) !== undefined &&
    !/官职|专家|罪人|宠物|守城|集结|增益|减益|降低/.test(line.text));
  for (const troop of REPORT_TROOPS) for (const attribute of REPORT_ATTRIBUTES) {
    const matching = labels.filter((line) =>
      troopOf(line.text) === troop && attributeOf(line.text) === attribute);
    const processed = new Set<OcrLine>();
    for (const anchor of matching) {
      if (processed.has(anchor)) continue;
      const rowAnchors = matching.filter((line) => sameRow(anchor, line))
        .sort((a, b) => bounds(a).centerX - bounds(b).centerX);
      rowAnchors.forEach((line) => processed.add(line));
      const aligned = image.lines.filter((line) => sameRow(anchor, line) &&
        parsePercent(line.text) !== undefined);
      const rowValues = (aligned.length > 0 ? aligned : image.lines.filter((line) =>
        parsePercent(line.text) !== undefined &&
        Math.abs(bounds(line).centerY - bounds(anchor).centerY) <=
          Math.max(bounds(line).height, bounds(anchor).height) * 1.5))
        .sort((a, b) => bounds(a).centerX - bounds(b).centerX);
      const structural = aligned.length > 0 ? .95 : .7;
      if (rowAnchors.length >= 2) {
        for (const [index, label] of rowAnchors.entries()) {
          if (index > 1) break;
          const next = rowAnchors[index + 1];
          const candidates = rowValues.filter((line) => line === label ||
            bounds(line).centerX >= bounds(label).centerX &&
            (next === undefined || bounds(line).centerX < bounds(next).centerX));
          const token = candidates.sort((a, b) =>
            Math.abs(bounds(a).centerX - bounds(label).centerX) -
            Math.abs(bounds(b).centerX - bounds(label).centerX))[0];
          const value = token === undefined ? undefined : parsePercent(token.text);
          if (token !== undefined && value !== undefined) assign(result, index === 0 ? "left" : "right", troop,
            attribute, makeValue(value, label, token, true, structural,
              image.enhancedLines, parsePercent));
        }
        continue;
      }
      const ownValues = inlinePercents(anchor.text);
      if (ownValues.length >= 2) {
        assign(result, "left", troop, attribute, makeValue(ownValues[0]!,
          anchor, anchor, true, .82));
        assign(result, "right", troop, attribute, makeValue(ownValues.at(-1)!,
          anchor, anchor, true, .82));
        continue;
      }
      const left = rowValues.filter((line) => bounds(line).centerX < bounds(anchor).x1)
        .sort((a, b) => bounds(b).centerX - bounds(a).centerX)[0];
      const right = rowValues.filter((line) => bounds(line).centerX > bounds(anchor).x2)
        .sort((a, b) => bounds(a).centerX - bounds(b).centerX)[0];
      if (left !== undefined && right !== undefined) {
        const leftValue = parsePercent(left.text)!;
        const rightValue = parsePercent(right.text)!;
        assign(result, "left", troop, attribute, makeValue(leftValue, anchor, left,
          true, structural, image.enhancedLines, parsePercent));
        assign(result, "right", troop, attribute, makeValue(rightValue, anchor, right,
          true, structural, image.enhancedLines, parsePercent));
      } else {
        const token = right ?? left ?? rowValues[0];
        const value = token === undefined ? undefined : parsePercent(token.text);
        if (token !== undefined && value !== undefined) {
          const side = right !== undefined && left === undefined &&
            bounds(anchor).centerX > image.width * .32 ? "right" : "left";
          assign(result, side, troop, attribute,
            makeValue(value, anchor, token, true, structural, image.enhancedLines, parsePercent));
        }
      }
    }
  }
  return result;
}
