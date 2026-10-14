import "./styles.css";
import { perfMark, perfMeasure, startupPerformanceReport } from "./startupPerformance";
import { renderFatalError } from "./startupErrors";

perfMark("bootstrap loaded");
window.addEventListener("error", (event) => {
  // Resource failures have no Error object; the dynamic import handles those.
  if (event.error) renderFatalError(event.error);
});
window.addEventListener("unhandledrejection", (event) => renderFatalError(event.reason));

try {
  await import("./main");
  perfMark("app module loaded");
  perfMeasure("JS dependency load", "bootstrap loaded", "main loaded");
  requestAnimationFrame(() => requestAnimationFrame(() => {
    perfMark("first painted UI");
    if (import.meta.env.DEV) console.info("[perf] startup report", startupPerformanceReport());
  }));
} catch (error) {
  console.error("PVP UI startup failed", error);
  renderFatalError(error);
}

if (import.meta.hot) {
  import.meta.hot.on("vite:beforeUpdate", () => {
    // A crashed module cannot install its own HMR handler. Reload after a fix.
    if (document.documentElement.dataset.pvpRuntimeError === "true") location.reload();
  });
}
