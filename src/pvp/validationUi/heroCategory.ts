/** R/SR are independent categories; only the S series has an S generation. */
export type HeroCategory = "R" | "SR" | "S";
export interface HeroCategorySource {
  readonly rarity?: string;
  readonly category?: HeroCategory;
  /** Legacy field, read only for S heroes. */
  readonly generation?: number | null;
  readonly sGeneration?: number;
}
export function heroCategory(hero: HeroCategorySource): HeroCategory {
  if (hero.rarity === "R" || hero.rarity === "SR") return hero.rarity;
  return hero.category ?? "S";
}
export function heroSGeneration(hero: HeroCategorySource): number | undefined {
  if (heroCategory(hero) !== "S") return undefined;
  const value = hero.sGeneration ?? hero.generation;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}
export function heroCategoryMetadata(hero: HeroCategorySource) {
  const category = heroCategory(hero), sGeneration = heroSGeneration(hero);
  return { category, ...(sGeneration === undefined ? {} : { sGeneration }) };
}
export function heroCategoryLabel(hero: HeroCategorySource): string {
  const category = heroCategory(hero), generation = heroSGeneration(hero);
  return category === "S" && generation !== undefined ? `S${generation}` : category;
}
export function heroRegistryCategoryCounts(heroes: readonly HeroCategorySource[]) {
  return { rHeroCount: heroes.filter((hero) => heroCategory(hero) === "R").length,
    srHeroCount: heroes.filter((hero) => heroCategory(hero) === "SR").length,
    sHeroCount: heroes.filter((hero) => heroCategory(hero) === "S").length };
}
