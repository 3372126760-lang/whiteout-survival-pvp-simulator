import { createEvaluationExecutor, type EvaluationJob, type EvaluationJobResult } from "../pvp/optimizer/execution";

interface WorkerSlot {
  readonly worker: Worker;
  tail: Promise<unknown>;
  load: number;
  readonly pending: Map<number, { resolve: (row: EvaluationJobResult) => void;
    reject: (error: Error) => void }>;
}

/** Affinity keeps each candidate's compiled template in the same worker across stages. */
function affinity(job: EvaluationJob): number {
  if (job.kind === "jointPeak") return job.jointPeakJob!.shard;
  const signature = JSON.stringify({ kind: job.kind,
    input: { ...job.input, randomSeed: 0, simulationMode: "fixedSeed" },
    ...(job.kind === "multiWave" ? { sequence: job.sequence } : {}) });
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash = Math.imul(hash ^ signature.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function createOptimizerWorkerPool() {
  const fallback = createEvaluationExecutor();
  const slots: WorkerSlot[] = [];
  // Bound memory and leave one logical core available to the application.
  const count = typeof Worker === "undefined" ? 0 :
    Math.min(4, Math.max(0, (navigator.hardwareConcurrency || 2) - 1));
  let nextId = 0;
  let closed = false;
  let failure: Error | undefined;
  const close = (error = new Error("Optimizer worker pool closed.")) => {
    closed = true;
    slots.forEach((slot) => {
      slot.pending.forEach((pending) => pending.reject(error));
      slot.pending.clear();
      slot.worker.terminate();
    });
  };
  try {
    for (let index = 0; index < count; index += 1) {
      const worker = new Worker(new URL("./optimizerCandidateWorker.ts", import.meta.url), { type: "module" });
      const slot: WorkerSlot = { worker, tail: Promise.resolve(), load: 0, pending: new Map() };
      worker.onmessage = (event: MessageEvent<{ readonly id: number;
        readonly result?: EvaluationJobResult; readonly error?: string }>) => {
        const pending = slot.pending.get(event.data.id);
        if (pending === undefined) return;
        slot.pending.delete(event.data.id);
        if (event.data.error !== undefined) pending.reject(new Error(event.data.error));
        else if (event.data.result !== undefined) pending.resolve(event.data.result);
        else pending.reject(new Error("Invalid candidate worker response."));
      };
      worker.onerror = (event) => {
        failure = new Error(event.message || "Candidate worker failed.");
        close(failure);
      };
      slots.push(slot);
    }
  } catch {
    // Worker construction may be disallowed; retain the fast sequential path.
    close();
    slots.length = 0;
    closed = false;
  }
  const preferredSlots = new Map<number, number>();
  const runJob = (job: EvaluationJob): Promise<EvaluationJobResult> => {
    if (closed) return Promise.reject(failure ?? new Error("Optimizer worker pool closed."));
    if (slots.length === 0) return Promise.resolve(fallback(job));
    const signature = affinity(job);
    const previous = preferredSlots.get(signature);
    const least = slots.reduce((best, slot, index) => slot.load < slots[best]!.load ? index : best, 0);
    const index = previous !== undefined && slots[previous]!.load <= slots[least]!.load ? previous : least;
    if (preferredSlots.size > 4096) preferredSlots.clear();
    preferredSlots.set(signature, index);
    const slot = slots[index]!;
    slot.load++;
    const result = slot.tail.then(() => new Promise<EvaluationJobResult>((resolve, reject) => {
      if (closed) { reject(failure ?? new Error("Optimizer worker pool closed.")); return; }
      const id = nextId++;
      slot.pending.set(id, { resolve, reject });
      try { slot.worker.postMessage({ id, job }); }
      catch (error) {
        slot.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }));
    slot.tail = result.catch(() => undefined);
    return result.finally(() => { slot.load--; });
  };
  return { workerCount: slots.length,
    run: async (jobs: readonly EvaluationJob[]) => (await Promise.all(jobs.map(runJob))).map((row, index) =>
      jobs[index]?.kind === "jointPeak" ? { ...row, performance: { ...row.performance, workerCount: slots.length } } : row), close };
}
