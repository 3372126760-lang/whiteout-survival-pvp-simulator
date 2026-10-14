import { TROOP_TYPES } from "../types/combat";
import type { ValidationQueueAttributes } from "./types";
import type { InnerEarthMode } from "../innerEarth/types";

export const ATTRIBUTE_STATS = ["attack", "defense", "penetration", "life"] as const;
export type AttributeSchema = "FULL_12" | "ALL_SHARED_1" | "ATTACK_DEFENSE__PEN_LIFE_2" | "ALL_TROOPS_PAIRED_2" | "PER_TROOP_PAIRED_6"
  | "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9" | "SHARED_BY_STAT_4";
export type CompactAttributeInput = Readonly<Record<string, number>>;
export type StandardTroopAttributes12 = ValidationQueueAttributes;
export const ATTRIBUTE_SCHEMA_FIELDS = {
  FULL_12: [], ALL_SHARED_1: ["allStats"],
  ATTACK_DEFENSE__PEN_LIFE_2: ["attackDefense", "penetrationLife"],
  ALL_TROOPS_PAIRED_2: ["sharedAttackDefense", "sharedPenetrationLife"],
  PER_TROOP_PAIRED_6: ["shieldAttackDefense", "shieldPenetrationLife", "lancerAttackDefense", "lancerPenetrationLife", "marksmanAttackDefense", "marksmanPenetrationLife"],
  PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9: [
    "shieldAttack", "shieldDefense", "shieldPenetrationLife",
    "lancerAttack", "lancerDefense", "lancerPenetrationLife",
    "marksmanAttack", "marksmanDefense", "marksmanPenetrationLife",
  ],
  SHARED_BY_STAT_4: ATTRIBUTE_STATS,
} as const;

export function innerEarthAttributeSchema(mode: InnerEarthMode, side: "ally" | "enemy"): AttributeSchema {
  if (mode === "GEM_MINE") return side === "ally" ? "PER_TROOP_PAIRED_6" : "ALL_TROOPS_PAIRED_2";
  if (mode === "EQUIPMENT_FORGE") return side === "ally" ? "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9" : "ALL_TROOPS_PAIRED_2";
  if (mode === "HEART_OF_EARTH" || mode === "HERO_LAND" || mode === "BEAST_CAVE" && side === "enemy") return "SHARED_BY_STAT_4";
  if (mode === "UNDERGROUND_LAB" && side === "enemy") return "ALL_SHARED_1";
  return "FULL_12";
}
export function expandAttributeInput(schema: AttributeSchema,
  input: CompactAttributeInput | StandardTroopAttributes12): StandardTroopAttributes12 {
  const compact = input as CompactAttributeInput;
  const full = input as StandardTroopAttributes12;
  return Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    Object.fromEntries(ATTRIBUTE_STATS.map((stat) => {
      const value = schema === "FULL_12" ? full[troop]?.[stat] : schema === "ALL_SHARED_1" ? compact.allStats
        : schema === "SHARED_BY_STAT_4" ? compact[stat]
        : compact[attributeFieldKey(schema, troop, stat)];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= -100)
        throw new RangeError(`属性输入无效：${schema}/${troop}/${stat}`);
      return [stat, value];
    }))])) as StandardTroopAttributes12;
}
export function expandAttackDefensePenLifePair(input: { attackDefense: number; penetrationLife: number }) {
  return expandAttributeInput("ATTACK_DEFENSE__PEN_LIFE_2", input);
}
/** UI/OCR grouping uses the same mapping as the formal twelve-cell expansion. */
export function attributeFieldKey(schema: AttributeSchema, troop: typeof TROOP_TYPES[number], stat: typeof ATTRIBUTE_STATS[number]): string {
  if (schema === "FULL_12") return `${troop}.${stat}`;
  if (schema === "ALL_SHARED_1") return "allStats";
  if (schema === "SHARED_BY_STAT_4") return stat;
  if (schema === "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9")
    return `${troop}${stat === "attack" ? "Attack" : stat === "defense" ? "Defense" : "PenetrationLife"}`;
  const pair = stat === "attack" || stat === "defense" ? "AttackDefense" : "PenetrationLife";
  if (schema === "PER_TROOP_PAIRED_6") return `${troop}${pair}`;
  if (schema === "ALL_TROOPS_PAIRED_2") return `shared${pair}`;
  return pair[0]!.toLowerCase() + pair.slice(1);
}
export function expandPerTroopPaired6(input: CompactAttributeInput) {
  return expandAttributeInput("PER_TROOP_PAIRED_6", input);
}
export function expandAllTroopsPaired2(input: CompactAttributeInput) {
  return expandAttributeInput("ALL_TROOPS_PAIRED_2", input);
}
/** Per-troop schemas retain each troop's values; globally shared schemas use shield representatives. */
export function compactAttributeInput(schema: AttributeSchema, full: StandardTroopAttributes12): CompactAttributeInput {
  if (schema === "ALL_SHARED_1") return { allStats: full.shield.attack };
  if (schema === "ATTACK_DEFENSE__PEN_LIFE_2") return { attackDefense: full.shield.attack, penetrationLife: full.shield.penetration };
  if (schema === "ALL_TROOPS_PAIRED_2") return { sharedAttackDefense: full.shield.attack, sharedPenetrationLife: full.shield.penetration };
  if (schema === "PER_TROOP_PAIRED_6") return Object.fromEntries(TROOP_TYPES.flatMap((troop) => [
    [`${troop}AttackDefense`, full[troop].attack], [`${troop}PenetrationLife`, full[troop].penetration],
  ]));
  if (schema === "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9") return Object.fromEntries(TROOP_TYPES.flatMap((troop) => [
    [`${troop}Attack`, full[troop].attack], [`${troop}Defense`, full[troop].defense],
    [`${troop}PenetrationLife`, full[troop].penetration],
  ]));
  return { ...full.shield };
}
export function normalizeAttributeSchema(schema: AttributeSchema, full: StandardTroopAttributes12): StandardTroopAttributes12 {
  return expandAttributeInput(schema, schema === "FULL_12" ? full : compactAttributeInput(schema, full));
}
