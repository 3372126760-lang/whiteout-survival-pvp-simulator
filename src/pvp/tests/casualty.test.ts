import { describe, expect, it } from "vitest";
import {
  applyDamageToTroopStack,
  calculateBaseTroopDamage,
  createBattleState,
} from "../../pvp";
import { makeSide } from "./helpers";

describe("residual HP casualty resolution", () => {
  it.each([
    {
      label: "damage below front HP",
      damage: 200,
      aliveCount: 3,
      frontUnitHp: 800,
      casualties: 0,
      unabsorbedDamage: 0,
    },
    {
      label: "damage equal to front HP",
      damage: 1_000,
      aliveCount: 2,
      frontUnitHp: 1_000,
      casualties: 1,
      unabsorbedDamage: 0,
    },
    {
      label: "damage above front HP",
      damage: 1_500,
      aliveCount: 2,
      frontUnitHp: 500,
      casualties: 1,
      unabsorbedDamage: 0,
    },
    {
      label: "exact whole-unit damage",
      damage: 2_000,
      aliveCount: 1,
      frontUnitHp: 1_000,
      casualties: 2,
      unabsorbedDamage: 0,
    },
    {
      label: "damage leaving residual HP",
      damage: 2_500,
      aliveCount: 1,
      frontUnitHp: 500,
      casualties: 2,
      unabsorbedDamage: 0,
    },
    {
      label: "damage clearing the stack",
      damage: 3_000,
      aliveCount: 0,
      frontUnitHp: 0,
      casualties: 3,
      unabsorbedDamage: 0,
    },
    {
      label: "overkill after clearing the stack",
      damage: 4_000,
      aliveCount: 0,
      frontUnitHp: 0,
      casualties: 3,
      unabsorbedDamage: 1_000,
    },
  ])(
    "$label",
    ({
      damage,
      aliveCount,
      frontUnitHp,
      casualties,
      unabsorbedDamage,
    }) => {
      const battle = createBattleState({
        sideA: makeSide({ shield: 3 }),
        sideB: makeSide({ shield: 3 }),
      });
      const result = applyDamageToTroopStack(
        battle.sideA.troops.shield,
        damage,
      );
      expect(result.troop.aliveCount).toBe(aliveCount);
      expect(result.troop.frontUnitHp).toBe(frontUnitHp);
      expect(result.casualties).toBe(casualties);
      expect(result.unabsorbedDamage).toBe(unabsorbedDamage);
    },
  );

  it("safely handles another hit against an already dead stack", () => {
    const battle = createBattleState({
      sideA: makeSide({ shield: 1 }),
      sideB: makeSide({ shield: 1 }),
    });
    const dead = applyDamageToTroopStack(
      battle.sideA.troops.shield,
      1_000,
    ).troop;
    const result = applyDamageToTroopStack(dead, 500);

    expect(result.casualties).toBe(0);
    expect(result.troop.aliveCount).toBe(0);
    expect(result.troop.frontUnitHp).toBe(0);
    expect(result.unabsorbedDamage).toBe(500);
  });

  it("does not reduce output when only the front unit has residual HP", () => {
    const battle = createBattleState({
      sideA: makeSide({ shield: 10_000 }),
      sideB: makeSide({ shield: 10_000 }),
    });
    const full = battle.sideA.troops.shield;
    const residual = applyDamageToTroopStack(full, 700).troop;

    expect(residual.aliveCount).toBe(10_000);
    expect(residual.frontUnitHp).toBe(300);
    const fullDamage = calculateBaseTroopDamage({
      fixedInitialMinTroops: 10_000,
      aliveCount: full.aliveCount,
      damageCoefficient: full.damageCoefficient,
      troopConstant: full.troopConstant,
      attack: full.attack,
      penetration: full.penetration,
    }).damage;
    const residualDamage = calculateBaseTroopDamage({
      fixedInitialMinTroops: 10_000,
      aliveCount: residual.aliveCount,
      damageCoefficient: residual.damageCoefficient,
      troopConstant: residual.troopConstant,
      attack: residual.attack,
      penetration: residual.penetration,
    }).damage;
    expect(residualDamage).toBe(fullDamage);
  });

  it("consumes previous residual HP before full units", () => {
    const battle = createBattleState({
      sideA: makeSide({ shield: 10_000 }),
      sideB: makeSide({ shield: 10_000 }),
    });
    const residual = applyDamageToTroopStack(
      battle.sideA.troops.shield,
      700,
    ).troop;
    const result = applyDamageToTroopStack(residual, 2_500);

    expect(result.casualties).toBe(3);
    expect(result.troop.aliveCount).toBe(9_997);
    expect(result.troop.frontUnitHp).toBe(800);
    expect(result.unabsorbedDamage).toBe(0);
  });
});
