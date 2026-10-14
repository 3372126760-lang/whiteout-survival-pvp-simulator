import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EXPEDITION_HERO_DATA } from "../src/pvp/heroSkills/data/expeditionHeroes";
import { CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS } from "../src/pvp/heroSkills/definitions/simpleHeroes";
import type { ExpeditionHeroData, ExpeditionSkillRecord } from "../src/pvp/heroSkills/data/types";
import type { HeroSkillDefinition, HeroSkillEffect } from "../src/pvp/heroSkills/types";

interface InventoryEffectEntry {
  readonly skillId: string;
  readonly effectId?: string | null;
  readonly confirmationStatus?: string;
  readonly confirmationBasis?: string;
  readonly confirmationEvidence?: string;
  readonly sourceFile?: string;
  readonly ruleStatus?: string;
}

const root = new URL("../", import.meta.url);
const sourceInventory = JSON.parse(readFileSync(new URL("docs/pvp-skill-inventory.json", root), "utf8")) as {
  generatedAt: string;
  entries: InventoryEffectEntry[];
};
const definitions = [...CONFIRMED_SIMPLE_HERO_SKILL_DEFINITIONS] as HeroSkillDefinition[];
const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
const entriesBySkill = new Map<string, InventoryEffectEntry[]>();
for (const entry of sourceInventory.entries) {
  if (!entry.skillId.startsWith("hero-")) continue;
  entriesBySkill.set(entry.skillId, [...(entriesBySkill.get(entry.skillId) ?? []), entry]);
}

if (definitionById.size !== definitions.length) {
  throw new Error("Duplicate registered hero skill id.");
}
const heroById = new Map(EXPEDITION_HERO_DATA.map((hero) => [hero.id, hero]));
const futureSkillIds = new Set(definitions.filter((definition) =>
  (heroById.get(definition.heroId)?.generation ?? 0) >= 12).map((definition) => definition.id));
const latestOverrideSkillIds = new Set(definitions.filter((definition) => {
  const generation = heroById.get(definition.heroId)?.generation;
  return generation === 9 || generation === 10 || generation === 11 ||
    definition.id === "hero-skill.weien.lightning-speed" ||
    definition.id === "hero-skill.weien.flanking-strike";
}).map((definition) => definition.id));
const orphanDefinitions = definitions.filter((definition) => !heroById.has(definition.heroId));
const missingCatalogBindings = EXPEDITION_HERO_DATA.flatMap((hero) =>
  hero.expeditionSkills.filter((skill) =>
    skill.combatRelevant &&
    (skill.combatSkillDefinitionId === undefined || !definitionById.has(skill.combatSkillDefinitionId))
  ).map((skill) => `${hero.id}/${skill.id}`)
);

const lines: string[] = [];
const add = (...values: string[]) => lines.push(...values);
const clean = (value: unknown): string => String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const json = (value: unknown) => JSON.stringify(value);
const show = (value: unknown) => value === undefined ? "—" : `\`${json(value)}\``;
const pct = (value: number): string => `${Number((value * 100).toFixed(6))}%`;
const troop = (value: string): string => ({ shield: "盾", lancer: "矛", marksman: "射" })[value] ?? value;
const sourceFile = (definition: HeroSkillDefinition): string =>
  entriesBySkill.get(definition.id)?.find((entry) => entry.sourceFile)?.sourceFile ??
  (heroById.get(definition.heroId)?.generation === undefined
    ? "src/pvp/heroSkills/definitions/simpleHeroes.ts"
    : `src/pvp/heroSkills/definitions/s${heroById.get(definition.heroId)!.generation}Heroes.ts`);
const catalogSkill = (hero: ExpeditionHeroData, definition: HeroSkillDefinition): ExpeditionSkillRecord | undefined =>
  hero.expeditionSkills.find((skill) => skill.combatSkillDefinitionId === definition.id);

