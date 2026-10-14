import { describe, expect, it } from "vitest";
import {
  createBattleState,
  createDamageEvent,
  type DamageEventInput,
  type DamageSubtype,
  type DamageType,
  type TroopType,
} from "../../pvp";
import { makeDamageEffect, makeSide } from "./helpers";

function damageInput(
  damageType: DamageType,
  damageSubtype: DamageSubtype,
  targetTroop: TroopType = "shield",
  sourceTroop: TroopType = "shield",
): DamageEventInput {
  return {
    id: `test:${damageType}:${damageSubtype}:${sourceTroop}:${targetTroop}`,
    sourceSide: "A",
    sourceTroop,
    targetSide: "B",
    targetTroop,
    damageType,
    damageSubtype,
    baseDamage: 120,
    round: 1,
    actionOrder: 0,
  };
}

describe("scoped effect matching and grouped multipliers", () => {
  it("applies normal attack reduction only to normalAttack", () => {
    const reduction = makeDamageEffect({
      id: "normal-reduction",
      kind: "damageReduction",
      group: "normalAttackReduction",
      value: 0.2,
      scope: { damageTypes: ["normalAttack"] },
    });
    const battle = createBattleState({
      sideA: makeSide({ shield: 10 }),
      sideB: makeSide(
        { shield: 10 },
        { armyEffects: [reduction] },
      ),
    });

    expect(
      createDamageEvent(
        damageInput("normalAttack", "normalAttack"),
        battle,
      ).finalDamage,
    ).toBeCloseTo(100);
    expect(
      createDamageEvent(
        damageInput("skillDamage", "skillDamage"),
        battle,
      ).finalDamage,
    ).toBe(120);
  });

  it("applies skill reduction to skillDamage and extraDamage", () => {
    const reduction = makeDamageEffect({
      id: "skill-reduction",
      kind: "damageReduction",
      group: "skillDamageReduction",
      value: 0.3,
      scope: { damageTypes: ["skillDamage"] },
    });
    const battle = createBattleState({
      sideA: makeSide({ shield: 10 }),
      sideB: makeSide(
        { shield: 10 },
        { armyEffects: [reduction] },
      ),
    });

    const skill = createDamageEvent(
      damageInput("skillDamage", "skillDamage"),
      battle,
    );
    const extra = createDamageEvent(
      damageInput("skillDamage", "extraDamage"),
      battle,
    );
    expect(skill.reductionMultiplier).toBe(1.3);
    expect(extra.reductionMultiplier).toBe(1.3);
    expect(extra.modifiedDamage).toBeCloseTo(120 / 1.3);
    expect(extra.roundedDamage).toBe(92);
    expect(extra.appliedReductionEffects.map((effect) => effect.effectId)).toEqual([
      "skill-reduction",
    ]);
    expect(extra.reductionGroups).toEqual([
      expect.objectContaining({
        group: "skillDamageReduction",
        summedValue: 0.3,
        multiplier: 1.3,
      }),
    ]);
  });

  it("applies shield reduction only when targetTroop is shield", () => {
    const reduction = makeDamageEffect({
      id: "shield-reduction",
      kind: "damageReduction",
      group: "shieldReduction",
      value: 0.15,
      scope: { targetTroops: ["shield"] },
    });
    const battle = createBattleState({
      sideA: makeSide({ shield: 10 }),
      sideB: makeSide(
        { shield: 10, lancer: 10, marksman: 10 },
        { armyEffects: [reduction] },
      ),
    });

    expect(
      createDamageEvent(
        damageInput("normalAttack", "normalAttack", "shield"),
        battle,
      ).reductionMultiplier,
    ).toBe(1.15);
    expect(
      createDamageEvent(
        damageInput("normalAttack", "normalAttack", "lancer"),
        battle,
      ).reductionMultiplier,
    ).toBe(1);
    expect(
      createDamageEvent(
        damageInput("normalAttack", "normalAttack", "marksman"),
        battle,
      ).reductionMultiplier,
    ).toBe(1);
  });

  it("combines army and attacker-troop effects by scope", () => {
    const army = makeDamageEffect({
      id: "army-increase",
      kind: "damageIncrease",
      group: "armyDamage",
      value: 0.1,
    });
    const marksman = makeDamageEffect({
      id: "marksman-increase",
      kind: "damageIncrease",
      group: "marksmanDamage",
      value: 0.2,
    });
    const battle = createBattleState({
      sideA: makeSide(
        { shield: 10, marksman: 10 },
        {
          armyEffects: [army],
          troopBuffs: { marksman: [marksman] },
        },
      ),
      sideB: makeSide({ shield: 10 }),
    });

    const marksmanEvent = createDamageEvent(
      damageInput(
        "normalAttack",
        "normalAttack",
        "shield",
        "marksman",
      ),
      battle,
    );
    const shieldEvent = createDamageEvent(
      damageInput("normalAttack", "normalAttack", "shield", "shield"),
      battle,
    );
    expect(marksmanEvent.increaseMultiplier).toBeCloseTo(1.1 * 1.2);
    expect(shieldEvent.increaseMultiplier).toBeCloseTo(1.1);
  });

  it("adds effects in one group before multiplying distinct groups", () => {
    const first = makeDamageEffect({
      id: "same-group-1",
      kind: "damageIncrease",
      group: "shared",
      value: 0.1,
    });
    const second = makeDamageEffect({
      id: "same-group-2",
      kind: "damageIncrease",
      group: "shared",
      value: 0.2,
    });
    const third = makeDamageEffect({
      id: "other-group",
      kind: "damageIncrease",
      group: "other",
      value: 0.5,
    });
    const battle = createBattleState({
      sideA: makeSide(
        { shield: 10 },
        { armyEffects: [first, second, third] },
      ),
      sideB: makeSide({ shield: 10 }),
    });

    const event = createDamageEvent(
      damageInput("normalAttack", "normalAttack"),
      battle,
    );
    expect(event.increaseMultiplier).toBeCloseTo(1.3 * 1.5);
  });

  it("rejects extraDamage mislabeled as normalAttack", () => {
    const battle = createBattleState({
      sideA: makeSide({ shield: 10 }),
      sideB: makeSide({ shield: 10 }),
    });
    expect(() =>
      createDamageEvent(
        damageInput("normalAttack", "extraDamage"),
        battle,
      ),
    ).toThrow(/extraDamage belongs to skillDamage/);
  });
});
