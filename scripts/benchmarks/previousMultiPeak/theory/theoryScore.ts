/** Symmetric bounded log advantage, a score, never a probability. */
export function logAdvantage(a: number, b: number): number {
  const value = Math.log((a + 1e-9) / (b + 1e-9));
  return value / (1 + Math.abs(value));
}
export function normalizedDifference(a: number, b: number): number {
  return (a - b) / Math.max(1e-9, Math.abs(a) + Math.abs(b));
}
export function combineTheoryScore(staticScore: number, deterministicScore: number): number {
  return .35 * staticScore + .65 * deterministicScore;
}
