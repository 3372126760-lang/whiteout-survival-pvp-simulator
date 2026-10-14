import type { DebugOverrideMode } from "./types";

/**
 * Trigger overrides are exclusively probability-debug controls. An empty map
 * is the canonical representation of "all skills use their normal RNG" and
 * also clears stale overrides for skills no longer in the active universe.
 */
export function resetAllProbabilityOverrides(
  overrides: Readonly<Record<string, DebugOverrideMode>>,
): Readonly<Record<string, DebugOverrideMode>> {
  // Traverse the current data structure rather than maintaining a skill list.
  const reset = { ...overrides };
  for (const key of Object.keys(reset)) delete reset[key];
  return reset;
}
