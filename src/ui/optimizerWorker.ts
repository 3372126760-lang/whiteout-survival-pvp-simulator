import { optimizeSimpleScenarioAsync, optimizeThreeQueueScenarioAsync, optimizeInnerEarthAsync,
  runRallyOptimizationAsync, verifyRallyCandidate,
  type OptimizationConfig, type RallyCandidate,
  type SimpleScenarioOptimizationOptions, type ThreeQueueOptimizationOptions, type InnerEarthOptimizationOptions,
  type ValidationBattleInput } from "../pvp";
import { createOptimizerWorkerPool } from "./optimizerWorkerPool";

type OptimizerRequest =
  | { readonly task: "optimize"; readonly input: ValidationBattleInput; readonly config: OptimizationConfig }
  | { readonly task: "optimizeSimple"; readonly input: ValidationBattleInput;
    readonly options: SimpleScenarioOptimizationOptions }
  | { readonly task: "optimizeThreeQueue"; readonly input: ValidationBattleInput;
    readonly options: ThreeQueueOptimizationOptions }
  | { readonly task: "optimizeInnerEarth"; readonly input: ValidationBattleInput;
    readonly options: InnerEarthOptimizationOptions }
  | { readonly task: "verify"; readonly input: ValidationBattleInput; readonly candidate: RallyCandidate; readonly trials: number; readonly firstSeed: number; readonly candidateSide?: "A" | "B" };

self.onmessage = (event: MessageEvent<OptimizerRequest>) => {
  void handleRequest(event.data);
};

async function handleRequest(data: OptimizerRequest) {
  const pool = createOptimizerWorkerPool();
  try {
    if (data.task === "verify") {
      const evaluation = verifyRallyCandidate(data.input, data.candidate,
        data.trials, data.firstSeed, data.candidateSide);
      self.postMessage({ type: "verified", evaluation });
      return;
    }
    if (data.task === "optimizeSimple") {
      const result = await optimizeSimpleScenarioAsync(data.input, { ...data.options, profiling: true }, pool.run,
        (progress) => self.postMessage({ type: "progress", progress }));
      self.postMessage({ type: "complete-simple", result: { ...result,
        performance: { ...result.performance, workerCount: pool.workerCount } } });
      return;
    }
    if (data.task === "optimizeInnerEarth") {
      const result = await optimizeInnerEarthAsync(data.input,
        { simple: { ...data.options.simple, profiling: true },
          threeQueue: { ...data.options.threeQueue, profiling: true } }, pool.run,
        (progress) => self.postMessage({ type: "progress", progress }));
      self.postMessage({ type: "complete-inner-earth", result: { ...result,
        result: { ...result.result, performance: { ...result.result.performance,
          workerCount: pool.workerCount } },
        performance: { ...result.performance, workerCount: pool.workerCount } } });
      return;
    }
    if (data.task === "optimizeThreeQueue") {
      const result = await optimizeThreeQueueScenarioAsync(data.input,
        { ...data.options, profiling: true }, pool.run, (progress) => self.postMessage({ type: "progress", progress }));
      self.postMessage({ type: "complete-three-queue", result: { ...result,
        performance: { ...result.performance, workerCount: pool.workerCount } } });
      return;
    }
    const result = await runRallyOptimizationAsync(data.input, { ...data.config, profiling: true }, pool.run, (progress) => {
      self.postMessage({ type: "progress", progress });
    });
    self.postMessage({ type: "complete", result: { ...result,
      performance: { ...result.performance, workerCount: pool.workerCount } } });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    pool.close();
  }
}
