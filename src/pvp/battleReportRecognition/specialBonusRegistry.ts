import type { ReportAttribute } from "../externalBuffs";

export type BonusCategory = "additive" | "buff" | "debuff";
export interface SpecialBonusRule {
  readonly canonicalLabel: string;
  readonly aliases: readonly string[];
  readonly category: BonusCategory;
  readonly stat: ReportAttribute;
  readonly troopScope: "all" | "shield" | "lancer" | "marksman";
  readonly scope: "general" | "garrison" | "rally";
  readonly effectTarget: "self" | "enemy";
  readonly condition?: string;
}

const stats: readonly { stat: ReportAttribute; aliases: readonly string[] }[] = [
  { stat: "attack", aliases: ["攻击力", "攻击"] },
  { stat: "defense", aliases: ["防御力", "防御"] },
  { stat: "penetration", aliases: ["穿透力", "穿透"] },
  { stat: "life", aliases: ["生命值", "生命力", "生命"] },
];
const sources: readonly { label: string; aliases: readonly string[];
  category: BonusCategory; scope: SpecialBonusRule["scope"]; condition?: string }[] = [
  { label: "官职赋予部队", aliases: ["官职赋予部队", "官职赋予", "官职赐予部队", "官职赐予", "官职"],
    category: "additive", scope: "general" },
  { label: "部队", aliases: ["部队", "所有部队", "全军"], category: "buff", scope: "general" },
  { label: "宠物技能", aliases: ["宠物技能", "宠物"], category: "buff", scope: "general" },
  { label: "守城部队", aliases: ["守城部队", "守城"], category: "buff",
    scope: "garrison", condition: "garrisonDefense" },
  { label: "城镇被攻击时守城部队", aliases: ["城镇被攻击时守城部队"], category: "buff",
    scope: "garrison", condition: "garrisonDefense" },
  { label: "集结部队", aliases: ["集结部队", "集结"], category: "buff",
    scope: "rally", condition: "rally" },
  { label: "罪人", aliases: ["罪人"], category: "debuff", scope: "general" },
  { label: "专家", aliases: ["专家"], category: "debuff", scope: "general" },
  { label: "敌方", aliases: ["敌方所有部队", "敌方部队", "敌方", "敌军"], category: "debuff", scope: "general" },
  { label: "宠物技能敌方", aliases: ["宠物技能敌方部队", "宠物敌方部队", "宠物技能敌方", "宠物敌方"],
    category: "debuff", scope: "general" },
];

export const SPECIAL_BONUS_REGISTRY: readonly SpecialBonusRule[] = sources.flatMap((source) =>
  stats.map((entry) => ({ canonicalLabel: `${source.label}${entry.aliases[0]}`,
    aliases: source.aliases.flatMap((prefix) => entry.aliases.flatMap((stat) =>
      [`${prefix}${stat}`, `${prefix}${stat}增益`, `${prefix}${stat}减益`,
        `${prefix}${stat}降低`])).concat(source.label === "专家" ?
      [`敌方${entry.aliases[0]}减益（专家技能）`] : source.label === "宠物技能" ?
      entry.aliases.map((stat) => `${stat}增益（宠物技能）`) :
        source.label === "宠物技能敌方" ? entry.aliases.map((stat) =>
          `敌方${stat}减益（宠物技能）`) : []),
    category: source.category, stat: entry.stat,
    effectTarget: source.category === "debuff" ? "enemy" : "self",
    troopScope: "all" as const,
    scope: source.scope, ...(source.condition === undefined ? {} :
      { condition: source.condition }) })));

export function normalizeSpecialBonusLabel(text: string): string {
  return text.normalize("NFKC")
    // OCR separators, Unicode format characters and numerical values are not labels.
    .replaceAll(/[\p{P}\p{S}\p{N}\p{Z}\p{Cf}\s]/gu, "")
    .replaceAll("寵物", "宠物").replaceAll("部隊", "部队")
    .replaceAll("官職", "官职").replaceAll("賜予", "赐予")
    .replaceAll("攻擊", "攻击").replaceAll("防禦", "防御")
    .replaceAll("穿遗", "穿透").replaceAll("穿誘", "穿透")
    .replaceAll("攻击カ", "攻击力").replaceAll("防御カ", "防御力")
    .replaceAll(/穿透(?:力|值|属性)?/g, "穿透")
    .replaceAll(/生命(?:值|力)?/g, "生命")
    .replaceAll("攻击力", "攻击").replaceAll("防御力", "防御")
    .replaceAll("增加", "增益").replaceAll("降低", "减益")
    .replaceAll("敌军", "敌方").replaceAll("全体部队", "所有部队");
}

