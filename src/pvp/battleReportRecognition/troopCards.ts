import { REPORT_TROOPS } from "./anchors";
import { bounds } from "./layout";
import type { OcrImage, OcrLine, ReportSourceSide } from "./types";
import type { TroopType } from "../types/combat";
import { parseCount } from "./values";

export interface CardRegion {
  readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number;
}
export interface TroopCardRegion {
  readonly cardId: string;
  readonly side: ReportSourceSide;
  readonly troop: TroopType;
  readonly anchor: OcrLine;
  readonly bbox: CardRegion;
  /** Portrait estimate derived from slot spacing and the level anchor. */
  readonly portraitBBox: CardRegion;
  readonly troopSlotBBox: CardRegion;
  readonly fireCrystalRoi: CardRegion;
  readonly fireCrystalFallbackRoi: CardRegion;
  readonly countRoi: CardRegion;
}

export function parseCardDisplayedLevel(text: string): number | undefined {
  const clean = text.normalize("NFKC").trim();
  const match = /^(?:T\s*)?(1[012]|[1-9])(?:\.(\d))?\s*级?$/.exec(clean);
  return match === null ? undefined : Number(`${match[1]}.${match[2] ?? "0"}`);
}

/** Card boundaries come from repeated level anchors, never screen pixel constants. */
export function detectTroopCardRegions(image: OcrImage): readonly TroopCardRegion[] {
  const lines = [...image.lines];
  for (const enhanced of image.enhancedLines ?? []) {
    if (parseCardDisplayedLevel(enhanced.text) === undefined || lines.some((line) => {
      const a = bounds(line), b = bounds(enhanced);
      return Math.abs(a.centerX - b.centerX) < Math.max(a.width, b.width) * .5 &&
        Math.abs(a.centerY - b.centerY) < Math.max(a.height, b.height) * .5;
    })) continue;
    lines.push(enhanced);
  }
  const anchors = lines.filter((line) => parseCardDisplayedLevel(line.text) !== undefined);
  const groups = anchors.map((anchor) => anchors.filter((other) =>
    Math.abs(bounds(other).centerY - bounds(anchor).centerY) <=
      Math.max(bounds(other).height, bounds(anchor).height, 1) * 1.25)
    .sort((a, b) => bounds(a).centerX - bounds(b).centerX))
    .filter((group) => group.length === 6 && group.every((line, index) =>
      index === 0 || bounds(line).centerX - bounds(group[index - 1]!).centerX >
        Math.max(bounds(line).width, bounds(group[index - 1]!).width) * .6));
  const score = (group: readonly OcrLine[]): number => {
    const row = bounds(group[0]!);
    const counts = lines.filter((line) => (parseCount(line.text) ?? -1) >= 100 &&
      bounds(line).centerY > row.centerY &&
      bounds(line).centerY - row.centerY < row.height * 12);
    const nearest = counts.length ? Math.min(...counts.map((line) =>
      (bounds(line).centerY - row.centerY) / Math.max(row.height, 1))) : 20;
    return group.filter((line) => /\.\d/.test(line.text)).length * 100 +
      group.filter((line) => /级|T/i.test(line.text)).length * 10 +
      Math.min(counts.length, 6) - nearest;
  };
  const six = groups.sort((a, b) => score(b) - score(a))[0];
  if (six === undefined) return [];
  return six.map((anchor, index) => {
    const a = bounds(anchor), x = a.centerX, h = Math.max(a.height, 1);
    const previousX = index === 0 ? x - (bounds(six[1]!).centerX - x) :
      bounds(six[index - 1]!).centerX;
    const nextX = index === 5 ? x + (x - bounds(six[4]!).centerX) :
      bounds(six[index + 1]!).centerX;
    const x1 = Math.max(0, (previousX + x) / 2);
    const x2 = Math.min(image.width, (x + nextX) / 2);
    // Level font height is not portrait height. Use neighboring card spacing to
    // recover the slot, including badges protruding above/right of the portrait.
    const portraitWidth = Math.min(x - previousX, nextX - x) * .68;
    const portraitBottom = a.y1 - h * .15;
    const portraitBBox = { x1: Math.max(x1, x - portraitWidth / 2),
      x2: Math.min(x2, x + portraitWidth / 2),
      y1: Math.max(0, portraitBottom - portraitWidth), y2: Math.max(0, portraitBottom) };
    const y1 = Math.max(0, Math.min(a.centerY - h * 5, portraitBBox.y1 - portraitWidth * .35));
    const y2 = Math.min(image.height, Math.max(a.centerY + h * 10, a.y2 + portraitWidth * .95));
    const troopSlotBBox = { x1, y1, x2, y2 };
    const side = index < 3 ? "left" : "right";
    const troop = REPORT_TROOPS[index % 3]!;
    return { cardId: `${side}-${troop}`, side, troop, anchor,
      bbox: troopSlotBBox, portraitBBox, troopSlotBBox,
      fireCrystalRoi: { x1: x + portraitWidth * .1, x2, y1,
        y2: Math.min(y2, portraitBBox.y1 + portraitWidth * .6) },
      // A second anchored crop tolerates portrait estimates and different skins.
      fireCrystalFallbackRoi: { x1, x2, y1, y2: Math.min(y2, a.y2 + h * .6) },
      countRoi: { x1, x2, y1: a.y2 + h * .15, y2 } };
  });
}

export function insideCardRegion(line: OcrLine, region: CardRegion): boolean {
  const b = bounds(line);
  // A line crossing a card boundary is unsafe: do not concatenate or assign it.
  return b.x1 >= region.x1 && b.x2 <= region.x2 && b.y1 >= region.y1 && b.y2 <= region.y2;
}
