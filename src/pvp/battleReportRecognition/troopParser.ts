import { SUPPORTED_TROOP_LEVELS } from "../data/troopConstants";
import type { TroopType } from "../types/combat";
import { REPORT_TROOPS, troopOf } from "./anchors";
import { bounds, sameRow } from "./layout";
import { makeValue, parseCount, parseCardCount } from "./values";
import type { OcrImage, OcrLine, ParsedTroopSetup, RecognizedValue,
  } from "./types";
import { resolveDisplayedBaseComposition, resolveParsedTroopSetup } from "./troopResolution";
export { resolveDisplayedBaseComposition } from "./troopResolution";

import { detectTroopCardRegions, insideCardRegion, parseCardDisplayedLevel, type TroopCardRegion } from "./troopCards";

const legal = new Set<string>(SUPPORTED_TROOP_LEVELS);

function closestValue<T>(anchor: OcrLine, lines: readonly OcrLine[],
  parse: (text: string) => T | undefined, image: OcrImage): RecognizedValue<T> | undefined {
  const own = parse(anchor.text);
  if (own !== undefined) return makeValue(own, anchor, anchor, true,
    .95, image.enhancedLines, parse);
  const candidate = lines.filter((line) => line !== anchor && sameRow(anchor, line) &&
    parse(line.text) !== undefined)
    .sort((a, b) => Math.abs(bounds(a).centerX - bounds(anchor).centerX) -
      Math.abs(bounds(b).centerX - bounds(anchor).centerX))[0];
  const value = candidate === undefined ? undefined : parse(candidate.text);
  return candidate === undefined || value === undefined ? undefined : makeValue(value, anchor, candidate,
    true, .9, image.enhancedLines, parse);
}

function displayedLevel(text: string): number | undefined {
  const match = /(?:兵种)?等级\s*[:：]?\s*(?:T\s*)?(1[012]|[1-9])(?:\.(\d))?(?!\d)/i.exec(text);
  if (match === null) return undefined;
  const level = Number(`${match[1]}.${match[2] ?? "0"}`);
  return Number.isFinite(level) ? level : undefined;
}

function actualLevel(text: string): string | undefined {
  const match = /T\s*(1[012]|[1-9])(?:\s*[-－]?\s*(?:FC|火晶)\s*(10|[1-9]))?/i.exec(text);
  return match === null ? undefined : `T${match[1]}${match[2] === undefined ? "" :
    `-FC${match[2]}`}`;
}

function fireCrystal(text: string): number | undefined {
  const match = /(?:FC|火晶(?:显示)?(?:等级)?)[\s:：-]*(10|[0-9])(?!\d)/i.exec(text);
  return match === null ? undefined : Number(match[1]);
}

function inferredCardTroops(lines: readonly OcrLine[]): ReadonlyMap<OcrLine, TroopType> {
  const levels = lines.filter((line) => /兵种等级|^等级/.test(line.text) &&
    troopOf(line.text) === undefined);
  if (levels.length !== 3) return new Map();
  const xs = levels.map((line) => bounds(line).centerX);
  const ys = levels.map((line) => bounds(line).centerY);
  const order = Math.max(...ys) - Math.min(...ys) >
    Math.max(...xs) - Math.min(...xs) ? "y" : "x";
  const sorted = [...levels].sort((a, b) =>
    bounds(a)[order === "y" ? "centerY" : "centerX"] -
    bounds(b)[order === "y" ? "centerY" : "centerX"]);
  return new Map(lines.map((line) => {
    const nearest = [...sorted].sort((a, b) =>
      Math.abs(bounds(a)[order === "y" ? "centerY" : "centerX"] -
        bounds(line)[order === "y" ? "centerY" : "centerX"]) -
      Math.abs(bounds(b)[order === "y" ? "centerY" : "centerX"] -
        bounds(line)[order === "y" ? "centerY" : "centerX"]))[0]!;
    return [line, REPORT_TROOPS[sorted.indexOf(nearest)]!] as const;
  }));
}

function parseCardFireCrystal(text: string): number | undefined {
  const labelled = fireCrystal(text.normalize("NFKC"));
  if (labelled !== undefined) return labelled;
  const bare = /^(10|[0-9])\s*级?$/.exec(text.normalize("NFKC").trim());
  return bare === null ? undefined : Number(bare[1]);
}