function similarity(left: string, right: string): number {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i]![0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0]![j] = j;
  for (let i = 1; i <= left.length; i += 1) for (let j = 1; j <= right.length; j += 1) {
    matrix[i]![j] = Math.min(matrix[i - 1]![j]! + 1, matrix[i]![j - 1]! + 1,
      matrix[i - 1]![j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1));
  }
  return 1 - matrix[left.length]![right.length]! / Math.max(left.length, right.length, 1);
}

export function matchSpecialBonusLabel(text: string):
  { readonly rule: SpecialBonusRule; readonly confidence: number;
    readonly matchType: "exact" | "alias" | "fuzzy" } | undefined {
  const clean = normalizeSpecialBonusLabel(text);
  const exactRule = SPECIAL_BONUS_REGISTRY.find((rule) =>
    normalizeSpecialBonusLabel(rule.canonicalLabel) === clean);
  if (exactRule !== undefined) return { rule: exactRule, confidence: 1,
    matchType: "exact" };
  const aliasRule = SPECIAL_BONUS_REGISTRY.find((rule) =>
    rule.aliases.some((alias) => normalizeSpecialBonusLabel(alias) === clean));
  if (aliasRule !== undefined) return { rule: aliasRule, confidence: 1,
    matchType: "alias" };
  if (!/^(官|部队|所有部队|全军|宠物|守城|城镇被攻击|集结|罪人|专家|敌方|敌军)/.test(clean) &&
    !/^(攻击|防御|穿透|生命).*(宠物技能|宠物)$/.test(clean)) {
    return undefined;
  }
  const negative = /敌方|罪人|专家/.test(clean);
  const officialCue = /官[职職]|[赐賜]予/.test(text);
  const garrisonCue = /守城|城镇被攻击/.test(clean);
  const rallyCue = /集结/.test(clean);
  const petCue = /宠物/.test(clean);
  const candidates = SPECIAL_BONUS_REGISTRY.filter((rule) =>
    (rule.category === "debuff") === negative &&
    (!officialCue || rule.category === "additive") &&
    (!garrisonCue || rule.scope === "garrison") &&
    (!rallyCue || rule.scope === "rally") &&
    (!petCue || rule.canonicalLabel.startsWith("宠物")) &&
    (rule.scope !== "garrison" || garrisonCue) &&
    (rule.scope !== "rally" || rallyCue) &&
    (rule.canonicalLabel.startsWith("宠物技能敌方") || !/敌方|敌军/.test(text) ||
      rule.category === "debuff"));
  const statText = clean.replace(/^城镇被攻击时/, "");
  const detectedStat = stats.flatMap((entry) => entry.aliases.map((alias) => ({
    stat: entry.stat, position: statText.lastIndexOf(
      normalizeSpecialBonusLabel(alias)) })))
    .sort((a, b) => b.position - a.position)[0];
  const sourceCue = petCue ? "宠物" : officialCue ? "官职" :
    garrisonCue ? /城镇被攻击/.test(clean) ? "城镇被攻击时守城部队" : "守城部队" : rallyCue ? "集结" :
      /罪人/.test(clean) ? "罪人" : /专家/.test(clean) ? "专家" :
        negative ? "敌方" : "部队";
  const ranked = candidates.filter((rule) =>
    (detectedStat === undefined || detectedStat.position < 0 || rule.stat === detectedStat.stat) &&
    rule.canonicalLabel.startsWith(sourceCue)).flatMap((rule) =>
    [rule.canonicalLabel, ...rule.aliases].map((alias) => ({
    rule, confidence: similarity(clean, normalizeSpecialBonusLabel(alias)) })))
    .sort((a, b) => b.confidence - a.confidence ||
      b.rule.canonicalLabel.length - a.rule.canonicalLabel.length);
  const best = ranked[0];
  return best !== undefined && best.confidence >= .5 ?
    { ...best, matchType: "fuzzy" } : undefined;
}

export function nearestSpecialBonusCandidates(text: string, limit = 3):
  readonly { readonly canonicalLabel: string; readonly confidence: number }[] {
  const clean = normalizeSpecialBonusLabel(text);
  const ranked = SPECIAL_BONUS_REGISTRY.map((rule) => ({
    canonicalLabel: rule.canonicalLabel,
    confidence: Math.max(...rule.aliases.map((alias) =>
      similarity(clean, normalizeSpecialBonusLabel(alias)))),
  })).sort((a, b) => b.confidence - a.confidence ||
    a.canonicalLabel.localeCompare(b.canonicalLabel));
  return ranked.slice(0, Math.max(0, limit));
}
