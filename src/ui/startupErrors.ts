/// <reference types="vite/client" />

export function renderFatalError(error: unknown): void {
  const root = document.querySelector("#app");
  if (root === null) return;
  const failure = error instanceof Error ? error : new Error(String(error));
  const panel = document.createElement("section");
  panel.className = "startup-error";
  panel.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "页面加载失败";
  const message = document.createElement("p");
  message.textContent = `错误：${failure.message}`;
  const reload = document.createElement("button");
  reload.className = "btn btn-primary";
  reload.textContent = "重新加载";
  reload.addEventListener("click", () => location.reload());
  panel.append(heading, message, reload);
  if (import.meta.env.DEV && failure.stack) {
    const stack = document.createElement("pre");
    stack.textContent = failure.stack;
    panel.append(stack);
  }
  root.replaceChildren(panel);
  document.documentElement.dataset.pvpRuntimeError = "true";
}
