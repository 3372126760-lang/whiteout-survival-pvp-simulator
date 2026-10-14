/// <reference types="vite/client" />

const enabled = import.meta.env.DEV || new URLSearchParams(location.search).has("perf");
const prefix = "pvp:";

export function perfMark(name: string): void {
  performance.mark(prefix + name);
  if (enabled) console.info(`[perf] ${name}: ${performance.now().toFixed(1)} ms`);
}

export function perfMeasure(name: string, start: string, end: string): void {
  const entry = performance.measure(prefix + name, prefix + start, prefix + end);
  if (enabled) console.info(`[perf] ${name}: ${entry.duration.toFixed(1)} ms`);
}

export function timeUiSection<T>(name: string, action: () => T): T {
  const start = performance.now();
  try { return action(); }
  finally {
    const duration = performance.now() - start;
    performance.measure(prefix + name, { start, duration });
    if (enabled) console.info(`[perf] ${name}: ${duration.toFixed(1)} ms`);
  }
}

export function recordOcrBackend(metrics: { engineReused: boolean;
  modelInitializationMs: number; workerRequestMs: number }): void {
  performance.measure(prefix + "OCR model initialization", {
    start: performance.now(), duration: metrics.modelInitializationMs });
  if (enabled) console.info("[perf] OCR backend", metrics);
}

export function startupPerformanceReport() {
  const navigation = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  return {
    url: location.href,
    navigation: navigation?.toJSON(),
    milestones: performance.getEntriesByType("mark").filter((entry) =>
      entry.name.startsWith(prefix)).map((entry) => ({ name: entry.name,
      atMs: entry.startTime })),
    measures: performance.getEntriesByType("measure").filter((entry) =>
      entry.name.startsWith(prefix)).map((entry) => ({ name: entry.name,
      durationMs: entry.duration })),
    resources: performance.getEntriesByType("resource").map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return { name: resource.name, type: resource.initiatorType,
        startMs: resource.startTime, endMs: resource.responseEnd,
        durationMs: resource.duration, transferBytes: resource.transferSize,
        decodedBytes: resource.decodedBodySize };
    }),
    dom: { total: document.querySelectorAll("*").length,
      heroCards: document.querySelectorAll(".hero-pool-row").length,
      ocrFields: document.querySelectorAll('[data-scope="report-field"]').length,
      traceEvents: document.querySelectorAll(".event-card").length },
  };
}

if (enabled) Object.assign(window, { pvpStartupPerformance: startupPerformanceReport });