function effectTypes(effect: HeroSkillEffect): string[] {
  switch (effect.kind) {
    case "extraDamage": return ["skillDamage", "extraDamage"];
    case "temporaryShield": return ["shield"];
    case "attributeModifier": return ["attribute", ...(effect.attribute === "penetration" ? ["penetration"] : [])];
    case "attributeReduction": return ["attribute", "reduction", ...(effect.attribute === "penetration" ? ["penetration"] : [])];
    case "damageIncrease": return effect.scope.damageType === "normalAttack" ? ["normalAttackDamage"] : ["damageIncrease"];
    case "damageReduction":
    case "outgoingDamageReduction":
    case "defenseModifier":
    case "defenseReduction": return ["reduction"];
    case "incomingDamageIncrease":
    case "oneUseIncomingDamageIncrease":
    case "markedTargetDamageIncrease": return ["vulnerability"];
    case "skipNextRoundAction": return ["control"];
    case "targetingOverride": return ["targeting"];
    case "targetBoundMark": return ["mark"];
    case "decayingDamageIncrease": return effect.scope.damageType === "normalAttack" ? ["normalAttackDamage"] : ["damageIncrease"];
  }
}

function statusForEntry(entry: InventoryEffectEntry): "confirmed" | "provisional" | "unverified" {
  if (futureSkillIds.has(entry.skillId)) return "provisional";
  if (latestOverrideSkillIds.has(entry.skillId)) return "unverified";
  if (entry.skillId === "hero-skill.jiatuo.kings-gift") return "unverified";
  if (entry.confirmationStatus === "provisional" || entry.ruleStatus === "TENTATIVE" || entry.ruleStatus === "RULE_UNKNOWN") {
    return "provisional";
  }
  const evidence = `${entry.confirmationBasis ?? ""} ${entry.confirmationEvidence ?? ""}`;
  return /真实战报|本轮实战确认|S7战报/.test(evidence) ? "confirmed" : "unverified";
}

function statusForSkill(definition: HeroSkillDefinition): "confirmed" | "provisional" | "unverified" {
  if (futureSkillIds.has(definition.id)) return "provisional";
  if (latestOverrideSkillIds.has(definition.id)) return "unverified";
  if (definition.id === "hero-skill.jiatuo.kings-gift") return "unverified";
  const entries = entriesBySkill.get(definition.id) ?? [];
  if (definition.metadata.ruleStatus === "TENTATIVE" || definition.metadata.ruleStatus === "RULE_UNKNOWN") {
    return "provisional";
  }
  if (entries.some((entry) => statusForEntry(entry) === "provisional")) return "provisional";
  if (entries.length > 0 && entries.every((entry) => statusForEntry(entry) === "confirmed")) return "confirmed";
  return "unverified";
}

function description(hero: ExpeditionHeroData, definition: HeroSkillDefinition): string {
  const linked = catalogSkill(hero, definition);
  if (linked !== undefined) return linked.description;
  const stock = entriesBySkill.get(definition.id)?.find((entry) => entry.confirmationBasis)?.confirmationBasis;
  if (definition.positionRule.kind === "exclusiveWeapon") {
    const effect = Object.values(definition.levelValues).flatMap((level) => level.effects)[0];
    const attribute = effect?.kind === "attributeModifier" ? effect.attribute : "属性";
    return `专武远征场景效果：${attribute} Buff；仅在 ${definition.battleContexts?.join("、") ?? "已定义场景"} 生效。原远征目录未提供独立技能文案。`;
  }
  return definition.uiSummary ?? stock ?? "原远征目录没有对应文字描述。";
}

