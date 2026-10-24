import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { AUTOSAVE_STORAGE_KEY, PROFILES_STORAGE_KEY, createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { resolveBodySkillConfigs } from "../validationUi/bodySkillConfig";
import { OptimizerProfiler } from "../optimizer/profiling";
import { defaultOptimizationConfig } from "../optimizer";
import { createOptimizationContext, optimizationContextAudit } from "../optimizer/optimizationContext";
import { emptyOptimizationPerformance } from "../optimizer/execution";
import { defaultSimpleScenarioOptimizationOptions, type SimpleScenarioOptimizationOptions,
  type SimpleScenarioOptimizationResult } from "../optimizer/scenarioOptimizer";
import type { CandidateEvaluation, OptimizationConfig, OptimizationResult, RallyCandidate } from "../optimizer/types";
import { getValidationCatalog, createValidationPreviewState, getValidationThreeQueues,
  createQueueReportLineageAudit, type ValidationBattleInput, type ValidationSideInput } from "../validationUi";
import { createDefaultInnerEarthConfig, normalizeInnerEarthInput, createInnerEarthAudit } from "../innerEarth";
import { createEmptyHeadCandidate, resolveSearchDimensions } from "../optimizer/searchDimensions";
import type { InnerEarthOptimizationResult } from "../optimizer/innerEarthOptimizer";
import type { ThreeQueueOptimizationResult, ThreeQueueOptimizationState } from "../optimizer/threeQueueOptimizer";
import { toThreeQueueBasisPoints } from "../scenario/threeQueueRatios";
import { initializeOptimizationHeroPool, optimizationHeroIds, serverHeroIds } from "../optimizer/heroPools";

afterEach(() => {
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules();
});

/** Match addEventListener: registering a second handler never replaces the first. */
class StartupListeners extends Map<string, EventListener> {
  override set(name: string, listener: EventListener): this {
    const previous = this.get(name);
    return super.set(name, previous ? (event) => { previous(event); listener(event); } : listener);
  }
}

/** Exercise main's delegated events and persisted state without a browser dependency. */
async function mountStartup(input: ValidationBattleInput, config?: OptimizationConfig,
  simpleOptions?: SimpleScenarioOptimizationOptions, existingStorage?: Map<string, string>) {
  const saved = JSON.stringify(createPersistedEnvelope(input, 1000, config, 1000, simpleOptions));
  const storage = existingStorage ?? new Map([[AUTOSAVE_STORAGE_KEY, saved], ["pvp.editor-mode", "advanced"]]);
  const setItem = vi.fn((key: string, value: string) => storage.set(key, value));
  const listeners = new Map<string, EventListener[]>();
  const dispatch = (name: string, target: object) => listeners.get(name)!
    .forEach((listener) => listener({ target } as unknown as Event));
  const app = { innerHTML: "", addEventListener: (name: string, listener: EventListener) =>
    listeners.set(name, [...listeners.get(name) ?? [], listener]),
    querySelector: () => null, querySelectorAll: () => [], replaceChildren: vi.fn() };
  class ElementStub {
    dataset: Record<string, string> = {};
    closest() { return this; }
  }
  class InputStub extends ElementStub { value = ""; checked = false; }
  class SelectStub extends ElementStub { value = ""; }
  class DetailsStub extends ElementStub {
    open = true; innerHTML = "";
    querySelector() { return null; }
    insertAdjacentHTML(_position: string, html: string) { this.innerHTML += html; }
  }
  const workers: WorkerStub[] = [];
  class WorkerStub {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminate = vi.fn(); postMessage = vi.fn();
    constructor() { workers.push(this); }
  }
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("HTMLInputElement", InputStub);
  vi.stubGlobal("HTMLSelectElement", SelectStub);
  vi.stubGlobal("HTMLDetailsElement", DetailsStub);
  vi.stubGlobal("Worker", WorkerStub);
  vi.stubGlobal("document", { querySelector: () => app, documentElement: { dataset: {} } });
  vi.stubGlobal("location", { search: "?mode=advanced&dev=1", href: "http://127.0.0.1:5173/" });
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem, removeItem: vi.fn() }, addEventListener: vi.fn() });
  await import("../../ui/main");
      openDeveloperSettings(listeners);
  await vi.runOnlyPendingTimersAsync();
  setItem.mockClear();
  return {
    app, workers, setItem, storage,
    profiles: () => JSON.parse(storage.get(PROFILES_STORAGE_KEY) ?? "[]") as { id: string; name: string; data: { input: ValidationBattleInput } }[],
    click(action: string, data: Record<string, string> = {}) {
      const target = new ElementStub(); target.dataset = { action, ...data };
      dispatch("click", target);
    },
    change(dataset: Record<string, string>, value = "", checked?: boolean) {
      const target = checked === undefined ? new SelectStub() : new InputStub();
      target.dataset = dataset; target.value = value;
      if (target instanceof InputStub) target.checked = checked!;
      dispatch("change", target);
    },
    open(key: string) {
      const target = new DetailsStub(); target.dataset = { lazySection: key };
      dispatch("toggle", target);
      return target.innerHTML;
    },
    restoreSaved: () => restorePersistedConfig(JSON.parse(storage.get(AUTOSAVE_STORAGE_KEY)!)),
  };
}

/** These integration cases inspect developer settings; explicitly open their lazy parents.
 * Collapsed/large-result behavior has its own regression suite. */
function openDeveloperSettings(listeners: Map<string, EventListener | EventListener[]>) {
  class Details {
    dataset: Record<string, string> = {}; open = true;
    querySelector() { return null; }
    insertAdjacentHTML() { /* DOM is represented by the next render in these stubs. */ }
  }
  const DetailsType = typeof HTMLDetailsElement === "undefined" ? Details : HTMLDetailsElement;
  if (typeof HTMLDetailsElement === "undefined") vi.stubGlobal("HTMLDetailsElement", DetailsType);
  const fire = (name: string, target: object) => {
    const handlers = listeners.get(name);
    for (const handler of Array.isArray(handlers) ? handlers : handlers ? [handlers] : []) handler({ target } as unknown as Event);
  };
  for (const key of ["dev-tools", "dev-simulation", "dev-skills", "dev-theory", "dev-raw"]) {
    const target = new DetailsType(); target.dataset.lazySection = key; target.open = true;
    fire("toggle", target);
  }
  if (typeof HTMLInputElement === "undefined") vi.stubGlobal("HTMLInputElement", class { dataset = {}; });
  const target = new HTMLInputElement();
  Object.defineProperty(target, "dataset", { value: { scope: "developer" } }); target.checked = true;
  fire("change", target);
}

