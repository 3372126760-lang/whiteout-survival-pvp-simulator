/** Mechanical one-time sync of the confirmed troop-rule audit metadata. */
import { readFileSync, writeFileSync } from "node:fs";
import { URL } from "node:url";

const file = new URL("../docs/pvp-skill-inventory.json", import.meta.url);
const inventory = JSON.parse(readFileSync(file, "utf8"));
if (inventory.migrationNotice) {
  throw new Error("此一次性同步脚本属于历史规则，不能重放到当前库存；请以 TypeScript 定义和 2026-09-27 规则迁移文档为准。");
}
const byEffect = (id) => {
  const entry = inventory.entries.find((item) => item.sourceType === "troop" && item.effectId === id);
  if (!entry) throw new Error(`Missing troop inventory effect ${id}`);
  return entry;
};
const confirm = (entry, basis) => {
  entry.ruleStatus = "supported";
  entry.confirmationStatus = "confirmed";
  entry.confirmationBasis = basis;
  entry.confirmationEvidence = "用户最终确认兵种规则：ff89c772/已粘贴的文本.txt；专项回归测试";
  entry.candidateGroups = [];
};

const shieldLink = byEffect("shield-lightforged-linked-cancellation");
const crystalShield = byEffect("shield-crystal-shield-cancellation");
crystalShield.confirmationBasis = "最终规则确认：每次敌方兵种主攻击判定一次，成功后同root全部伤害使用单份36%/46%/51%直接抵消。";
crystalShield.confirmationEvidence = "用户最终确认兵种规则：ff89c772/已粘贴的文本.txt；专项回归测试";
shieldLink.uiSummary = "基础防御力独立提升；烈晶盾牌抵消值直接升至46%/51%";
shieldLink.confirmationBasis = "光铸之躯只修改烈晶盾牌单份抵消值：36%+10%/15%=46%/51%；不产生第二个抵消乘区或概率判定。";

const crimson = byEffect("lancer-crimson-field-half");
crimson.uiSummary = "每笔独立伤害事件分别判定；成功时该笔伤害直接减半";
crimson.description = "FC8 10%、FC10 15%；normalAttack、skillDamage、extraDamage 独立事件各判一次；连射内部段不另判。";
crimson.scope.damageType = "all";
crimson.damageTypes = ["all"];
confirm(crimson, "真实战报确认逐独立 DamageEvent 判定；成功时直接乘0.5，连射内部第二段不增加判定。" );

const radiantShield = byEffect("lancer-radiant-shield-reduction");
radiantShield.group = "receivedDamageReduction";
confirm(radiantShield, "最终规则明确前5回合盾兵普通承伤减伤，每级1%，按伤害除以(1+x)结算。" );

const radiantMarksman = byEffect("lancer-radiant-marksman-increase");
radiantMarksman.group = "baseDamageIncrease";
confirm(radiantMarksman, "最终规则明确前5回合射手普通增伤，每级1%，覆盖普攻、连射内部段、skillDamage 和 extraDamage。" );

const rapid = byEffect("marksman-rapid-fire-second-shot");
rapid.uiSummary = "同次主攻击内部第二段100%普通伤害；不新增独立 DamageEvent 或概率判定";
rapid.skillType = "概率+同主攻击内部段";
rapid.effectKind = "sameMainAttackSegment";
rapid.effectName = "连射：同次主攻击第二段普通伤害";
rapid.extra.attackCount = null;
rapid.extra.segmentCount = 1;
rapid.confirmationBasis = "最终规则确认连射是同一主攻击内部第二段，不增加 attackCount、独立 DamageEvent 或防御事件判定；目标和适用普攻乘区继承主攻击。";

const blazing = byEffect("marksman-blazing-star-increase");
blazing.uiSummary = "R6起每5回合永久增加一层射手普通增伤，每层为等级×0.5%";
blazing.description = "stack(r)=floor((r-1)/5)，每层0.005×最终T12等级，无已知层数上限。";
blazing.skillType = "常驻+普通增伤+永久叠层";
blazing.effectName = "炽火燧星：射手累计增伤";
blazing.effectKind = "damageIncrease";
blazing.group = "baseDamageIncrease";
blazing.scope = { source: "self", target: "all", damageType: "all" };
blazing.damageTypes = ["all"];
blazing.targetTroops = ["all"];
blazing.extra.basis = null;
for (const level of Object.keys(blazing.lifecycleByLevel)) {
  blazing.lifecycleByLevel[level] = { refreshMode: "replace" };
}
confirm(blazing, "最终规则明确 R1-R5 零层、R6 起每5回合永久增一层；每层为最终T12等级×0.5%，归普通增伤，覆盖射手全部伤害。" );