function renderDefinition(hero: ExpeditionHeroData, definition: HeroSkillDefinition, index: number): void {
  const linked = catalogSkill(hero, definition);
  const levels = Object.entries(definition.levelValues).sort((a, b) => Number(a[0]) - Number(b[0]));
  const effects = levels.flatMap(([, level]) => level.effects);
  const kinds = [...new Set(effects.flatMap(effectTypes))];
  const scopes = [...new Set(effects.map((effect) => json({ recipient: effect.recipient, scope: effect.scope })))];
  const statuses = entriesBySkill.get(definition.id) ?? [];
  add(`#### ${index}. ${clean(linked?.name ?? definition.name)}（\`${definition.id}\`）`, "");
  add(`- **实现名/原文**：${clean(definition.name)}；${clean(description(hero, definition))}`);
  add(`- **等级原数值**：${linked === undefined ? "专武见下列逐级效果；远征目录无单独条目" : show(linked.levelValues)}。目录数值可能只概括技能，实际多效果数值见下表。`);
  add(`- **触发**：\`${definition.trigger}\`；主攻判定时点=${show(definition.triggerTiming)}；定义概率=${show(definition.probability)}；行动机制=${show(definition.actionMechanic)}；场景=${show(definition.battleContexts)}。`);
  add(`- **生效/持续**：定义 activationTiming=${show(definition.activationTiming)}；durationRounds=${show(definition.durationRounds)}；cooldownRounds=${show(definition.cooldownRounds)}。逐效果 lifecycle 和逐等级覆盖值见下表；\`passive\` 在回合快照前挂载，生命属性会在首回合前重算 HP，防御属性仅进入受击伤害分母。`);
  add(`- **目标范围**：${scopes.map((scope) => `\`${scope}\``).join("、") || "无 effect scope；见行动机制"}。`);
  add(`- **类型**：${kinds.map((kind) => `\`${kind}\``).join("、") || "行动机制（无 effect）"}；代码 effect kind=${[...new Set(effects.map((effect) => effect.kind))].join("、") || "无"}。`);
  add(`- **位置**：\`${json(definition.positionRule)}\`；**源码**：\`${sourceFile(definition)}\`。`);
  add(`- **验证状态（战报口径）**：**${statusForSkill(definition)}**；项目内部 ruleStatus=\`${definition.metadata.ruleStatus}\`；verificationStatus=${show(definition.metadata.verificationStatus)}；项目效果库存状态=${futureSkillIds.has(definition.id) ? "历史快照已废止" : statuses.map((entry) => entry.confirmationStatus ?? "未列").join("、") || "未列"}。`);
  add(`- **元数据**：source=${show(definition.metadata.source)}；templateSource=${show(definition.metadata.templateSource)}；tags=${show(definition.metadata.tags)}。`, "");
  add("| 等级 | 版本 | 概率 | 持续/冷却 | 周期 | 完整 effect 数据（原代码字段，数值为小数） |", "| --- | --- | --- | --- | --- | --- |");
  for (const [level, data] of levels) {
    add(`| ${level} | ${clean(data.versionLabel)} | ${clean(data.probability === undefined ? definition.probability === undefined ? "—" : pct(definition.probability) : pct(data.probability))} | duration=${clean(data.durationRounds ?? definition.durationRounds)}；cooldown=${clean(data.cooldownRounds ?? definition.cooldownRounds)} | period=${clean(data.periodRounds)}；start=${clean(data.periodStartRound)} | ${data.effects.map((effect) => `\`${json(effect)}\``).join("<br>") || "无 effect；行动机制见上"} |`);
  }
  add("");
  if (statuses.length > 0) {
    add("效果级验证依据：", "", "| effectId | 战报口径 | 库存标记 | 依据/缺口 |", "| --- | --- | --- | --- |");
    for (const entry of statuses) {
      add(`| \`${clean(entry.effectId ?? "无 effect/行动机制")}\` | ${statusForEntry(entry)} | ${futureSkillIds.has(definition.id) ? "已废止" : clean(entry.confirmationStatus)} | ${latestOverrideSkillIds.has(definition.id) || futureSkillIds.has(definition.id) ? `旧库存证据（已由 2026-09-27 用户规则覆盖）：${clean(entry.confirmationBasis ?? entry.confirmationEvidence ?? "未记载")}` : clean(entry.confirmationBasis ?? entry.confirmationEvidence ?? "未记载")} |`);
    }
    add("");
  }
}

