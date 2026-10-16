/** Wall-clock observations must not be compared as deterministic battle data. */
export function withoutOptimizerTimings<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, row: unknown) =>
    typeof row === "number" && /(elapsedMs|ElapsedMs|Time|PerSecond|throughput)$/.test(key) ? 0 : row)) as T;
}
