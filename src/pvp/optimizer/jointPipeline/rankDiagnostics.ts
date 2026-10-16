import { canonicalBodySemanticKey } from "../../bodyEffects/canonicalRegistry";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../../heroSkills";
import { TROOP_TYPES, type SideId } from "../../types";
import { headLineupKey } from "../theory";
import { candidateHeadWeaponLevels } from "../candidateGenerator";
import type { OptimizationConfig, OptimizationInput, RallyCandidate } from "../types";
import type { PreprocessedBodyRow } from "../criterion/bodyPreprocess";
import { combineJointCoefficients, type JointCoefficientTable } from "./coefficients";
import { solveRatioPeak } from "./ratioPeak";
import { peakPairKey } from "./recall";
import type { JointPeakRow, JointJLineage } from "./types";

/** Axis-only diagnostics: O(B) per distinct final Head and O(H) per distinct
 * final Body. Never retain or rescan the full H×B matrix. */
export function createJointRankInspector(table: JointCoefficientTable, input: OptimizationInput,
  config: OptimizationConfig, heads: readonly Pick<RallyCandidate, "leaderHeroIds">[], bodies: readonly PreprocessedBodyRow[],
  global: readonly JointPeakRow[], side: SideId) {
  const headIds = new Map(heads.map((head, i) => [headLineupKey(head.leaderHeroIds), i]));
  const definitions = new Map(CONFIRMED_HERO_SKILL_DEFINITIONS.map((skill) => [skill.id, skill]));
  const intern = new Map<string, number>(), variants = new Map<string, number>();
  const bodyKey = (ids: readonly string[], levels: readonly number[]) => ids.map((id, i) => {
    const level = levels[i] ?? 5, key = `${id}@${level}:${input.disabledSkillIds.includes(id)}`;
    if (!variants.has(key)) {
      const definition = definitions.get(id);
      const semantic = definition ? canonicalBodySemanticKey(definition, level) + `:disabled=${input.disabledSkillIds.includes(id)}` : key;
      if (!intern.has(semantic)) intern.set(semantic, intern.size);
      variants.set(key, intern.get(semantic)!);
    }
    return variants.get(key)!;
  }).sort((a, b) => a - b).join("|");
  const bodyIds = new Map(bodies.map((body, i) => [bodyKey(body.ids, body.semantic.skills.map((s) => s.skillLevel)), i]));
  const globalRanks = new Map(global.map((row, i) => [peakPairKey(row), i + 1]));
  const headScores = new Map<number, Float64Array>(), bodyScores = new Map<number, Float64Array>();
  const s = new Float64Array(3), o = new Float64Array(3), scratch = new Float64Array(12), peak = new Float64Array(5);
  let evaluations = 0;
  const solve = (head: number, body: number): JointPeakRow => {
    combineJointCoefficients(table, head, body, s, o, scratch); solveRatioPeak(s, o, peak); evaluations++;
    return { head, body, score: peak[3]!, ratio: { shield: peak[0]! * 100, lancer: peak[1]! * 100, marksman: peak[2]! * 100 } };
  };
  const indices = (candidate: RallyCandidate) => {
    const head = headIds.get(headLineupKey(candidate.leaderHeroIds));
    const body = bodyIds.get(bodyKey(candidate.memberSkillIds, candidate.bodySkillLevels ?? candidate.memberSkillIds.map(() => 5)));
    if (head === undefined || body === undefined) return undefined;
    const expected = candidateHeadWeaponLevels(input, heads[head]!.leaderHeroIds, config.constraints, side);
    if (candidate.headWeaponLevels && Object.entries(expected).some(([id, level]) => candidate.headWeaponLevels![id] !== level)) return undefined;
    const own = input[side === "A" ? "sideA" : "sideB"];
    if (candidate.troopLevels && TROOP_TYPES.some((troop) => candidate.troopLevels![troop] !== own.troops[troop].troopLevel)) return undefined;
    return { head, body };
  };
  const diagnose = (candidate: RallyCandidate): JointJLineage => {
    const pair = indices(candidate);
    if (!pair) return { initialJRank: null, initialGlobalJRank: null, bodyRankWithinHead: null, headRankWithinBody: null,
      jRankUnavailableReason: "outside searched Head/Body/weapon/troop domain" };
    const target = solve(pair.head, pair.body);
    let byHead = headScores.get(pair.head);
    if (!byHead) { byHead = Float64Array.from({ length: table.bodyCount }, (_, body) => solve(pair.head, body).score); headScores.set(pair.head, byHead); }
    let byBody = bodyScores.get(pair.body);
    if (!byBody) { byBody = Float64Array.from({ length: table.headCount }, (_, head) => solve(head, pair.body).score); bodyScores.set(pair.body, byBody); }
    const rank = (scores: Float64Array, id: number) => 1 + scores.reduce((n, score, i) => n + Number(score > target.score || score === target.score && i < id), 0);
    const initialGlobalJRank = globalRanks.get(peakPairKey(pair)) ?? null;
    return { initialJRank: initialGlobalJRank, initialGlobalJRank, jMax: target.score, jPeakRatio: target.ratio,
      bodyRankWithinHead: rank(byHead, pair.body), headRankWithinBody: rank(byBody, pair.head) };
  };
  return { indices, diagnose, get peakEvaluationCount() { return evaluations; } };
}