inventory.groups.damageSide = inventory.groups.damageSide.filter((group) => group.id !== "lancerRadiantMarksmanDamageIncrease");
inventory.groups.defenseSide = inventory.groups.defenseSide.filter((group) => group.id !== "shieldReceivedDamageReduction");
inventory.stats.damageSideGroupCount = inventory.groups.damageSide.length;
inventory.stats.defenseSideGroupCount = inventory.groups.defenseSide.length;
// Preserve the inventory's established primary-effect counting convention.
inventory.stats.confirmedEffectCount = 229;
inventory.stats.confirmedEffectCountIncludingLegacyAliases = 234;
inventory.stats.provisionalEffectCount = 37;
inventory.stats.provisionalEffectCountIncludingLegacyAliases = 37;
inventory.stats.pendingEffectCount = 37;
inventory.auditMode = "source-and-final-confirmed-troop-rule-sync";
writeFileSync(file, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

const inventoryMarkdownFile = new URL("../docs/pvp-skill-inventory.md", import.meta.url);
let inventoryMarkdown = readFileSync(inventoryMarkdownFile, "utf8").split(/\r?\n/);
const inventoryRows = new Map([
  ["| 盾 | 光铸之躯（`shield-lightforged-body`）", "| 盾 | 光铸之躯（`shield-lightforged-body`） | 基础防御力+4%/6%；烈晶盾牌触发时将其单份抵消值从36%直接改为46%/51%。 | 常驻+基础防御倍率+联动数值修正 | passive；FC8 Lv1 / FC10 Lv2 | `shield-lightforged-defense` / baseDefenseMultiplier / `lightforgedBaseDefense` / 4%/6% / all damage<br>`shield-lightforged-linked-cancellation` / 烈晶盾牌数值贡献 / `crystalShieldDirectCancellation` / +10%/+15%；不生成第二个 ActiveEffect 或概率判定 | confirmed | `src/pvp/troopSkills/definitions/shield.ts` |"],
  ["| 矛 | 炽红力场（`lancer-crimson-field`）", "| 矛 | 炽红力场（`lancer-crimson-field`） | FC8 10%、FC10 15%；每笔独立 incoming DamageEvent 判定，成功直接×0.5；连射内部段不另判。 | 概率+直接抵消 | beforeDamage；Lv1=10%；Lv2=15% | `lancer-crimson-field-half` / directDamageCancellation / `crimsonFieldDirectCancellation` / 50% / target=lancer；damage=all | confirmed | `src/pvp/troopSkills/definitions/lancer.ts` |"],
  ["| 矛 | 烈辉战阵（`lancer-radiant-formation-t12`）", "| 矛 | 烈辉战阵（`lancer-radiant-formation-t12`） | R1-R5：盾兵普通承伤减伤、射手普通增伤，均为最终T12等级×1%。 | 常驻+减伤+增伤 | passive；activeRounds=1-5；T12等级直接输入0-24 | `lancer-radiant-shield-reduction` / damageReduction / `receivedDamageReduction` / 每级1% / target=shield；damage=all<br>`lancer-radiant-marksman-increase` / damageIncrease / `baseDamageIncrease` / 每级1% / source=marksman；damage=all | confirmed | `src/pvp/troopSkills/definitions/lancer.ts` |"],
  ["| 射 | 连射（`marksman-rapid-fire`）", "| 射 | 连射（`marksman-rapid-fire`） | 10%概率在同次主攻击内部追加第二段100%普通伤害；不新增主攻击或独立 DamageEvent。 | 概率+同主攻击内部段 | afterNormalAttack；概率10% | `marksman-rapid-fire-second-shot` / sameMainAttackSegment / 无group / 100% B / source=self；继承原目标；normalAttack适用乘区 | confirmed | `src/pvp/troopSkills/definitions/marksman.ts` |"],
  ["| 射 | 炽火燧星（`marksman-blazing-star-t12`）", "| 射 | 炽火燧星（`marksman-blazing-star-t12`） | R6起每5回合永久增加一层射手普通增伤；stack(r)=floor((r-1)/5)，每层为最终T12等级×0.5%，无已知上限。 | 常驻+永久叠层普通增伤 | passive；R6/R11/R16…叠层；T12等级直接输入0-24 | `marksman-blazing-star-increase` / damageIncrease / `baseDamageIncrease` / 0.5%×等级×层数 / source=marksman；damage=all | confirmed | `src/pvp/troopSkills/definitions/marksman.ts` |"],
]);
inventoryMarkdown = inventoryMarkdown
  .filter((line) => !line.startsWith("| 兵种技能 | lancer | lancer / 烈辉战阵 |") &&
    !line.startsWith("| 兵种技能 | lancer | lancer / 炽红力场 |") &&
    !line.startsWith("| 兵种技能 | marksman | marksman / 炽火燧星 |"))
  .map((line) => {
    for (const [prefix, replacement] of inventoryRows) {
      if (line.startsWith(prefix)) return replacement;
    }
    if (line.startsWith("| 兵种/marksman | 连射 (`marksman-rapid-fire`)")) {
      return "| 兵种/marksman | 连射 (`marksman-rapid-fire`) | `marksman-rapid-fire-second-shot` | sameMainAttackSegment | 无group / 同主攻击内部段 | 最终规则确认：第二段不是独立主攻击或独立 DamageEvent，不重新索敌或判定任何事件型技能。 | `src/pvp/troopSkills/definitions/marksman.ts`；专项回归测试 |";
    }
    if (line.startsWith("| 兵种/shield | 光铸之躯 (`shield-lightforged-body`) | `shield-lightforged-linked-cancellation`")) {
      return "| 兵种/shield | 光铸之躯 (`shield-lightforged-body`) | `shield-lightforged-linked-cancellation` | linked directDamageCancellation contribution | `crystalShieldDirectCancellation` | 最终规则确认：只提升烈晶盾牌本身数值至46%/51%，不生成独立抵消 effect。 | `src/pvp/troopSkills/definitions/shield.ts`；专项回归测试 |";
    }
    return line.replace("confirmed 225，provisional 41，unknown 0", "confirmed 229，provisional 37，unknown 0")
      .replace("confirmed 230，provisional 41，unknown 0", "confirmed 234，provisional 37，unknown 0");
  });
writeFileSync(inventoryMarkdownFile, `${inventoryMarkdown.join("\n").trimEnd()}\n`, "utf8");

const groupsFile = new URL("../docs/pvp-multiplier-groups.md", import.meta.url);
let groupsMarkdown = readFileSync(groupsFile, "utf8").split(/\r?\n/);
groupsMarkdown = groupsMarkdown
  .filter((line) => !line.startsWith("| 烈辉战阵射手增伤 |") &&
    !line.startsWith("| 盾兵受到伤害降低 | `shieldReceivedDamageReduction`") &&
    !line.startsWith("- `crimsonFieldDirectCancellation`：判定频率") &&
    !line.startsWith("- `lancerRadiantMarksmanDamageIncrease`：") &&
    !line.startsWith("- `[marksman T12 periodic]`：") &&
    !line.startsWith("- `shieldReceivedDamageReduction`："))
  .map((line) => {
    if (line.startsWith("| 炽红力场直接伤害抵消 |")) {
      return "| 炽红力场直接伤害抵消 | `crimsonFieldDirectCancellation` | directDamageCancellation | 每笔独立 incoming DamageEvent 分别判定；成功时该笔伤害×0.5。连射内部段不另判。 | target=lancer；damage=all | 矛·炽红力场 | src/pvp/troopSkills/definitions/lancer.ts | confirmed |";
    }
    if (line.startsWith("| 烈晶盾牌直接伤害抵消 |")) {
      return "| 烈晶盾牌直接伤害抵消 | `crystalShieldDirectCancellation` | directDamageCancellation | 每次敌方兵种主攻击判定一次；成功后单份抵消36%/46%/51%覆盖同root全部伤害，不是两个抵消因子相乘。 | target=shield；damage=all | 盾·烈晶盾牌；盾·光铸之躯 | src/pvp/troopSkills/definitions/shield.ts | confirmed |";
    }
    if (line.startsWith("| directDamageCancellation |")) {
      return "| directDamageCancellation | 同组 `1-(a+b)`；烈晶盾牌联动先改为单份46%/51% | 不同 group 相乘 | 烈晶盾牌按主攻击一次并覆盖同root；炽红力场按独立事件逐笔判定；连射不另判 | 烈晶盾牌、炽红力场 |";
    }
    return line.replace("伤害侧 20，承伤/属性防御侧 36", "伤害侧 19，承伤/属性防御侧 35")
      .replace("上面的 56 个 group", "上面的 54 个 group")
      .replace("41 个 provisional effect", "37 个 provisional effect");
  });
writeFileSync(groupsFile, `${groupsMarkdown.join("\n").trimEnd()}\n`, "utf8");
