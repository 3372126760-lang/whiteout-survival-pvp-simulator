import { afterEach, describe, expect, it, vi } from "vitest";
import { debugJsonPreview, debugHtmlPreview, DEBUG_PREVIEW } from "../../ui/debugPreview";
import { LazyDetails } from "../../ui/lazyDetails";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { AUTOSAVE_STORAGE_KEY, createPersistedEnvelope } from "../../storage";
import type { ValidationBattleResult } from "../validationUi";
import { readReneeFixture } from "../../../scripts/benchmark-renee-stacking";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function mount(dev: boolean, supplied?: ValidationBattleResult, mode = "advanced") {
  vi.useFakeTimers();
  const input = { ...createDefaultValidationInput(), maxRounds: 3, randomSeed: 20261016 };
  const saved = JSON.stringify(createPersistedEnvelope(input, 1000));
  const listeners = new Map<string, EventListener[]>();
  const app = { innerHTML: "", replaceChildren: vi.fn(), querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (name: string, listener: EventListener) => listeners.set(name, [...listeners.get(name) ?? [], listener]) };
  class Element { dataset: Record<string, string> = {}; closest() { return this; } }
  class Input extends Element { checked = true; value = ""; }
  class Details extends Element {
    open = true; html = ""; querySelector() { return null; }
    insertAdjacentHTML(_where: string, html: string) { this.html += html; }
  }
  vi.stubGlobal("HTMLElement", Element); vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("HTMLSelectElement", Input); vi.stubGlobal("HTMLDetailsElement", Details);
  const blobs = new Map<string, Blob>(), downloads: { filename: string; blob: Blob }[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { const url = `blob:test-${blobs.size}`; blobs.set(url, blob as Blob); return url; });
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const clipboard = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: clipboard } });
  vi.stubGlobal("document", { querySelector: (selector: string) => selector === "#app" ? app : null, documentElement: { dataset: {} },
    body: { append: vi.fn() }, createElement: () => {
      const node = { href: "", download: "", hidden: false, className: "", textContent: "", remove: vi.fn(),
        click() { downloads.push({ filename: node.download, blob: blobs.get(node.href)! }); } };
      return node;
    } });
  vi.stubGlobal("location", { search: `?mode=${mode}${dev ? "&dev=1" : ""}`, href: "https://example.test/" });
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === AUTOSAVE_STORAGE_KEY ? saved : null,
    setItem: vi.fn(), removeItem: vi.fn() }, addEventListener: vi.fn() });
  const adapter = await import("../validationUi/adapter");
  const real = adapter.runValidationBattle;
  const run = vi.spyOn(adapter, "runValidationBattle").mockImplementation((value) => supplied ?? real(value));
  await import("../../ui/main");
  await vi.runOnlyPendingTimersAsync();
  const dispatch = (name: string, target: object) => listeners.get(name)!.forEach((fn) => fn({ target } as unknown as Event));
  return { app, run, downloads, revoke, clipboard,
    single() { const target = new Element(); target.dataset.action = "run"; dispatch("click", target); },
    click(action: string) { const target = new Element(); target.dataset.action = action; dispatch("click", target); },
    changeSeed(value: number) { const target = new Input(); target.dataset = { scope: "control", field: "randomSeed" }; target.value = String(value); dispatch("change", target); },
    open(key: string) { const target = new Details(); target.dataset.lazySection = key; dispatch("toggle", target); return target.html; },
  };
}