function selectCardValue(image: OcrImage, card: TroopCardRegion,
  field: "fireCrystal" | "count"): RecognizedValue<number> | undefined {
  const roi = field === "count" ? card.countRoi : card.fireCrystalRoi;
  const parse = field === "count" ? parseCardCount : parseCardFireCrystal;
  const within = (line: OcrLine) => (insideCardRegion(line, roi) ||
    field === "fireCrystal" && insideCardRegion(line, card.fireCrystalFallbackRoi)) &&
    !(sameRow(line, card.anchor, .4) &&
      Math.abs(bounds(line).centerX - bounds(card.anchor).centerX) < bounds(card.anchor).width * .6);
  const passes = [{ variant: "full", lines: image.lines },
    { variant: "enhanced", lines: image.enhancedLines ?? [] },
    ...(image.troopCardReadings ?? []).filter((reading) =>
      reading.cardId === card.cardId && reading.field === field).flatMap((reading) => reading.passes)];
  const candidates: { value: number; line: OcrLine; pass: string; structure: number }[] = [];
  for (const pass of passes) {
    const rows = pass.lines.filter(within);
    for (const line of rows) {
      const value = parse(line.text);
      // Level, fire crystal and skill numerals are never count candidates.
      if (value === undefined || field === "count" && value !== 0 && value < 100) continue;
      candidates.push({ value, line, pass: pass.variant,
        structure: pass.variant === "full" || pass.variant === "enhanced" ? .9 : .95 });
    }
    if (field === "count") {
      // Repair separated thousands fragments inside this one card only.
      const sorted = rows.filter((line) => /^[\d,，\s]+$/.test(line.text))
        .sort((a, b) => bounds(a).x1 - bounds(b).x1);
      for (const [index, first] of sorted.entries()) {
        const fragments = [first];
        for (const next of sorted.slice(index + 1)) {
          const previous = fragments.at(-1)!;
          if (!sameRow(first, next, .5) || bounds(next).x1 - bounds(previous).x2 >
            Math.max(bounds(first).height, bounds(next).height) * .75 ||
            !/^\s*[,，]?\d{1,3}[,，]?\s*$/.test(next.text)) break;
          fragments.push(next);
          const text = fragments.map((part) => part.text.trim()).join("");
          const value = parse(text);
          if (value === undefined || value < 100) continue;
          const b = { x1: bounds(first).x1, y1: Math.min(...fragments.map((part) => bounds(part).y1)),
            x2: bounds(next).x2, y2: Math.max(...fragments.map((part) => bounds(part).y2)) };
          candidates.push({ value, pass: pass.variant, structure: .9,
            line: { text, confidence: Math.min(...fragments.map((part) => part.confidence)),
              box: [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]] } });
        }
      }
    }
  }
  if (candidates.length === 0) return undefined;
  const groups = [...new Set(candidates.map((candidate) => candidate.value))].map((value) => {
    const members = candidates.filter((candidate) => candidate.value === value);
    const best = members.sort((a, b) => b.line.confidence - a.line.confidence)[0]!;
    return { value, best, support: new Set(members.filter((member) => member.line.confidence >= .85)
      .map((member) => member.pass)).size };
  }).sort((a, b) => b.support - a.support || b.best.line.confidence - a.best.line.confidence);
  const chosen = groups[0]!;
  const disagreement = groups.slice(1).some((other) => other.best.line.confidence >= .85 &&
    other.support >= chosen.support);
  const selected = makeValue(chosen.value, chosen.best.line, chosen.best.line, true,
    chosen.best.structure);
  return { ...selected, ...(disagreement ? { confidence: .45, finalConfidence: .45,
    needsConfirmation: true, alternatives: groups.slice(1).map((other) => other.value) } : {}) };
}

function parseSixCardRow(image: OcrImage):
  { left: Record<TroopType, ParsedTroopSetup>;
    right: Record<TroopType, ParsedTroopSetup> } | undefined {
  const cards = detectTroopCardRegions(image);
  if (cards.length !== 6) return undefined;
  const sides = { left: { shield: {}, lancer: {}, marksman: {} },
    right: { shield: {}, lancer: {}, marksman: {} } } as
      { left: Record<TroopType, ParsedTroopSetup>;
        right: Record<TroopType, ParsedTroopSetup> };
  for (const card of cards) {
    const count = selectCardValue(image, card, "count");
    const crystal = selectCardValue(image, card, "fireCrystal");
    const shown = parseCardDisplayedLevel(card.anchor.text)!;
    const display = makeValue(shown, card.anchor, card.anchor, true, .9,
      image.enhancedLines, parseCardDisplayedLevel);
    sides[card.side][card.troop] = resolveParsedTroopSetup({
      cardBbox: card.bbox,
      portraitBBox: card.portraitBBox, troopSlotBBox: card.troopSlotBBox,
      cardConfidence: Math.min(display.confidence, count?.confidence ?? 0, crystal?.confidence ?? 1),
      displayedTroopLevel: display,
      ...(count === undefined ? {} : { count }),
      ...(crystal === undefined ? {} : { displayedFireCrystalLevel: crystal, fireCrystal: crystal }),
      resolvedBaseComposition: resolveDisplayedBaseComposition(shown, count?.value) });
  }
  return sides;
}

