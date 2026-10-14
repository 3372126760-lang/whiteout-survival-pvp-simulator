import { describe, expect, it } from "vitest";
import {
  createValidationResultRevisionState,
  doesValidationScopeAffectInput,
  isValidationResultStale,
  markValidationInputChanged,
  markValidationResultCurrent,
} from "../../ui/resultRevision";

describe("Validation UI stale-result revisions", () => {
  it("marks an existing result stale after BattleInput changes", () => {
    const current = markValidationResultCurrent(
      createValidationResultRevisionState(),
    );
    expect(isValidationResultStale(current)).toBe(false);
    expect(isValidationResultStale(markValidationInputChanged(current))).toBe(true);
  });

  it("clears stale after rerun and treats mixed composition as BattleInput", () => {
    const current = markValidationResultCurrent(
      markValidationInputChanged(
        markValidationResultCurrent(createValidationResultRevisionState()),
      ),
    );
    expect(isValidationResultStale(current)).toBe(false);
    expect(doesValidationScopeAffectInput("mixed-count")).toBe(true);
    expect(doesValidationScopeAffectInput("mixed-level")).toBe(true);
    expect(doesValidationScopeAffectInput("developer")).toBe(false);
    expect(doesValidationScopeAffectInput("trace-range")).toBe(false);
  });
});
