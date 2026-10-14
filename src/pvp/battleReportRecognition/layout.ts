import type { OcrImage, OcrLine, ReportPageType } from "./types";

export interface TextBounds {
  readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number;
  readonly centerX: number; readonly centerY: number;
  readonly width: number; readonly height: number;
}

export function bounds(line: OcrLine): TextBounds {
  const x1 = Math.min(...line.box.map((point) => point[0]));
  const y1 = Math.min(...line.box.map((point) => point[1]));
  const x2 = Math.max(...line.box.map((point) => point[0]));
  const y2 = Math.max(...line.box.map((point) => point[1]));
  return { x1, y1, x2, y2, centerX: (x1 + x2) / 2,
    centerY: (y1 + y2) / 2, width: x2 - x1, height: y2 - y1 };
}

export function sameRow(a: OcrLine, b: OcrLine, factor = .85): boolean {
  const left = bounds(a);
  const right = bounds(b);
  return Math.abs(left.centerY - right.centerY) <=
    Math.max(left.height, right.height, 8) * factor;
}

export function rowDistance(anchor: OcrLine, candidate: OcrLine): number {
  const a = bounds(anchor);
  const b = bounds(candidate);
  return Math.abs(a.centerY - b.centerY) / Math.max(a.height, b.height, 8) +
    Math.abs(a.centerX - b.centerX) / Math.max(a.width, b.width, 40) * .05;
}

export function groupRows(lines: readonly OcrLine[], factor = .85): readonly OcrLine[][] {
  const sorted = [...lines].sort((a, b) => bounds(a).centerY - bounds(b).centerY);
  const rows: OcrLine[][] = [];
  for (const line of sorted) {
    const row = rows.find((candidate) => sameRow(candidate[0]!, line, factor));
    if (row === undefined) rows.push([line]);
    else row.push(line);
  }
  return rows.map((row) => row.sort((a, b) => bounds(a).x1 - bounds(b).x1));
}

export function detectPageType(image: Pick<OcrImage, "lines">): ReportPageType {
  const text = image.lines.map((line) => line.text).join(" ");
  const special = /特殊加成说明|属性加成包含以下|官职[赋赐]予|敌方.{0,8}减益|罪人.{0,8}减益|专家.{0,8}减益|宠物.{0,8}(攻击|防御|穿透|生命)|部队.{0,8}增益|守城部队|集结部队/.test(text);
  if (special) return "specialBonuses";
  const attributeLabels = image.lines.filter((line) =>
    /盾兵|矛兵|射手|弓兵|步兵|枪兵/.test(line.text) &&
    /攻击|防御|穿透|生命/.test(line.text)).length;
  if (/属性加成/.test(text) || attributeLabels >= 2) return "attributes";
  if (/兵种等级|火晶|兵种数量|兵力/.test(text) ||
    image.lines.filter((line) => /^(?:T\s*)?(?:1[012]|[1-9])\.\d\s*级?$/.test(line.text.trim())).length >= 3) return "troops";
  if (image.lines.filter((line) => /^(?:T\s*)?(?:1[012]|[1-9])\s*级?$/.test(line.text.trim())).length >= 6 &&
    image.lines.filter((line) => /\d{3}/.test(line.text)).length >= 3) return "troops";
  return "unknown";
}
