type BattleJsonKind = "input" | "result";

export function battleJsonFilename(kind: BattleJsonKind, seed?: number, date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const suffix = seed !== undefined && Number.isSafeInteger(seed) ? `-${seed}` : "";
  return `whiteout-pvp-battle-${kind}-${timestamp}${suffix}.json`;
}

/** Call only from an explicit user action. Never retain a full JSON string in UI state. */
export function downloadBattleJson(kind: BattleJsonKind, data: unknown, seed?: number): void {
  const json = JSON.stringify(data);
  if (json === undefined) throw new Error("没有可导出的战斗 JSON 数据。");
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = battleJsonFilename(kind, seed);
    link.hidden = true;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Leave the browser one task to start reading the Blob before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