function renderHero(hero: ExpeditionHeroData): void {
  const heroDefinitions = definitions.filter((definition) => definition.heroId === hero.id);
  add(`### ${hero.name}（${troop(hero.stats.troopType)}，${hero.rarity}，\`${hero.id}\`）`, "");
  add(`远征静态属性（小数）：attack=${hero.stats.attackBonus}；defense=${hero.stats.defenseBonus}；penetration=${hero.stats.penetrationBonus}；life=${hero.stats.lifeBonus}。英雄资料：\`src/pvp/heroSkills/data/expeditionHeroes.ts\`。`, "");
  add("| 远征槽位 | 目录技能名称 | 完整目录描述 | 已录入等级数值 | PVP 关联 |", "| --- | --- | --- | --- | --- |");
  for (const skill of hero.expeditionSkills) {
    add(`| ${skill.expeditionSkillSlot} | ${clean(skill.name)}（\`${skill.id}\`） | ${clean(skill.description)} | \`${json(skill.levelValues)}\` | ${skill.combatRelevant ? `\`${skill.combatSkillDefinitionId ?? "缺失"}\`` : "非战斗，仅展示"} |`);
  }
  add("");
  if (hero.exclusiveWeapon !== undefined) {
    add(`专武目录：基础属性上限 penetration=${hero.exclusiveWeapon.maxPenetrationBonus}、life=${hero.exclusiveWeapon.maxLifeBonus}；技能ID=${hero.exclusiveWeapon.skillDefinitionIds.map((id) => `\`${id}\``).join("、") || "无"}；已录入阶梯数值=\`${json(hero.exclusiveWeapon.knownSkillValues)}\`。`, "");
  }
  add(heroDefinitions.length === 0
    ? "PVP 注册技能 0 项。"
    : `PVP 注册技能 ${heroDefinitions.length} 项；以下逐项展开代码中的全部等级、效果和生命周期。`, "");
  heroDefinitions.forEach((definition, index) => renderDefinition(hero, definition, index + 1));
}

add("# 无尽冬日 PVP 英雄技能数据库全量报告", "");
add("生成日期：2026-09-27。直接读取当前 TypeScript 远征英雄目录和注册的 PVP 技能定义；验证依据对照 `docs/pvp-skill-inventory.json`（该库存生成于 " + sourceInventory.generatedAt + "）。本报告保留目录原描述、所有已录入等级、每一级的完整 effect 字段、源码路径、触发/时机/持续/目标和验证状态。", "");
add("## 口径与注意事项", "");
add("- `confirmed` 在本报告中特指**库存文字明确记录真实战报/实战验证**且该技能所有效果均有此依据；若原始战报未随仓库存档，仍需外部复核。`provisional` 指代码或乘区规则暂定；其余为 `unverified`。项目原有 `ruleStatus=supported`、库存 `confirmationStatus=confirmed` 另行保留，不能直接当成战报验证。", "- 目录等级数值和 effect 数值均为小数：`0.25` 表示 25%；缺失等级保持缺失，不插值。代际英雄多数仅录入 Lv5；专武的技能等级 1～5 是武器阶梯，不等于武器本体 Lv1～Lv5。", "- `activationTiming` 的引擎枚举是 `immediate/nextAction/roundEnd/nextRound`；`startBattle` 不是枚举值。开场被动会在首回合快照前应用。effect 自身 `lifecycle` 可以覆盖定义级时机与持续。", "- `extraDamage` 在此引擎产生独立 `skillDamage/extraDamage` 事件；它不代表 `additionalAttack`。报告只在代码实际增加主攻击时才使用 `additionalAttack`，当前注册英雄定义没有此类效果。`normalAttackDamage` 表示只匹配普通攻击的伤害修正。", "- `target=all` 对属性或减伤效果表示对应军队范围；对多目标 `extraDamage` 则由运行时按存活目标栈展开。`currentTarget` 指该次主攻击选中的目标栈，即使普通攻击随后被闪避。", "- 车头默认启用战斗远征技能 1～3；车身只允许显式选择远征技能 1。专武场景技能需武器阶梯及匹配 `battleContexts`，见 `src/pvp/heroSkills/loadout.ts`。", "");

