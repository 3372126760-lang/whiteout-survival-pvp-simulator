import { TROOP_TYPES, type TroopType } from "../pvp/types";
import { getValidationCatalog, validationStageId, type ValidationBattleInput,
  type ValidationQueueAttributes } from "../pvp/validationUi";
import { isHeroAvailableAtStage, isTroopLevelAvailableAtStage } from "../pvp/progression";
import { SUPPORTED_TROOP_LEVELS } from "../pvp/data/troopConstants";
import { getInnerEarthConfig, getInnerEarthRule, normalizeInnerEarthInput,
  INNER_EARTH_MODES } from "../pvp/innerEarth";
import type { PetExternalBuffConfig } from "../pvp/externalBuffs";
import { heroCategoryLabel } from "../pvp/validationUi/heroCategory";
import { innerEarthAttributeSchema, compactAttributeInput, expandAttributeInput,
  ATTRIBUTE_SCHEMA_FIELDS, attributeFieldKey } from "../pvp/validationUi/attributeSchema";

export const INNER_EARTH_MODE_LABELS = { HEART_OF_EARTH: "大地之心", HERO_LAND: "英雄之地",
  BEAST_CAVE: "群兽洞窟", GEM_MINE: "宝石矿洞", UNDERGROUND_LAB: "地下研究所", EQUIPMENT_FORGE: "装备锻炉" } as const;
const names = { shield: "盾兵", lancer: "矛兵", marksman: "射兵" };
const stats = { attack: "攻击", defense: "防御", penetration: "穿透", life: "生命" } as const;
const petLabels: Record<keyof PetExternalBuffConfig, string> = { attackLevel: "宠物攻击技能", defenseLevel: "宠物防御技能",
  penetrationLevel: "宠物穿透技能", lifeLevel: "宠物生命技能", enemyDefenseReductionLevel: "宠物敌方防御减益",
  enemyPenetrationReductionLevel: "宠物敌方穿透减益", enemyLifeReductionLevel: "宠物敌方生命减益" };
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
const data = (fields: Record<string, string | number>) => Object.entries(fields)
  .map(([key, value]) => `data-${key}="${escape(String(value))}"`).join(" ");