describe("Advanced scenario persistence and final attribute semantics", () => {
  it("restores defaults only for the current scenario and preserves another scenario's edits", async () => {
    vi.useFakeTimers();
    const base = createDefaultValidationInput(), ui = await mountStartup({ ...base, scenarioType: "SINGLE" });
    ui.change({ scope: "troop", side: "A", troop: "shield", field: "attack" }, "2700");
    ui.change({ scope: "scenario-type" }, "RALLY");
    ui.change({ scope: "troop", side: "A", troop: "shield", field: "attack" }, "3500");
    ui.click("restore-default");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.scenarioType).toBe("RALLY");
    expect(ui.restoreSaved().input.sideA.troops.shield.attack).toBe(base.sideA.troops.shield.attack);
    ui.change({ scope: "scenario-type" }, "SINGLE");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.sideA.troops.shield.attack).toBe(2700);
  });

  it("restores independent Rally Lv24 and Underground Lv3/attributes through switches and reload", async () => {
    vi.useFakeTimers();
    const base = createDefaultValidationInput();
    const side = { ...base.sideA, troops: { ...base.sideA.troops, shield: { ...base.sideA.troops.shield, attack: 3500, t12Level: 24 } } };
    const ui = await mountStartup({ ...base, scenarioType: "RALLY", battleContext: "rally", sideA: side, sideB: side });
    expect((ui.click("troops-edit", { side: "A" }), ui.open("player-t12-A"))).toContain('value="24" selected');
    ui.change({ scope: "scenario-type" }, "INNER_EARTH");
    ui.change({ scope: "inner-earth", field: "compact-attribute", side: "ally", queue: "0", stat: "attack" }, "2800");
    ui.change({ scope: "inner-earth", field: "tier", side: "ally", troop: "shield" }, "T12-FC10");
    ui.change({ scope: "inner-earth", field: "t12", troop: "shield" }, "3");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.innerEarth!.ally.t12SkillLevels.shield).toBe(3);
    ui.change({ scope: "scenario-type" }, "RALLY");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.sideA.troops.shield).toMatchObject({ attack: 3500, t12Level: 24 });
    expect(ui.restoreSaved().input.sideB.troops.shield.t12Level).toBe(24);
    vi.clearAllTimers(); vi.resetModules();
    const reloaded = await mountStartup(base, undefined, undefined, ui.storage);
    reloaded.change({ scope: "scenario-type" }, "INNER_EARTH");
    await vi.runOnlyPendingTimersAsync();
    expect(reloaded.restoreSaved().input.innerEarth!.ally.queues[0].expectedReportStats.shield.attack).toBe(2800);
    expect(reloaded.restoreSaved().input.innerEarth!.ally.t12SkillLevels.shield).toBe(3);
    reloaded.change({ scope: "scenario-type" }, "RALLY");
    await vi.runOnlyPendingTimersAsync();
    expect(reloaded.restoreSaved().input.sideA.troops.shield).toMatchObject({ attack: 3500, t12Level: 24 });
  });

  it("updates input-mode help and uses real total-plus-ratio counts independently on both Single sides", async () => {
    vi.useFakeTimers();
    const ui = await mountStartup({ ...createDefaultValidationInput(), scenarioType: "SINGLE" });
    expect(ui.app.innerHTML).toContain('report-troops-summary');
    expect(ui.app.innerHTML).not.toContain('data-scope="advanced-deployment"');
    ui.click("troops-edit", { side: "A" });
    expect(ui.app.innerHTML).toContain('data-scope="advanced-deployment"');
    ui.click("special-buffs-close");
    expect(ui.app.innerHTML).toContain('class="btn report-special-buffs-button"');
    expect(ui.app.innerHTML).not.toContain('id="report-buffs"');
    ui.click("special-buffs-open");
    expect(ui.app.innerHTML).toContain('role="dialog" aria-modal="true"');
    expect(ui.app.innerHTML).toContain('advanced-shell report-theme" inert');
    ui.click("special-buffs-close");
    expect(ui.app.innerHTML).not.toContain('class="special-buffs-overlay"');
    const beforeB = ui.restoreSaved().input.sideB;
    ui.change({ scope: "advanced-deployment", field: "total" }, "100001");
    for (const [troop, value] of [["shield", "33"], ["lancer", "33"], ["marksman", "34"]])
      ui.change({ scope: "advanced-deployment", field: "ratio", troop: troop! }, value!);
    ui.change({ scope: "player-attribute-source" }, "base");
    expect(ui.open("player-attributes-A")).toContain("预计最终战报属性");
    expect((ui.click("special-buffs-open"), ui.click("special-buffs-side", { side: "A" }), ui.app.innerHTML)).toContain("当前输入为基础属性");
    expect((ui.click("troops-edit", { side: "A" }), ui.open("player-t12-A"))).toContain("非集结模式，最高Lv3");
    await vi.runOnlyPendingTimersAsync();
    const input = ui.restoreSaved().input;
    expect([input.sideA.troops.shield.count, input.sideA.troops.lancer.count, input.sideA.troops.marksman.count]).toEqual([33000, 33000, 34001]);
    expect(input.sideB).toEqual(beforeB);
    ui.change({ scope: "advanced-deployment", side: "B", field: "total" }, "224790");
    await vi.runOnlyPendingTimersAsync();
    const updated = ui.restoreSaved().input;
    expect(Object.values(updated.sideB.troops).reduce((sum, row) => sum + row.count, 0)).toBe(224790);
    expect(updated.sideA).toEqual(input.sideA);
    ui.change({ scope: "scenario-type" }, "RALLY");
    expect((ui.click("troops-edit", { side: "A" }), ui.open("player-t12-A"))).toContain("集结模式，最高Lv24");
    ui.change({ scope: "scenario-type" }, "SINGLE");
    expect(ui.open("player-attributes-A")).toContain("当前输入为基础属性");
  });

  it("shows defender-only city controls and persists territory and defensive T12 levels", async () => {
    vi.useFakeTimers();
    const ui = await mountStartup({ ...createDefaultValidationInput(), scenarioType: "CITY_DEFENSE", battleContext: "cityDefense", attributeInputMode: "prediction" });
    expect(ui.app.innerHTML).toContain("进攻方阵容");
    expect(ui.app.innerHTML).toContain("守城方阵容");
    ui.click("bodies-edit", { side: "B" });
    expect(ui.app.innerHTML).toContain("守城车身英雄");
    expect((ui.click("special-buffs-open"), ui.click("special-buffs-side", { side: "A" }), ui.app.innerHTML)).not.toContain('data-scope="city-territory"');
    expect((ui.click("special-buffs-open"), ui.click("special-buffs-side", { side: "B" }), ui.app.innerHTML)).toContain('data-scope="city-territory"');
    expect((ui.click("troops-edit", { side: "A" }), ui.open("player-t12-A"))).not.toContain('value="24"');
    expect((ui.click("troops-edit", { side: "B" }), ui.open("player-t12-B"))).toContain('value="24"');
    ui.change({ scope: "city-territory" }, "", true);
    ui.change({ scope: "t12", side: "B", troop: "shield" }, "24");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.defenderInTerritory).toBe(true);
    expect(ui.restoreSaved().input.sideB.troops.shield.t12Level).toBe(24);
    ui.change({ scope: "scenario-type" }, "SINGLE");
    ui.change({ scope: "scenario-type" }, "CITY_DEFENSE");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.defenderInTerritory).toBe(true);
  });

  it("records both sides from report-shaped percent inputs without changing other battle settings", async () => {
    vi.useFakeTimers();
    const base = { ...createDefaultValidationInput(), scenarioType: "CITY_DEFENSE" as const, defenderInTerritory: true };
    const ui = await mountStartup(base);
    expect(ui.app.innerHTML).toContain('class="report-stat-table"');
    expect(ui.app.innerHTML.indexOf('id="report-heroes"')).toBeLessThan(ui.app.innerHTML.indexOf('id="report-troops"'));
    expect(ui.app.innerHTML.indexOf('id="report-troops"')).toBeLessThan(ui.app.innerHTML.indexOf('id="report-stats"'));
    ui.change({ scope: "troop", side: "A", troop: "shield", field: "attack" }, "+4527.7%");
    ui.change({ scope: "troop", side: "B", troop: "marksman", field: "life" }, "+3188.25");
    await vi.runOnlyPendingTimersAsync();
    const restored = ui.restoreSaved().input;
    expect(restored.sideA.troops.shield.attack).toBe(4527.7);
    expect(restored.sideB.troops.marksman.life).toBe(3188.25);
    expect(restored.sideA.troops.shield.count).toBe(base.sideA.troops.shield.count);
    expect(restored.defenderInTerritory).toBe(true);
    expect(restored.scenarioType).toBe("CITY_DEFENSE");
    expect(restored.sideA.leaderHeroIds).toEqual(base.sideA.leaderHeroIds);
  });

  it("keeps capacity and expert settings through all combat shortcuts and allows manual changes", async () => {
    vi.useFakeTimers();
    const base = createDefaultValidationInput(), side = { ...base.sideA, marchCapacityBonus: .12, rallyCapacityBonus: .18,
      rallyFixedCapacityBonus: 2222, petMarchCapacityLevel: 7,
      externalBuffs: { ...base.sideA.externalBuffs!, expert: { garethFourthSkillLevel: 12 } } };
    const ui = await mountStartup({ ...base, sideA: side });
    expect((ui.click("special-buffs-open"), ui.click("special-buffs-side", { side: "A" }), ui.app.innerHTML)).toContain("宠物全开");
    for (const preset of ["small", "large", "pets", "off"]) {
      ui.click("combat-buff-preset", { side: "A", preset });
      await vi.runOnlyPendingTimersAsync();
      const current = ui.restoreSaved().input.sideA;
      expect([current.marchCapacityBonus, current.rallyCapacityBonus, current.rallyFixedCapacityBonus, current.petMarchCapacityLevel]).toEqual([.12, .18, 2222, 7]);
      expect(current.externalBuffs!.expert.garethFourthSkillLevel).toBe(12);
      if (preset === "pets") expect(current.externalBuffs!.pet).toMatchObject({ attackLevel: 10, enemyPenetrationReductionLevel: 8, enemyLifeReductionLevel: 7 });
      if (preset === "off") expect(Object.values(current.externalBuffs!.pet).every((level) => level === 0)).toBe(true);
    }
    ui.change({ scope: "external", side: "A", section: "pet", field: "attackLevel" }, "4");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.sideA.externalBuffs!.pet.attackLevel).toBe(4);
  });

  it("keeps history edits separate until explicit reverse and removes the current custom UI", async () => {
    vi.useFakeTimers();
    const base = createDefaultValidationInput(), side = { ...base.sideA, troops: { ...base.sideA.troops,
      shield: { ...base.sideA.troops.shield, penetration: 3000 } } };
    const ui = await mountStartup({ ...base, sideA: side });
    ui.open("player-attributes-A");
    const history = ui.open("source-bonuses-A-side");
    expect(history).toContain("仅用于旧战报反推，不参与当前战斗");
    ui.change({ scope: "bonus-context", side: "A", context: "sourceReportBonuses", stat: "penetration", field: "buff" }, "20");
    ui.change({ scope: "bonus-context", side: "A", context: "sourceReportBonuses", stat: "penetration", field: "debuff" }, "2");
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.sideA.troops.shield.penetration).toBe(3000);
    ui.click("apply-historical-base", { side: "A" });
    await vi.runOnlyPendingTimersAsync();
    expect(ui.restoreSaved().input.sideA.troops.shield.penetration).toBeCloseTo(3100 * 1.02 / 1.2 - 100, 10);
    expect(ui.restoreSaved().input.attributeInputMode).toBe("prediction");
    expect((ui.click("special-buffs-open"), ui.click("special-buffs-side", { side: "A" }), ui.app.innerHTML)).not.toMatch(/当前预期战斗特殊加成|自定义当前加成/);
  });

  it("edits IceFire current attributes without silently applying saved historical conditions", async () => {
    vi.useFakeTimers();
    const base = createDefaultValidationInput();
    const queues = getValidationThreeQueues(base.sideA).map((queue) => ({ ...queue,
      sourceReportBonuses: { attack: { additive: 0, buff: 20, debuff: 2 }, defense: { additive: 0, buff: 0, debuff: 0 },
        penetration: { additive: 0, buff: 0, debuff: 0 }, life: { additive: 0, buff: 0, debuff: 0 } } }));
    const ui = await mountStartup({ ...base, scenarioType: "ICE_FIRE_LEAGUE", attributeInputMode: "prediction",
      sideA: { ...base.sideA, threeQueues: queues as unknown as NonNullable<typeof base.sideA.threeQueues> } });
    ui.change({ scope: "queue-attribute", side: "A", queueIndex: "0", troop: "shield", field: "attack" }, "2500");
    await vi.runOnlyPendingTimersAsync();
    const saved = ui.restoreSaved().input.sideA.threeQueues![0];
    expect(saved.attributes!.shield.attack).toBe(2500);
    expect(saved.attributes!.lancer.attack).toBe(base.sideA.troops.lancer.attack);
    expect(saved.sourceReportBonuses).toEqual(queues[0]!.sourceReportBonuses);
    ui.open("player-queues-A"); ui.open("player-queue-history-A-0");
    expect(ui.open("source-bonuses-A-0")).toContain("仅用于旧战报反推，不参与当前战斗");
  });
});

function selectMarkup(html: string, dataset: Record<string, string>): string {
  const select = [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/g)].map((match) => match[0])
    .find((markup) => Object.entries(dataset).every(([key, value]) =>
      markup.slice(0, markup.indexOf(">") + 1).includes(`data-${key}="${value}"`)));
  expect(select, `select ${JSON.stringify(dataset)}`).toBeDefined();
  return select!;
}

