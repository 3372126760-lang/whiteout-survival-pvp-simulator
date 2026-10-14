import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../../ui/main");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("outer startup exception fallback", () => {
  it("displays a dynamic-import runtime failure and a reload action", async () => {
    const nodes: { tag: string; textContent?: string; children: unknown[];
      append: (...children: unknown[]) => void; addEventListener: ReturnType<typeof vi.fn> }[] = [];
    const root = { replaceChildren: vi.fn() };
    vi.stubGlobal("document", { querySelector: () => root,
      documentElement: { dataset: {} }, createElement: (tag: string) => {
        const node = { tag, children: [] as unknown[], setAttribute: vi.fn(),
          addEventListener: vi.fn(), append: (...children: unknown[]) => node.children.push(...children) };
        nodes.push(node);
        return node;
      } });
    vi.stubGlobal("location", { search: "", reload: vi.fn() });
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.doMock("../../ui/main", () => {
      throw new ReferenceError("Cannot access 'reportAttributes' before initialization");
    });
    await import("../../ui/bootstrap");
    expect(root.replaceChildren).toHaveBeenCalledOnce();
    expect(nodes.find((node) => node.tag === "h1")?.textContent).toBe("页面加载失败");
    // Vitest wraps an exception thrown by a mock module factory in its own Error.
    expect(nodes.find((node) => node.tag === "p")?.textContent).toContain("错误：");
    const button = nodes.find((node) => node.tag === "button");
    expect(button?.textContent).toBe("重新加载");
    expect(button?.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
    const { renderFatalError } = await import("../../ui/startupErrors");
    nodes.length = 0;
    renderFatalError(new ReferenceError("Cannot access 'reportAttributes' before initialization"));
    expect(nodes.find((node) => node.tag === "p")?.textContent).toBe(
      "错误：Cannot access 'reportAttributes' before initialization",
    );
    button?.addEventListener.mock.calls[0]?.[1]();
    expect(location.reload).toHaveBeenCalledOnce();
  });
});