function field(label: string, value: number, metadata: Record<string, string | number>, percent = false): string {
  return `<label>${label}${percent ? " %" : ""}<input type="text" inputmode="decimal" data-scope="inner-earth" ${data(metadata)} value="${value}"></label>`;
}
function attributeFields(attributes: ValidationQueueAttributes, side: "ally" | "enemy", mode: typeof INNER_EARTH_MODES[number], queue?: number): string {
  const schema = innerEarthAttributeSchema(mode, side);
  if (schema !== "FULL_12") {
    const values = compactAttributeInput(schema, attributes);
    const labels: Record<string, string> = { ...stats, allStats: "敌方全属性", attackDefense: "攻击 / 防御", penetrationLife: "穿透 / 生命", sharedAttackDefense: "攻击 / 防御", sharedPenetrationLife: "穿透 / 生命" };
    if (schema === "PER_TROOP_PAIRED_6" || schema === "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9") {
      const separateAttackDefense = schema === "PER_TROOP_ATTACK_DEFENSE_SEPARATE_PEN_LIFE_PAIRED_9";
      const inputStats = separateAttackDefense ? ["attack", "defense", "penetration"] as const : ["attack", "penetration"] as const;
      return `<div class="troop-cards" data-attribute-schema="${schema}">${TROOP_TYPES.map((troop) => `<section class="troop-card"><h4>${names[troop]}</h4>${inputStats.map((stat) => {
        const key = attributeFieldKey(schema, troop, stat);
        const label = stat === "penetration" ? "穿透 / 生命" : separateAttackDefense ? stats[stat] : "攻击 / 防御";
        return field(label, values[key]!, { field: "compact-attribute", side, stat: key }, true);
      }).join("")}</section>`).join("")}</div>`;
    }
    return `${schema === "ALL_TROOPS_PAIRED_2" ? "<h4>全兵种</h4>" : ""}<div class="inline-fields" data-attribute-schema="${schema}">${ATTRIBUTE_SCHEMA_FIELDS[schema].map((stat) =>
      field(labels[stat]!, values[stat]!, { field: "compact-attribute", side, stat, ...(queue === undefined ? {} : { queue }) }, true)).join("")}</div>`;
  }
  return `<div class="troop-cards">${TROOP_TYPES.map((troop) => `<section class="troop-card"><h4>${names[troop]}</h4>
    ${Object.entries(stats).map(([stat, label]) => field(label, attributes[troop][stat as keyof typeof stats],
      { field: "attribute", side, troop, stat, ...(queue === undefined ? {} : { queue }) }, true)).join("")}</section>`).join("")}</div>`;
}
function heroFields(input: ValidationBattleInput, side: "ally" | "enemy", queue: number): string {
  const config = getInnerEarthConfig(input), selected = config[side].queues[queue]!.heroes;
  return `<div class="hero-slot-grid">${TROOP_TYPES.map((troop) => `<label>${names[troop]}英雄<select data-scope="inner-earth" data-field="hero" data-side="${side}" data-queue="${queue}" data-troop="${troop}">
    <option value="">无英雄</option>${getValidationCatalog().leaderHeroes.filter((hero) => hero.troopType === troop &&
      isHeroAvailableAtStage(hero, validationStageId(input))).map((hero) => `<option value="${escape(hero.heroId)}" ${selected[troop] === hero.heroId ? "selected" : ""}>${escape(hero.name)} ${heroCategoryLabel(hero)}</option>`).join("")}</select></label>`).join("")}</div>`;
}
export function renderInnerEarthModePicker(input: ValidationBattleInput): string {
  const config = getInnerEarthConfig(input);
  return `<label>地心玩法<select data-scope="inner-earth-mode">${INNER_EARTH_MODES.map((mode) =>
    `<option value="${mode}" ${config.subMode === mode ? "selected" : ""}>${INNER_EARTH_MODE_LABELS[mode]}</option>`).join("")}</select></label>`;
}
export function renderInnerEarthForm(input: ValidationBattleInput, presentation: "player" | "developer" = "developer",
  fold: (key: string, title: string, body: () => string) => string = (_key, title, body) => `<details><summary>${title}</summary>${body()}</details>`): string {
  const config = getInnerEarthConfig(input), rule = getInnerEarthRule(config.subMode);
  const queued = config.subMode === "HEART_OF_EARTH" || config.subMode === "HERO_LAND";
  const enemyPreset = `<label>敌方出兵比例<select data-scope="inner-earth" data-field="enemy-preset">
    <option value="BALANCED" ${config.enemy.shared.troopRatioPreset === "BALANCED" ? "selected" : ""}>1/3 - 1/3 - 1/3</option>
    <option value="SHIELD_HEAVY" ${config.enemy.shared.troopRatioPreset === "SHIELD_HEAVY" ? "selected" : ""}>8/15 - 4/15 - 3/15</option></select></label>`;
  const enemyCapacity = config.subMode === "GEM_MINE" || config.subMode === "EQUIPMENT_FORGE"
    ? '<label>敌方容量<output>150000（固定）</output></label>' : field("敌方出征容量", config.enemy.shared.capacity, { field: "enemy-capacity" });
  const allyCapacity = config.subMode === "HERO_LAND" ? '<label>我方每队容量<output>190410（固定）</output></label>' :
    queued ? field("我方每队共用出征容量", config.ally.shared.capacity, { field: "ally-capacity" }) : "";
  const tiers = config.subMode === "HEART_OF_EARTH" || config.subMode === "UNDERGROUND_LAB" ? `<h3>我方兵种等级</h3><div class="inline-fields">${TROOP_TYPES.map((troop) => {
    const options = config.subMode === "UNDERGROUND_LAB" ? ["T10", "LAB_T11", "LAB_T12"] :
      SUPPORTED_TROOP_LEVELS.filter((level) => isTroopLevelAvailableAtStage(level, validationStageId(input)));
    return `<label>我方${names[troop]}兵种等级<select data-scope="inner-earth" data-field="tier" data-side="ally" data-troop="${troop}">${options.map((tier) =>
      `<option value="${tier}" ${config.ally.troopTiers[troop] === tier ? "selected" : ""}>${tier === "LAB_T11" ? "T11无火晶（研究所）" : tier === "LAB_T12" ? "T12无火晶（研究所）" : tier}</option>`).join("")}</select></label>`;
  }).join("")}</div>` : "";
  const t12 = config.subMode === "UNDERGROUND_LAB" && TROOP_TYPES.some((troop)=>config.ally.troopTiers[troop] === "LAB_T12") ? `<section><h3>我方 T12 技能等级</h3><div class="inline-fields">${TROOP_TYPES.filter((troop) => config.ally.troopTiers[troop] === "LAB_T12").map((troop) =>
    `<label>${names[troop]}（0–3）<select data-scope="inner-earth" data-field="t12" data-troop="${troop}">${Array.from({ length: 4 }, (_, level) =>
      `<option value="${level}" ${config.ally.t12SkillLevels[troop] === level ? "selected" : ""}>${level}</option>`).join("")}</select></label>`).join("")}</div></section>` : "";
  const ally = queued ? `<div class="queue-grid">${config.ally.queues.map((queue, index) => `<article class="queue-card"><h3>我方第${index + 1}队</h3>
    ${heroFields(input, "ally", index)}<div class="inline-fields">${TROOP_TYPES.map((troop) => field(names[troop] + "比例", queue.ratio[troop],
      { field: "ratio", side: "ally", queue: index, troop }, true)).join("")}</div>
    ${presentation === "player" ? fold(`player-earth-attributes-${index}`, "本队战报属性", () => attributeFields(queue.expectedReportStats, "ally", config.subMode, index)) : `<h4>本队预期战报基础属性</h4>${attributeFields(queue.expectedReportStats, "ally", config.subMode, index)}`}</article>`).join("")}</div>` :
    `<div class="inline-fields">${TROOP_TYPES.map((troop) => field(names[troop] + "数量", config.ally.counts[troop], { field: "count", troop })).join("")}</div>${presentation === "player" ? fold("player-earth-attributes", "战报属性", () => attributeFields(config.ally.reportStats, "ally", config.subMode)) : attributeFields(config.ally.reportStats, "ally", config.subMode)}`;
  return `<section class="panel inner-earth-panel" data-inner-earth-mode="${config.subMode}"><header class="panel-head"><h2>地心模式 · ${INNER_EARTH_MODE_LABELS[config.subMode]}</h2><span class="tag tag-cyan">${queued ? "预期战报属性" : "最终战报属性"}（固定）</span></header>
    <div class="panel-body"><p class="hint">${queued ? "我方三队英雄、比例、基础属性分别录入；敌方仅英雄分队，兵力和属性共用。" : "双方无英雄；我方填写数量，敌方由容量和固定比例预设生成兵数。"}敌方固定T10。</p>
    ${presentation === "developer" ? renderInnerEarthModePicker(input) : ""}<div class="inline-fields">${allyCapacity}${enemyCapacity}${enemyPreset}</div>${tiers}${t12}
    <h3>我方配置</h3>${ally}<p>敌方兵种等级：T10（固定）</p>${presentation === "player" ? fold("player-earth-enemy-attributes", "敌方共用战报属性", () => attributeFields(config.enemy.shared.expectedReportStats, "enemy", config.subMode)) : `<h3>敌方共用属性</h3>${attributeFields(config.enemy.shared.expectedReportStats, "enemy", config.subMode)}`}
    ${queued ? `<div class="queue-grid">${config.enemy.queues.map((_, index) => `<article class="queue-card"><h3>敌方第${index + 1}队英雄</h3>${heroFields(input, "enemy", index)}</article>`).join("")}</div>` : ""}
    <p class="hint">属性按当前玩法展开为12项。矿洞我方为每兵种攻防、穿血共6项；锻炉我方为每兵种攻击、防御、穿血共9项，攻击与防御独立；两者敌方仍为全军共享2项。旧共享或配对配置无法恢复已丢失的差异，请按战报核对。本次搜索维度：${rule.searchDimensions.map((dimension) => dimension === "head" ? "英雄" : "兵种比例").join(" × ")}</p>
    </div></section>`;
}
export function renderInnerEarthPets(input: ValidationBattleInput): string {
  const config = getInnerEarthConfig(input);
  if (config.subMode !== "HEART_OF_EARTH") return "";
  return `<details class="panel inner-earth-pets"><summary>大地之心宠物战斗技能</summary><div class="panel-body"><p class="hint">独立参与候选战斗评价，不改写上方基础战报属性；出征容量类宠物不参与。</p><div class="inline-fields">${Object.entries(petLabels).map(([fieldName, label]) =>
    `<label>${label}<select data-scope="inner-earth" data-field="pet" data-pet-field="${fieldName}">${Array.from({ length: 11 }, (_, level) =>
      `<option value="${level}" ${(config.petContext?.[fieldName as keyof PetExternalBuffConfig] ?? 0) === level ? "selected" : ""}>Lv${level}</option>`).join("")}</select></label>`).join("")}</div></div></details>`;
}