add("最新规则说明：最终战报模式直接采用战报四属性与实际初始兵数；专武属性归外部 Buff 层，不重复叠加。目标防御进入每笔伤害分母，生命公式不含防御。同来源、同目标、同结算时点、同伤害基准的技能额外伤害系数先汇总再取整。S12～S16 全部为 inferredFromPriorGenerations / TENTATIVE，尚无可用 PVP 战报；复用 S1～S11 模板仅确认代码语义继承，不表示新代数获得战报验证。`mainAttackAttempt` 与 `successfulNormalAttackHit` 明确分离，新录 kB 事件使用 `parentBaseDamage`。目录文字与项目内部旧库存的证据标签若仍沿用旧口径，以本说明及当前 effect 数据为准。", "");
add("## 完整性统计", "");
add(`目录英雄 ${EXPEDITION_HERO_DATA.length} 名；PVP 注册技能定义 ${definitions.length} 项；孤立定义 ${orphanDefinitions.length} 项；目录中战斗技能缺实现 ${missingCatalogBindings.length} 项。`, "");
const statusCounts = { confirmed: 0, provisional: 0, unverified: 0 };
for (const definition of definitions) statusCounts[statusForSkill(definition)] += 1;
add(`按本报告严格战报口径：confirmed ${statusCounts.confirmed} 项、provisional ${statusCounts.provisional} 项、unverified ${statusCounts.unverified} 项。项目内部库存的 \`confirmed\` 数量另见原始 JSON，两者定义不同。`, "");
add("| 代数 | 英雄数 | 注册 PVP 技能数 |", "| --- | ---: | ---: |");
for (const generation of [undefined, ...Array.from({ length: 16 }, (_, index) => index + 1)]) {
  const heroes = EXPEDITION_HERO_DATA.filter((hero) => hero.generation === generation);
  const skills = definitions.filter((definition) => heroes.some((hero) => hero.id === definition.heroId));
  add(`| ${generation === undefined ? "R/SR（非代际）" : `S${generation}`} | ${heroes.length} | ${skills.length} |`);
}
add("");
if (orphanDefinitions.length > 0 || missingCatalogBindings.length > 0) {
  add(`孤立定义：${orphanDefinitions.map((definition) => definition.id).join("、") || "无"}；目录缺实现：${missingCatalogBindings.join("、") || "无"}。`, "");
}