function distinctRallyInput(): ValidationBattleInput {
  const base = createDefaultValidationInput();
  const attackBodies = ["hero-skill.shuyun.attack"], defenseBodies = ["hero-skill.xieergai.guardian-power", "hero-skill.patelike.life"];
  return { ...base, scenarioType: "RALLY", battleContext: "rally", attributeInputMode: "prediction",
    sideA: { ...base.sideA, leaderHeroIds: { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" },
      selectedMemberSkillIds: attackBodies, bodySkills: resolveBodySkillConfigs(attackBodies, [], "s11", "A") },
    sideB: { ...base.sideB, leaderHeroIds: { shield: "hero.s10.gregory", lancer: "hero.s10.freya", marksman: "hero.s10.blanchette" },
      selectedMemberSkillIds: defenseBodies, bodySkills: resolveBodySkillConfigs(defenseBodies, [], "s11", "B") } };
}

function fakeOptimizationResult(input: ValidationBattleInput, recommendation: RallyCandidate): OptimizationResult {
  const remaining = { mean: 0, p05: 0, p50: 0, p95: 0, min: 0, max: 0 };
  const distribution = { total: remaining, shield: remaining, lancer: remaining, marksman: remaining };
  const evaluation = (candidate: RallyCandidate, wins: number): CandidateEvaluation => ({ candidate,
    actualCounts: { shield: 7200, lancer: 10800, marksman: 18000 }, trials: 10,
    wins, losses: 10 - wins, draws: 0, timeouts: 0, winRate: wins / 10, wilson95: [0, 1],
    selfRemaining: distribution, enemyRemaining: distribution, rounds: remaining });
  return { optimizationContext: createOptimizationContext(input, "B"), status: "success", seed: input.randomSeed,
    requestedMode: "singleWin", selectedMode: "singleWin", evaluatedCandidates: 2,
    currentEvaluation: evaluation({ leaderHeroIds: input.sideB.leaderHeroIds ?? {},
      memberSkillIds: input.sideB.selectedMemberSkillIds, ratios: { shield: 34, lancer: 33, marksman: 33 } }, 3),
    singleWaveTop: [evaluation(recommendation, 8)], multiWaveTop: [],
    performance: emptyOptimizationPerformance(), approximation: null };
}

it("offers attacker attrition, suggests it below 30%, renders its result and applies only A",async()=>{
 vi.useFakeTimers();
 const before=distinctRallyInput(),ui=await mountStartup(before);
 ui.click("open-optimizer");
 expect(selectMarkup(ui.app.innerHTML,{scope:"optimizer",field:"objectiveMode"})).toContain('value="enemyAttrition"');
 ui.click("run-optimizer");
 const recommendation:RallyCandidate={leaderHeroIds:before.sideA.leaderHeroIds??{},memberSkillIds:before.sideA.selectedMemberSkillIds,ratios:{shield:50,lancer:10,marksman:40}};
 const initial=fakeOptimizationResult(before,recommendation);
 const low:OptimizationResult={...initial,optimizationContext:createOptimizationContext(before,"A"),
  currentEvaluation:{...initial.currentEvaluation,winRate:.1},singleWaveTop:initial.singleWaveTop.map(row=>({...row,winRate:.2}))};
 ui.workers[0]!.onmessage!({data:{type:"complete",result:low}} as MessageEvent);
 await vi.runOnlyPendingTimersAsync();
 expect(ui.app.innerHTML).toContain('data-action="rally-attrition-search"');
 ui.click("rally-attrition-search");
 expect(ui.workers[1]!.postMessage).toHaveBeenCalledWith(expect.objectContaining({task:"optimize",config:expect.objectContaining({objectiveMode:"enemyAttrition"})}));
 const stats={mean:12,p05:10,p50:12,p95:15,min:10,max:15};
 const weakened:OptimizationResult={...low,requestedMode:"enemyAttrition",selectedMode:"enemyAttrition",
  currentEvaluation:{...low.currentEvaluation,enemyRemainingQuality:{...stats,mean:50}},
  singleWaveTop:low.singleWaveTop.map(row=>({...row,enemyRemainingQuality:stats}))};
 ui.workers[1]!.onmessage!({data:{type:"complete",result:weakened}} as MessageEvent);
 await vi.runOnlyPendingTimersAsync();
 expect(ui.app.innerHTML).toContain("剩余战力 12.00%");
 expect(ui.app.innerHTML).toContain("本次单集结胜率 20.00%");
 ui.click("apply-rally-optimizer",{index:"0"});
 await vi.runOnlyPendingTimersAsync();
 expect(ui.restoreSaved().input.sideB).toEqual(restorePersistedConfig(createPersistedEnvelope(before,100)).input.sideB);
 expect(ui.restoreSaved().optimizationConfig.objectiveMode).toBe("enemyAttrition");
});

function fakeInnerEarthRatioResult(input: ValidationBattleInput): InnerEarthOptimizationResult {
  const candidate = { ...createEmptyHeadCandidate(), ratios: { shield: 50, lancer: 10, marksman: 40 } };
  const context = createOptimizationContext({ ...input, scenarioType: "SINGLE" }, "A");
  const dimensions = resolveSearchDimensions(input, { fixedHead: true });
  const result: SimpleScenarioOptimizationResult = {
    ...optimizationContextAudit(context), ...dimensions, searchDimensionAudit: dimensions,
    optimizationContext: context, scenarioType: "SINGLE", side: "A", status: "success",
    seed: input.randomSeed, current: { candidate: { ...createEmptyHeadCandidate(),
      ratios: { shield: 34, lancer: 33, marksman: 33 } }, trials: 1000, wins: 400, winRate: .4, isCurrent: true },
    topCandidates: [{ candidate, trials: 1000, wins: 800, winRate: .8 }],
    headTemplateCount: 1, ratioCount: 231, theoreticalEvaluationCount: 231,
    searchedCandidateCount: 231, finalValidatedCandidateCount: 5,
    performance: emptyOptimizationPerformance(),
  };
  return { battleScenario: "INNER_EARTH", innerEarthMode: input.innerEarth!.subMode,
    kind: "ratio", result, performance: result.performance,
    audit: { ...createInnerEarthAudit(input), optimizationSide: "A", headMode: "EMPTY_HEAD",
      headTemplateCount: 1, ratioCount: 231, formalInitialCandidateLimit: 30 } };
}

function fakeInnerEarthQueueResult(input: ValidationBattleInput,
  recommendation: ThreeQueueOptimizationState): InnerEarthOptimizationResult {
  const current = { queues: input.innerEarth!.ally.queues.map((queue) => ({
    leaderHeroIds: queue.heroes, ratiosBp: toThreeQueueBasisPoints(queue.ratio),
  })) as unknown as ThreeQueueOptimizationState["queues"] };
  const evaluation = (candidate: ThreeQueueOptimizationState, wins: number) => ({ candidate,
    trials: 1000, wins, losses: 1000 - wins, failedTrials: 0, validTrials: 1000, winRate: wins / 1000 });
  const result: ThreeQueueOptimizationResult = { threeQueueMode: "EARTH_HEART_BRAVE_LAND",
    schedulerType: "RandomAliveQueueScheduler", optimizationObjective: "schedulerMonteCarloWinProbability",
    positionCandidateCount: 0, scenarioType: "THREE_QUEUE", status: "success", side: "A",
    rootSeed: input.randomSeed, current: evaluation(current, 400),
    topCandidates: [evaluation(recommendation, 800)], searchedCandidateCount: 20,
    finalValidatedCandidateCount: 5, finalValidationCount: 1000, cacheHits: 0,
    performance: emptyOptimizationPerformance() };
  return { battleScenario: "INNER_EARTH", innerEarthMode: input.innerEarth!.subMode,
    kind: "threeQueue", result, performance: result.performance,
    audit: { ...createInnerEarthAudit(input), optimizationSide: "A", headMode: "SEARCH_HEAD" } };
}

describe("controlled preset dialogs without native prompt/confirm", () => {
  it.each(["UNDERGROUND_LAB", "HEART_OF_EARTH"] as const)("saves %s, cancels, overwrites and deletes using application state", async (mode) => {
    vi.useFakeTimers();
    try {
      const base=createDefaultValidationInput();
      const input=normalizeInnerEarthInput(base,createDefaultInnerEarthConfig(base,mode));
      const ui=await mountStartup(input);
      // The window stub deliberately provides no prompt(), confirm() or alert().
      ui.click("save-profile");expect(ui.app.innerHTML).toContain('role="dialog"');
      expect(ui.app.innerHTML).toContain('data-scope="dialog-name"');
      ui.click("dialog-cancel");expect(ui.profiles()).toHaveLength(0);
      expect(ui.app.innerHTML).not.toContain('role="dialog"');expect(ui.app.innerHTML).not.toContain('class="error-box"');
      ui.click("save-profile");ui.change({scope:"dialog-name"},"测试地心方案");ui.click("dialog-confirm");
      expect(ui.profiles()).toHaveLength(1);expect(ui.profiles()[0]!.name).toBe("测试地心方案");
      expect(ui.open("profile-library")).toContain("测试地心方案");
      const id=ui.profiles()[0]!.id;
      ui.click("save-profile");ui.change({scope:"dialog-name"},"测试地心方案");ui.click("dialog-confirm");
      expect(ui.app.innerHTML).toContain("覆盖方案");expect(ui.profiles()).toHaveLength(1);
      ui.click("dialog-confirm");expect(ui.profiles()).toHaveLength(1);expect(ui.profiles()[0]!.id).toBe(id);
      ui.click("load-profile",{profileId:id});expect(ui.app.innerHTML).toContain("载入方案");ui.click("dialog-confirm");
      expect(ui.restoreSaved().input.innerEarth!.subMode).toBe(mode);
      ui.click("delete-profile",{profileId:id});ui.click("dialog-cancel");expect(ui.profiles()).toHaveLength(1);
      ui.click("delete-profile",{profileId:id});ui.click("dialog-confirm");expect(ui.profiles()).toHaveLength(0);
      expect(ui.app.innerHTML).not.toContain("prompt() is not supported");
      await vi.runOnlyPendingTimersAsync();
      expect(vi.getTimerCount()).toBe(0);
      expect(ui.workers).toHaveLength(0);
    } finally { vi.clearAllTimers(); vi.useRealTimers(); }
  });
  it("keeps invalid names inside the dialog, with no configuration update",async()=>{
    vi.useFakeTimers();try{
      const ui=await mountStartup(createDefaultValidationInput()),before=ui.restoreSaved().input;
      ui.click("save-profile");ui.change({scope:"dialog-name"}," ");ui.click("dialog-confirm");
      expect(ui.app.innerHTML).toContain("方案名称需要");expect(ui.profiles()).toHaveLength(0);
      expect(ui.restoreSaved().input).toEqual(before);ui.click("dialog-cancel");expect(ui.app.innerHTML).not.toContain('class="error-box"');
    }finally{vi.useRealTimers();}
  });
});

describe("UI startup with restored prediction config", () => {
  it("initializes report constants before rendering and leaves heavy collapsed content absent", async () => {
    const saved = JSON.stringify(createPersistedEnvelope({ ...createDefaultValidationInput(),
      attributeInputMode: "prediction" }, 1000));
    const listeners = new Map<string, EventListener[]>();
    const app = { innerHTML: "", addEventListener: (name: string, listener: EventListener) =>
      listeners.set(name, [...listeners.get(name) ?? [], listener]),
      querySelector: () => null, querySelectorAll: () => [], replaceChildren: vi.fn() };
    const documentStub = { querySelector: () => app, documentElement: { dataset: {} } };
    vi.stubGlobal("document", documentStub);
    vi.stubGlobal("location", { search: "?mode=advanced&dev=1", href: "http://127.0.0.1:5173/" });
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => key === "pvp.editor-mode" ? "advanced" : key === AUTOSAVE_STORAGE_KEY ? saved : null,
      setItem: vi.fn(), removeItem: vi.fn(),
    }, addEventListener: vi.fn() });
    const adapter = await import("../validationUi/adapter");
    const preview = vi.spyOn(adapter, "createValidationPreviewState");
    const battle = vi.spyOn(adapter, "runValidationBattle");
    const queues = vi.spyOn(adapter, "runValidationThreeQueueScenario");
    await import("../../ui/main");
      openDeveloperSettings(listeners);
    expect(app.innerHTML).toContain("WHITEOUT · ADVANCED");
    expect(app.innerHTML).not.toContain("共享战报英雄阵容");
    expect(app.innerHTML.match(/data-scope="report-hero"/g)).toHaveLength(6);
    expect(app.innerHTML.match(/历史战报英雄<\/h3>/g)).toHaveLength(2);
    expect(app.innerHTML).toContain("不代表当前模拟阵容");
    expect(app.innerHTML).toContain("A 方属性识图");
    expect(app.innerHTML).toContain("B 方属性识图");
    expect(app.innerHTML).not.toContain('data-scope="report-special-completeness"');
    expect(app.innerHTML).not.toContain("兵种：");
    expect(app.replaceChildren).not.toHaveBeenCalled();
    expect(app.innerHTML).not.toContain('class="hero-pool-row"');
    expect(app.innerHTML).not.toContain('data-scope="report-field"');
    expect(app.innerHTML).not.toContain('data-scope="override"');
    expect(preview).not.toHaveBeenCalled();
    expect(battle).not.toHaveBeenCalled();
    expect(queues).not.toHaveBeenCalled();
    expect(listeners.has("change")).toBe(true);
  });
  it("renders prediction rally heads unlocked and preserves only an explicit checkbox choice", async () => {
    const input = { ...createDefaultValidationInput(), scenarioType: "RALLY" as const,
      battleContext: "rally" as const, attributeInputMode: "prediction" as const };
    const saved = JSON.stringify(createPersistedEnvelope(input, 1000));
    const listeners = new StartupListeners();
    const app = { innerHTML: "", addEventListener: (name: string, listener: EventListener) =>
      listeners.set(name, listener), querySelector: () => null, querySelectorAll: () => [],
      replaceChildren: vi.fn() };
    class InputStub { dataset = { scope: "optimizer", field: "fixedLeaders" }; checked = true; }
    class ButtonStub { dataset = { action: "open-optimizer" }; closest() { return this; } }
    vi.stubGlobal("HTMLInputElement", InputStub);
    vi.stubGlobal("HTMLSelectElement", class {});
    vi.stubGlobal("HTMLElement", ButtonStub);
    vi.stubGlobal("document", { querySelector: () => app, documentElement: { dataset: {} } });
    vi.stubGlobal("location", { search: "?mode=advanced&dev=1", href: "http://127.0.0.1:5173/" });
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) =>
      key === "pvp.editor-mode" ? "advanced" : key === AUTOSAVE_STORAGE_KEY ? saved : null, setItem: vi.fn(), removeItem: vi.fn() }, addEventListener: vi.fn() });
    await import("../../ui/main");
      openDeveloperSettings(listeners);
    listeners.get("click")!({ target: new ButtonStub() } as unknown as Event);
    const checkbox = () => /data-field="fixedLeaders" type="checkbox"([^>]*)/.exec(app.innerHTML)?.[1];
    expect(checkbox()).toBeDefined();
    expect(checkbox()).not.toContain("checked");
    const target = new InputStub();
    listeners.get("change")!({ target } as unknown as Event);
    expect(checkbox()).toContain("checked");
    target.checked = false;
    listeners.get("change")!({ target } as unknown as Event);
    expect(checkbox()).not.toContain("checked");
    listeners.get("click")!({ target: new ButtonStub() } as unknown as Event);
    listeners.get("click")!({ target: new ButtonStub() } as unknown as Event);
    expect(checkbox()).not.toContain("checked");
  });
  it("filters body choices in place without rerendering, changing a selected hero or saving config", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput(), skillId = "hero-skill.shuyun.attack";
      const input = { ...base, serverStage: "s11" as const,
        scenarioType: "RALLY" as const, battleContext: "rally" as const,
        sideA: { ...base.sideA, selectedMemberSkillIds: [skillId],
          bodySkills: resolveBodySkillConfigs([skillId], [], "s11").map((body) => ({ ...body, skillLevel: 3 })) } };
      const saved = JSON.stringify(createPersistedEnvelope(input, 1000));
      const listeners = new StartupListeners();
      const app = { innerHTML: "", addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
        querySelector: () => null, querySelectorAll: () => [], replaceChildren: vi.fn() };
      const select = { innerHTML: "" }, status = { textContent: "" };
      const slot = { querySelector: (selector: string) => selector.startsWith("select") ? select : status };
      class SearchInput { dataset = { scope: "member-search", side: "A", index: "0" }; value = "书允"; closest() { return slot; } }
      class SelectInput { dataset = { scope: "member", side: "A", index: "0" }; value = "hero-skill.buladeli.veterans-pride"; }
      vi.stubGlobal("HTMLInputElement", SearchInput);
      vi.stubGlobal("HTMLSelectElement", SelectInput);
      vi.stubGlobal("document", { querySelector: () => app, documentElement: { dataset: {} } });
      vi.stubGlobal("location", { search: "?mode=advanced&dev=1", href: "http://127.0.0.1:5173/" });
      const setItem = vi.fn();
      vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === "pvp.editor-mode" ? "advanced" : key === AUTOSAVE_STORAGE_KEY ? saved : null,
        setItem, removeItem: vi.fn() }, addEventListener: vi.fn() });
      await import("../../ui/main");
      openDeveloperSettings(listeners);
      await vi.runOnlyPendingTimersAsync(); setItem.mockClear();
      const initialHtml = app.innerHTML, target = new SearchInput();
      listeners.get("input")!({ target } as unknown as Event);
      expect(select.innerHTML).toContain("书允（SR）｜全军攻击提升15%｜常驻生效");
      expect(select.innerHTML).not.toContain("布拉德利（S7）");
      expect(select.innerHTML).toContain('value="hero-skill.shuyun.attack" selected');
      expect(status.textContent).toContain("1 /");
      expect(app.innerHTML).toBe(initialHtml);
      listeners.get("change")!({ target } as unknown as Event);
      await vi.runOnlyPendingTimersAsync();
      expect(app.innerHTML).toBe(initialHtml);
      expect(setItem).not.toHaveBeenCalled();
      target.value = "S7";
      listeners.get("input")!({ target } as unknown as Event);
      expect(select.innerHTML).toContain("当前选择（未匹配搜索）");
      expect(select.innerHTML).toContain('value="hero-skill.shuyun.attack" selected');
      target.value = "";
      listeners.get("input")!({ target } as unknown as Event);
    expect(select.innerHTML).not.toContain("布拉德利（S7）");
      listeners.get("change")!({ target: new SelectInput() } as unknown as Event);
      await vi.runOnlyPendingTimersAsync();
      expect(app.innerHTML).toContain('value="hero-skill.buladeli.veterans-pride" selected');
      expect(setItem).toHaveBeenCalled();
      const payload = JSON.parse(setItem.mock.calls.at(-1)![1]);
      const restored = restorePersistedConfig(payload).input;
      expect(restored.sideA.selectedMemberSkillIds).toEqual(["hero-skill.buladeli.veterans-pride"]);
      expect(restored.sideA.bodySkills?.[0]?.heroId).toBe("hero.s7.buladeli");
      expect(restored.sideA.bodySkills?.[0]?.skillLevel).toBe(5);
      expect(restored.sideB).toEqual(restorePersistedConfig(JSON.parse(saved)).input.sideB);
    } finally { vi.useRealTimers(); }
  });
  it("saves historical heroes and weapons independently from current simulation heroes and weapons", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const configured = { ...base, attributeInputMode: "prediction" as const,
        sideA: { ...base.sideA, reportHeroByTroop: { shield: "hero.s1.nataliya" },
          reportWeaponLevels: { "hero.s1.nataliya": 3 },
          leaderHeroIds: { shield: "hero.s11.eleonora" }, simulationWeaponLevels: { "hero.s11.eleonora": 8 } } };
      const saved = JSON.stringify(createPersistedEnvelope(configured, 1000));
      const listeners = new StartupListeners();
      const app = { innerHTML: "", addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
        querySelector: () => null, querySelectorAll: () => [], replaceChildren: vi.fn() };
      class SelectInput { dataset: Record<string, string> = { scope: "report-hero", side: "A", troop: "shield" }; value = "hero.s3.luogen"; }
      vi.stubGlobal("HTMLInputElement", class {}); vi.stubGlobal("HTMLSelectElement", SelectInput);
      vi.stubGlobal("document", { querySelector: () => app, documentElement: { dataset: {} } });
      vi.stubGlobal("location", { search: "?mode=advanced&dev=1", href: "http://127.0.0.1:5173/" });
      const setItem = vi.fn();
      vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === "pvp.editor-mode" ? "advanced" : key === AUTOSAVE_STORAGE_KEY ? saved : null,
        setItem, removeItem: vi.fn() }, addEventListener: vi.fn() });
      await import("../../ui/main");
      openDeveloperSettings(listeners); await vi.runOnlyPendingTimersAsync(); setItem.mockClear();
      const target = new SelectInput();
      listeners.get("change")!({ target } as unknown as Event); await vi.runOnlyPendingTimersAsync();
      const restoreLast = () => restorePersistedConfig(JSON.parse(setItem.mock.calls.at(-1)![1])).input;
      expect(restoreLast().sideA.reportHeroByTroop?.shield).toBe("hero.s3.luogen");
      expect(restoreLast().sideA.leaderHeroIds?.shield).toBe("hero.s11.eleonora");
      target.dataset.scope = "leader"; target.value = "hero.s4.ahemosi";
      listeners.get("change")!({ target } as unknown as Event); await vi.runOnlyPendingTimersAsync();
      expect(restoreLast().sideA.reportHeroByTroop?.shield).toBe("hero.s3.luogen");
      expect(restoreLast().sideA.leaderHeroIds?.shield).toBe("hero.s4.ahemosi");
      expect(restoreLast().sideA.reportWeaponLevels).toEqual({ "hero.s1.nataliya": 3 });
      expect(restoreLast().sideA.simulationWeaponLevels?.["hero.s11.eleonora"]).toBe(8);
    } finally { vi.useRealTimers(); }
  });
  it("updates stage clocks without full renders and retains/copies the report after worker failure", async () => {
    vi.useFakeTimers();
    try {
      const saved = JSON.stringify(createPersistedEnvelope(createDefaultValidationInput(), 1000));
      const listeners = new StartupListeners();
      const label = { textContent: "", closest: () => null }, body = { innerHTML: "" };
      const host = { innerHTML: "", querySelector: () => host.innerHTML ? body : null };
      const app = { innerHTML: "", addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
        querySelector: (selector: string) => selector === ".optimizer-progress" ? label :
          selector === ".optimizer-performance-host" ? host : null,
        querySelectorAll: (selector: string) => selector === ".optimizer-progress" ? [label] : [], replaceChildren: vi.fn() };
      class Button { dataset: Record<string, string> = { action: "open-optimizer" }; closest() { return this; } }
      const workers: WorkerStub[] = [];
      class WorkerStub {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        terminate = vi.fn(); postMessage = vi.fn();
        constructor() { workers.push(this); }
      }
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("Worker", WorkerStub); vi.stubGlobal("navigator", { clipboard: { writeText } });
      vi.stubGlobal("HTMLElement", Button); vi.stubGlobal("HTMLInputElement", class {}); vi.stubGlobal("HTMLSelectElement", class {});
      vi.stubGlobal("document", { querySelector: () => app, documentElement: { dataset: {} } });
      vi.stubGlobal("location", { search: "?mode=advanced&dev=1", href: "http://127.0.0.1:5173/" });
      vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === "pvp.editor-mode" ? "advanced" : key === AUTOSAVE_STORAGE_KEY ? saved : null,
        setItem: vi.fn(), removeItem: vi.fn() }, addEventListener: vi.fn() });
      await import("../../ui/main");
      openDeveloperSettings(listeners);
      const click = (action: string) => { const target = new Button(); target.dataset.action = action;
        listeners.get("click")!({ target } as unknown as Event); };
      click("open-optimizer"); click("run-optimizer");
      const initialHtml = app.innerHTML;
      let clock = 0; const profiler = new OptimizerProfiler(undefined, () => clock);
      profiler.begin("候选生成", 1); clock += 100; profiler.end(); profiler.begin("M1", 4);
      clock += 100; profiler.progress({ stage: "M1", completed: 1, total: 4 });
      workers[0]!.onmessage!({ data: { type: "progress", progress: { stage: "M1", completed: 1, total: 4,
        performanceReport: profiler.snapshot() } } } as MessageEvent);
      await vi.advanceTimersByTimeAsync(350);
      expect(label.textContent).toContain("M1：1/4"); expect(label.textContent).toContain("当前阶段预计剩余");
      expect(host.innerHTML).toContain("阶段耗时"); expect(app.innerHTML).toBe(initialHtml);
      workers[0]!.onmessage!({ data: { type: "error", message: "test worker failure" } } as MessageEvent);
      await vi.advanceTimersByTimeAsync(0);
      expect(app.innerHTML).toContain("阶段耗时 · 异常"); expect(app.innerHTML).toContain("候选生成");
      expect(app.innerHTML).not.toContain("搜索中…"); expect(workers[0]!.terminate).toHaveBeenCalled();
      click("copy-optimizer-performance"); await Promise.resolve();
      const copied = JSON.parse(writeText.mock.calls[0]![0]);
      expect(copied.status).toBe("error"); expect(copied.stages[0].status).toBe("completed");
      expect(copied.stages[1].status).toBe("error");
    } finally { vi.useRealTimers(); }
  });
});

