import type { ValidationTroopInput } from "../validationUi/types";

export function rescaleTroop(troop: ValidationTroopInput, count: number): ValidationTroopInput {
  if (troop.levelMode !== "mixed" || troop.levelComposition === undefined) {
    return { ...troop, count };
  }
  const oldTotal = troop.levelComposition.reduce((sum, row) => sum + row.aliveCount, 0);
  if (oldTotal === 0) return { count, attack: troop.attack, defense: troop.defense,
    penetration: troop.penetration, life: troop.life, troopLevel: troop.troopLevel,
    levelMode: "single", ...(troop.t12Level === undefined ? {} : {
      t12Level: troop.t12Level }) };
  const exact = troop.levelComposition.map((row) => row.aliveCount * count / oldTotal);
  const values = exact.map(Math.floor);
  const order = values.map((_, index) => index).sort((a, b) =>
    exact[b]! - values[b]! - (exact[a]! - values[a]!) || a - b);
  const missing = count - values.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < missing; index += 1) values[order[index]!]! += 1;
  return { ...troop, count, levelComposition: troop.levelComposition.map((row, index) =>
    ({ ...row, aliveCount: values[index]! })) };
}

