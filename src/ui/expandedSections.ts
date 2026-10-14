export type ExpandedSectionKey =
  | "advanced-debug"
  | "probability-A"
  | "probability-B"
  | "disabled-A"
  | "disabled-B";

const DEFAULT_EXPANDED_SECTIONS: readonly ExpandedSectionKey[] = [
  "probability-A",
  "probability-B",
  "disabled-A",
  "disabled-B",
];

/** UI-only state kept independently from BattleInput and render revisions. */
export function createExpandedSections(): Set<ExpandedSectionKey> {
  return new Set(DEFAULT_EXPANDED_SECTIONS);
}

export function rememberExpandedSection(
  sections: Set<ExpandedSectionKey>,
  key: ExpandedSectionKey,
  expanded: boolean,
): void {
  if (expanded) sections.add(key);
  else sections.delete(key);
}

export function isExpandedSectionKey(value: string): value is ExpandedSectionKey {
  return value === "advanced-debug" || value === "probability-A" ||
    value === "probability-B" || value === "disabled-A" || value === "disabled-B";
}
