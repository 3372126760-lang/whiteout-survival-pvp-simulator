import { createEvaluationExecutor, type EvaluationJob } from "../pvp/optimizer/execution";

const execute = createEvaluationExecutor();
self.onmessage = (event: MessageEvent<{ readonly id: number; readonly job: EvaluationJob }>) => {
  const { id, job } = event.data;
  try {
    self.postMessage({ id, result: execute(job) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
