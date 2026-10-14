import type { ValidationBattleInput } from "./types";

export function generateValidationRandomSeed(
  randomUint32: () => number = defaultRandomUint32,
): number {
  const value = randomUint32();
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError("Random seed source must return a uint32 integer.");
  }
  return value;
}

export function prepareValidationRunInput(
  input: ValidationBattleInput,
  randomUint32?: () => number,
): ValidationBattleInput {
  if ((input.simulationMode ?? "fixedSeed") === "fixedSeed") return input;
  return {
    ...input,
    randomSeed: generateValidationRandomSeed(randomUint32),
  };
}

export function replayValidationSeed(
  input: ValidationBattleInput,
  seed: number,
): ValidationBattleInput {
  if (!Number.isSafeInteger(seed)) throw new RangeError("Seed must be a safe integer.");
  return { ...input, simulationMode: "fixedSeed", randomSeed: seed };
}

function defaultRandomUint32(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues !== undefined) {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
}