add("## S8 专题：完整描述、当前逻辑与机制假设", "");
add("S8 注册加托、索妮娅、亨德里克各 3 个远征战斗技能和 1 个场景专武技能。下表使用远征目录原描述；所有逐级原始数据仍在后面的 S8 全量条目。", "");
const s8Notes: Record<string, string> = {
  "hero-skill.jiatuo.golden-guard": "首回合快照前给盾兵 defense 属性 +30%，属于 heroDefenseBonus；仅影响盾兵受击时的 Defense 分母，不提高最大 HP。",
  "hero-skill.jiatuo.kings-gift": "每次完成盾兵主攻击后按 X=100×Ct×√当前盾兵数×(1+战报攻击加成) 生成待生效护盾，Lv4=0.24X、Lv5=0.30X；仅读取战报攻击层，不吃英雄远征技能攻击层；下一回合生效并覆盖上一层，伤害取整后、HP 前吸收。Sheet2/Sheet3 原始表格未随仓库存档。",
  "hero-skill.jiatuo.kings-army": "开场对敌全军攻击属性施加 25% enemyAttackReduction；同组先加算，再除以 1+组和。",
  "hero-weapon-skill.jiatuo.defense-defense": "仅 rallyDefense/garrisonDefense 生效，属于外部 Buff 属性层；最终战报模式已含该值，不再运行时重复叠加。",
  "hero-skill.suoniya.treasure-hunter": "开场给我军全伤害 commonDamageIncrease +20%；与同组来源加算。",
  "hero-skill.suoniya.bounty-temptation": "每完成2次矛兵主攻击，当回合向命中栈追加0.75B的 skillDamage/extraDamage；全军 heroAttackBonus +25% 从下一回合生效1回合，本次0.75B不吃该新加成。",
  "hero-skill.suoniya.torrent-impact": "按自然回合 R5/10/15… 判定，完成矛兵主攻击后向命中栈追加2.50B skillDamage/extraDamage；实际目标下一回合跳过行动。与赏金诱惑同一时点时系数先合并。",
  "hero-weapon-skill.suoniya.defense-penetration": "仅 rallyDefense/garrisonDefense 生效，buffPenetration 与普通外部穿透 Buff 同组先加，再形成一个外部 Buff 乘区。",
  "hero-skill.s8.hengdelike.defense-reduction": "开场给敌全军 defense 属性施加 enemyDefenseReduction +25%（防御因子除以1.25），不作为易伤或伤害增益。",
  "hero-skill.s8.hengdelike.barnacle-armor": "从 R5 起每 4 回合前 2 回合（R5/6、9/10…）全军 heroDefenseBonus +30%，进入受击目标防御属性，重复状态 replace。",
  "hero-skill.s8.hengdelike.heir-of-forest": "按自然回合 R3/6/9…判定，射手完成主攻击后对每个仍存活敌军兵种栈分别生成0.40B skillDamage/extraDamage；各目标独立使用自身防御与减伤。",
  "hero-weapon-skill.s8.hengdelike.rally-attack": "仅 rallyAttack 生效，buffAttack 与普通外部攻击 Buff 同组先加，再形成一个外部 Buff 乘区。",
};
add("| 英雄/定位 | 技能与完整目录描述 | 当前实现逻辑 | 用户规则口径 | 原始战报口径 |", "| --- | --- | --- | --- | --- |");
for (const hero of EXPEDITION_HERO_DATA.filter((candidate) => candidate.generation === 8)) {
  for (const definition of definitions.filter((candidate) => candidate.heroId === hero.id)) {
    const text = description(hero, definition);
    add(`| ${hero.name}/${troop(hero.stats.troopType)} | **${clean(definition.name)}**（\`${definition.id}\`）<br>${clean(text)} | ${clean(s8Notes[definition.id] ?? "以完整定义为准。")} | confirmed | ${statusForSkill(definition)} |`);
  }
}
add("", "S8 主要交互点：`resolveHeroSkills.ts` 的 `prepareRound`、主攻击计数、技能追加 `DamageEvent`、加托护盾、次回合跳过行动；`gatotShield.ts` 负责只读战报攻击层的 X 计算；`round/actionPhase.ts` 负责同一快照出手；`damage/createDamageEvent.ts` 处理乘区；`casualty/resolvePendingDamage.ts` 在回合末先用临时护盾承伤再扣兵。S14 艾丽芙护盾仍采用独立的暂定 parentRawDamage 公式，不能沿用加托的新公式。", "");
add("S8 规则已由用户本次确认并覆盖旧时序和旧乘区。原始证据缺口：", "", "1. Sheet2/Sheet3 原始表格与 257 回合战报未随仓库存档，需后续逐事件复核数值、取整和命中目标。", "2. 三个专武的场景匹配和属性乘区仍可用原始游戏战报复核；final-report 模式已关闭重复叠加。", "");

