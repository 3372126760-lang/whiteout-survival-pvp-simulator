import { describe, expect, it } from "vitest";
import { aliveMask, buildTargetFlow } from "../optimizer/criterion/flow";
import type { AttackChannel, CriterionSide } from "../optimizer/criterion/types";

function side(extra: AttackChannel["target"] = 2, coefficient = .4): CriterionSide {
  return { counts: [0, 0, 100], hp: [100, 100, 100], normal: Array(9).fill(1), skill: Array(9).fill(1),
    priorities: [[0, 1, 2], [0, 1, 2], [0, 1, 2]],
    channels: [{ source: 2, kind: "normalAttack", coefficient: 1, target: "priority" },
      { source: 2, kind: "extraDamage", coefficient, target: extra }],
    uncertainty: 0, omittedMechanisms: [], flags: { probabilityApproximation: false,
      roundSkillApproximation: false, targetRedirect: false, hardToStaticize: false } };
}

const row = (value: CriterionSide, counts: number[]) => [...buildTargetFlow(value, 4, aliveMask(counts))].slice(6);

describe("A2 Criterion fixed targets", () => {
  it.each([
    { label: "marksman alive", counts: [100, 100, 100], expected: [1, 0, .4] },
    { label: "marksman dead, shield alive", counts: [100, 100, 0], expected: [1, 0, 0] },
    { label: "only lancer alive", counts: [0, 100, 0], expected: [0, 1, 0] },
  ])("keeps marksman-only extra fixed: $label", ({ counts, expected }) => {
    expect(row(side(), counts)).toEqual(expected);
  });

  it.each([
    { target: 0, counts: [0, 100, 100] },
    { target: 1, counts: [100, 0, 100] },
    { target: 2, counts: [100, 100, 0] },
  ])("disables fixed extra channel $target when its designated target is dead", ({ target, counts }) => {
    const value = side(target);
    const mainOnly = { ...value, channels: value.channels.filter((channel) => channel.kind === "normalAttack") };
    expect(row(value, counts)).toEqual(row(mainOnly, counts));
  });

  it("removes the fixed contribution when aliveMask and a reused flow buffer are rebuilt", () => {
    const value = side(), buffer = new Float64Array(9);
    expect([...buildTargetFlow(value, 4, aliveMask([100, 100, 100]), buffer)].slice(6)).toEqual([1, 0, .4]);
    expect([...buildTargetFlow(value, 4, aliveMask([100, 100, 0]), buffer)].slice(6)).toEqual([1, 0, 0]);
    expect([...buildTargetFlow(value, 4, aliveMask([0, 100, 0]), buffer)].slice(6)).toEqual([0, 1, 0]);
    expect([...buildTargetFlow(value, 4, 0, buffer)]).toEqual(Array(9).fill(0));
  });

  it("keeps current-target extra attached to the main attack and its ambush redirection", () => {
    const value = side("current", .5);
    const redirected = { ...value, channels: value.channels.map((channel) => channel.kind === "normalAttack"
      ? { ...channel, redirectProbability: .2, redirectPriority: [2, 0, 1] } : channel) };
    const full = row(redirected, [100, 100, 100]);
    expect(full[0]).toBeCloseTo(1.2, 12); expect(full[1]).toBe(0); expect(full[2]).toBeCloseTo(.3, 12);
    expect(row(redirected, [100, 100, 0])).toEqual([1.5, 0, 0]);
    expect(row(redirected, [0, 100, 0])).toEqual([0, 1.5, 0]);
  });

  it("continues all-target contributions to every living target", () => {
    expect(row(side("all"), [100, 100, 100])).toEqual([1.4, .4, .4]);
    expect(row(side("all"), [100, 100, 0])).toEqual([1.4, .4, 0]);
    expect(row(side("all"), [0, 100, 0])).toEqual([0, 1.4, 0]);
  });

  it("keeps random extra uniformly distributed over living targets", () => {
    const value = side("random", .6);
    const full = row(value, [100, 100, 100]);
    expect(full[0]).toBeCloseTo(1.2, 12); expect(full[1]).toBeCloseTo(.2, 12); expect(full[2]).toBeCloseTo(.2, 12);
    expect(row(value, [100, 100, 0])).toEqual([1.3, .3, 0]);
    expect(row(value, [0, 100, 0])).toEqual([0, 1.6, 0]);
  });
});
