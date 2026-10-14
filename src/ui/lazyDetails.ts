/** Collapsed sections keep only a summary. Their body is built on demand. */
export class LazyDetails {
  private readonly open = new Set<string>();
  private readonly bodies = new Map<string, () => string>();

  beginRender(): void { this.bodies.clear(); }
  isOpen(key: string): boolean { return this.open.has(key); }

  render(key: string, summary: string, body: () => string,
    attributes = ""): string {
    this.bodies.set(key, body);
    const summaryClass = attributes.includes("panel") || key === "hero-pool" ? "panel-head" : "";
    return `<details data-lazy-section="${key}" ${attributes} ${this.isOpen(key) ? "open" : ""}>
      <summary class="${summaryClass}">${summary}</summary>${this.isOpen(key) ?
        `<div data-lazy-body>${body()}</div>` : ""}</details>`;
  }

  toggle(target: HTMLDetailsElement): void {
    const key = target.dataset.lazySection;
    if (key === undefined) return;
    if (target.open) this.open.add(key); else this.open.delete(key);
    const existing = target.querySelector(":scope > [data-lazy-body]");
    if (!target.open) existing?.remove();
    else if (existing === null) {
      const body = this.bodies.get(key);
      if (body !== undefined) target.insertAdjacentHTML("beforeend",
        `<div data-lazy-body>${body()}</div>`);
    }
  }
}
