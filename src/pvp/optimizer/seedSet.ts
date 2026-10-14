import { deriveBatchSeed } from "../validationUi";

/** Same stage uses the same seeds for every candidate (common random numbers). */
export function createStageSeeds(firstSeed: number, count: number, offset = 0): readonly number[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) {
    throw new RangeError("Stage trial count must be 1–100000.");
  }
  return Array.from({ length: count }, (_, index) => deriveBatchSeed(firstSeed, offset + index));
}

export function deriveWaveSeed(trajectorySeed: number, waveIndex: number): number {
  return deriveBatchSeed(trajectorySeed, waveIndex * 1_000_003);
}
