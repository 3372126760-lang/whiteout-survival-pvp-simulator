import { createPersistedEnvelope, restorePersistedConfig, type KeyValueStorage } from "../storage";
import type { OptimizationConfig, SimpleScenarioOptimizationOptions, ThreeQueueOptimizationOptions } from "../pvp";
import type { ValidationBattleInput } from "../pvp/validationUi/types";
import type { BattleScenarioType } from "../pvp/scenario/scenarioTypes";

export const ADVANCED_SCENARIO_STORAGE_KEY = "wos-pvp.advanced-scenarios";
export interface ScenarioEditorState {
  readonly input: ValidationBattleInput;
  readonly simulationCount: number;
  readonly optimizationConfig: OptimizationConfig;
  readonly simpleOptimizerOptions: SimpleScenarioOptimizationOptions;
  readonly threeQueueOptimizerOptions: ThreeQueueOptimizationOptions;
}
export function scenarioStateKey(input: ValidationBattleInput): BattleScenarioType {
  return input.scenarioType ?? (input.battleContext === "rally" ? "RALLY" : "SINGLE");
}

/** Separate from the active autosave/share: switching, copying and importing one
 * scenario cannot overwrite another. In-memory drafts survive even if not valid yet. */
export class AdvancedScenarioStates {
  private readonly drafts = new Map<BattleScenarioType, ScenarioEditorState>();
  private persisted: Record<string, unknown> = {};
  constructor(private readonly storage: KeyValueStorage | null) {
    const json = storage?.getItem(ADVANCED_SCENARIO_STORAGE_KEY);
    if (json) {
      const raw: unknown = JSON.parse(json);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) this.persisted = raw as Record<string, unknown>;
    }
  }
  remember(state: ScenarioEditorState): void {
    this.drafts.set(scenarioStateKey(state.input), structuredClone(state));
  }
  read(key: BattleScenarioType): ScenarioEditorState | null {
    const draft = this.drafts.get(key);
    if (draft) return structuredClone(draft);
    const raw = this.persisted[key];
    if (!raw) return null;
    const restored = restorePersistedConfig(raw, { validateBattleState: false });
    if (scenarioStateKey(restored.input) !== key) throw new Error("场景保存记录与目标模式不匹配。");
    this.remember(restored);
    return structuredClone(restored);
  }
  save(state: ScenarioEditorState): void {
    this.remember(state);
    const key = scenarioStateKey(state.input);
    this.persisted[key] = createPersistedEnvelope(state.input, state.simulationCount,
      state.optimizationConfig, Date.now(), state.simpleOptimizerOptions, state.threeQueueOptimizerOptions);
    this.storage?.setItem(ADVANCED_SCENARIO_STORAGE_KEY, JSON.stringify(this.persisted));
  }
}
