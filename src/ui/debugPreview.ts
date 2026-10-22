/** Preview budgets apply before serialization: never stringify a complete trace to truncate it. */
export const DEBUG_PREVIEW = { rounds: 10, events: 20, chars: 32_000 } as const;

/** Bound rich event markup before joining its fragments into one HTML string. */
export function debugHtmlPreview(parts: TemplateStringsArray, ...values: readonly (string | number)[]): string {
  let length = 0;
  for (const part of parts) length += part.length;
  for (const value of values) length += String(value).length;
  if (length > DEBUG_PREVIEW.chars) return '<p class="hint">事件预览超过 32,000 字符，请在 Raw Data 中主动复制完整 JSON 查看。</p>';
  return parts.reduce((html, part, index) => html + part + (values[index] ?? ""), "");
}

export function debugJsonPreview(value: unknown, maxChars: number = DEBUG_PREVIEW.chars): string {
  let remaining = Math.max(0, maxChars - 100);
  let nodes = 600;
  const seen = new WeakSet<object>();
  const clip = (text: string) => {
    const result = text.slice(0, Math.min(256, Math.max(0, remaining)));
    remaining -= result.length + 8;
    return result.length < text.length ? `${result}…` : result;
  };
  const visit = (entry: unknown, depth: number): unknown => {
    if (--nodes < 0 || remaining <= 0) return "[preview budget]";
    remaining -= 8;
    if (typeof entry === "string") return clip(entry);
    if (entry === null || typeof entry !== "object") {
      return typeof entry === "function" ? "[function]" : typeof entry === "bigint" ? String(entry) : entry;
    }
    if (depth >= 7) return "[depth limit]";
    if (seen.has(entry)) return "[shared/circular reference]";
    seen.add(entry);
    if (Array.isArray(entry)) {
      const output: unknown[] = [];
      for (let i = 0; i < Math.min(entry.length, DEBUG_PREVIEW.events) && remaining > 0 && nodes > 0; i++) {
        output.push(visit(entry[i], depth + 1));
      }
      if (output.length < entry.length) output.push(`[${entry.length - output.length} more items]`);
      return output;
    }
    const output: Record<string, unknown> = {};
    let count = 0;
    for (const key in entry) {
      if (!Object.hasOwn(entry, key)) continue;
      if (count++ >= 40 || remaining <= 0 || nodes <= 0) { output["…"] = "[preview limit]"; break; }
      output[clip(key)] = visit((entry as Record<string, unknown>)[key], depth + 1);
    }
    return output;
  };
  // Only this bounded copy is serialized; escaping/indentation can still expand its characters.
  const text = JSON.stringify(visit(value, 0), null, 2) ?? "null";
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 20))}\n[preview limit]`;
}