add("## S9/S10 最新确认规则摘要", "");
add("用户确认的机制与真实战报验证状态分别记录；详细逐技能等级/effect 数据在下方全量条目。`commonDamageIncrease` 是当前引擎对普通增伤（需求文字 `baseDamageIncrease`）使用的同组键。", "");
add("| 代数 | 英雄 | 技能 | 当前触发与完整 Lv5 结算 |", "| --- | --- | --- | --- |");
const s9s10Notes: Record<string, string> = {
  "hero-skill.magenusi.raging-sea": "常驻全军 heroAttackBonus +25%。",
  "hero-skill.magenusi.steel-phalanx": "每次盾主攻尝试独立40%判定；闪避不取消；成功后全军 heroDefenseBonus +50%，触发点起当轮生效，次轮失效。",
  "hero-skill.magenusi.ice-sea-tactics": "盾承伤降低10%进入 receivedDamageReduction；射手所有伤害普通增伤10%进入 commonDamageIncrease。",
  "hero-skill.fuleide.water-cannon": "敌全军穿透属性因子除以1.20。",
  "hero-skill.fuleide.acid-solution": "仅敌方盾兵 vulnerability +20%。",
  "hero-skill.fuleide.tidal-offensive": "每4次矛主攻尝试，闪避仍计数；当轮原目标2B skillDamage/extraDamage，敌全军次轮造成伤害降低20%。",
  "hero-skill.xiula.mist-spores": "全军 receivedDamageReduction +20%。",
  "hero-skill.xiula.piercing-arrow": "每2次射手主攻尝试，闪避仍计数；当轮原目标1B skillDamage/extraDamage，原目标次轮 vulnerability +25%。",
  "hero-skill.xiula.unpredictable-clouds": "射手 receivedDamageReduction +15%，与一技能同组加算；射手普通增伤 +10%。",
  "hero-skill.gregory.blazing-sun-army": "全军 heroAttackBonus +15%、heroDefenseBonus +10%。",
  "hero-skill.gregory.steel-phalanx": "盾/矛/射各自主普攻通过闪避后独立25%判定；触发只将本次 normalAttack ×2，不生成额外事件。共用韦恩普通攻击暴击效果模板。",
  "hero-skill.gregory.steel-defense": "盾 receivedDamageReduction +20%，与烈晶盾牌等同组加算。",
  "hero-skill.freya.twilight-mist": "敌全军攻击属性因子除以1.20。",
  "hero-skill.freya.crescent-scythe": "仅矛普通攻击成功命中后独立50%判定；触发对原目标1B skillDamage/extraDamage；闪避时不判定。",
  "hero-skill.freya.agile-strike": "盾/射 receivedDamageReduction 各+15%，盾/射普通增伤各+15%；矛不受三技能增伤。",
  "hero-skill.blanchette.crimson-hunting-blade": "全军 heroPenetrationBonus +25%。",
  "hero-skill.blanchette.crimson-burst": "自然 R3/R6/R9… 的射手主攻尝试对当前目标造成0.75B；闪避不改变周期。",
  "hero-skill.blanchette.dawn-sniper": "共用韦恩二技能分目标模板；每2次射手主攻尝试，敌矛0.40B、敌射0.20B，各自防御与减伤结算，缺目标不转移。",
};
for (const hero of EXPEDITION_HERO_DATA.filter((candidate) => candidate.generation === 9 || candidate.generation === 10)) {
  for (const definition of definitions.filter((candidate) => candidate.heroId === hero.id &&
    candidate.positionRule.kind === "expeditionSkillSlot")) {
    add(`| S${hero.generation} | ${hero.name} | ${definition.name} | ${s9s10Notes[definition.id] ?? "见下方逐级定义"} |`);
  }
}
add("", "实现与证据说明见 `S9_S10_RULE_MIGRATION_2026-09-27.md`。S9 马格努斯 1500 次主攻、604 次钢铁方阵触发的比例由用户提供；原始战报未随仓库附上，故严格战报状态仍按库存证据字段单列。", "");