function parseSingleTroopPage(image: OcrImage): Record<TroopType, ParsedTroopSetup> {
  const result: Record<TroopType, ParsedTroopSetup> = {
    shield: {}, lancer: {}, marksman: {},
  };
  const cardTroops = inferredCardTroops(image.lines);
  for (const line of image.lines) {
    if (/T12.*技能|技能.*T12/i.test(line.text)) continue;
    const troop = troopOf(line.text) ?? cardTroops.get(line);
    if (troop === undefined) continue;
    const inferred = troopOf(line.text) === undefined && cardTroops.has(line);
    const related = cardTroops.size === 0 ? image.lines : image.lines.filter((candidate) =>
      cardTroops.get(candidate) === troop);
    const mark = <T>(value: RecognizedValue<T>): RecognizedValue<T> => inferred ?
      { ...value, structuralConfidence: .7, finalConfidence: .7,
        confidence: .7, needsConfirmation: true } : value;
    const current = result[troop];
    if (/数量|兵力|兵数/.test(line.text)) {
      const count = closestValue(line, related, parseCount, image);
      if (count !== undefined) result[troop] = { ...current, count: mark(count) };
    }
    if (/兵种等级|(?:盾兵|矛兵|射手|步兵|枪兵|弓兵)等级|^等级|T\s*\d+\s*[-－]?\s*(FC|火晶)/i.test(line.text)) {
      const concrete = closestValue(line, related, actualLevel, image);
      if (concrete !== undefined) {
        const valid = legal.has(concrete.value);
        const candidates = SUPPORTED_TROOP_LEVELS.filter((entry) =>
          entry.startsWith(concrete.value.split("-")[0]! + "-"));
        result[troop] = { ...result[troop], level: mark({ ...concrete,
          validationConfidence: valid ? 1 : 0, finalConfidence: valid ?
            concrete.confidence : 0, confidence: valid ? concrete.confidence : 0,
          needsConfirmation: !valid || Boolean(concrete.needsConfirmation),
          ...(valid ? {} : { legalCandidates: candidates }) }) };
      }
      const display = closestValue(line, related, displayedLevel, image);
      if (display !== undefined) result[troop] = { ...result[troop],
        displayedTroopLevel: mark(display) };
    }
    if (/火晶|FC/i.test(line.text)) {
      const crystal = closestValue(line, related, fireCrystal, image);
      if (crystal !== undefined) result[troop] = { ...result[troop],
        displayedFireCrystalLevel: mark(crystal), fireCrystal: mark(crystal) };
    }
  }
  for (const troop of REPORT_TROOPS) {
    result[troop] = resolveParsedTroopSetup(result[troop]);
  }
  return result;
}

export function parseTroopPage(image: OcrImage):
  { readonly left: Record<TroopType, ParsedTroopSetup>;
    readonly right?: Record<TroopType, ParsedTroopSetup> } {
  const cards = parseSixCardRow(image);
  if (cards !== undefined) return cards;
  const labels = image.lines.filter((line) => troopOf(line.text) !== undefined &&
    /兵种等级|^等级|数量|兵力|兵数|火晶/i.test(line.text));
  const duplicated = REPORT_TROOPS.some((troop) => labels.filter((line) =>
    troopOf(line.text) === troop && /等级/.test(line.text)).length >= 2);
  if (!duplicated) return { left: parseSingleTroopPage(image) };
  const mid = image.width / 2;
  const part = (right: boolean): OcrImage => ({ ...image,
    lines: image.lines.filter((line) => (bounds(line).centerX >= mid) === right),
    ...(image.enhancedLines === undefined ? {} : { enhancedLines:
      image.enhancedLines.filter((line) =>
        (bounds(line).centerX >= mid) === right) }) });
  return { left: parseSingleTroopPage(part(false)),
    right: parseSingleTroopPage(part(true)) };
}