describe("main UI optimization side integration", () => {
  it("writes a newly selected full S12 weapon to A and B canonical state symmetrically", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const ui = await mountStartup({ ...base, serverStage: "s12", scenarioType: "RALLY", battleContext: "rally", attributeInputMode: "prediction" });
      for (const side of ["A", "B"] as const) {
        ui.change({ scope: "leader", side, troop: "shield" }, "hero.s12.hervor");
        await vi.runOnlyPendingTimersAsync();
      }
      const saved = ui.restoreSaved().input;
      expect(saved.sideA.simulationWeaponLevels?.["hero.s12.hervor"]).toBe(10);
      expect(saved.sideB.simulationWeaponLevels?.["hero.s12.hervor"]).toBe(10);
      ui.change({ scope: "simulation-weapon", side: "B", hero: "hero.s12.hervor" }, "0");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.sideB.simulationWeaponLevels?.["hero.s12.hervor"]).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it("Head pool S12: restores legacy available heroes with current canonical S12 and shows migration notice", async () => {
    vi.useFakeTimers();
    try {
      const base = distinctRallyInput();
      const ui = await mountStartup({ ...base, serverStage: "s12", availableHeroIds: serverHeroIds(base),
        sideA: { ...base.sideA, leaderHeroIds: { shield: "hero.s12.hervor", lancer: "hero.s12.karol", marksman: "hero.s12.ligeia" } } });
      expect(ui.app.innerHTML).toContain("已将旧英雄可用列表迁移为我的英雄");
      ui.click("open-optimizer");
      expect(ui.app.innerHTML).toContain("参与优化：37 / 可用 37");
      expect(ui.open("head-pool-audit")).toContain('&quot;canonicalSelectedHeroesExcluded&quot;: []');
      expect(ui.workers).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it("Head pool S12: expands an open S11 theoretical pool and exposes H0 without starting Workers", async () => {
    vi.useFakeTimers();
    try {
      const ui = await mountStartup(initializeOptimizationHeroPool(distinctRallyInput()));
      ui.click("open-optimizer");
      expect(ui.app.innerHTML).toContain("参与优化：34 / 可用 34");
      ui.change({ scope: "server-stage" }, "s12");
      expect(ui.app.innerHTML).toContain("参与优化：37 / 可用 37");
      const html = ui.open("hero-pool");
      for (const [id, name] of [["hervor", "赫尔薇尔"], ["karol", "加罗尔"], ["ligeia", "丽姬娅"]]) {
        expect(html).toContain(`data-scope="hero-pool" data-hero-id="hero.s12.${id}" type="checkbox" checked`);
        expect(html).toContain(`${name} S12`);
      }
      expect(html.indexOf("鲁弗斯 S11")).toBeLessThan(html.indexOf("赫尔薇尔 S12"));
      const audit = ui.open("head-pool-audit");
      expect(audit).toContain('&quot;effectiveN&quot;: 12');
      expect(audit).toContain('&quot;finalLegalHeadCount&quot;: 1062');
      ui.change({ scope: "hero-pool", heroId: "hero.s12.karol" }, "", false);
      expect(ui.app.innerHTML).toContain("参与优化：36 / 可用 37");
      ui.change({ scope: "hero-pool-side" }, "B");
      expect(ui.app.innerHTML).toContain("参与优化：37 / 可用 37");
      expect(ui.workers).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it("Head pool S12: preserves owned S11, explains selected unowned S12 and offers explicit reconciliation", async () => {
    vi.useFakeTimers();
    try {
      const base = distinctRallyInput();
      const owned = serverHeroIds(base);
      const ui = await mountStartup({ ...base, serverStage: "s12", ownedHeroIds: owned,
        sideA: { ...base.sideA, leaderHeroIds: { shield: "hero.s12.hervor", lancer: "hero.s12.karol", marksman: "hero.s12.ligeia" } } });
      ui.click("open-optimizer");
      expect(ui.app.innerHTML).toContain("参与优化：34 / 可用 34");
      expect(ui.open("hero-pool")).toContain("赫尔薇尔（未标记拥有）");
      expect(ui.open("head-pool-audit")).toContain("S12 server stage but no S12 SSR is eligible for Head optimization");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.ownedHeroIds).toEqual(owned);
      ui.click("hero-pool-own-current");
      expect(ui.app.innerHTML).toContain("参与优化：37 / 可用 37");
      expect(ui.open("head-pool-audit")).toContain('&quot;canonicalSelectedHeroesExcluded&quot;: []');
      expect(ui.workers).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it("Head pool S12: manual hero selection updates actual ownership, and all-available mode is explicit", async () => {
    vi.useFakeTimers();
    try {
      const base = distinctRallyInput();
      const ui = await mountStartup({ ...base, serverStage: "s12", ownedHeroIds: serverHeroIds(base) });
      ui.click("open-optimizer");
      ui.change({ scope: "leader", side: "A", troop: "shield" }, "hero.s12.hervor");
      expect(ui.app.innerHTML).toContain("参与优化：35 / 可用 35");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.ownedHeroIds).toContain("hero.s12.hervor");
      ui.change({ scope: "hero-ownership-scope" }, "allAvailable");
      expect(ui.app.innerHTML).toContain("参与优化：37 / 可用 37");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.ownedHeroIds).toBeUndefined();
      expect(ui.restoreSaved().input.availableHeroIds).toBeUndefined();
      expect(ui.workers).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });
  it("immediately refreshes an owned S12 pool through S13-S16, and sends the same S13 pool to the optimizer Worker", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const base = { ...distinctRallyInput(), serverStage: "s12" as const };
      const ui = await mountStartup({ ...base, ownedHeroIds: serverHeroIds(base) });
      ui.click("open-optimizer"); expect(ui.app.innerHTML).toContain("参与优化：37 / 可用 37");
      ui.change({ scope: "server-stage" }, "s13");
      expect(ui.app.innerHTML).toContain("参与优化：40 / 可用 40");
      const pool = ui.open("hero-pool");
      for (const id of ["hero.s13.gisela", "hero.s13.flora", "hero.s13.vulcanus"]) expect(pool).toContain(`data-hero-id="${id}"`);
      ui.click("run-optimizer");
      const worker = ui.workers.at(-1)!;
      const payload = worker.postMessage.mock.calls[0]![0] as { task: string; input: ValidationBattleInput };
      expect(payload.task).toBe("optimize"); expect(payload.input.serverStage).toBe("s13");
      expect(optimizationHeroIds(payload.input)).toHaveLength(40);
      expect(optimizationHeroIds(payload.input)).toContain("hero.s13.flora");
      // Finish the stub request so no optimization promise/interval leaks into later tests.
      worker.onmessage?.({ data: { type: "error", message: "Stopped test Worker" } } as MessageEvent);
      await vi.advanceTimersByTimeAsync(0);
      for (const [stage, count] of [["s14", 43], ["s15", 46], ["s16", 49], ["s13", 40], ["s12", 37]] as const) {
        ui.change({ scope: "server-stage" }, stage);
        expect(ui.app.innerHTML).toContain(`参与优化：${count} / 可用 ${count}`);
      }
      expect(ui.open("hero-pool")).not.toContain('data-hero-id="hero.s13.flora"');
      await vi.runOnlyPendingTimersAsync();
      expect(optimizationHeroIds(ui.restoreSaved().input)).toHaveLength(37);
      expect(ui.restoreSaved().input.ownedHeroIds).toContain("hero.s16.sigel");
    } finally { vi.useRealTimers(); }
  });
  it("adds newly unlocked S13 Heads even to a custom owned subset, preserving omitted older heroes", async () => {
    vi.useFakeTimers();
    try {
      const ui = await mountStartup({ ...distinctRallyInput(), serverStage: "s12", ownedHeroIds: ["hero.s11.eleonora"] });
      ui.click("open-optimizer"); expect(ui.app.innerHTML).toContain("参与优化：1 / 可用 1");
      ui.change({ scope: "server-stage" }, "s13");
      expect(ui.app.innerHTML).toContain("参与优化：4 / 可用 4");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.ownedHeroIds).toEqual(["hero.s11.eleonora", "hero.s13.gisela", "hero.s13.flora", "hero.s13.vulcanus"]);
      expect(ui.restoreSaved().input.ownedHeroIds).not.toContain("hero.s12.hervor");
    } finally { vi.useRealTimers(); }
  });
  it.each(["SINGLE", "THREE_THREE_THREE", "RALLY"] as const)("hides hero search controls for final-report %s and restores them in prediction", async (scenarioType) => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const ui = await mountStartup({ ...base, scenarioType,
        battleContext: scenarioType === "RALLY" ? "rally" : "challenge" });
      ui.click("open-optimizer");
      expect(ui.app.innerHTML).not.toContain('data-lazy-section="hero-pool"');
      expect(ui.app.innerHTML).not.toContain('data-field="fixedHeroes"');
      expect(ui.app.innerHTML).not.toContain('data-field="fixedLeaders"');
      expect(ui.app.innerHTML).toContain("当前车头及实际专武固定");
      expect(ui.app.innerHTML).toContain('data-lazy-section="owned-heroes"');
      ui.change({ scope: "attribute-input-mode" }, "prediction");
      expect(ui.app.innerHTML).toContain('data-lazy-section="hero-pool"');
      expect(ui.app.innerHTML).toContain(scenarioType === "RALLY" ? 'data-field="fixedLeaders"' : 'data-field="fixedHeroes"');
    } finally { vi.useRealTimers(); }
  });

  it("uses one participation checkbox, hides unowned heroes and preserves weapon/ownership through select all/none", async () => {
    vi.useFakeTimers();
    try {
      const ids = ["hero.s11.eleonora", "hero.s11.lloyd"];
      const base = createDefaultValidationInput();
      const ui = await mountStartup({ ...base, attributeInputMode: "prediction", ownedHeroIds: ids,
        optimizerHeroPool: { A: { [ids[0]!]: { enabled: true, weaponLevel: 6 }, [ids[1]!]: { enabled: false, weaponLevel: 3 } } } });
      ui.click("open-optimizer");
      const pool = ui.open("hero-pool");
      expect(pool).not.toContain('data-scope="owned-hero"');
      expect(pool.match(/type="checkbox"/g)).toHaveLength(2);
      expect(pool).toContain("参与优化");
      expect(pool).not.toContain('data-hero-id="hero.s11.rufus"');
      expect(ui.app.innerHTML).toContain("参与优化：1 / 可用 2（已拥有且当前合法）");
      expect(ui.open("owned-heroes")).toContain('data-scope="owned-hero"');
      for (const action of ["hero-pool-all", "hero-pool-none"]) {
        ui.click(action); await vi.runOnlyPendingTimersAsync();
        const saved = ui.restoreSaved().input;
        expect(saved.ownedHeroIds).toEqual(ids);
        expect(saved.optimizerHeroPool!.A![ids[0]!]).toEqual({ enabled: action === "hero-pool-all", weaponLevel: 6 });
        expect(saved.optimizerHeroPool!.A![ids[1]!]).toEqual({ enabled: action === "hero-pool-all", weaponLevel: 3 });
      }
      ui.change({ scope: "owned-hero", heroId: ids[0]! }, "", false);
      ui.change({ scope: "hero-pool", heroId: ids[0]! }, "", true);
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.optimizerHeroPool!.A![ids[0]!]!.enabled).toBe(false);
      expect(ui.restoreSaved().input.optimizerHeroPool!.A![ids[0]!]!.weaponLevel).toBe(6);
    } finally { vi.useRealTimers(); }
  });

  it("offers six public scenes and fixes IceFire scheduling without a random activity switch", async () => {
    vi.useFakeTimers();
    try {
      const ui = await mountStartup({ ...createDefaultValidationInput(), scenarioType: "ICE_FIRE_LEAGUE", attributeInputMode: "prediction" });
      const sceneChoices = [...ui.app.innerHTML.slice(0, ui.app.innerHTML.indexOf('class="developer-tools"')).matchAll(/<input[^>]+data-scope="scenario-type"[^>]+value="([^"]+)"/g)]
        .map((match) => match[1]);
      expect(sceneChoices).toEqual(["SINGLE", "CITY_DEFENSE", "THREE_THREE_THREE", "RALLY", "ICE_FIRE_LEAGUE", "INNER_EARTH"]);
      expect(ui.app.innerHTML).not.toContain('value="THREE_QUEUE"');
      expect(ui.app.innerHTML).not.toContain("三队列模式");
      expect(ui.app.innerHTML).not.toContain('data-scope="three-queue-mode"');
      expect(ui.app.innerHTML).toContain("冰火战歌模式");
      ui.change({ scope: "scenario-type" }, "ICE_FIRE_LEAGUE");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.threeQueueMode).toBe("ICE_FIRE_LEAGUE");
      ui.click("open-optimizer");
      expect(ui.app.innerHTML).toContain("冰火战歌固定顺序");
      expect(ui.app.innerHTML).not.toContain('data-scope="three-queue-mode"');
      ui.change({ scope: "scenario-type" }, "INNER_EARTH");
      await vi.runOnlyPendingTimersAsync();
      expect(selectMarkup(ui.app.innerHTML, { scope: "inner-earth-mode" })).toContain('value="HEART_OF_EARTH" selected');
      expect(ui.restoreSaved().input.innerEarth?.subMode).toBe("HEART_OF_EARTH");
      ui.change({ scope: "inner-earth-mode" }, "HERO_LAND");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.innerEarth?.subMode).toBe("HERO_LAND");
      expect(ui.app.innerHTML).toContain("英雄之地");
    } finally { vi.useRealTimers(); }
  });

  it("clears all six IceFire hero lineages through real UI events and autosaves 240% inputs", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const lineup = { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" };
      const side = { ...base.sideA, reportHeroIds: Object.values(lineup), reportHeroByTroop: lineup,
        threeQueues: getValidationThreeQueues(base.sideA).map((queue) => ({ ...queue,
          leaderHeroIds: lineup, reportHeroByTroop: lineup,
          weaponLevels: Object.fromEntries(Object.values(lineup).map((id) => [id, 10])) })) as
            unknown as NonNullable<ValidationSideInput["threeQueues"]> };
      const ui = await mountStartup({ ...base, scenarioType: "ICE_FIRE_LEAGUE",
        attributeInputMode: "prediction", sideA: side, sideB: side });
      ui.click("copy-a-to-b");
      for (const sideId of ["A", "B"] as const) for (let index = 0; index < 3; index++) {
        for (const troop of ["shield", "lancer", "marksman"] as const) {
          ui.change({ scope: "queue-hero", side: sideId, queueIndex: String(index), troop }, "");
        }
        ui.change({ scope: "queue-attribute", side: sideId, queueIndex: String(index),
          troop: "shield", field: "attack" }, "240");
      }
      await vi.runOnlyPendingTimersAsync();
      expect(ui.setItem).toHaveBeenCalled();
      const saved = ui.restoreSaved().input;
      for (const key of ["sideA", "sideB"] as const) for (const queue of getValidationThreeQueues(saved[key])) {
        const audit = createQueueReportLineageAudit(queue, key);
        expect(audit.simulationHeroIds).toEqual([]);
        expect(audit.reportHoldHeroIds).toEqual([]);
        expect(audit.heroStaticDeltaPercent.shield!.attack).toBe(0);
        expect(audit.reportValueSource.shield!.attack).toMatchObject({ value: 240, source: "manualInput" });
        expect(queue.reportWeaponLevels).toEqual({}); expect(queue.weaponLevels).toEqual({});
      }
      expect(ui.app.innerHTML).not.toContain("因子无效");
      expect(ui.app.innerHTML).toContain("本队属性来源调试（高级）");
      expect(ui.app.innerHTML).toContain("reportHoldHeroIds");
    } finally { vi.useRealTimers(); }
  });

  it("manual historical report edits preserve the imported hero baseline before autosave", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const queues = getValidationThreeQueues(base.sideB);
      const attributes = Object.fromEntries(["shield", "lancer", "marksman"].map((troop) =>
        [troop, { attack: 5000, defense: 5000, penetration: 5000, life: 5000 }])) as NonNullable<typeof queues[0]["attributes"]>;
      const imported = { ...queues[0], attributes, leaderHeroIds: { lancer: "hero.s3.miya" },
        reportHeroByTroop: { lancer: "hero.s11.lloyd" }, attributeSource: "importedReport" as const,
        reportLineage: { source: "historicalReport" as const, attributeSnapshot: attributes } };
      const ui = await mountStartup({ ...base, scenarioType: "ICE_FIRE_LEAGUE", attributeInputMode: "prediction",
        sideB: { ...base.sideB, threeQueues: [imported, queues[1], queues[2]] } });
      ui.change({ scope: "queue-attribute", side: "B", queueIndex: "0", troop: "lancer", field: "attack" }, "5100");
      await vi.runOnlyPendingTimersAsync();
      const saved = ui.restoreSaved().input.sideB.threeQueues![0];
      expect(saved.reportLineage).toMatchObject({ source: "historicalReport", historicalLineageConfirmed: true });
      expect(saved.reportHeroByTroop).toEqual({ lancer: "hero.s11.lloyd" });
      expect(saved.attributeSource).toBe("manualInput");
      expect(saved.attributes!.lancer.attack).toBe(5100);
      expect(ui.app.innerHTML).not.toContain("因子无效");
      ui.change({ scope: "bonus-context", side: "B", queueIndex: "0", context: "sourceReportBonuses", stat: "attack", field: "buff" }, "20");
      ui.click("apply-historical-base", { side: "B", queueIndex: "0" });
      await vi.runOnlyPendingTimersAsync();
      const reversed = ui.restoreSaved().input.sideB.threeQueues![0];
      expect(reversed.reportHeroByTroop).toEqual({ lancer: "hero.s11.lloyd" });
      expect(reversed.reportLineage?.historicalLineageConfirmed).toBe(true);
      expect(reversed.attributes!.lancer.attack).toBeCloseTo(5200 / 1.2 - 100, 10);
    } finally { vi.useRealTimers(); }
  });

  it("keeps explicit IceFire historical heroes when clearing expected heroes through UI events", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput(), queues = getValidationThreeQueues(base.sideA);
      const attributes = Object.fromEntries(["shield", "lancer", "marksman"].map((troop) => [troop,
        { attack:5000, defense:5000, penetration:5000, life:5000 }])) as NonNullable<typeof queues[0]["attributes"]>;
      const hero = "hero.s11.eleonora", historic = { ...queues[0], attributes,
        leaderHeroIds:{shield:hero},reportHeroByTroop:{shield:hero},weaponLevels:{[hero]:10},reportWeaponLevels:{[hero]:10},
        reportLineage:{source:"historicalReport" as const,historicalLineageConfirmed:true,attributeSnapshot:attributes} };
      const ui = await mountStartup({ ...base, scenarioType:"ICE_FIRE_LEAGUE", attributeInputMode:"prediction",
        sideA:{...base.sideA,threeQueues:[historic,queues[1],queues[2]]} });
      ui.change({scope:"queue-hero",side:"A",queueIndex:"0",troop:"shield"},"");
      await vi.runOnlyPendingTimersAsync();
      const saved = ui.restoreSaved().input.sideA.threeQueues![0];
      expect(saved.leaderHeroIds.shield).toBeNull(); expect(saved.reportHeroByTroop!.shield).toBe(hero);
      expect(saved.reportWeaponLevels![hero]).toBe(10); expect(saved.weaponLevels).toEqual({});
      expect(saved.reportLineage!.historicalLineageConfirmed).toBe(true);
      expect(ui.app.innerHTML).not.toContain("因子无效");
    } finally {vi.useRealTimers();}
  });

  it("updates expert effect labels after level changes and autosaves A/B independently", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const side = (source: ValidationSideInput, level: number): ValidationSideInput => ({ ...source,
        shared: { petContext: { attackLevel:0,defenseLevel:0,penetrationLevel:0,lifeLevel:0,
          enemyDefenseReductionLevel:0,enemyPenetrationReductionLevel:0,enemyLifeReductionLevel:0 },
          expertContext: { garethFourthSkillLevel:level } },
        threeQueues: getValidationThreeQueues(source).map((queue) => ({ ...queue,
          leaderHeroIds:{},reportHeroByTroop:{},weaponLevels:{},reportWeaponLevels:{},
          attributes:{ shield:{attack:2000,defense:2000,penetration:2000,life:2000},
            lancer:{attack:2000,defense:2000,penetration:2000,life:2000},
            marksman:{attack:2000,defense:2000,penetration:2000,life:2000} },
        })) as unknown as NonNullable<ValidationSideInput["threeQueues"]>,
      });
      const ui = await mountStartup({ ...base,scenarioType:"ICE_FIRE_LEAGUE",attributeInputMode:"prediction",
        sideA:side(base.sideA,8),sideB:side(base.sideB,20) });
      const expert = (sideId: string) => selectMarkup(ui.app.innerHTML,
        {scope:"ice-fire-shared",side:sideId,group:"expertContext",field:"garethFourthSkillLevel"});
      expect(expert("A")).toContain('<option value="8" selected>Lv8 · 2.0%</option>');
      expect(expert("B")).toContain('<option value="20" selected>Lv20 · 5.0%</option>');
      expect(ui.app.innerHTML).toContain("当前效果：敌方全军穿透降低2.0%");
      ui.change({scope:"ice-fire-shared",side:"A",group:"expertContext",field:"garethFourthSkillLevel"},"20");
      await vi.runOnlyPendingTimersAsync();
      expect(expert("A")).toContain('<option value="20" selected>Lv20 · 5.0%</option>');
      expect(ui.app.innerHTML).not.toContain("当前效果：敌方全军穿透降低2.0%");
      ui.change({scope:"ice-fire-shared",side:"B",group:"expertContext",field:"garethFourthSkillLevel"},"8");
      await vi.runOnlyPendingTimersAsync();
      const saved = ui.restoreSaved().input;
      expect(saved.sideA.shared!.expertContext.garethFourthSkillLevel).toBe(20);
      expect(saved.sideB.shared!.expertContext.garethFourthSkillLevel).toBe(8);
      expect(expert("B")).toContain('<option value="8" selected>Lv8 · 2.0%</option>');
    } finally { vi.useRealTimers(); }
  });

  it("edits side-shared contexts and swaps full IceFire queues through UI autosave", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput(), queues = getValidationThreeQueues(base.sideA);
      const attrs = (value:number) => Object.fromEntries(["shield","lancer","marksman"].map((troop) => [troop,
        {attack:value,defense:value,penetration:value,life:value}])) as NonNullable<typeof queues[0]["attributes"]>;
      const ui = await mountStartup({...base,scenarioType:"ICE_FIRE_LEAGUE",attributeInputMode:"prediction",
        sideA:{...base.sideA,threeQueues:queues.map((queue,index) => ({...queue,attributes:attrs(2000+index*100)})) as unknown as NonNullable<typeof base.sideA.threeQueues>} });
      ui.change({scope:"ice-fire-shared",side:"A",group:"petContext",field:"attackLevel"},"10");
      ui.change({scope:"ice-fire-shared",side:"A",group:"expertContext",field:"garethFourthSkillLevel"},"20");
      ui.change({scope:"queue-t12",side:"A",queueIndex:"0",troop:"shield"},"3");
      ui.click("swap-ice-fire-queues",{side:"A",first:"0",second:"2"});
      await vi.runOnlyPendingTimersAsync();
      const saved = ui.restoreSaved().input.sideA;
      expect(saved.shared!.petContext.attackLevel).toBe(10);expect(saved.shared!.expertContext.garethFourthSkillLevel).toBe(20);
      expect(saved.threeQueues![0].attributes!.shield.attack).toBe(2200);expect(saved.threeQueues![2].attributes!.shield.attack).toBe(2000);
      expect(saved.threeQueues![2].t12Levels!.shield).toBe(3);expect(saved.queueOrder).toEqual([2,1,0]);
      expect(saved.threeQueues!.every((q) => !q.externalBuffs)).toBe(true);
      ui.click("open-optimizer");
      expect(ui.app.innerHTML).toContain('data-field="enemyPermutationMode"');
      expect(ui.app.innerHTML).toContain('data-field="fixedOwnQueueOrder"');
    } finally {vi.useRealTimers();}
  });

  it.each(["HEART_OF_EARTH", "HERO_LAND", "BEAST_CAVE", "GEM_MINE",
    "UNDERGROUND_LAB", "EQUIPMENT_FORGE"] as const)("renders %s with only its permitted fields and fixed input mode", async (mode) => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const input = normalizeInnerEarthInput({ ...base, scenarioType: "INNER_EARTH",
        innerEarth: createDefaultInnerEarthConfig(base, mode) });
      const ui = await mountStartup(input);
      const queued = mode === "HEART_OF_EARTH" || mode === "HERO_LAND";
      const fixedEnemy = mode === "GEM_MINE" || mode === "EQUIPMENT_FORGE";
      expect(ui.app.innerHTML).toContain(`data-inner-earth-mode="${mode}"`);
      expect(selectMarkup(ui.app.innerHTML, { scope: "inner-earth-mode" }).match(/<option /g)).toHaveLength(6);
      expect(ui.app.innerHTML).not.toContain('data-scope="attribute-input-mode"');
      expect(ui.app.innerHTML).not.toContain('data-body-slot-card');
      expect(ui.app.innerHTML).not.toContain('data-scope="report-hero"');
      expect(ui.app.innerHTML).not.toContain('data-field="enemy-ratio"');
      const presets = selectMarkup(ui.app.innerHTML, { scope: "inner-earth", field: "enemy-preset" });
      expect(presets.match(/<option /g)).toHaveLength(2);
      expect(presets).toContain("1/3 - 1/3 - 1/3");
      expect(presets).toContain("8/15 - 4/15 - 3/15");
      expect(ui.app.innerHTML.includes('data-field="enemy-capacity"')).toBe(!fixedEnemy);
      expect(ui.app.innerHTML.includes('data-field="hero"')).toBe(queued);
      expect(ui.app.innerHTML.includes('data-field="tier"')).toBe(mode === "HEART_OF_EARTH" || mode === "UNDERGROUND_LAB");
      expect(ui.app.innerHTML.includes('data-field="t12"')).toBe(false);
      if (mode === "HERO_LAND") {
        expect(ui.app.innerHTML).toContain("190410（固定）");
        expect(ui.app.innerHTML).not.toContain('data-field="ally-capacity"');
      }
      if (fixedEnemy) expect(ui.app.innerHTML).toContain("150000（固定）");
      ui.click("open-optimizer");
      expect(ui.app.innerHTML.includes('class="panel inner-earth-pets"')).toBe(mode === "HEART_OF_EARTH");
      expect(ui.app.innerHTML).not.toContain('data-field="fixedLeaders"');
      expect(ui.app.innerHTML).not.toContain('data-field="fixedMemberSkillIds"');
      if (!queued) {
        expect(ui.app.innerHTML).not.toContain('data-lazy-section="hero-pool"');
        expect(ui.app.innerHTML).not.toContain('data-lazy-section="owned-heroes"');
        expect(ui.app.innerHTML).not.toContain('data-field="weaponLevels"');
        expect(ui.app.innerHTML).toContain("仅兵种比例");
      }
      ui.change({ scope: "inner-earth", field: "enemy-preset" }, "SHIELD_HEAVY");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.innerEarth?.enemy.shared.troopRatioPreset).toBe("SHIELD_HEAVY");
      const prior = ui.restoreSaved().input.innerEarth;
      ui.change({ scope: "inner-earth", field: "enemy-preset" }, "CUSTOM");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.innerEarth).toEqual(prior);
      ui.change({ scope: "attribute-input-mode" }, input.attributeInputMode === "prediction" ? "finalReport" : "prediction");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.restoreSaved().input.attributeInputMode).toBe(input.attributeInputMode);
    } finally { vi.useRealTimers(); }
  });

  it("keeps independent Heart queue stats and ratios and saves pet combat context without changing base stats", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const input = normalizeInnerEarthInput({ ...base, scenarioType: "INNER_EARTH",
        innerEarth: createDefaultInnerEarthConfig(base, "HEART_OF_EARTH") });
      const ui = await mountStartup(input);
      ui.change({ scope: "inner-earth", field: "compact-attribute", side: "ally", queue: "1", stat: "attack" }, "2612.8");
      ui.change({ scope: "inner-earth", field: "ally-capacity" }, "50000");
      await vi.runOnlyPendingTimersAsync();
      const beforePet = ui.restoreSaved().input.innerEarth!;
      expect(beforePet.ally.queues[1].expectedReportStats.lancer.attack).toBe(2612.8);
      expect(beforePet.ally.queues[0].expectedReportStats.lancer.attack).toBe(input.innerEarth!.ally.queues[0].expectedReportStats.lancer.attack);
      expect(beforePet.ally.shared.capacity).toBe(50000);
      ui.click("open-optimizer");
      ui.change({ scope: "inner-earth", field: "pet", petField: "attackLevel" }, "5");
      await vi.runOnlyPendingTimersAsync();
      const after = ui.restoreSaved().input.innerEarth!;
      expect(after.petContext?.attackLevel).toBe(5);
      expect(after.ally.queues).toEqual(beforePet.ally.queues);
      expect(after.enemy).toEqual(beforePet.enemy);
      expect(after.ally.shared.capacity).toBe(50000);
    } finally { vi.useRealTimers(); }
  });

  it("runs the Inner Earth worker route and applies ratio-only results to canonical counts", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const configured = normalizeInnerEarthInput({ ...base, scenarioType: "INNER_EARTH",
        innerEarth: createDefaultInnerEarthConfig(base, "BEAST_CAVE") });
      const ui = await mountStartup(configured);
      ui.click("open-optimizer");
      ui.click("run-optimizer");
      expect(ui.workers).toHaveLength(1);
      const worker = ui.workers[0]!;
      expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
        task: "optimizeInnerEarth", input: expect.objectContaining({ scenarioType: "INNER_EARTH",
          innerEarth: expect.objectContaining({ subMode: "BEAST_CAVE" }) }),
      }));
      const response = fakeInnerEarthRatioResult(configured);
      worker.onmessage!({ data: { type: "complete-inner-earth", result: response } } as MessageEvent);
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(ui.app.innerHTML).toContain("地心优化结果");
      expect(ui.app.innerHTML).toContain('data-action="apply-inner-earth-optimizer"');
      const before = ui.restoreSaved().input.innerEarth!;
      ui.click("apply-inner-earth-optimizer", { index: "0" });
      await vi.runOnlyPendingTimersAsync();
      const after = ui.restoreSaved().input;
      expect(after.scenarioType).toBe("INNER_EARTH");
      expect(after.innerEarth!.ally.counts).toEqual({ shield: 18000, lancer: 3600, marksman: 14400 });
      expect(after.innerEarth!.ally.reportStats).toEqual(before.ally.reportStats);
      expect(after.innerEarth!.ally.queues).toEqual(before.ally.queues);
      expect(after.innerEarth!.enemy).toEqual(before.enemy);
      expect(after.innerEarth!.petContext).toEqual(before.petContext);
      expect(ui.app.innerHTML).not.toContain("地心优化结果");
    } finally { vi.useRealTimers(); }
  });

  it("applies Heart heroes/ratios while preserving base stats, pet, enemy and rejects stale pool revisions", async () => {
    vi.useFakeTimers();
    try {
      const base = createDefaultValidationInput();
      const config = createDefaultInnerEarthConfig(base, "HEART_OF_EARTH");
      const configured = normalizeInnerEarthInput({ ...base, scenarioType: "INNER_EARTH",
        innerEarth: { ...config, petContext: { ...config.petContext!, attackLevel: 5 } } });
      const recommendation: ThreeQueueOptimizationState = { queues: [
        { leaderHeroIds: { shield: "hero.s11.eleonora" }, headWeaponLevels: { "hero.s11.eleonora": 7 },
          ratiosBp: { shield: 5000, lancer: 1000, marksman: 4000 } },
        { leaderHeroIds: { lancer: "hero.s11.lloyd" }, headWeaponLevels: { "hero.s11.lloyd": 8 },
          ratiosBp: { shield: 6000, lancer: 1000, marksman: 3000 } },
        { leaderHeroIds: { marksman: "hero.s11.rufus" }, headWeaponLevels: { "hero.s11.rufus": 9 },
          ratiosBp: { shield: 5500, lancer: 1000, marksman: 3500 } },
      ] };
      const ui = await mountStartup(configured);
      ui.click("open-optimizer");
      ui.click("run-optimizer");
      const firstWorker = ui.workers[0]!;
      expect(firstWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ task: "optimizeInnerEarth" }));
      firstWorker.onmessage!({ data: { type: "complete-inner-earth",
        result: fakeInnerEarthQueueResult(configured, recommendation) } } as MessageEvent);
      await vi.advanceTimersByTimeAsync(0);
      expect(ui.app.innerHTML).toContain("地心优化结果");
      expect(ui.app.innerHTML).toContain("专武 Lv7");
      const before = ui.restoreSaved().input.innerEarth!;
      ui.click("apply-inner-earth-optimizer", { index: "0" });
      await vi.runOnlyPendingTimersAsync();
      const applied = ui.restoreSaved().input;
      applied.innerEarth!.ally.queues.forEach((queue, index) => {
        expect(queue.heroes).toEqual(recommendation.queues[index]!.leaderHeroIds);
        expect(queue.weaponLevels).toEqual(recommendation.queues[index]!.headWeaponLevels);
        expect(toThreeQueueBasisPoints(queue.ratio)).toEqual(recommendation.queues[index]!.ratiosBp);
        expect(queue.expectedReportStats).toEqual(before.ally.queues[index]!.expectedReportStats);
        expect(queue.reportHeroes).toEqual(before.ally.queues[index]!.reportHeroes);
      });
      expect(applied.innerEarth!.petContext).toEqual(before.petContext);
      expect(applied.innerEarth!.enemy).toEqual(before.enemy);
      expect(applied.innerEarth!.ally.shared).toEqual(before.ally.shared);
      ui.click("run-optimizer");
      const staleWorker = ui.workers[1]!;
      staleWorker.onmessage!({ data: { type: "complete-inner-earth",
        result: fakeInnerEarthQueueResult(applied, recommendation) } } as MessageEvent);
      await vi.advanceTimersByTimeAsync(0);
      expect(ui.app.innerHTML).toContain("地心优化结果");
      ui.change({ scope: "hero-pool", heroId: "hero.s11.eleonora" }, "", false);
      await vi.runOnlyPendingTimersAsync();
      const afterPool = ui.restoreSaved().input.innerEarth;
      expect(ui.app.innerHTML).not.toContain("地心优化结果");
      ui.click("apply-inner-earth-optimizer", { index: "0" });
      await vi.runOnlyPendingTimersAsync();
      expect(ui.app.innerHTML).toContain("推荐方案已失效");
      expect(ui.restoreSaved().input.innerEarth).toEqual(afterPool);
    } finally { vi.useRealTimers(); }
  });

  it("hides every R/SR hero from the S11 optimizer pool while retaining selectable manual heroes", async () => {
    vi.useFakeTimers();
    try {
      const ui = await mountStartup({ ...createDefaultValidationInput(), attributeInputMode: "prediction" });
      ui.click("open-optimizer");
      const pool = ui.open("hero-pool");
      expect(pool).toContain('data-scope="hero-pool" data-hero-id="hero.s11.eleonora"');
      const lowRarityHeroes = getValidationCatalog().leaderHeroes.filter((hero) => hero.rarity === "R" || hero.rarity === "SR");
      expect(lowRarityHeroes.some((hero) => hero.rarity === "R")).toBe(true);
      expect(lowRarityHeroes.some((hero) => hero.rarity === "SR")).toBe(true);
      for (const hero of lowRarityHeroes) {
        expect(pool).not.toContain(`data-hero-id="${hero.heroId}"`);
        expect(selectMarkup(ui.app.innerHTML, { scope: "leader", side: "A", troop: hero.troopType }))
          .toContain(`<option value="${hero.heroId}"`);
      }
      ui.change({ scope: "leader", side: "A", troop: "shield" }, "hero.r.youjin");
      ui.change({ scope: "leader", side: "A", troop: "lancer" }, "hero.sr.patelike");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.setItem).toHaveBeenCalled();
      const restored = ui.restoreSaved().input;
      expect(restored.sideA.leaderHeroIds?.shield).toBe("hero.r.youjin");
      expect(restored.sideA.leaderHeroIds?.lancer).toBe("hero.sr.patelike");
      expect(selectMarkup(ui.app.innerHTML, { scope: "leader", side: "A", troop: "shield" }))
        .toContain('value="hero.r.youjin" selected');
      expect(selectMarkup(ui.app.innerHTML, { scope: "leader", side: "A", troop: "lancer" }))
        .toContain('value="hero.sr.patelike" selected');
    } finally { vi.useRealTimers(); }
  });

  it.each(["SINGLE", "THREE_THREE_THREE"] as const)("renders and saves A方/B方 optimization choices for %s", async (scenarioType) => {
    vi.useFakeTimers();
    try {
      const ui = await mountStartup({ ...createDefaultValidationInput(), scenarioType, attributeInputMode: "prediction" });
      ui.click("open-optimizer");
      const options = () => selectMarkup(ui.app.innerHTML, { scope: "simple-optimizer", field: "side" });
      expect(options()).toMatch(/value="A" selected>A方/);
      expect(options()).toMatch(/value="B"\s*>B方/);
      expect(options()).not.toMatch(/进攻|防守|集结/);
      ui.change({ scope: "simple-optimizer", field: "side" }, "B");
      await vi.runOnlyPendingTimersAsync();
      expect(options()).toMatch(/value="B" selected>B方/);
      expect(ui.setItem).toHaveBeenCalled();
      expect(ui.restoreSaved().simpleOptimizerOptions.side).toBe("B");
      expect(ui.restoreSaved().input.scenarioType).toBe(scenarioType);
      expect(ui.open("hero-pool")).toMatch(/value="B" selected>B 方/);
      ui.change({ scope: "simple-optimizer", field: "side" }, "A");
      await vi.runOnlyPendingTimersAsync();
      expect(options()).toMatch(/value="A" selected>A方/);
      expect(ui.restoreSaved().simpleOptimizerOptions.side).toBe("A");
    } finally { vi.useRealTimers(); }
  });

  it.each(["SINGLE", "THREE_THREE_THREE", "RALLY"] as const)("restores B as the selected optimizer and hero-pool editing side for %s", async (scenarioType) => {
    vi.useFakeTimers();
    try {
      const configured = { ...createDefaultValidationInput(), scenarioType,
        battleContext: scenarioType === "RALLY" ? "rally" as const : "challenge" as const, attributeInputMode: "prediction" as const };
      const rally = { ...defaultOptimizationConfig(configured.randomSeed), candidateSide: "B" as const,
        objectiveMode: "singleWin" as const };
      const simple = { ...defaultSimpleScenarioOptimizationOptions(configured.randomSeed), side: "B" as const };
      const ui = await mountStartup(configured, rally, simple);
      ui.click("open-optimizer");
      const selector = selectMarkup(ui.app.innerHTML, scenarioType === "RALLY"
        ? { scope: "optimizer", field: "candidateSide" } : { scope: "simple-optimizer", field: "side" });
      expect(selector).toMatch(scenarioType === "RALLY" ? /value="B" selected>集结防守方/ : /value="B" selected>B方/);
      expect(ui.open("hero-pool")).toMatch(/value="B" selected>B 方/);
    } finally { vi.useRealTimers(); }
  });

  it("saves the rally defender selection and rebinds existing current-head/body locks to B", async () => {
    vi.useFakeTimers();
    try {
      const configured = distinctRallyInput();
      const ui = await mountStartup(configured, defaultOptimizationConfig(configured.randomSeed));
      ui.click("open-optimizer");
      const options = () => selectMarkup(ui.app.innerHTML, { scope: "optimizer", field: "candidateSide" });
      expect(options()).toMatch(/value="A" selected>集结进攻方/);
      expect(options()).toMatch(/value="B"\s*>集结防守方/);
      ui.change({ scope: "optimizer", field: "fixedLeaders" }, "", true);
      ui.change({ scope: "optimizer", field: "fixedMemberSkillIds" }, "", true);
      await vi.runOnlyPendingTimersAsync();
      const attackerLocks = ui.restoreSaved().optimizationConfig.constraints;
      expect(attackerLocks.fixedLeaders).toEqual(configured.sideA.leaderHeroIds);
      expect(attackerLocks.fixedMemberSkillIds).toEqual(configured.sideA.selectedMemberSkillIds);
      ui.setItem.mockClear();
      ui.change({ scope: "optimizer", field: "candidateSide" }, "B");
      await vi.runOnlyPendingTimersAsync();
      expect(ui.setItem).toHaveBeenCalled();
      const restored = ui.restoreSaved();
      expect(restored.optimizationConfig.candidateSide).toBe("B");
      expect(restored.optimizationConfig.objectiveMode).toBe("singleWin");
      expect(restored.optimizationConfig.constraints.fixedLeaders).toEqual(restored.input.sideB.leaderHeroIds);
      expect(restored.optimizationConfig.constraints.fixedMemberSkillIds).toEqual(restored.input.sideB.bodySkills?.map((body) => body.skillId));
      expect(restored.optimizationConfig.constraints.fixedBodyExact).toBe(true);
      expect(restored.optimizationConfig.constraints.fixedLeaders).not.toEqual(restored.input.sideA.leaderHeroIds);
      expect(restored.optimizationConfig.constraints.fixedMemberSkillIds).not.toEqual(restored.input.sideA.selectedMemberSkillIds);
      expect(options()).toMatch(/value="B" selected>集结防守方/);
      expect(ui.app.innerHTML).toContain("最高防守方胜率");
      expect(ui.app.innerHTML).not.toContain('data-field="objectiveMode"');
      expect(ui.app.innerHTML).toMatch(/data-field="fixedLeaders" type="checkbox" checked/);
      expect(ui.app.innerHTML).toMatch(/data-field="fixedMemberSkillIds" type="checkbox" checked/);
      expect(ui.open("hero-pool")).toMatch(/value="B" selected>B 方/);
    } finally { vi.useRealTimers(); }
  });

  it("renders four independently identified body cards per side with each side's rally role", async () => {
    vi.useFakeTimers();
    try {
      const ui = await mountStartup(distinctRallyInput());
      expect(ui.app.innerHTML.match(/data-body-slot-card data-side="A"/g)).toHaveLength(4);
      expect(ui.app.innerHTML.match(/data-body-slot-card data-side="B"/g)).toHaveLength(4);
      for (const [side, role] of [["A", "集结进攻方"], ["B", "集结防守方"]] as const) {
        for (let index = 0; index < 4; index++) {
          expect(ui.app.innerHTML).toContain(`<h4 id="member-${side}-${index}-title">${role} · 车身槽位${index + 1}</h4>`);
          expect(selectMarkup(ui.app.innerHTML, { scope: "member", side, index: String(index) }))
            .toContain(`id="member-${side}-${index}-select"`);
          expect(ui.app.innerHTML).toContain(`data-body-description data-side="${side}" data-index="${index}"`);
        }
      }
      expect(selectMarkup(ui.app.innerHTML, { scope: "member", side: "A", index: "0" }))
        .toContain('value="hero-skill.shuyun.attack" selected');
      expect(selectMarkup(ui.app.innerHTML, { scope: "member", side: "B", index: "0" }))
        .toContain('value="hero-skill.xieergai.guardian-power" selected');
    } finally { vi.useRealTimers(); }
  });

  it.each(["RALLY", "CITY_DEFENSE"] as const)("applies the worker's %s defender recommendation to B's heroes, bodies, weapons and troop ratio", async (scenarioType) => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const configured = { ...distinctRallyInput(), scenarioType, battleContext: scenarioType === "CITY_DEFENSE" ? "cityDefense" as const : "rally" as const, defenderInTerritory: true };
      const ui = await mountStartup(configured, defaultOptimizationConfig(configured.randomSeed));
      ui.click("open-optimizer");
      ui.change({ scope: "optimizer", field: "candidateSide" }, "B");
      await vi.runOnlyPendingTimersAsync();
      const before = ui.restoreSaved().input;
      const recommendation: RallyCandidate = { leaderHeroIds: { shield: "hero.s11.eleonora", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" },
        memberSkillIds: ["hero-skill.shuyun.attack", "hero-skill.jiexi.penetration", "hero-skill.patelike.life", "hero-skill.wuming.wind-shelter"],
        headWeaponLevels: { "hero.s11.eleonora": 7, "hero.s11.lloyd": 8, "hero.s11.rufus": 9 },
        ratios: { shield: 20, lancer: 30, marksman: 50 } };
      ui.click("run-optimizer");
      expect(ui.workers).toHaveLength(1);
      const worker = ui.workers[0]!;
      expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ task: "optimize",
        config: expect.objectContaining({ candidateSide: "B", objectiveMode: "singleWin" }) }));
      worker.onmessage!({ data: { type: "complete", result: fakeOptimizationResult(before, recommendation) } } as MessageEvent);
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(ui.app.innerHTML).toContain(scenarioType === "CITY_DEFENSE" ? "守城防守方优化结果" : "集结防守方优化结果");
      expect(ui.app.innerHTML).toContain('data-action="apply-rally-optimizer"');
      expect(ui.app.innerHTML).not.toContain("搜索中…");
      ui.setItem.mockClear();
      ui.click("apply-rally-optimizer", { index: "0" });
      await vi.runOnlyPendingTimersAsync();
      expect(ui.app.innerHTML).toContain("已应用推荐方案。");
      expect(ui.setItem).toHaveBeenCalled();
      const restored = ui.restoreSaved();
      expect(restored.optimizationConfig.candidateSide).toBe("B");
      expect(restored.input.scenarioType).toBe(scenarioType);
      expect(restored.input.defenderInTerritory).toBe(true);
      expect(restored.input.sideA).toEqual(before.sideA);
      expect(restored.input.sideB.leaderHeroIds).toEqual(recommendation.leaderHeroIds);
      expect(restored.input.sideB.selectedMemberSkillIds).toEqual(recommendation.memberSkillIds);
      expect(restored.input.sideB.bodySkills?.map((body) => body.skillId)).toEqual(recommendation.memberSkillIds);
      expect(restored.input.sideB.bodySkills?.map((body) => body.runtimeInstanceId)).toEqual(["B-body-0", "B-body-1", "B-body-2", "B-body-3"]);
      expect(restored.input.sideB.simulationWeaponLevels).toMatchObject(recommendation.headWeaponLevels!);
      expect(restored.input.sideB.rallyDeployment?.ratios).toEqual(recommendation.ratios);
      expect(restored.input.sideB.rallyDeployment?.totalTroops).toBe(36000);
      expect(restored.input.sideB.rallyDeployment?.ratios).toEqual({ shield: 20, lancer: 30, marksman: 50 });
      const battle = createValidationPreviewState(restored.input);
      expect([battle.sideB.troops.shield.aliveCount, battle.sideB.troops.lancer.aliveCount,
        battle.sideB.troops.marksman.aliveCount]).toEqual([7200, 10800, 18000]);
      expect(ui.app.innerHTML).not.toContain(scenarioType === "CITY_DEFENSE" ? "守城防守方优化结果" : "集结防守方优化结果");
    } finally { vi.useRealTimers(); }
  });
});

