import { createPersistedEnvelope, parsePersistedJson, restorePersistedConfig } from "../storage";
import { decodeSimpleShare } from "./simpleShare";
import type { ValidationBattleInput } from "../pvp/validationUi/types";
/** One canonical codec for JSON/file imports; the existing share decoder owns URLs. */
export function parseConfigurationImport(text: string, simulationCount = 1000) {
  const value = text.replace(/^\uFEFF/, "").trim();
  if (!value) throw new Error("请粘贴分享链接或配置 JSON，或选择配置文件。");
  if (value.startsWith("v1.")) return decodeSimpleShare(value);
  if (/^(https?:\/\/|#|\?)/i.test(value)) {
    const url = new URL(value, "https://config.invalid/");
    const payload = new URLSearchParams(url.hash.slice(1)).get("s");
    if (!payload) throw new Error("链接中没有阵容分享配置（#s=…）。");
    return decodeSimpleShare(payload);
  }
  let raw: unknown; try { raw = JSON.parse(value); } catch { throw new Error("JSON 格式损坏，无法读取配置。"); }
  if (raw && typeof raw === "object" && "sideA" in raw && "sideB" in raw)
    return restorePersistedConfig(createPersistedEnvelope(raw as ValidationBattleInput, simulationCount));
  return parsePersistedJson(value);
}
