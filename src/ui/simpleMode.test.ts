import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultValidationInput } from "./defaultInput";
import { AUTOSAVE_STORAGE_KEY, createPersistedEnvelope, restorePersistedConfig } from "../storage";
import { runBatchSimulation } from "../pvp/validationUi/batchSimulation";
import type { ValidationBattleInput } from "../pvp/validationUi/types";
import { EDITOR_MODE_KEY, copySimpleAttributes, playerConfidence, readEditorMode,
  setSimpleRatios, simpleTroopRatios, simpleTroopTotal, validSimpleRatios } from "./simpleMode";
import { decodeSimpleShare, encodeSimpleShare } from "./simpleShare";
import { DISPLAY_MODEL_VERSION, renderSimpleDetailsOnly, simpleDifferences } from "./simpleModeView";
import { resolveEditorLayers } from "./editorLayers";
import { renderAdvancedStatistics } from "./advancedModeView";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function mount(mode?: string, dev = false) {
  vi.useFakeTimers();
  const base = createDefaultValidationInput();
  const configured: ValidationBattleInput = { ...base, randomSeed: 721, maxRounds: 317,
    triggerOverrides: { "ui-test-preserved": "AUTO" },
    sideA: { ...base.sideA, leaderHeroIds: { ...base.sideA.leaderHeroIds, lancer: "hero.s3.miya" } } };
  const storage = new Map([[AUTOSAVE_STORAGE_KEY, JSON.stringify(createPersistedEnvelope(configured, 1000, undefined, 0))]]);
  if (mode) storage.set(EDITOR_MODE_KEY, mode);
  const listeners = new Map<string, EventListener[]>();
  const dispatch = (name: string, target: object) => listeners.get(name)!.forEach((listener) => listener({ target } as unknown as Event));
  const app = { innerHTML: "", addEventListener: (name: string, listener: EventListener) =>
    listeners.set(name, [...listeners.get(name) ?? [], listener]), querySelector: () => null, querySelectorAll: () => [], replaceChildren: vi.fn() };
  class Element { dataset: Record<string, string> = {}; closest() { return this; } }
  class Input extends Element { value = ""; checked = false; }
  class Select extends Element { value = ""; }
  class Details extends Element {
    open = true; innerHTML = ""; querySelector() { return null; }
    insertAdjacentHTML(_where: string, html: string) { this.innerHTML += html; }
  }
  const requests: { input: ValidationBattleInput; count: number }[] = [];
  const results: ReturnType<typeof runBatchSimulation>[] = [];
  class WorkerStub {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminate() { /* same worker lifecycle as production */ }
    postMessage(request: typeof requests[number]) {
      requests.push(structuredClone(request));
      const result = runBatchSimulation(request.input, request.count);
      results.push(result);
      this.onmessage?.({ data: { type: "complete", result } } as MessageEvent);
    }
  }
  vi.stubGlobal("HTMLElement", Element); vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("HTMLSelectElement", Select); vi.stubGlobal("HTMLDetailsElement", Details);
  vi.stubGlobal("Worker", WorkerStub);
  vi.stubGlobal("document", { querySelector: () => app, documentElement: { dataset: {} } });
  vi.stubGlobal("location", { search: dev ? "?dev=1" : "", hash: "", href: "http://127.0.0.1:5173/" });
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: vi.fn() }, addEventListener: vi.fn() });
  await import("./main");
  await vi.runOnlyPendingTimersAsync();
  return {
    app, storage, requests, results,
    current: () => restorePersistedConfig(JSON.parse(storage.get(AUTOSAVE_STORAGE_KEY)!)).input,
    async click(action: string, data: Record<string, string> = {}) {
      const element = new Element(); element.dataset = { action, ...data };
      dispatch("click", element); await vi.runOnlyPendingTimersAsync();
    },
    async change(dataset: Record<string, string>, value: string, checked = false) {
      const element = new Input(); element.dataset = dataset; element.value = value; element.checked = checked;
      dispatch("change", element); await vi.runOnlyPendingTimersAsync();
    },
    open(key: string) {
      const element = new Details(); element.dataset = { lazySection: key }; dispatch("toggle", element);
      return element.innerHTML;
    },
  };
}

