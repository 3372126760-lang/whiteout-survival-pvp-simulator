export interface ValidationResultRevisionState {
  readonly inputRevision: number;
  readonly resultRevision: number | null;
}

export function createValidationResultRevisionState():
  ValidationResultRevisionState {
  return { inputRevision: 0, resultRevision: null };
}

export function markValidationInputChanged(
  state: ValidationResultRevisionState,
): ValidationResultRevisionState {
  return { ...state, inputRevision: state.inputRevision + 1 };
}

export function markValidationResultCurrent(
  state: ValidationResultRevisionState,
): ValidationResultRevisionState {
  return { ...state, resultRevision: state.inputRevision };
}

export function clearValidationResultRevision(
  state: ValidationResultRevisionState,
): ValidationResultRevisionState {
  return { ...state, resultRevision: null };
}

export function isValidationResultStale(
  state: ValidationResultRevisionState,
): boolean {
  return state.resultRevision !== null &&
    state.resultRevision !== state.inputRevision;
}

export function doesValidationScopeAffectInput(
  scope: string | undefined,
): boolean {
  return scope !== undefined && scope !== "developer" &&
    scope !== "trace-range" && scope !== "batch-count";
}