add("## S11 最新确认规则摘要", "");
add("S11 使用既有主攻尝试、命中、自然回合、同组乘区和 kB 系统；本表为用户确认规则摘要，完整已录等级/effect 字段见下方全量条目。", "");
add("| 英雄 | 技能 | 当前 Lv5 触发与效果 |", "| --- | --- | --- |");
const s11Notes: Record<string, string> = {
  "hero-skill.eleonora.sunlight-majesty": "全军 heroLifeBonus +25%，独立于最终战报已包含的静态与专武属性。",
  "hero-skill.eleonora.solaris-phalanx": "盾 receivedDamageReduction +10%；射手 commonDamageIncrease +10%，覆盖普攻和技能伤害。",
  "hero-skill.eleonora.soaring-flame": "第5/10/15…次盾主攻尝试触发，闪避仍计数、跳过不计数；下两回合全军 commonDamageIncrease +25%、receivedDamageReduction +25%。",
  "hero-skill.lloyd.bird-harassment": "敌全军穿透属性降低20%，进入 enemyPenetrationReduction。",
  "hero-skill.lloyd.ice-fog-bomb": "自然R3/R6/R9…当轮矛普通增伤150%、敌全军穿透降低30%；与一技能20%同组为50%，属性分母1.50。",
  "hero-skill.lloyd.endless-ingenuity": "每自然回合开始独立40%判定，成功则全军当轮 heroPenetrationBonus +50%，下轮重新判定。",
  "hero-skill.rufus.fire-brigade": "全军 heroAttackBonus +25%。",
  "hero-skill.rufus.armor-breaking-strike": "仅射手普通主攻击成功命中后，对原目标0.60B skillDamage/extraDamage，并预约该目标次轮 vulnerability +25%；闪避或跳过则无。",
  "hero-skill.rufus.violent-blast": "盾/矛/射每次主攻尝试分别20%判定，闪避仍判定、跳过不判定；成功使选中目标穿透降低50%，即时生效2回合，同目标覆盖刷新。",
};
for (const hero of EXPEDITION_HERO_DATA.filter((candidate) => candidate.generation === 11)) {
  for (const definition of definitions.filter((candidate) => candidate.heroId === hero.id &&
    candidate.positionRule.kind === "expeditionSkillSlot")) {
    add(`| ${hero.name} | ${definition.name} | ${s11Notes[definition.id] ?? "见下方逐级定义"} |`);
  }
}
add("", "S11 实现与证据边界见 `S11_RULE_MIGRATION_2026-09-27.md`；完整合成运行日志为 `s11_rule_trace.txt`。旧库存中 S11 provisional/confirmed 标签不直接证明新时序已有真实战报复核。", "");

add("## 全量英雄与技能", "");
const baseHeroes = EXPEDITION_HERO_DATA.filter((hero) => hero.generation === undefined);
if (baseHeroes.length > 0) {
  add("## R/SR（非代际）", "");
  baseHeroes.forEach(renderHero);
}
for (let generation = 1; generation <= 16; generation += 1) {
  add(`## S${generation}`, "");
  EXPEDITION_HERO_DATA.filter((hero) => hero.generation === generation).forEach(renderHero);
}

add("## 数据来源", "", "- `src/pvp/heroSkills/data/expeditionHeroes.ts`：英雄定位、原远征技能名/描述/已录等级、专武目录。", "- `src/pvp/heroSkills/definitions/simpleHeroes.ts` 与 `s1Heroes.ts`～`s16Heroes.ts`：当前注册的 PVP 技能定义和逐级效果。", "- `src/pvp/heroSkills/resolveHeroSkills.ts`、`loadout.ts`：时序、触发、阵容和事件运行逻辑。", "- `docs/pvp-skill-inventory.json`：项目原有规则状态及证据说明；S12～S16 的旧 confirmed 标记已由新规则覆盖。", "");

const output = fileURLToPath(new URL("hero_skill_inventory.md", root));
writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${output}`);
console.log(`heroes=${EXPEDITION_HERO_DATA.length} definitions=${definitions.length} orphan=${orphanDefinitions.length} missingCatalogBindings=${missingCatalogBindings.length}`);