export function updateInnerEarthField(input: ValidationBattleInput, dataset: Record<string, string | undefined>, raw: string): ValidationBattleInput {
  if (input.scenarioType !== "INNER_EARTH") throw new Error("当前不是地心模式。");
  const config = structuredClone(getInnerEarthConfig(input));
  const troop = dataset.troop as TroopType;
  if (dataset.troop !== undefined && !TROOP_TYPES.includes(troop)) throw new Error("兵种无效。");
  const queue = Number(dataset.queue);
  if (dataset.queue !== undefined && (!Number.isInteger(queue) || queue < 0 || queue > 2)) throw new Error("队列无效。");
  const number = () => { if (!/^-?\d+(?:\.\d{0,2})?$/.test(raw.trim())) throw new Error("请输入最多两位小数的数字。");
    const value = Number(raw); if (!Number.isFinite(value)) throw new Error("输入数值无效。"); return value; };
  const integer = () => { const value = number(); if (!Number.isSafeInteger(value) || value < 0) throw new Error("请输入非负整数。"); return value; };
  // Keep drafts editable while their ratios are incomplete. Fixed mode fields
  // are validated at run/save boundaries; selectors cannot offer other presets.
  const mutable = config as unknown as WritableConfig;
  const fieldName = dataset.field;
  if (fieldName === "enemy-preset") {
    if (raw !== "BALANCED" && raw !== "SHIELD_HEAVY") throw new Error("敌方仅允许两种比例预设。");
    mutable.enemy.shared.troopRatioPreset = raw;
  } else if (fieldName === "enemy-capacity" || fieldName === "ally-capacity") {
    if (fieldName === "enemy-capacity" && ["GEM_MINE", "EQUIPMENT_FORGE"].includes(config.subMode) ||
      fieldName === "ally-capacity" && config.subMode === "HERO_LAND") throw new Error("该容量由玩法固定。");
    const value = integer(); if (value < 1) throw new Error("出征容量必须大于零。");
    mutable[fieldName === "enemy-capacity" ? "enemy" : "ally"].shared.capacity = value;
  } else if (fieldName === "count") mutable.ally.counts[troop] = integer();
  else if (fieldName === "ratio") { const value = number(); if (value < 0 || value > 100) throw new Error("比例须为0–100%。"); mutable.ally.queues[queue]!.ratio[troop] = value; }
  else if (fieldName === "compact-attribute") {
    const side = dataset.side === "enemy" ? "enemy" : "ally";
    const schema = innerEarthAttributeSchema(config.subMode, side);
    const target = side === "enemy" ? config.enemy.shared.expectedReportStats : dataset.queue !== undefined
      ? config.ally.queues[queue]!.expectedReportStats : config.ally.reportStats;
    const stat = dataset.stat!;
    if (schema === "FULL_12" || !ATTRIBUTE_SCHEMA_FIELDS[schema].some((field) => field === stat)) throw new Error("共享属性字段无效。");
    const expanded = expandAttributeInput(schema, { ...compactAttributeInput(schema, target), [stat]: number() });
    if (side === "enemy") mutable.enemy.shared.expectedReportStats = expanded as Mutable<ValidationQueueAttributes>;
    else if (dataset.queue !== undefined) mutable.ally.queues[queue]!.expectedReportStats = expanded as Mutable<ValidationQueueAttributes>;
    else mutable.ally.reportStats = expanded as Mutable<ValidationQueueAttributes>;
  }
  else if (fieldName === "attribute") {
    if (innerEarthAttributeSchema(config.subMode, dataset.side === "enemy" ? "enemy" : "ally") !== "FULL_12") throw new Error("当前玩法使用共享属性输入。");
    const stat = dataset.stat as keyof typeof stats; if (!(stat in stats)) throw new Error("属性无效。");
    const value = number();
    if (dataset.side === "enemy") mutable.enemy.shared.expectedReportStats[troop][stat] = value;
    else if (dataset.queue !== undefined) mutable.ally.queues[queue]!.expectedReportStats[troop][stat] = value;
    else mutable.ally.reportStats[troop][stat] = value;
  } else if (fieldName === "hero") {
    const side = dataset.side === "enemy" ? "enemy" : "ally";
    if (raw && !getValidationCatalog().leaderHeroes.some((hero) => hero.heroId === raw && hero.troopType === troop && isHeroAvailableAtStage(hero, validationStageId(input)))) throw new Error("英雄不在当前合法目录。");
    mutable[side].queues[queue]!.heroes[troop] = raw || null;
    if (side === "ally") {
      const current = mutable.ally.queues[queue]!;
      current.reportHeroes = { ...(current.reportHeroes ?? current.heroes), [troop]: raw || null };
    }
  } else if (fieldName === "tier") {
    if (dataset.side === "enemy") throw new Error("敌方兵种等级固定T10。");
    if (config.subMode === "UNDERGROUND_LAB" && !["T10", "LAB_T11", "LAB_T12"].includes(raw)) throw new Error("地下研究所只允许无火晶T10/T11/T12。");
    mutable.ally.troopTiers[troop] = raw;
    if (config.subMode === "UNDERGROUND_LAB" && raw !== "LAB_T12") mutable.ally.t12SkillLevels[troop] = 0;
  }
  else if (fieldName === "t12") { if (config.subMode !== "UNDERGROUND_LAB" || config.ally.troopTiers[troop] !== "LAB_T12") throw new Error("仅我方T12可配置T12技能。"); const level = integer(); if (level > 3) throw new Error("T12技能等级最高3级。"); mutable.ally.t12SkillLevels[troop] = level; }
  else if (fieldName === "pet") {
    if (config.subMode !== "HEART_OF_EARTH") throw new Error("当前玩法不使用宠物。");
    const key = dataset.petField as keyof PetExternalBuffConfig; if (!(key in petLabels)) throw new Error("宠物技能无效。");
    const level = integer(); if (level > 10) throw new Error("宠物技能等级为0–10。");
    mutable.petContext ??= Object.fromEntries(Object.keys(petLabels).map((key) => [key, 0])) as Mutable<PetExternalBuffConfig>;
    mutable.petContext[key] = level;
  } else throw new Error("地心输入字段无效。");
  return { ...input, innerEarth: config };
}
type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [P in keyof T]: Mutable<T[P]> } : T;
type WritableConfig = Mutable<ReturnType<typeof getInnerEarthConfig>>;

export function changeInnerEarthMode(input: ValidationBattleInput, mode: string): ValidationBattleInput {
  if (!INNER_EARTH_MODES.includes(mode as typeof INNER_EARTH_MODES[number])) throw new Error("地心玩法无效。");
  return normalizeInnerEarthInput({ ...input, scenarioType: "INNER_EARTH" },
    { ...getInnerEarthConfig(input), subMode: mode as typeof INNER_EARTH_MODES[number] });
}