describe("shared canonical config through actual editor events", () => {
  it("routes public modes and unlocks developer tools only through the URL flag", () => {
    const storage = { getItem: (key: string) => key === EDITOR_MODE_KEY ? "simple" : null };
    expect(resolveEditorLayers("", storage)).toEqual({ mode: "simple", developerToolsEnabled: false });
    expect(resolveEditorLayers("?mode=advanced", storage)).toEqual({ mode: "advanced", developerToolsEnabled: false });
    expect(resolveEditorLayers("?dev=1", storage)).toEqual({ mode: "simple", developerToolsEnabled: true });
    expect(resolveEditorLayers("?mode=advanced&dev=1", storage)).toEqual({ mode: "advanced", developerToolsEnabled: true });
  });

  it("keeps debug controls out of public advanced mode and preserves their saved values", async () => {
    const ui = await mount("advanced"), before = ui.current();
    expect(ui.app.innerHTML).toContain('class="shell advanced-shell"');
    expect(ui.app.innerHTML).not.toContain('class="developer-tools"');
    expect(ui.app.innerHTML).not.toContain('data-field="maxRounds"');
    expect(ui.app.innerHTML).not.toContain('data-scope="override"');
    expect(ui.app.innerHTML).not.toContain('data-scope="developer"');
    await ui.change({ scope: "control", field: "maxRounds" }, "1");
    await ui.change({ scope: "override", skillId: "ui-test-preserved" }, "NEVER");
    expect(ui.current()).toEqual(before);
    vi.resetModules();
    const dev = await mount("advanced", true);
    expect(dev.app.innerHTML).toContain('class="developer-tools"');
    expect(dev.app.innerHTML).toContain('data-field="maxRounds"');
    expect(dev.app.innerHTML).toContain('data-dev-group="skills"');
    expect(dev.current().maxRounds).toBe(317);
  });
  it("defaults to simple and switches both ways without modifying any canonical field", async () => {
    const ui = await mount(), before = ui.current();
    expect(ui.app.innerHTML).toContain('class="shell simple-shell"');
    for (const field of ["control", "override", "developer", "trace-range"]) {
      expect(ui.app.innerHTML).not.toContain(`data-scope="${field}"`);
    }
    await ui.click("editor-mode", { mode: "advanced" });
    expect(ui.app.innerHTML).toContain("WHITEOUT · ADVANCED");
    expect(ui.current()).toEqual(before);
    await ui.click("editor-mode", { mode: "simple" });
    expect(ui.current()).toEqual(before);
    expect(ui.storage.get(EDITOR_MODE_KEY)).toBe("simple");
  });

  it("edits a simple lineup, counts, percentages and attributes, then echoes it in advanced", async () => {
    const ui = await mount(), before = ui.current();
    await ui.change({ scope: "leader", side: "A", troop: "shield" }, "hero.s5.heketuo");
    await ui.click("simple-troop-mode", { side: "A", value: "ratio" });
    await ui.click("simple-preset", { side: "A", value: "49/1/50" });
    await ui.change({ scope: "simple-total", side: "A" }, "100001");
    await ui.change({ scope: "troop", side: "A", troop: "shield", field: "attack" }, "+1376.4%");
    const simple = ui.current();
    expect(simple.sideA.troops.shield.count).toBe(49000);
    expect(simple.sideA.troops.lancer.count).toBe(1000);
    expect(simple.sideA.troops.marksman.count).toBe(50001);
    expect(simple.sideA.troops.shield.attack).toBe(1376.4);
    expect(simple.sideA.leaderHeroIds?.shield).toBe("hero.s5.heketuo");
    expect(simple.maxRounds).toBe(before.maxRounds);
    expect(simple.randomSeed).toBe(before.randomSeed);
    expect(simple.triggerOverrides).toEqual(before.triggerOverrides);
    await ui.click("editor-mode", { mode: "advanced" });
    expect(ui.current()).toEqual(simple);
    expect(ui.open("player-attributes-A")).toContain('value="1376.4"');
    expect(ui.app.innerHTML).toContain('value="hero.s5.heketuo" selected');
    await ui.click("editor-mode", { mode: "simple" });
    expect(ui.current()).toEqual(simple);
  });

  it("echoes advanced edits and keeps hidden seed/round/override settings through simple mode", async () => {
    const ui = await mount("advanced", true);
    await ui.change({ scope: "control", field: "randomSeed" }, "987654");
    await ui.change({ scope: "control", field: "maxRounds" }, "510");
    await ui.change({ scope: "troop", side: "B", troop: "marksman", field: "life" }, "1823.7");
    await ui.change({ scope: "troop", side: "B", troop: "marksman", field: "count" }, "63291");
    const advanced = ui.current();
    await ui.click("editor-mode", { mode: "simple" });
    expect(ui.app.innerHTML).toContain('value="63291"');
    expect(ui.open("simple-attributes-B")).toContain('value="+1823.7"');
    expect(ui.current()).toEqual(advanced);
    expect(ui.current().randomSeed).toBe(987654);
    expect(ui.current().maxRounds).toBe(510);
    await ui.click("editor-mode", { mode: "advanced" });
    expect(ui.current()).toEqual(advanced);
  });

  it("keeps incomplete ratios out of canonical config, blocks simulation, and accepts a corrected sum", async () => {
    const ui = await mount(), before = ui.current();
    await ui.click("simple-troop-mode", { side: "A", value: "ratio" });
    await ui.change({ scope: "simple-ratio", side: "A", troop: "shield" }, "50");
    expect(ui.current()).toEqual(before);
    expect(ui.app.innerHTML).toContain("请调整至 100%");
    await ui.click("run-batch"); expect(ui.requests).toHaveLength(0);
    await ui.change({ scope: "simple-ratio", side: "A", troop: "lancer" }, "0");
    await ui.change({ scope: "simple-ratio", side: "A", troop: "marksman" }, "50");
    expect(ui.current().sideA.troops.shield.count).toBe(18000);
    expect(ui.current().sideA.troops.lancer.count).toBe(0);
    expect(ui.current().sideA.troops.marksman.count).toBe(18000);
  });

  it("sends identical seeded config to the same batch runner in both modes and preserves results on switching", async () => {
    const ui = await mount();
    await ui.change({ scope: "batch-count" }, "8");
    await ui.click("run-batch");
    expect(ui.app.innerHTML).toContain("8 场模拟");
    await ui.click("editor-mode", { mode: "advanced" });
    expect(ui.app.innerHTML).toContain("查看完整统计");
    await ui.click("run-batch");
    expect(ui.requests[1]).toEqual(ui.requests[0]);
    expect(ui.results[1]).toEqual(ui.results[0]);
    await ui.click("editor-mode", { mode: "simple" });
    expect(ui.app.innerHTML).toContain("8 场模拟");
    await ui.click("simple-details"); expect(ui.app.innerHTML).toContain('role="dialog"');
    await ui.click("editor-mode", { mode: "advanced" });
    expect(ui.results).toHaveLength(2);
  });
});

