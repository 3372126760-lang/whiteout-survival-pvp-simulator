import { afterEach, describe, expect, it, vi } from "vitest";
import { battleJsonFilename, downloadBattleJson } from "./battleJsonExport";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("battle JSON file downloads", () => {
  it.each([502926396, 0, undefined])("uses a Windows-safe local timestamp and optional seed %s", (seed) => {
    const date = new Date(2026, 9, 17, 2, 52, 59);
    const suffix = seed === undefined ? "" : `-${seed}`;
    for (const kind of ["input", "result"] as const) {
      const name = battleJsonFilename(kind, seed, date);
      expect(name).toBe(`whiteout-pvp-battle-${kind}-2026-10-17-025259${suffix}.json`);
      expect(name).not.toMatch(/[<>:"/\\|?*]/);
    }
  });
  it.each([false, true])("cleans the anchor and releases its Blob URL, including click failure=%s", async (failClick) => {
    vi.useFakeTimers();
    const data = { 技能: "惊梦留痕", nested: { full: "all data", values: [1, 2, 3] } };
    const link = { href: "", download: "", hidden: false, click: vi.fn(() => { if (failClick) throw new Error("download blocked"); }), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", { createElement: () => link, body: { append } });
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    if (failClick) expect(() => downloadBattleJson("input", data, 0)).toThrow("download blocked");
    else downloadBattleJson("input", data, 0);
    const blob = createUrl.mock.calls[0]![0] as Blob;
    expect(await blob.text()).toBe(JSON.stringify(data));
    expect(blob.type).toBe("application/json;charset=utf-8");
    expect(blob.size).toBe(new TextEncoder().encode(JSON.stringify(data)).byteLength);
    expect(append).toHaveBeenCalledWith(link); expect(link.click).toHaveBeenCalledOnce();
    expect(link.hidden).toBe(true); expect(link.remove).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:test");
  });
});
