import { createPersistedEnvelope, restorePersistedConfig } from "../storage";
import type { ValidationBattleInput } from "../pvp/validationUi/types";

/** Allowlisted by the existing config codec; exclude OCR provenance and optimizer inventories. */
export function encodeSimpleShare(input: ValidationBattleInput, simulationCount: number): string {
  const envelope = createPersistedEnvelope(input, simulationCount, undefined, 0);
  const omitted = new Set(["recognizedSpecialBonuses", "legacySceneMigration", "ownedHeroIds",
    "optimizerHeroPool", "rallyBodyPoolIds", "availableHeroIds"]);
  const json = JSON.stringify(envelope, (key, value: unknown) => omitted.has(key) ? undefined : value);
  const bytes = new TextEncoder().encode(json);
  return "v1." + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeSimpleShare(payload: string) {
  if (!payload.startsWith("v1.") || payload.length > 250_000 || !/^v1\.[\w-]+$/.test(payload)) {
    throw new Error("分享链接格式或版本无效。");
  }
  try {
    const binary = atob(payload.slice(3).replaceAll("-", "+").replaceAll("_", "/"));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    return restorePersistedConfig(JSON.parse(json) as unknown);
  } catch { throw new Error("分享阵容无法读取，请检查链接是否完整。"); }
}
