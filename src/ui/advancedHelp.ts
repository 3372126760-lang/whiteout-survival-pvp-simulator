export function advancedHelp(summary: string, detail: string): string {
  return `<p class="hint">${summary}</p><details class="mini-details advanced-help"><summary>查看详细说明</summary><div class="hint">${detail}</div></details>`;
}
export function attributeModeHelp(prediction: boolean): string {
  return `<p class="notice" data-attribute-mode-hint>${prediction
    ? "当前输入为基础属性。下方城镇、宠物、专家等当前Buff会继续作用于这些属性。"
    : "当前输入为最终战报属性。战报中已经包含的城镇、宠物、专家等普通攻防穿血不会再次叠加，以避免重复计算。"}</p>`;
}
export const WEAPON_HELP = "专武可能同时包含①反映在战报面板中的静态属性；②战斗中实际生效的专武技能。使用最终战报属性时，①不再重复叠加，但仍需要设置专武等级，因为②仍由BattleEngine执行。";