describe("bounded, lazy Developer rendering", () => {
  it("does not evaluate closed panels, including nested panels, and discards their DOM on close", () => {
    const lazy = new LazyDetails(), outer = vi.fn(() => lazy.render("inner", "inner", () => "heavy"));
    expect(lazy.render("outer", "outer", outer)).not.toContain("heavy"); expect(outer).not.toHaveBeenCalled();
    let html = ""; const remove = vi.fn();
    const target = { dataset: { lazySection: "outer" }, open: true, querySelector: () => null,
      insertAdjacentHTML: (_where: string, value: string) => { html += value; } };
    lazy.toggle(target as unknown as HTMLDetailsElement);
    expect(outer).toHaveBeenCalledOnce(); expect(html).toContain("inner"); expect(html).not.toContain("heavy");
    lazy.toggle({ ...target, open: false, querySelector: () => ({ remove }) } as unknown as HTMLDetailsElement);
    expect(remove).toHaveBeenCalledOnce();
  });
  it("caps traversal before serialization, including huge arrays, strings, cycles and toJSON", () => {
    const toJSON = vi.fn(() => { throw new Error("full serialization forbidden"); });
    const value: Record<string, unknown> = { rounds: new Array(1000000).fill({ text: "x".repeat(100000), toJSON }) };
    value.self = value;
    const text = debugJsonPreview(value);
    expect(toJSON).not.toHaveBeenCalled(); expect(text.length).toBeLessThanOrEqual(DEBUG_PREVIEW.chars);
    expect(text).toContain("more items"); expect(text).not.toContain("x".repeat(300));
    expect(debugHtmlPreview`<div>${text.repeat(3)}</div>`.length).toBeLessThan(DEBUG_PREVIEW.chars);
  });
  it("runs repeated fresh Developer battles without serializing entire trace/result, even with previews open", async () => {
    const adapter = await import("../validationUi/adapter");
    const small = adapter.runValidationBattle({ ...createDefaultValidationInput(), maxRounds: 1, randomSeed: 20261016 });
    const toJSON = vi.fn(() => { throw new Error("attempted full JSON"); });
    const trace = { ...small.trace, rounds: new Array(1500).fill(small.trace.rounds[0]!), toJSON };
    const result = { ...small, trace, simulation: { ...small.simulation, trace, toJSON } };
    const ui = await mount(true, result);
    expect(ui.app.innerHTML).not.toContain("Raw BattleTrace");
    ui.single(); expect(ui.app.replaceChildren).not.toHaveBeenCalled();
    ui.open("dev-tools");
    const simulation = ui.open("dev-simulation");
    expect(simulation).toContain('name="dev-scenario-type"');
    expect(simulation).not.toContain('name="scenario-type"');
    const raw = ui.open("dev-raw"); expect(raw).toContain("Raw BattleTrace");
    expect(raw).not.toContain("&quot;rounds&quot;");
    for (const key of ["raw-battle-trace", "raw-battle-result", "dev-rng"]) {
      const html = ui.open(key); expect(html.length).toBeLessThan(DEBUG_PREVIEW.chars * 6 + 2000);
    }
    ui.open("dev-damage"); ui.open("battle-trace");
    for (let i = 0; i < 5; i++) ui.single();
    expect(ui.run).toHaveBeenCalledTimes(6); expect(toJSON).not.toHaveBeenCalled();
    expect(ui.app.replaceChildren).not.toHaveBeenCalled(); expect(ui.app.innerHTML.length).toBeLessThan(500000);
  });
  it("passes identical input/seed to the engine and returns identical BattleResult with and without dev", async () => {
    const normal = await mount(false); normal.single();
    const normalResult = normal.run.mock.results[0]!.value as ValidationBattleResult;
    const normalInput = normal.run.mock.calls[0]![0];
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules();
    const dev = await mount(true); dev.single();
    expect(dev.run.mock.calls[0]![0]).toEqual(normalInput);
    expect((dev.run.mock.results[0]!.value as ValidationBattleResult).simulation).toEqual(normalResult.simulation);
    expect(dev.app.replaceChildren).not.toHaveBeenCalled();
  });
  it("offers both file exports next to Copy JSON only after opening Developer Raw panels", async () => {
    const ui = await mount(true); ui.single();
    expect(ui.app.innerHTML).not.toContain('data-action="export-battle-');
    ui.open("dev-tools"); ui.open("dev-raw");
    const input = ui.open("raw-battle-input"), result = ui.open("raw-battle-result");
    expect(input).toContain('data-action="export-battle-input">导出 JSON');
    expect(input).toContain('data-action="copy-battle-input">Copy JSON');
    expect(result).toContain('data-action="export-battle-result">导出 JSON');
    expect(result).toContain('data-action="copy-result">Copy JSON');
  });
  it.each(["simple", "advanced"])("does not expose or execute Raw exports in public %s mode", async (mode) => {
    const ui = await mount(false, undefined, mode); ui.single();
    expect(ui.app.innerHTML).not.toContain('data-action="export-battle-');
    expect(ui.open("dev-tools")).toBe(""); expect(ui.open("raw-battle-result")).toBe("");
    ui.click("export-battle-input"); ui.click("export-battle-result"); ui.click("copy-battle-input");
    expect(ui.downloads).toEqual([]); expect(ui.clipboard).not.toHaveBeenCalled();
    expect(ui.run).toHaveBeenCalledOnce();
  });
  it("exports/copies the complete canonical input of this battle even after editing the current seed", async () => {
    const adapter = await import("../validationUi/adapter");
    const { input } = readReneeFixture();
    const supplied = { ...adapter.runValidationBattle({ ...createDefaultValidationInput(), maxRounds: 1 }), input };
    const ui = await mount(true, supplied); ui.single(); ui.changeSeed(99);
    ui.open("dev-tools"); ui.open("dev-raw"); ui.open("raw-battle-input");
    ui.click("export-battle-input");
    expect(ui.downloads).toHaveLength(1);
    expect(ui.downloads[0]!.filename).toMatch(/^whiteout-pvp-battle-input-\d{4}-\d{2}-\d{2}-\d{6}-502926396\.json$/);
    expect(JSON.parse(await ui.downloads[0]!.blob.text())).toEqual(input);
    ui.click("copy-battle-input");
    expect(JSON.parse(ui.clipboard.mock.calls[0]![0] as string)).toEqual(input);
    expect(ui.run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ui.revoke).toHaveBeenCalledExactlyOnceWith("blob:test-0");
  });
  it("downloads an entire >5MiB result, without full stringify on initial render or opening Raw panels", async () => {
    const adapter = await import("../validationUi/adapter");
    const small = adapter.runValidationBattle({ ...createDefaultValidationInput(), maxRounds: 1 });
    const trace = { ...small.trace, rounds: Array.from({ length: 50 }, (_, i) => ({ ...small.trace.rounds[0]!, round: i + 1,
      damageEvents: Array.from({ length: 40 }, (_, event) => ({ ...small.trace.rounds[0]!.damageEvents[0]!, id: `round-${i + 1}-event-${event}` })) })) };
    const simulation = { ...small.simulation, trace, rounds: trace.rounds.map((round) => ({ ...small.simulation.rounds[0]!,
      trace: round, rawDebugPayload: "完整调试数据".repeat(16384) })) };
    const supplied = { ...small, simulation, trace }, expected = JSON.stringify(simulation);
    expect(new Blob([expected]).size).toBeGreaterThan(5 * 1024 * 1024);
    const stringify = vi.spyOn(JSON, "stringify");
    const fullCalls = () => stringify.mock.calls.filter(([value]) => value === simulation || value === trace || value === supplied.input);
    const ui = await mount(true, supplied); expect(fullCalls()).toHaveLength(0);
    ui.single(); expect(fullCalls()).toHaveLength(0);
    ui.open("dev-tools"); ui.open("dev-raw"); expect(fullCalls()).toHaveLength(0);
    const preview = ui.open("raw-battle-result"); ui.open("raw-battle-input");
    expect(preview.length).toBeLessThan(DEBUG_PREVIEW.chars * 6 + 2000);
    expect(fullCalls()).toHaveLength(0);
    ui.click("export-battle-result"); expect(fullCalls()).toHaveLength(1);
    expect(ui.downloads).toHaveLength(1);
    const text = await ui.downloads[0]!.blob.text(); expect(text).toBe(expected);
    const restored = JSON.parse(text) as typeof simulation;
    expect(restored.rounds).toHaveLength(50); expect(restored.trace.rounds).toHaveLength(50);
    expect(restored.trace.rounds[49]!.damageEvents).toHaveLength(40);
    expect(restored.rounds[49]!.rawDebugPayload).toBe(simulation.rounds[49]!.rawDebugPayload);
    expect(restored.finalState).toEqual(JSON.parse(expected).finalState);
    expect(ui.run).toHaveBeenCalledOnce();
  });
  it("does not rerun a real battle, consume RNG, or mutate its results when downloading", async () => {
    const ui = await mount(true); ui.single();
    const result = ui.run.mock.results[0]!.value as ValidationBattleResult, before = JSON.stringify(result.simulation);
    const runtime = await import("../troopSkills/runtime");
    const rng = vi.spyOn(runtime, "createSeededRandomSource");
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("Export must not consume RNG"); });
    ui.click("export-battle-input"); ui.click("export-battle-result");
    expect(ui.run).toHaveBeenCalledOnce(); expect(rng).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
    expect(JSON.stringify(result.simulation)).toBe(before);
    expect(await ui.downloads[1]!.blob.text()).toBe(before);
    expect(JSON.parse(await ui.downloads[0]!.blob.text())).toEqual(result.input);
  });
});
