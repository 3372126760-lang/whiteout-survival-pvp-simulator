import { attributeOf } from "./anchors";
import { bounds, sameRow } from "./layout";
import { matchSpecialBonusLabel, nearestSpecialBonusCandidates,
  normalizeSpecialBonusLabel, type BonusCategory } from "./specialBonusRegistry";
import { makeValue, parsePercent } from "./values";
import type { OcrImage, OcrLine, ParsedSpecialBonus, ReportSourceSide,
  SpecialBonusRowQuality, UnmatchedSpecialBonus } from "./types";

export interface ParsedSpecialPage {
  readonly sides: Readonly<Record<ReportSourceSide, {
    readonly additive: readonly ParsedSpecialBonus[];
    readonly buffs: readonly ParsedSpecialBonus[];
    readonly debuffs: readonly ParsedSpecialBonus[];
    readonly unmatchedBonuses: readonly UnmatchedSpecialBonus[];
    readonly evidence: boolean;
  }>>;
  readonly warnings: readonly string[];
}

export function parseSpecialBonusPage(image: OcrImage): ParsedSpecialPage {
  const blank = () => ({ additive: [] as ParsedSpecialBonus[],
    buffs: [] as ParsedSpecialBonus[], debuffs: [] as ParsedSpecialBonus[],
    unmatchedBonuses: [] as UnmatchedSpecialBonus[],
    evidence: false });
  const sides = { left: blank(), right: blank() };
  const warnings: string[] = [];
  const specialSection = image.lines.some((line) => /特殊加成说明/.test(line.text));
  const labels = image.lines.filter((line) => matchSpecialBonusLabel(line.text) !== undefined ||
    attributeOf(line.text) !== undefined &&
    (/官职|宠物|寵物|部队|部隊|守城|城镇被攻击|集结|专家|罪人|敌方|敌军|全军/.test(line.text) ||
      specialSection && !/^(盾兵|矛兵|射手)/.test(line.text)));
  const used = new Set<OcrLine>();
  for (const label of labels) {
    if (used.has(label)) continue;
    const sameLabels = labels.filter((other) => sameRow(label, other))
      .sort((a, b) => bounds(a).centerX - bounds(b).centerX);
    sameLabels.forEach((item) => used.add(item));
    const aligned = image.lines.filter((line) => sameRow(label, line) &&
      parsePercent(line.text) !== undefined);
    const values = (aligned.length > 0 ? aligned : image.lines.filter((line) =>
      parsePercent(line.text) !== undefined &&
      Math.abs(bounds(line).centerY - bounds(label).centerY) <=
        Math.max(bounds(line).height, bounds(label).height) * 1.5))
      .sort((a, b) => bounds(a).centerX - bounds(b).centerX);
    for (const [index, anchor] of sameLabels.entries()) {
      const match = matchSpecialBonusLabel(anchor.text);
      const paired = sameLabels.length >= 2 ? values.filter((value) => value === anchor ||
        bounds(value).centerX >= bounds(anchor).centerX &&
        (sameLabels[index + 1] === undefined ||
          bounds(value).centerX < bounds(sameLabels[index + 1]!).centerX)) : values;
      const own = parsePercent(anchor.text);
      const inlineValues = [...anchor.text.matchAll(/[+\-－]?\d+(?:\.\d{1,2})?\s*[%％]/g)]
        .flatMap((match) => parsePercent(match[0]) ?? []);
      const left = paired.filter((value) => bounds(value).centerX < bounds(anchor).x1).at(-1);
      const right = paired.find((value) => bounds(value).centerX > bounds(anchor).x2);
      if (match === undefined) {
        const addUnknown = (side: ReportSourceSide, token?: OcrLine,
          number?: number) => {
          const possibleAttribute = attributeOf(anchor.text);
          const amount = token === undefined || number === undefined ? undefined :
            makeValue(Math.abs(number), anchor, token, true, .7,
              image.enhancedLines, (text) => { const parsed = parsePercent(text);
                return parsed === undefined ? undefined : Math.abs(parsed); });
          sides[side].unmatchedBonuses.push({ rawText: anchor.text,
            normalizedText: normalizeSpecialBonusLabel(anchor.text),
            ...(possibleAttribute === undefined ? {} : { possibleAttribute }),
            nearestRegistryCandidates: nearestSpecialBonusCandidates(anchor.text),
            ...(amount === undefined ? {} : { amount }) });
          sides[side].evidence = true;
        };
        if (sameLabels.length === 1 && inlineValues.length >= 2) {
          addUnknown("left", anchor, inlineValues[0]);
          addUnknown("right", anchor, inlineValues.at(-1));
        } else if (sameLabels.length >= 2) {
          const token = own !== undefined ? anchor : right ?? paired[0];
          addUnknown(index === 0 ? "left" : "right", token,
            token === undefined ? undefined : parsePercent(token.text));
        } else if (left !== undefined && right !== undefined) {
          addUnknown("left", left, parsePercent(left.text));
          addUnknown("right", right, parsePercent(right.text));
        } else {
          const token = own !== undefined ? anchor : right ?? left ?? paired[0];
          const side = right !== undefined && left === undefined &&
            bounds(anchor).centerX > image.width * .32 ? "right" : "left";
          addUnknown(side, token, token === undefined ? undefined :
            parsePercent(token.text));
        }
        warnings.push(`特殊加成名称未能归类：${anchor.text}`);
        continue;
      }
      const add = (side: ReportSourceSide, token: OcrLine, number: number,
        inline = false) => {
        const detected = makeValue(Math.abs(number), anchor, token, true,
          Math.min(inline ? .98 : aligned.length > 0 ? .98 : .7,
            match.confidence),
          inline ? undefined : image.enhancedLines,
          (text) => { const parsed = parsePercent(text);
            return parsed === undefined ? undefined : Math.abs(parsed); });
        const labelBox = bounds(anchor);
        const valueBox = bounds(token);
        const bbox = { x1: Math.min(labelBox.x1, valueBox.x1),
          y1: Math.min(labelBox.y1, valueBox.y1),
          x2: Math.max(labelBox.x2, valueBox.x2),
          y2: Math.max(labelBox.y2, valueBox.y2) };
        const rowHeight = Math.max(labelBox.height, valueBox.height, 1);
        const isNearTopEdge = bbox.y1 < rowHeight * .7;
        const isNearBottomEdge = image.height - bbox.y2 < rowHeight * .7;
        const isPartiallyClipped = bbox.y1 <= 0 || bbox.y2 >= image.height ||
          bbox.x1 <= 0 || bbox.x2 >= image.width;
        const structuralConfidence = Math.min(detected.structuralConfidence ?? 1,
          isPartiallyClipped ? .55 : isNearTopEdge || isNearBottomEdge ? .8 : 1);
        const finalConfidence = Math.min(detected.finalConfidence ?? detected.confidence,
          structuralConfidence);
        const rowQuality: SpecialBonusRowQuality = {
          labelConfidence: anchor.confidence, valueConfidence: token.confidence,
          structuralConfidence, finalConfidence, isNearTopEdge,
          isNearBottomEdge, isPartiallyClipped };
        const amount = { ...detected, confidence: finalConfidence, finalConfidence,
          structuralConfidence, needsConfirmation: detected.needsConfirmation ||
            finalConfidence < .85 };
        const rawText = anchor === token ? anchor.text : `${anchor.text} ${token.text}`;
        const entry: ParsedSpecialBonus = {
          label: anchor.text, canonicalLabel: match.rule.canonicalLabel,
          sourceReportSide: side,
          matchConfidence: match.confidence, matchScore: match.confidence, matchType: match.matchType,
          rowQuality, sources: [{ ...rowQuality, imageId: image.imageId,
            imageIndex: 0, rawText, normalizedText: normalizeSpecialBonusLabel(rawText),
            bbox, matchType: match.matchType, value: amount.value }],
          attribute: match.rule.stat,
          amount, scope: match.rule.scope, category: match.rule.category,
          troopScope: match.rule.troopScope, activeInThisBattle: true,
          effectTarget: match.rule.effectTarget };
        const group: Record<BonusCategory, "additive" | "buffs" | "debuffs"> =
          { additive: "additive", buff: "buffs", debuff: "debuffs" };
        sides[side][group[match.rule.category]].push(entry);
        sides[side].evidence = true;
      };
      if (sameLabels.length === 1 && inlineValues.length >= 2) {
        add("left", anchor, inlineValues[0]!, true);
        add("right", anchor, inlineValues.at(-1)!, true);
      } else if (sameLabels.length >= 2) {
        const token = own !== undefined ? anchor : right ?? paired[0];
        const number = token === undefined ? undefined : parsePercent(token.text);
        if (token !== undefined && number !== undefined) add(index === 0 ? "left" : "right", token, number);
      } else if (left !== undefined && right !== undefined) {
        add("left", left, parsePercent(left.text)!);
        add("right", right, parsePercent(right.text)!);
      } else {
        const token = own !== undefined ? anchor : right ?? left ?? paired[0];
        const number = token === undefined ? undefined : parsePercent(token.text);
        if (token !== undefined && number !== undefined) {
          const side = right !== undefined && left === undefined &&
            bounds(anchor).centerX > image.width * .32 ? "right" : "left";
          add(side, token, number);
        }
        else warnings.push(`特殊加成数值未识别：${anchor.text}`);
      }
    }
  }
  if (image.lines.some((line) => /无特殊加成|特殊加成[:：]?无/.test(line.text))) {
    sides.left.evidence = true;
  }
  return { sides, warnings };
}
