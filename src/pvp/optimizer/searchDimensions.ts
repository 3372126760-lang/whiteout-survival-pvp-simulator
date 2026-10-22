import { TROOP_TYPES, type SideId, type TroopType } from "../types";
import { getValidationCatalog, type ValidationBattleInput } from "../validationUi";
import { optimizationHeroIds } from "./heroPools";

export type OptimizerHead = Readonly<Partial<Record<TroopType, string | null>>>;
export type SearchDimension = "head" | "ratio" | "body";
export interface SearchDimensionsAudit {
  readonly attributeInputMode: "FINAL_REPORT" | "CONFIG";
  readonly headSearchEnabled: boolean;
  readonly headFixedReason: "finalReportAttributes" | "userFixedHead" | "emptyHead" | "noEnabledHeroPool" | null;
  readonly ratioSearchEnabled: boolean;
  readonly bodySearchEnabled: boolean;
  readonly searchDimensions: readonly SearchDimension[];
  readonly headMode: "EMPTY_HEAD" | "FIXED_HEAD" | "SEARCH_HEAD";
  readonly headTemplateCount?: number;
}

/** Empty is a genuine head template, not a missing search candidate. */
export function createEmptyHeadCandidate() {
  return { headMode: "EMPTY_HEAD" as const,
    leaderHeroIds: { shield: null, lancer: null, marksman: null },
    headWeaponLevels: {} as Readonly<Record<string, number>>,
    heroSkills: [] as readonly never[], weaponEffects: [] as readonly never[] };
}
export function isEmptyHead(head: OptimizerHead): boolean {
  return TROOP_TYPES.every((troop) => head[troop] === undefined || head[troop] === null);
}
export function currentHeadHeroIds(input: ValidationBattleInput, side: SideId = "A"): OptimizerHead {
  const own = side === "A" ? input.sideA : input.sideB;
  if (own.leaderHeroIds !== undefined) return { ...own.leaderHeroIds };
  if (own.leaderHeroId === null) return createEmptyHeadCandidate().leaderHeroIds;
  const hero = getValidationCatalog().leaderHeroes.find((entry) => entry.heroId === own.leaderHeroId);
  return hero ? { [hero.troopType]: hero.heroId } : createEmptyHeadCandidate().leaderHeroIds;
}
/** The formal adapter defaults a currently equipped, unspecified weapon to Lv0.
 * The optimization pool's Lv10 default belongs only to generated new heads. */
export function currentHeadWeaponLevels(input: ValidationBattleInput, side: SideId = "A"):
  Readonly<Record<string, number>> {
  const own = side === "A" ? input.sideA : input.sideB;
  const head = currentHeadHeroIds(input, side);
  return Object.fromEntries(TROOP_TYPES.flatMap((troop) => {
    const id = head[troop]; return id ? [[id, own.simulationWeaponLevels?.[id] ?? 0]] : [];
  }));
}
export function resolveSearchDimensions(input: ValidationBattleInput, options: {
  readonly side?: SideId; readonly fixedHead?: boolean; readonly fixedRatio?: boolean;
  readonly fixedBody?: boolean;
} = {}): SearchDimensionsAudit {
  const side = options.side ?? "A";
  const finalReport = (input.attributeInputMode ?? "finalReport") === "finalReport";
  const currentEmpty = isEmptyHead(currentHeadHeroIds(input, side));
  const noEnabledHeroPool = !finalReport && !options.fixedHead && !currentEmpty && optimizationHeroIds(input, side).length === 0;
  const headSearchEnabled = !finalReport && !options.fixedHead && !currentEmpty && !noEnabledHeroPool;
  const ratioSearchEnabled = input.scenarioType !== "THREE_THREE_THREE" && !options.fixedRatio;
  const bodySearchEnabled = (input.scenarioType === "RALLY" || input.scenarioType === "CITY_DEFENSE" && side === "B") && !options.fixedBody;
  return { attributeInputMode: finalReport ? "FINAL_REPORT" : "CONFIG", headSearchEnabled,
    headFixedReason: finalReport ? "finalReportAttributes" : options.fixedHead ? "userFixedHead" : currentEmpty ? "emptyHead" : noEnabledHeroPool ? "noEnabledHeroPool" : null,
    ratioSearchEnabled, bodySearchEnabled,
    searchDimensions: [ ...(headSearchEnabled ? ["head" as const] : []),
      ...(ratioSearchEnabled ? ["ratio" as const] : []), ...(bodySearchEnabled ? ["body" as const] : []) ],
    headMode: currentEmpty ? "EMPTY_HEAD" : headSearchEnabled ? "SEARCH_HEAD" : "FIXED_HEAD",
    ...(headSearchEnabled ? {} : { headTemplateCount: 1 }) };
}
