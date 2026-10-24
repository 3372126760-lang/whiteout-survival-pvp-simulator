export interface AppDialog {
  readonly title: string;
  readonly message?: string;
  name?: string;
  importText?: string;
  error?: string;
  readonly confirmLabel: string;
  readonly onConfirm: (name: string) => void;
}
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function renderAppDialog(dialog: AppDialog | null): string {
  if (dialog === null) return "";
  return `<div class="app-dialog-backdrop"><section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
    <h2 id="app-dialog-title">${escape(dialog.title)}</h2>
    ${dialog.message === undefined ? "" : `<p class="app-dialog-message">${escape(dialog.message)}</p>`}
    ${dialog.name === undefined ? "" : `<label>方案名称<input type="text" data-scope="dialog-name" value="${escape(dialog.name)}" maxlength="80" autofocus></label>`}
    ${dialog.importText === undefined ? "" : `<label>选择配置文件（推荐）<input data-scope="import-file" type="file" accept=".json,application/json" aria-label="选择配置 JSON 文件"></label><label>或粘贴旧分享链接 / 配置 JSON<textarea data-scope="import-config-text" rows="8" spellcheck="false" placeholder="https://…/?mode=advanced#s=… 或配置 JSON">${escape(dialog.importText)}</textarea></label>`}
    ${dialog.error === undefined ? "" : `<p class="field-error" role="alert">${escape(dialog.error)}</p>`}
    <div class="button-row"><button class="btn" data-action="dialog-cancel">取消</button>
    <button class="btn btn-primary" data-action="dialog-confirm">${escape(dialog.confirmLabel)}</button></div>
  </section></div>`;
}
