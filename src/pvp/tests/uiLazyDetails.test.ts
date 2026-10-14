import { describe, expect, it, vi } from "vitest";
import { LazyDetails } from "../../ui/lazyDetails";

describe("on-demand detail sections", () => {
  it("does not build OCR or hero body when collapsed, builds it on open, removes it on close", () => {
    const sections = new LazyDetails();
    const body = vi.fn(() => '<input data-scope="report-field">');
    expect(sections.render("ocr-A", "12/12", body)).not.toContain("report-field");
    expect(body).not.toHaveBeenCalled();
    const insert = vi.fn();
    const remove = vi.fn();
    const target = { dataset: { lazySection: "ocr-A" }, open: true,
      querySelector: () => null, insertAdjacentHTML: insert } as unknown as HTMLDetailsElement;
    sections.toggle(target);
    expect(body).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith("beforeend", expect.stringContaining("report-field"));
    expect(sections.isOpen("ocr-A")).toBe(true);
    target.open = false;
    target.querySelector = (() => ({ remove })) as typeof target.querySelector;
    sections.toggle(target);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(sections.isOpen("ocr-A")).toBe(false);
  });
});
