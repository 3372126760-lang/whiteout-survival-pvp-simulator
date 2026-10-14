import { runBatchSimulation, runThreeQueueBatchSimulation } from "../pvp";
import type { ValidationBattleInput } from "../pvp";
import { isThreeQueueBattleInput } from "../pvp/scenario/scenePolicy";

interface BatchRequest {
  readonly input: ValidationBattleInput;
  readonly count: number;
}

self.onmessage = (event: MessageEvent<BatchRequest>) => {
  try {
    const runner = isThreeQueueBattleInput(event.data.input)
      ? runThreeQueueBatchSimulation : runBatchSimulation;
    const result = runner(
      event.data.input,
      event.data.count,
      undefined,
      (completed, total) => self.postMessage({ type: "progress", completed, total }),
    );
    self.postMessage({ type: "complete", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
};