describe("player-facing mapping and sharing", () => {
  it("renders advanced player statistics from a real batch without internal skill IDs", () => {
    const result = runBatchSimulation(createDefaultValidationInput(), 1);
    const html = renderAdvancedStatistics(result);
    expect(html).toContain("90%模拟区间");
    expect(html).toContain("技能表现");
    expect(html).not.toContain("skillId");
    expect(html).not.toContain("DamageEvent");
  });
  it("uses the existing allocator without losing total troops, including tiny totals", () => {
    for (const total of [0, 1, 2, 3, 100001]) {
      const input = setSimpleRatios(createDefaultValidationInput(), "A", total, { shield: 49, lancer: 1, marksman: 50 });
      expect(simpleTroopTotal(input, "A")).toBe(total);
      expect(validSimpleRatios(simpleTroopRatios(input, "A"))).toBe(true);
    }
    expect(() => setSimpleRatios(createDefaultValidationInput(), "A", 100, { shield: 50, lancer: 1, marksman: 50 })).toThrow("100%");
  });

  it("copies only twelve displayed attributes and preserves other-side metadata and buffs", () => {
    const input = createDefaultValidationInput(), copied = copySimpleAttributes(input, "A");
    expect(copied.sideB.externalBuffs).toBe(input.sideB.externalBuffs);
    expect(copied.sideB.reportHeroByTroop).toBe(input.sideB.reportHeroByTroop);
    expect(copied.sideB.troops.shield.count).toBe(input.sideB.troops.shield.count);
    expect(copied.sideB.troops.shield.attack).toBe(input.sideA.troops.shield.attack);
    expect(copied.sideA).toBe(input.sideA);
  });

  it("round-trips lineup, troops, attributes, buffs, settings and hidden options through a versioned share", () => {
    const input = createDefaultValidationInput();
    const expected = restorePersistedConfig(createPersistedEnvelope(input, 1000, undefined, 0));
    const shared = decodeSimpleShare(encodeSimpleShare(input, 1000));
    expect(shared.input).toEqual(expected.input);
    expect(shared.simulationCount).toBe(1000);
    expect(() => decodeSimpleShare("v2.bad")).toThrow();
    expect(() => decodeSimpleShare("v1.Zm9v")).toThrow();
  });

  it("distinguishes implemented from battle-confirmed evidence", () => {
    expect(playerConfidence(["BATTLE_CONFIRMED"]).label).toBe("已验证");
    expect(playerConfidence(["supported"]).label).toBe("模型已实现");
    expect(playerConfidence(["CODE_CONFIRMED"]).warning).toBe(true);
    expect(playerConfidence(["TENTATIVE"]).label).toBe("部分待验证");
    expect(playerConfidence(["BATTLE_CONFIRMED", "CONFLICT"]).label).toBe("存在规则冲突");
    expect(readEditorMode({ getItem: () => { throw new Error("unavailable"); } })).toBe("simple");
  });

  it("derives differences from actual batch statistics and never leaks internal skill IDs", () => {
    const result = runBatchSimulation(createDefaultValidationInput(), 3);
    expect(simpleDifferences(result).length).toBeGreaterThanOrEqual(3);
    const html = renderSimpleDetailsOnly(result);
    expect(html).toContain("90%模拟区间");
    expect(html).not.toContain("firstSeed");
    for (const skill of result.skillStatistics) expect(html).not.toContain(skill.skillId);
  });

  it("displays the actual package model version", () => {
    expect(DISPLAY_MODEL_VERSION).toBe((JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version);
  });
});
