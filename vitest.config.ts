import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig((environment) => mergeConfig(viteConfig(environment), {
  test: {
    // These CPU-bound optimizer suites contend with cold UI imports when Vitest
    // starts one process per logical core. Keep isolation and default timeouts.
    maxWorkers: 2,
  },
}));
