import { expect, it } from "vitest";
import { diverseCombatParents, localCombatNeighbors } from "../optimizer/jointPipeline/localCombat";
import type { PreprocessedBodyRow } from "../optimizer/criterion/bodyPreprocess";
import type { RallyCandidate } from "../optimizer/types";

const parent: RallyCandidate = { leaderHeroIds: { shield: "head" }, memberSkillIds: ["a", "b", "c", "d"],
  bodySkillLevels: [3, 3, 3, 3], headWeaponLevels: { head: 4 },
  ratios: { shield: 53, lancer: 2, marksman: 45 }, troopLevels: { shield: "T12", lancer: "T11", marksman: "T10" } };
const row = (ids: string[]) => ({ ids, semantic: { skills: ids.map(skillId => ({ skillId, skillLevel: 3 })) } }) as unknown as PreprocessedBodyRow;

it("limits Body exploration to legal one-effect neighbors and preserves actual levels and Head", () => {
  const bodies = [row(["a", "b", "c", "d"]), row(["a", "b", "c", "e"]), row(["a", "b", "c", "f"]), row(["a", "x", "y", "z"])];
  const neighbors = localCombatNeighbors(parent, bodies, 0, i => i, 1);
  const bodyChanges = neighbors.filter(c => c.memberSkillIds.join() !== parent.memberSkillIds.join());
  expect(bodyChanges).toHaveLength(1);
  expect(bodyChanges[0]!.memberSkillIds).toEqual(["a", "b", "c", "f"]);
  for (const candidate of neighbors) {
    expect(candidate.leaderHeroIds).toBe(parent.leaderHeroIds);
    expect(candidate.headWeaponLevels).toBe(parent.headWeaponLevels);
    expect(candidate.troopLevels).toBe(parent.troopLevels);
    expect(candidate.bodySkillLevels).toEqual([3, 3, 3, 3]);
    expect(Object.values(candidate.ratios).reduce((a, b) => a + b, 0)).toBe(100);
  }
});

it("respects a fixed Body pool and never substitutes a protected configuration outside the pool", () => {
  const only = [row(["a", "b", "c", "d"])];
  expect(localCombatNeighbors(parent, only, 0, () => 0).every(c => c.memberSkillIds === parent.memberSkillIds)).toBe(true);
  expect(localCombatNeighbors(parent, only, undefined, () => 0).every(c => c.memberSkillIds === parent.memberSkillIds)).toBe(true);
});

it("reserves a slot for a low-J vulnerability replacement instead of only high-J damage copies", () => {
  const bodies = [row(["a", "b", "c", "d"]), ...Array.from({ length: 20 }, (_, i) => row(["a", "b", "c", `high-${i}`])), row(["a", "b", "c", "vulnerable"])];
  bodies[21] = { ...bodies[21]!, semantic: { ...bodies[21]!.semantic, vulnerability: 0.4 } };
  const neighbors = localCombatNeighbors(parent, bodies, 0, i => -i, 4);
  expect(neighbors.some(c => c.memberSkillIds.includes("vulnerable"))).toBe(true);
  expect(neighbors.filter(c => c.memberSkillIds.join() !== parent.memberSkillIds.join())).toHaveLength(4);
});

it("reserves Head diversity and a second mutation can reach a two-replacement combination", () => {
  const otherHead = { ...parent, leaderHeroIds: { shield: "other" } };
  const sameHead = { ...parent, ratios: { shield: 54, lancer: 1, marksman: 45 } };
  expect(diverseCombatParents([parent, sameHead, otherHead], 2)).toEqual([parent, otherHead]);
  const bodies = [row(["a", "b", "c", "d"]), row(["a", "b", "c", "e"]), row(["a", "b", "f", "e"])];
  const first = localCombatNeighbors(parent, bodies, 0, () => 0);
  expect(first.some(c => c.memberSkillIds.includes("f"))).toBe(false);
  const middle = first.find(c => c.memberSkillIds.includes("e"))!;
  expect(localCombatNeighbors(middle, bodies, 1, () => 0).some(c => c.memberSkillIds.includes("f"))).toBe(true);
});
