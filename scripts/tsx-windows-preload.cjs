if (typeof globalThis.process.geteuid !== "function") {
  Object.defineProperty(globalThis.process, "geteuid", {
    configurable: true,
    value: () => 0,
  });
}
