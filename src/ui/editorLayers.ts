import { readEditorMode, type EditorMode } from "./simpleMode";

/** UI routing only: neither URL flag is part of the canonical battle configuration. */
export function resolveEditorLayers(search: string, storage: Pick<Storage, "getItem">): {
  mode: EditorMode; developerToolsEnabled: boolean;
} {
  const query = new URLSearchParams(search);
  const requested = query.get("mode");
  return { mode: requested === "advanced" || requested === "simple" ? requested : readEditorMode(storage),
    developerToolsEnabled: query.get("dev") === "1" };
}

export function playerOptimizerProgress(completed: number, total: number): string {
  return total > 0 ? `正在比较候选阵容 · ${completed.toLocaleString()} / ${total.toLocaleString()}` : "正在准备候选阵容…";
}
