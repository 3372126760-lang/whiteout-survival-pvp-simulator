import type { ExpeditionHeroData, ExpeditionSkillRecord } from "./types";
import {
  EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  EXPEDITION_GENERATION_STATS,
  S1_JERONIMO_EXPEDITION_ATTACK_DEFENSE_BONUS,
  S1_JERONIMO_WEAPON_MAX_PENETRATION_LIFE_BONUS,
  S1_WEAPON_SCENE_SKILL_VALUES,
} from "./generationStats";

const rStats = 0.9007;
const srStats = 1.4011;
const percentLevels = (
  ...values: readonly [number, number, number, number, number]
): Readonly<Record<1 | 2 | 3 | 4 | 5, number>> => ({
  1: values[0], 2: values[1], 3: values[2], 4: values[3], 5: values[4],
});

export const EXPEDITION_HERO_DATA = [
  hero("hero.r.youjin", "尤金", "R", "shield", rStats, [
    nonCombat("expedition.youjin.ancestral-craft", "祖传技艺", 1, percentLevels(.05, .10, .15, .20, .25), "伐木收益+25%。"),
    nonCombat("expedition.youjin.logging-master", "伐木大师", 2, percentLevels(.05, .10, .15, .20, .25), "木材采集速度+25%。"),
  ]),
  hero("hero.r.shimisi", "史密斯", "R", "shield", rStats, [
    nonCombat("expedition.shimisi.strike-while-hot", "趁热打铁", 1, percentLevels(.05, .10, .15, .20, .25), "铁矿厂收益+25%。"),
    nonCombat("expedition.shimisi.blacksmith-spirit", "铁匠精神", 2, percentLevels(.05, .10, .15, .20, .25), "铁矿采集速度+25%。"),
  ]),
  hero("hero.r.chali", "查理", "R", "lancer", rStats, [
    nonCombat("expedition.chali.blasting", "爆破专精", 1, percentLevels(.05, .10, .15, .20, .25), "煤矿厂收益+25%。"),
    nonCombat("expedition.chali.coal-mining", "煤矿开采", 2, percentLevels(.05, .10, .15, .20, .25), "煤矿采集速度+25%。"),
  ]),
  hero("hero.r.kelaoruisi", "克劳瑞斯", "R", "marksman", rStats, [
    nonCombat("expedition.kelaoruisi.ace-hunter", "王牌猎人", 1, percentLevels(.05, .10, .15, .20, .25), "狩猎收益+25%。"),
    nonCombat("expedition.kelaoruisi.carnivore", "肉食者", 2, percentLevels(.05, .10, .15, .20, .25), "生肉采集速度+25%。"),
  ]),
  hero("hero.sr.xieergai", "谢尔盖", "SR", "shield", srStats, [
    combat("expedition.xieergai.guardian-power", "守护之力", 1, percentLevels(.04, .08, .12, .16, .20), "hero-skill.xieergai.guardian-power", "全军受到伤害降低20%。"),
    combat("expedition.xieergai.weakening-strike", "虚弱打击", 2, percentLevels(.04, .08, .12, .16, .20), "hero-skill.xieergai.weakening-strike", "敌军攻击力降低20%。"),
  ]),
  hero("hero.sr.patelike", "帕特里克", "SR", "lancer", srStats, [
    combat("expedition.patelike.food-effect", "美食功效", 1, percentLevels(.05, .10, .15, .20, .25), "hero-skill.patelike.life", "全军生命值提升25%。"),
    combat("expedition.patelike.energy-intake", "能量摄入", 2, percentLevels(.05, .10, .15, .20, .25), "hero-skill.patelike.attack", "全军攻击力提升25%。"),
  ]),
  hero("hero.sr.baxiti", "巴希提", "SR", "marksman", srStats, [
    combat("expedition.baxiti.danger-sense", "危险感知", 1, percentLevels(.04, .08, .12, .16, .20), "hero-skill.baxiti.danger-sense", "全军受到伤害降低20%。"),
    combat("expedition.baxiti.unstable-field", "不稳定力场", 2, { 5: .50 }, "hero-skill.baxiti.unstable-field", "每个兵种主攻击时独立50%概率，触发后追加基于本次基础伤害B的50%额外技能伤害。"),
  ]),
  hero("hero.body.jiexi", "杰西", "SR", "lancer", srStats, [
    combat("expedition.jiexi.fully-armed", "全副武装", 1, percentLevels(.05, .10, .15, .20, .25), "hero-skill.jiexi.penetration", "全军穿透力提升25%。"),
    combat("expedition.jiexi.mechanical-barrier", "机械屏障", 2, percentLevels(.04, .08, .12, .16, .20), "hero-skill.jiexi.mechanical-barrier", "全军受到伤害降低20%。"),
  ]),
  hero("hero.body.shuyun", "书允", "SR", "marksman", srStats, [
    combat("expedition.shuyun.war-drum", "征伐的战鼓", 1, percentLevels(.05, .10, .15, .20, .25), "hero-skill.shuyun.attack", "全军攻击力提升25%。"),
    nonCombat("expedition.shuyun.healing-dance", "疗愈之舞", 2, percentLevels(.10, .20, .30, .40, .50), "军医所治疗速度+50%。"),
  ]),
  hero("hero.body.jiesaier", "杰塞尔", "SR", "marksman", srStats, [
    combat("expedition.jiesaier.tactical-deduction", "战术推演", 1, percentLevels(.05, .10, .15, .20, .25), "hero-skill.jiesaier.penetration", "全军穿透力提升25%。"),
    nonCombat("expedition.jiesaier.erudition", "博学多闻", 2, percentLevels(.03, .06, .09, .12, .15), "科技研究速度+15%。"),
  ]),
  hero("hero.sr.lumubogen", "卢姆·波根", "SR", "lancer", srStats, [
    combat("expedition.lumubogen.deception", "惑敌战术", 1, percentLevels(.04, .08, .12, .16, .20), "hero-skill.lumubogen.penetration-reduction", "敌军穿透力降低20%。"),
    nonCombat("expedition.lumubogen.emerald-warrior", "翡翠勇士", 2, percentLevels(.20, .40, .60, .80, 1), "打怪出征速度+100%。"),
  ]),
  hero("hero.sr.lingshuang", "凌霜", "SR", "lancer", srStats, [
    combat("expedition.lingshuang.commanding-presence", "威风八面", 1, percentLevels(.04, .08, .12, .16, .20), "hero-skill.lingshuang.attack-reduction", "敌军攻击力降低20%。"),
    nonCombat("expedition.lingshuang.troop-training", "治兵振旅", 2, percentLevels(.04, .08, .12, .16, .20), "训练速度+20%。"),
  ]),
  hero("hero.sr.jina", "吉娜", "SR", "marksman", 1.1008, [
    nonCombat("expedition.jina.strong-physique", "强劲体魄", 1, percentLevels(.10, .12, .15, .18, .20), "领主体力消耗减少20%。"),
    nonCombat("expedition.jina.swift-action", "迅捷行动", 2, percentLevels(.20, .40, .60, .80, 1), "打怪出征速度+100%。"),
  ]),
  s1Hero("hero.s1.heluonimo", "赫罗尼莫", "shield", S1_JERONIMO_EXPEDITION_ATTACK_DEFENSE_BONUS, S1_JERONIMO_WEAPON_MAX_PENETRATION_LIFE_BONUS, [
    combat("expedition.heluonimo.prebattle-declaration", "战前宣言", 1, { 5: .25 }, "hero-skill.heluonimo.penetration", "全军穿透+25%。"),
    combat("expedition.heluonimo.swordsmanship-guidance", "剑术指导", 2, { 5: .25 }, "hero-skill.heluonimo.attack", "全军攻击+25%。"),
    combat("expedition.heluonimo.masterful-swordsmanship", "精湛剑术", 3, { 5: .30 }, "hero-skill.heluonimo.periodic-damage", "从第5回合起，每4回合生效2回合，全军造成伤害+30%。"),
  ], {
    "hero-weapon-skill.heluonimo.rally-attack": S1_WEAPON_SCENE_SKILL_VALUES,
  }),
  s1Hero("hero.s1.nataliya", "娜塔莉亚", "shield", EXPEDITION_GENERATION_STATS[1].expeditionAttackDefenseBonus, EXPEDITION_GENERATION_STATS[1].exclusiveWeaponMaxPenetrationLifeBonus, [
    combat("expedition.nataliya.wild-roar", "野性咆哮", 1, { 5: .50 }, "hero-skill.nataliya.wild-roar", "每回合40%概率使全军本回合受到伤害降低50%。"),
    combat("expedition.nataliya.pack-leader", "兽群领袖", 2, { 5: .25 }, "hero-skill.nataliya.attack", "全军攻击+25%。"),
    combat("expedition.nataliya.wild-call", "狂野呼唤", 3, { 5: .25 }, "hero-skill.nataliya.penetration", "全军穿透+25%。"),
  ], {
    "hero-weapon-skill.nataliya.rally-penetration": S1_WEAPON_SCENE_SKILL_VALUES,
  }),
  s1Hero("hero.s1.moli", "茉莉", "lancer", EXPEDITION_GENERATION_STATS[1].expeditionAttackDefenseBonus, EXPEDITION_GENERATION_STATS[1].exclusiveWeaponMaxPenetrationLifeBonus, [
    combat("expedition.moli.snow-command", "雪之号令", 1, { 5: .50 }, "hero-skill.moli.snow-command", "每回合40%概率使全军本回合受到伤害降低50%。"),
    combat("expedition.moli.ice-field", "冰雪领域", 2, { 5: .50 }, "hero-skill.moli.ice-field", "每个兵种主攻击前独立50%判定，触发后产生基于基础伤害B的50%额外技能伤害。"),
    combat("expedition.moli.maiden-fury", "少女之怒", 3, { 5: .25 }, "hero-skill.moli.penetration", "全军穿透+25%。"),
  ], {
    "hero-weapon-skill.moli.defense-penetration": S1_WEAPON_SCENE_SKILL_VALUES,
  }),
  s1Hero("hero.s1.jinman", "津曼", "marksman", EXPEDITION_GENERATION_STATS[1].expeditionAttackDefenseBonus, EXPEDITION_GENERATION_STATS[1].exclusiveWeaponMaxPenetrationLifeBonus, [
    combat("expedition.jinman.impregnable", "固若金汤", 1, { 5: .10 }, "hero-skill.jinman.defense-life", "全军防御与生命+10%。"),
    nonCombat("expedition.jinman.architectural-art", "建筑艺术", 2, { 5: .10 }, "非战斗远征技能。"),
    combat("expedition.jinman.positional-warfare", "阵地战强者", 3, { 5: .25 }, "hero-skill.jinman.penetration", "全军穿透+25%。"),
  ], {
    "hero-weapon-skill.jinman.defense-attack": S1_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(2, "hero.head.fulinte", "弗林特", "shield", [
    combat("expedition.fulinte.wildfire", "野火燎原", 1, percentLevels(.20, .40, .60, .80, 1), "hero-skill.fulinte.wildfire", "盾兵造成伤害提升100%。"),
    combat("expedition.fulinte.burning-will", "燃烧意志", 2, percentLevels(.05, .10, .15, .20, .25), "hero-skill.fulinte.burning-will", "全军攻击提升25%。"),
    combat("expedition.fulinte.endless-fire", "无尽烈火", 3, percentLevels(.05, .10, .15, .20, .25), "hero-skill.fulinte.endless-fire", "全军穿透提升25%。"),
  ], {
    "hero-weapon-skill.fulinte.defense-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(2, "hero.s2.feilande", "菲兰德", "lancer", [
    combat("expedition.feilande.fitness-secret", "健身秘诀", 1, percentLevels(.03, .06, .09, .12, .15), "hero-skill.feilande.fitness-secret", "全军攻击提升15%、防御提升10%。"),
    combat("expedition.feilande.strengthening-potion", "强化药剂", 2, percentLevels(.20, .40, .60, .80, 1), "hero-skill.feilande.strengthening-potion", "盾、矛、射每次主攻击各独立判定25%；成功后暂按该次主攻击 parentRawDamage 基准产生额外技能伤害（载体待战报验证），连射内部第二段不重判。"),
    combat("expedition.feilande.stimulant", "提神针剂", 3, percentLevels(.10, .20, .30, .40, .50), "hero-skill.feilande.stimulant", "每回合40%概率使全军受到伤害降低50%。"),
  ], {
    "hero-weapon-skill.feilande.defense-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(2, "hero.s2.alongsuo", "阿隆索", "marksman", [
    combat("expedition.alongsuo.stormy-waves", "惊涛骇浪", 1, percentLevels(.10, .20, .30, .40, .50), "hero-skill.alongsuo.stormy-waves", "每回合40%概率使全军当回合穿透提升50%。"),
    combat("expedition.alongsuo.steel-will", "钢铁意志", 2, percentLevels(.10, .20, .30, .40, .50), "hero-skill.alongsuo.steel-will", "各存活兵种主攻击独立20%判定；命中目标栈从下一回合起穿透降低，持续2回合，重复触发覆盖并重新计时。"),
    combat("expedition.alongsuo.sharp-harpoon", "锋锐鱼叉", 3, percentLevels(.10, .20, .30, .40, .50), "hero-skill.alongsuo.sharp-harpoon", "各兵种主攻击时独立50%判定，成功后按等级产生基于基础伤害B的额外技能伤害。"),
  ], {
    "hero-weapon-skill.alongsuo.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(3, "hero.s3.luogen", "罗根", "shield", [
    combat("expedition.luogen.angry-lion-assault", "怒狮强袭", 1, { 5: .20 }, "hero-skill.luogen.angry-lion-assault", "敌军全体攻击力降低20%。"),
    combat("expedition.luogen.lion-intimidation", "猛狮恫吓", 2, { 5: .20 }, "hero-skill.luogen.lion-intimidation", "我军全体受到伤害降低20%。"),
    combat("expedition.luogen.burning-body", "烈火焚身", 3, { 5: .25 }, "hero-skill.luogen.burning-body", "全军生命提升25%，开场生效。"),
  ], {
    "hero-weapon-skill.luogen.defense-defense": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(3, "hero.s3.miya", "米娅", "lancer", [
    combat("expedition.miya.doom-entanglement", "厄运缠身", 1, { 5: .50 }, "hero-skill.miya.doom-entanglement", "三兵种每回合各一次普通攻击，每次50%独立触发；仅命中目标栈在下一回合易伤50%，持续1回合。"),
    combat("expedition.miya.lucky-blessing", "幸运加护", 2, { 5: .50 }, "hero-skill.miya.lucky-blessing", "盾、矛、射每次主攻击分别独立50%判定，成功且主攻未被闪避时，对该次实际目标造成0.5B额外技能伤害；B为本次主攻基础伤害。stun/skip无主攻时不判定，额外伤害不增加主攻计数、不递归触发技能。"),
    combat("expedition.miya.secret-interpretation", "秘义解读", 3, { 5: .50 }, "hero-skill.miya.secret-interpretation", "每回合一次40%判定，触发时全军当回合受到伤害降低50%。"),
  ], {
    "hero-weapon-skill.miya.rally-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(3, "hero.s3.gelaige", "格雷格", "marksman", [
    combat("expedition.gelaige.sword-of-justice", "正义之剑", 1, { 5: .40 }, "hero-skill.gelaige.sword-of-justice", "每回合一次20%判定；触发当回合全军伤害提升40%，持续3回合，重复触发覆盖并重新计时。"),
    combat("expedition.gelaige.law-deterrence", "律令震慑", 2, { 1: .10, 2: .20, 3: .30, 4: .40, 5: .50 }, "hero-skill.gelaige.law-deterrence", "盾/矛/射每次主攻击尝试分别20%判定；本次选中目标穿透降低10/20/30/40/50%，立即生效2回合，闪避仍判定，同一目标重复触发覆盖刷新。"),
    combat("expedition.gelaige.order-protection", "秩序庇护", 3, { 5: .25 }, "hero-skill.gelaige.order-protection", "全军生命提升25%，开场生效。"),
  ], {
    "hero-weapon-skill.gelaige.rally-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(4, "hero.s4.ahemosi", "阿赫莫斯", "shield", [
    combat("expedition.ahemosi.viper-phalanx", "腹蛇方阵", 1, { 5: .70 }, "hero-skill.ahemosi.viper-phalanx", "盾兵每完成4次主攻击后跳过下一次；跳过回合及下一回合盾兵减伤70%、矛兵/射手减伤30%。"),
    combat("expedition.ahemosi.fire-blessing", "火之祝祷", 2, { 5: 1 }, "hero-skill.ahemosi.fire-blessing", "盾兵造成伤害提升100%。"),
    combat("expedition.ahemosi.light-forged-blade", "光铸之刃", 3, { 5: .60 }, "hero-skill.ahemosi.light-forged-blade", "盾兵主攻击附加60% extraDamage，并使命中目标下一回合易伤25%。"),
  ], {
    "hero-weapon-skill.ahemosi.defense-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(4, "hero.s4.lingnai", "玲奈", "lancer", [
    combat("expedition.lingnai.assassin-instinct", "刺客本能", 1, { 5: .30 }, "hero-skill.lingnai.assassin-instinct", "全军普通攻击伤害提升30%。"),
    combat("expedition.lingnai.swift-shadow-dance", "迅影舞步", 2, { 2: .08, 5: .20 }, "hero-skill.lingnai.swift-shadow-dance", "敌方每次主攻击独立判定闪避；Lv2 8%、Lv5 20%。仅取消普通攻击命中，不取消此前已触发的额外伤害。"),
    combat("expedition.lingnai.shadow-blade", "影刃", 3, { 4: 1.8, 5: 2 }, "hero-skill.lingnai.shadow-blade", "矛兵每次主攻击尝试独立25%判定；Lv4 附加180%、Lv5 附加200% extraDamage，闪避前判定。"),
  ], {
    "hero-weapon-skill.lingnai.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(4, "hero.s4.linen", "琳恩", "marksman", [
    combat("expedition.linen.lion-song", "雄狮之歌", 1, { 5: .50 }, "hero-skill.linen.lion-song", "每回合40%概率使全军当回合穿透提升50%。"),
    combat("expedition.linen.sorrowful-sound", "悲戚之音", 2, { 5: .20 }, "hero-skill.linen.sorrowful-sound", "敌军全体穿透降低20%。"),
    combat("expedition.linen.onaihua", "欧纳伊华", 3, { 5: .05 }, "hero-skill.linen.onaihua", "射手每完成3次主攻击，自身攻击叠加5%；无层数上限，持续至战斗结束。"),
  ], {
    "hero-weapon-skill.linen.defense-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(5, "hero.s5.heketuo", "赫克托", "shield", [
    combat("expedition.heketuo.survival-instinct", "生存本能", 1, { 5: .50 }, "hero-skill.heketuo.survival-instinct", "每回合40%概率使全军当回合受到伤害降低50%。"),
    combat("expedition.heketuo.thunder-strike", "雷霆出击", 2, { 5: 2 }, "hero-skill.heketuo.thunder-strike", "盾兵初始普通增伤乘区+200%、射手+100%，同一兵种每次主攻击后按85%衰减，覆盖10次；此处普通增伤按 scope 作用于普攻与技能伤害。"),
    combat("expedition.heketuo.gale-strike", "疾风猛击", 3, { 5: 1 }, "hero-skill.heketuo.gale-strike", "每个兵种成功主攻击后独立25%判定，触发1倍基础伤害的额外技能事件。"),
  ], {
    "hero-weapon-skill.heketuo.defense-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(5, "hero.s5.nuola", "诺拉", "lancer", [
    combat("expedition.nuola.multi-troop-combat", "多兵种作战", 1, { 5: .15 }, "hero-skill.nuola.multi-troop-combat", "盾/射造成伤害+15%，盾/射受到伤害降低15%。"),
    combat("expedition.nuola.catch-off-guard", "攻其不备", 2, { 5: 1 }, "hero-skill.nuola.catch-off-guard", "矛兵成功主攻击后20%判定；每个存活敌军兵种分别受到100% extraDamage。"),
    combat("expedition.nuola.momentum-pursuit", "乘势追击", 3, { 5: .25 }, "hero-skill.nuola.momentum-pursuit", "矛兵每完成5次成功主攻击后，全军从下一回合起增伤25%、减伤25%，持续2回合。"),
  ], {
    "hero-weapon-skill.nuola.defense-defense": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(5, "hero.s5.gewen", "格温", "marksman", [
    combat("expedition.gewen.eagle-vision", "鹰之视野", 1, { 5: .25 }, "hero-skill.gewen.eagle-vision", "全军主攻击命中目标后，使该目标从下一回合起永久易伤25%，同目标不叠层。"),
    combat("expedition.gewen.aerial-suppression", "空中压制", 2, { 5: 1 }, "hero-skill.gewen.aerial-suppression", "各兵种第6、12、18次成功主攻击附加100% extraDamage，并给目标一次性15%易伤覆盖令牌。"),
    combat("expedition.gewen.demolition-squad", "爆破小队", 3, { 5: .50 }, "hero-skill.gewen.demolition-squad", "射手第5、10、15次主攻击尝试时，对每个存活敌军兵种分别造成50% extraDamage；主攻闪避不取消。"),
  ], {
    "hero-weapon-skill.gewen.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(6, "hero.s6.wuming", "无名", "shield", [
    combat("expedition.wuming.wind-shelter", "避风扑雨", 1, { 5: .30 }, "hero-skill.wuming.wind-shelter", "盾兵受到普通攻击降低25%，受到技能伤害降低30%。"),
    combat("expedition.wuming.half-moon", "半月冲雪", 2, { 5: .20 }, "hero-skill.wuming.half-moon", "全军造成伤害提升20%。"),
    combat("expedition.wuming.four-images", "四象分明", 3, { 5: .25 }, "hero-skill.wuming.four-images", "全军技能伤害提升25%，包括extraDamage。"),
  ], {
    "hero-weapon-skill.wuming.defense-defense": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(6, "hero.s6.ruini", "芮妮", "lancer", [
    combat("expedition.ruini.dream-mark", "惊梦留痕", 1, { 5: 2 }, "hero-skill.ruini.dream-mark", "矛兵每2次主攻击尝试在闪避前标记选定目标；下回合200%B独立技能伤害。重复m来源合并为(m+1)B，各来源独立计数；目标标记不叠层，重复伤害规则为战报支持的暂定规则。"),
    combat("expedition.ruini.dream-catcher", "捕梦手", 2, { 5: 1.50 }, "hero-skill.ruini.dream-catcher", "矛兵对DreamMark目标伤害提升150%。"),
    combat("expedition.ruini.dream-fragment", "梦境切片", 3, { 5: .75 }, "hero-skill.ruini.dream-fragment", "全军对DreamMark目标伤害提升75%。"),
  ], {
    "hero-weapon-skill.ruini.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(6, "hero.s6.weien", "韦恩", "marksman", [
    combat("expedition.weien.thunder-raid", "惊雷奇袭", 1, { 1: .2, 2: .4, 3: .6, 4: .8, 5: 1 }, "hero-skill.weien.thunder-raid", "每4自然回合，我军各存活兵种分别发动一次独立技能额外打击；Lv5为100%。"),
    combat("expedition.weien.flanking-strike", "迂回打击", 2, { 1: .08, 2: .16, 3: .24, 4: .32, 5: .40 }, "hero-skill.weien.flanking-strike", "射手每2次主攻击尝试，在闪避前对存活矛兵/射手产生独立技能伤害；Lv5为40%/20%。"),
    combat("expedition.weien.lightning-speed", "电光石火", 3, { 1: .05, 2: .10, 3: .15, 4: .20, 5: .25 }, "hero-skill.weien.lightning-speed", "全军各兵种主普攻通过闪避后分别判定暴击；触发时该次普通攻击伤害×2，不生成独立技能事件；Lv5概率25%。"),
  ], {
    "hero-weapon-skill.weien.defense-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(7, "hero.s7.aidisi", "艾迪丝", "shield", [
    combat("expedition.aidisi.offense-and-defense", "攻守兼备", 1, { 5: .20 }, "hero-skill.aidisi.offense-and-defense", "射手承伤降低20%，矛兵伤害提升20%。"),
    combat("expedition.aidisi.iron-body", "铜头铁臂", 2, { 5: .20 }, "hero-skill.aidisi.iron-body", "盾兵受到伤害降低20%。"),
    combat("expedition.aidisi.steel-armor", "钢甲护体", 3, { 5: .25 }, "hero-skill.aidisi.steel-armor", "全军生命提升25%。"),
  ], {
    "hero-weapon-skill.aidisi.defense-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(7, "hero.s7.gedun", "哥顿", "lancer", [
    combat("expedition.gedun.poisoned-blade", "浸毒锋刃", 1, { 1: .20, 5: 1 }, "hero-skill.gedun.poisoned-blade", "每2次成功矛兵主攻击对实际命中目标附加技能额外伤害，并使该目标下一回合造成伤害降低；Lv5分别为100%与20%。"),
    combat("expedition.gedun.toxic-phobia", "恐惧威慑", 2, { 1: .30, 5: 1.50 }, "hero-skill.gedun.toxic-phobia", "R3/6/9…当回合矛兵伤害提升、敌军全军造成伤害降低；Lv5分别为150%与30%。"),
    combat("expedition.gedun.poison-cloud", "腐蚀云雾", 3, { 1: .06, 5: .30 }, "hero-skill.gedun.poison-cloud", "R4/R5、R8/R9…使敌方盾兵易伤、敌方射手造成伤害降低；Lv5均为30%。"),
  ], {
    "hero-weapon-skill.gedun.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(7, "hero.s7.buladeli", "布拉德利", "marksman", [
    combat("expedition.buladeli.veterans-pride", "老兵的骄傲", 1, { 5: .25 }, "hero-skill.buladeli.veterans-pride", "全军攻击提升25%。"),
    combat("expedition.buladeli.head-cannon", "当头炮", 2, { 5: .30 }, "hero-skill.buladeli.head-cannon", "全军对矛兵伤害提升30%、对盾兵伤害提升25%。"),
    combat("expedition.buladeli.battlefield-insight", "洞悉战局", 3, { 5: .30 }, "hero-skill.buladeli.battlefield-insight", "R5/6/9/10全军伤害提升30%。"),
  ], {
    "hero-weapon-skill.buladeli.defense-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(8, "hero.s8.jiatuo", "加托", "shield", [
    combat("expedition.jiatuo.golden-guard", "黄金近卫", 1, { 5: .30 }, "hero-skill.jiatuo.golden-guard", "盾兵防御提升30%。"),
    combat("expedition.jiatuo.kings-gift", "列王恩赐", 2, { 4: .24, 5: .30 }, "hero-skill.jiatuo.kings-gift", "盾兵每次完成主攻击后触发，下一回合护盾生效并覆盖旧盾：X=100×当前盾兵常数×√当前盾兵数×(1+战报攻击加成)；Lv4=0.24X，Lv5=0.30X。英雄远征技能攻击增减不进入X。"),
    combat("expedition.jiatuo.kings-army", "王者之师", 3, { 5: .25 }, "hero-skill.jiatuo.kings-army", "敌军全军攻击降低25%。"),
  ], {
    "hero-weapon-skill.jiatuo.defense-defense": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(8, "hero.s8.suoniya", "索妮娅", "lancer", [
    combat("expedition.suoniya.treasure-hunter", "宝藏猎人", 1, { 5: .20 }, "hero-skill.suoniya.treasure-hunter", "全军伤害提升20%。"),
    combat("expedition.suoniya.bounty-temptation", "赏金诱惑", 2, { 5: .75 }, "hero-skill.suoniya.bounty-temptation", "每完成2次矛兵主攻击立即造成0.75B技能额外伤害；全军攻击+25%从下一回合起持续1回合。"),
    combat("expedition.suoniya.torrent-impact", "激流冲击", 3, { 5: 2.50 }, "hero-skill.suoniya.torrent-impact", "每5个自然回合（R5/10/15…）对实际命中目标造成2.50B技能额外伤害；该目标下一回合跳过行动。"),
  ], {
    "hero-weapon-skill.suoniya.defense-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(8, "hero.s8.hengdelike", "亨德里克", "marksman", [
    combat("expedition.s8.hengdelike.defense-reduction", "蝙虫之噬", 1, { 5: .25 }, "hero-skill.s8.hengdelike.defense-reduction", "敌军全军防御属性降低25%，进入enemyDefenseReduction属性组。"),
    combat("expedition.s8.hengdelike.barnacle-armor", "藤壶之铠", 2, { 5: .30 }, "hero-skill.s8.hengdelike.barnacle-armor", "每4个自然回合连续生效2回合（R5/6、R9/10…），全军heroDefenseBonus+30%。"),
    combat("expedition.s8.hengdelike.heir-of-forest", "大森之嗣", 3, { 5: .40 }, "hero-skill.s8.hengdelike.heir-of-forest", "每3个自然回合（R3/6/9…）由射手对每个存活敌军兵种栈分别造成0.40B技能额外伤害。"),
  ], {
    "hero-weapon-skill.s8.hengdelike.rally-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(9, "hero.s9.magenusi", "马格努斯", "shield", [
    combat("expedition.magenusi.raging-sea", "怒海狂涛", 1, { 5: .25 }, "hero-skill.magenusi.raging-sea", "全军攻击提升25%。"),
    combat("expedition.magenusi.steel-phalanx", "钢铁方阵", 2, { 5: .50 }, "hero-skill.magenusi.steel-phalanx", "每次盾兵发起主攻击即独立40%判定，普通攻击被闪避仍判定；成功后全军 heroDefenseBonus +50%，当轮触发点起立即生效，次轮失效。"),
    combat("expedition.magenusi.ice-sea-tactics", "冰海战法", 3, { 5: .10 }, "hero-skill.magenusi.ice-sea-tactics", "盾兵承伤降低10%，射手伤害提升10%。"),
  ], {
    "hero-weapon-skill.magenusi.defense-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(9, "hero.s9.fuleide", "弗雷德", "lancer", [
    combat("expedition.fuleide.water-cannon", "水炮压制", 1, { 5: .20 }, "hero-skill.fuleide.water-cannon", "敌军全军穿透降低20%。"),
    combat("expedition.fuleide.acid-solution", "酸性溶液", 2, { 5: .20 }, "hero-skill.fuleide.acid-solution", "仅敌方盾兵常驻易伤20%。"),
    combat("expedition.fuleide.tidal-offensive", "攻势如潮", 3, { 5: 2 }, "hero-skill.fuleide.tidal-offensive", "每4次矛兵主攻击尝试对原目标造成2B技能额外伤害，普通攻击被闪避仍触发；敌军全体下一回合造成伤害降低20%。"),
  ], {
    "hero-weapon-skill.fuleide.rally-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(9, "hero.s9.xiula", "修拉", "marksman", [
    combat("expedition.xiula.mist-spores", "迷雾孢子", 1, { 5: .20 }, "hero-skill.xiula.mist-spores", "全军受到伤害降低20%。"),
    combat("expedition.xiula.piercing-arrow", "贯穿之矢", 2, { 5: 1 }, "hero-skill.xiula.piercing-arrow", "每2次射手主攻击尝试对原目标造成1B技能额外伤害，普通攻击被闪避仍触发；原目标下一回合易伤25%。"),
    combat("expedition.xiula.unpredictable-clouds", "波云诡谲", 3, { 5: .15 }, "hero-skill.xiula.unpredictable-clouds", "射手承伤降低15%，射手伤害提升10%。"),
  ], {
    "hero-weapon-skill.xiula.defense-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(10, "hero.s10.gregory", "格里高利", "shield", [
    combat("expedition.gregory.blazing-sun-army", "炽阳之师", 1, { 5: .15 }, "hero-skill.gregory.blazing-sun-army", "全军攻击+15%、防御+10%。"),
    combat("expedition.gregory.steel-phalanx", "钢铁方阵", 2, { 5: 2 }, "hero-skill.gregory.steel-phalanx", "全军普通主攻击25%概率暴击，暴击倍率2。"),
    combat("expedition.gregory.steel-defense", "钢铁防线", 3, { 5: .20 }, "hero-skill.gregory.steel-defense", "盾兵受到伤害降低20%。"),
  ], {
    "hero-weapon-skill.gregory.defense-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(10, "hero.s10.freya", "芙蕾雅", "lancer", [
    combat("expedition.freya.twilight-mist", "暮色迷雾", 1, { 5: .20 }, "hero-skill.freya.twilight-mist", "敌军全体攻击降低20%。"),
    combat("expedition.freya.crescent-scythe", "新月之镰", 2, { 5: 1 }, "hero-skill.freya.crescent-scythe", "仅矛兵普通主攻击成功命中后独立50%判定，触发时对原目标造成1B技能额外伤害；闪避时不判定。"),
    combat("expedition.freya.agile-strike", "灵动一击", 3, { 5: .15 }, "hero-skill.freya.agile-strike", "盾兵/射手承伤降低15%，盾兵/射手伤害提升15%。"),
  ], {
    "hero-weapon-skill.freya.defense-defense": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(10, "hero.s10.blanchette", "布兰琪", "marksman", [
    combat("expedition.blanchette.crimson-hunting-blade", "真红猎刃", 1, { 5: .25 }, "hero-skill.blanchette.crimson-hunting-blade", "全军穿透提升25%。"),
    combat("expedition.blanchette.crimson-burst", "炽红爆裂", 2, { 5: .75 }, "hero-skill.blanchette.crimson-burst", "自然回合R3/R6/R9…射手对当前目标造成0.75B技能额外伤害；周期不随攻击次数或闪避漂移。"),
    combat("expedition.blanchette.dawn-sniper", "曙红狙刺", 3, { 5: .40 }, "hero-skill.blanchette.dawn-sniper", "每2次射手主攻击对存活矛兵造成40%、射手造成20% extraDamage。"),
  ], {
    "hero-weapon-skill.blanchette.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(11, "hero.s11.eleonora", "埃莱奥诺拉", "shield", [
    combat("expedition.eleonora.sunlight-majesty", "烈日威光", 1, { 5: .25 }, "hero-skill.eleonora.sunlight-majesty", "全军生命提升25%。"),
    combat("expedition.eleonora.solaris-phalanx", "索拉里斯方阵", 2, { 5: .10 }, "hero-skill.eleonora.solaris-phalanx", "盾兵承伤降低10%，射手伤害提升10%。"),
    combat("expedition.eleonora.soaring-flame", "腾焰飞芒", 3, { 5: .25 }, "hero-skill.eleonora.soaring-flame", "每5次盾兵主攻击尝试后，全军从下一回合起通用伤害提升25%、承伤降低25%，持续2回合；普通攻击被闪避仍计数，跳过行动不计数。"),
  ], {
    "hero-weapon-skill.eleonora.defense-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(11, "hero.s11.lloyd", "劳埃德", "lancer", [
    combat("expedition.lloyd.bird-harassment", "群鸟侵扰", 1, { 5: .20 }, "hero-skill.lloyd.bird-harassment", "敌军全体穿透降低20%。"),
    combat("expedition.lloyd.ice-fog-bomb", "冰雾爆弹", 2, { 5: 1.50 }, "hero-skill.lloyd.ice-fog-bomb", "自然R3/R6/R9…当轮矛兵通用伤害提升150%、敌军全体穿透属性降低30%，与群鸟侵扰20%同组加算。"),
    combat("expedition.lloyd.endless-ingenuity", "机巧万变", 3, { 5: .50 }, "hero-skill.lloyd.endless-ingenuity", "每回合40%概率使全军当回合穿透提升50%。"),
  ], {
    "hero-weapon-skill.lloyd.rally-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(11, "hero.s11.rufus", "鲁弗斯", "marksman", [
    combat("expedition.rufus.fire-brigade", "火焰战团", 1, { 5: .25 }, "hero-skill.rufus.fire-brigade", "全军攻击提升25%。"),
    combat("expedition.rufus.armor-breaking-strike", "碎甲一击", 2, { 5: .60 }, "hero-skill.rufus.armor-breaking-strike", "射手普通主攻击成功命中后对原目标造成0.6B技能额外伤害，并使其下一回合易伤25%；闪避或跳过行动时不触发。"),
    combat("expedition.rufus.violent-blast", "暴烈震爆", 3, { 5: .50 }, "hero-skill.rufus.violent-blast", "盾/矛/射每次主攻击尝试分别20%判定；触发使本次选中目标穿透降低50%持续2回合，闪避仍判定，同一目标重复触发覆盖刷新。"),
  ], {
    "hero-weapon-skill.rufus.rally-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(12, "hero.s12.hervor", "赫尔薇尔", "shield", [
    combat("expedition.hervor.war-cry", "战争怒吼", 1, { 5: .25 }, "hero-skill.hervor.war-cry", "全军穿透提升25%。"),
    combat("expedition.hervor.immortal-army", "不灭之师", 2, { 5: .30 }, "hero-skill.hervor.immortal-army", "盾兵受到普通攻击降低25%、技能伤害降低30%。"),
    combat("expedition.hervor.will-of-war", "战火意志", 3, { 5: .15 }, "hero-skill.hervor.will-of-war", "盾兵承伤降低15%、伤害提升10%。"),
  ], {
    "hero-weapon-skill.hervor.defense-defense": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(12, "hero.s12.karol", "加罗尔", "lancer", [
    combat("expedition.karol.guardian-wings", "守护之翼", 1, { 5: .20 }, "hero-skill.karol.guardian-wings", "全军受到伤害降低20%。"),
    combat("expedition.karol.formation-breaking-spear", "破阵之矛", 2, { 5: .30 }, "hero-skill.karol.formation-breaking-spear", "全军对矛兵伤害+30%、对盾兵伤害+25%。"),
    combat("expedition.karol.banner-of-glory", "荣耀战旗", 3, { 5: .15 }, "hero-skill.karol.banner-of-glory", "全军攻击+15%、防御+10%。"),
  ], {
    "hero-weapon-skill.karol.rally-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(12, "hero.s12.ligeia", "丽姬娅", "marksman", [
    combat("expedition.ligeia.steel-fang-gnaw", "钢牙啃噬", 1, { 5: .25 }, "hero-skill.ligeia.steel-fang-gnaw", "敌军全体防御降低25%。"),
    combat("expedition.ligeia.disintegrating-poison", "瓦解之毒", 2, { 5: 1 }, "hero-skill.ligeia.disintegrating-poison", "每第2次射手主攻击尝试若成功命中，对本次目标造成1B并预约次轮易伤25%；闪避仍计数但不产生效果。"),
    combat("expedition.ligeia.venom-fang-assault", "毒牙侵袭", 3, { 5: 1 }, "hero-skill.ligeia.venom-fang-assault", "与瓦解之毒共用每第2次射手主攻计数；命中后对本次目标追加1B并使其次轮造成伤害降低20%；两笔同目标1B合并为2B。"),
  ], {
    "hero-weapon-skill.ligeia.defense-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(13, "hero.s13.gisela", "吉塞拉", "shield", [
    combat("expedition.gisela.alloy-shield", "合金盾牌", 1, { 5: .30 }, "hero-skill.gisela.alloy-shield", "盾兵防御提升30%。"),
    combat("expedition.gisela.temporary-fortification", "临时工事", 2, { 5: .50 }, "hero-skill.gisela.temporary-fortification", "盾兵主攻击时40%概率使全军本回合防御提升50%。"),
    combat("expedition.gisela.prototype-shield", "试作护盾", 3, { 5: .50 }, "hero-skill.gisela.prototype-shield", "每回合一次40%判定，成功后全军本回合受到伤害降低50%。"),
  ], {
    "hero-weapon-skill.gisela.defense-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(13, "hero.s13.flora", "弗洛拉", "lancer", [
    combat("expedition.flora.thorn-vine-dance", "刺藤曼舞", 1, { 5: .50 }, "hero-skill.flora.thorn-vine-dance", "三兵种每次主攻击尝试各自50%判定，本次选中目标下一回合易伤50%；闪避不撤销已发生的判定。"),
    combat("expedition.flora.thorn-bush", "荆棘花丛", 2, { 5: .25 }, "hero-skill.flora.thorn-bush", "盾兵承伤降低25%、矛兵伤害提升25%。"),
    combat("expedition.flora.aromatic-mist", "芳香迷雾", 3, { 5: .30 }, "hero-skill.flora.aromatic-mist", "自然R5/6、R9/10…使敌盾易伤30%、敌射造成伤害降低30%。"),
  ], {
    "hero-weapon-skill.flora.defense-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(13, "hero.s13.vulcanus", "乌尔卡努斯", "marksman", [
    combat("expedition.vulcanus.overlord-fury", "枭雄之怒", 1, { 5: .20 }, "hero-skill.vulcanus.overlord-fury", "敌军全体攻击降低20%。"),
    combat("expedition.vulcanus.rifting-blade", "架裂之刃", 2, { 5: 1 }, "hero-skill.vulcanus.rifting-blade", "完全沿用格温空中压制：各兵种第6/12/18…次成功主攻击产生1B及目标一次性15%易伤令牌。"),
    combat("expedition.vulcanus.shattered-scythe", "破碎之镰", 3, { 5: .60 }, "hero-skill.vulcanus.shattered-scythe", "每3回合敌盾/矛防御降低60%、我方射手攻击提升60%，持续1回合。"),
  ], {
    "hero-weapon-skill.vulcanus.rally-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(14, "hero.s14.elif", "艾丽芙", "shield", [
    combat("expedition.elif.light-veil-binding", "轻纱之缚", 1, { 5: .25 }, "hero-skill.elif.light-veil-binding", "敌军全体攻击降低25%。"),
    combat("expedition.elif.thousand-blade-formation", "千刃之阵", 2, { 5: .15 }, "hero-skill.elif.thousand-blade-formation", "全军攻击+15%、防御+10%。"),
    combat("expedition.elif.brocade-veil", "绫绮之幕", 3, { 5: .30 }, "hero-skill.elif.brocade-veil", "沿用加托列王恩赐：每次盾兵主攻后按0.30×100×Ct×√当前盾兵数×(1+A_report)生成下一回合护盾，覆盖刷新。"),
  ], {
    "hero-weapon-skill.elif.defense-defense": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(14, "hero.s14.dominic", "多米尼克", "lancer", [
    combat("expedition.dominic.shapeshifting-mechanism", "幻形机巧", 1, { 5: .20 }, "hero-skill.dominic.shapeshifting-mechanism", "全军伤害提升20%。"),
    combat("expedition.dominic.rose-thrust", "玫瑰突刺", 2, { 5: .60 }, "hero-skill.dominic.rose-thrust", "矛兵普通主攻击成功命中后，对本次目标产生0.6B并预约次轮易伤25%；闪避时均取消。"),
    combat("expedition.dominic.mirror-maze", "魔镜迷宫", 3, { 5: .15 }, "hero-skill.dominic.mirror-maze", "盾兵/射手承伤降低15%，盾兵/射手伤害提升15%。"),
  ], {
    "hero-weapon-skill.dominic.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(14, "hero.s14.cara", "卡拉", "marksman", [
    combat("expedition.cara.heavy-mist", "迷雾重重", 1, { 5: .20 }, "hero-skill.cara.heavy-mist", "敌军全体穿透降低20%。"),
    combat("expedition.cara.mechanical-pet", "机械魔宠", 2, { 5: .30 }, "hero-skill.cara.mechanical-pet", "全军普通攻击伤害提升30%。"),
    combat("expedition.cara.witch-assault", "魔女的强袭", 3, { 5: .40 }, "hero-skill.cara.witch-assault", "沿用韦恩迂回打击：每第2次射手主攻尝试对存活敌矛造成0.4B、敌射造成0.2B；闪避仍触发，缺失目标不转移。"),
  ], {
    "hero-weapon-skill.cara.defense-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(15, "hero.s15.hank", "汉克", "shield", [
    combat("expedition.hank.roaring-fury", "轰鸣的怒火", 1, { 5: .25 }, "hero-skill.hank.roaring-fury", "全军穿透提升25%。"),
    combat("expedition.hank.sparks-fly", "火花四溅", 2, { 5: .25 }, "hero-skill.hank.sparks-fly", "沿用埃莱奥诺拉腾焰飞芒：每第5次盾兵主攻尝试后，下两回合全军通用伤害提升25%、承伤降低25%；闪避仍计数。"),
    combat("expedition.hank.berserk-power", "狂暴之力", 3, { 5: .30 }, "hero-skill.hank.berserk-power", "沿用弗洛拉芳香迷雾：自然R5/6、R9/10…使敌盾易伤30%、敌射造成伤害降低30%。"),
  ], {
    "hero-weapon-skill.hank.defense-life": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(15, "hero.s15.estrella", "艾丝黛拉", "lancer", [
    combat("expedition.estrella.eclipse-sorrow", "月蚀哀色", 1, { 5: .25 }, "hero-skill.estrella.eclipse-sorrow", "敌军全体防御降低25%。"),
    combat("expedition.estrella.dawn-canvas", "黎明画卷", 2, { 5: .15 }, "hero-skill.estrella.dawn-canvas", "全军攻击+15%、防御+10%。"),
    combat("expedition.estrella.colorful-scene", "浮彩盛景", 3, { 5: .25 }, "hero-skill.estrella.colorful-scene", "盾兵承伤降低25%、矛兵伤害提升25%。"),
  ], {
    "hero-weapon-skill.estrella.defense-attack": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(15, "hero.s15.viveca", "维薇卡", "marksman", [
    combat("expedition.viveca.dark-night-legion", "暗夜军团", 1, { 5: .25 }, "hero-skill.viveca.dark-night-legion", "全军攻击提升25%。"),
    combat("expedition.viveca.shadow-vision", "暗影视界", 2, { 5: 1 }, "hero-skill.viveca.shadow-vision", "射手普攻成功命中后独立20%判定，成功对每个仍存活敌军兵种栈分别造成1B；闪避时不判定。"),
    combat("expedition.viveca.child-of-mist", "迷雾之子", 3, { 5: .10 }, "hero-skill.viveca.child-of-mist", "盾兵承伤降低10%、射手伤害提升10%。"),
  ], {
    "hero-weapon-skill.viveca.rally-penetration": EXCLUSIVE_WEAPON_SCENE_SKILL_VALUES,
  }),
  generationHero(16, "hero.s16.sigel", "西格尔", "shield", [
    combat("expedition.sigel.dark-armor", "暗夜铠胄", 1, { 5: .25 }, "hero-skill.sigel.dark-armor", "全军生命提升25%。"),
    combat("expedition.sigel.eternal-fortress", "永夜坚城", 2, { 5: .35 }, "hero-skill.sigel.eternal-fortress", "己方盾兵攻击属性降低20%；敌方矛兵、射手攻击属性降低35%。"),
    combat("expedition.sigel.night-vanguard", "极夜先锋", 3, { 5: .30 }, "hero-skill.sigel.night-vanguard", "盾兵受到普通攻击伤害降低25%、技能伤害降低30%，沿用赫尔薇尔不灭之师。"),
  ], {}),
  generationHero(16, "hero.s16.ursa", "乌尔撒", "lancer", [
    combat("expedition.ursa.mushroom-maze", "蕈林迷踪", 1, { 5: .25 }, "hero-skill.ursa.mushroom-maze", "敌军全体攻击属性降低25%。"),
    combat("expedition.ursa.ancestral-horn", "先祖号角", 2, { 5: .30 }, "hero-skill.ursa.ancestral-horn", "自然R2/4/6…当轮我方矛兵、射手穿透提升30%，敌军全体防御属性降低30%。"),
    combat("expedition.ursa.poison-blade", "蕈毒尖刃", 3, { 5: 1 }, "hero-skill.ursa.poison-blade", "每第2次矛兵主攻击尝试若命中，产生1B并使本次目标次轮易伤25%；闪避仍计数但取消效果。"),
  ], {}),
  generationHero(16, "hero.s16.aishilin", "艾诗琳", "marksman", [
    combat("expedition.aishilin.forest-song", "林间战曲", 1, { 5: .20 }, "hero-skill.aishilin.forest-song", "全军通用伤害提升20%。"),
    combat("expedition.aishilin.arrow-rain", "矢石如雨", 2, { 5: 1.50 }, "hero-skill.aishilin.arrow-rain", "自然R3/6/9…当轮射手通用伤害提升150%，敌军造成伤害降低30%。"),
    combat("expedition.aishilin.forest-fury", "森林之怒", 3, { 5: .40 }, "hero-skill.aishilin.forest-fury", "自然R3/6/9…射手对每个仍存活敌方兵种栈分别造成0.4B技能额外伤害。"),
  ], {}),
] as const satisfies readonly ExpeditionHeroData[];

const byId = new Map(EXPEDITION_HERO_DATA.map((heroData) => [heroData.id, heroData]));

export function getExpeditionHeroData(heroId: string): ExpeditionHeroData | undefined {
  return byId.get(heroId);
}

export function requireExpeditionHeroData(heroId: string): ExpeditionHeroData {
  const heroData = getExpeditionHeroData(heroId);
  if (heroData === undefined) {
    throw new Error(`Missing expedition hero data: ${heroId}.`);
  }
  return heroData;
}

export function getCombatExpeditionSkills(
  heroId: string,
): readonly ExpeditionSkillRecord[] {
  return requireExpeditionHeroData(heroId).expeditionSkills.filter(
    (skill) => skill.combatRelevant,
  );
}

function hero(
  id: string,
  name: string,
  rarity: "R" | "SR",
  troopType: "shield" | "lancer" | "marksman",
  attackDefenseBonus: number,
  expeditionSkills: readonly ExpeditionSkillRecord[],
): ExpeditionHeroData {
  return {
    id,
    name,
    rarity,
    stats: {
      troopType,
      attackBonus: attackDefenseBonus,
      defenseBonus: attackDefenseBonus,
      penetrationBonus: 0,
      lifeBonus: 0,
    },
    expeditionSkills,
  };
}

function s1Hero(
  id: string,
  name: string,
  troopType: "shield" | "lancer" | "marksman",
  attackDefenseBonus: number,
  weaponMaxStat: number,
  expeditionSkills: readonly ExpeditionSkillRecord[],
  knownSkillValues: Readonly<
    Record<string, Readonly<Partial<Record<1 | 2 | 3 | 4 | 5, number>>>>
  >,
): ExpeditionHeroData {
  return {
    id,
    name,
    rarity: "SSR",
    generation: 1,
    stats: {
      troopType,
      attackBonus: attackDefenseBonus,
      defenseBonus: attackDefenseBonus,
      penetrationBonus: 0,
      lifeBonus: 0,
    },
    exclusiveWeapon: {
      maxPenetrationBonus: weaponMaxStat,
      maxLifeBonus: weaponMaxStat,
      skillDefinitionIds: Object.keys(knownSkillValues),
      knownSkillValues,
    },
    expeditionSkills,
  };
}

function generationHero(
  generation: number,
  id: string,
  name: string,
  troopType: "shield" | "lancer" | "marksman",
  expeditionSkills: readonly ExpeditionSkillRecord[],
  knownSkillValues: Readonly<
    Record<string, Readonly<Partial<Record<1 | 2 | 3 | 4 | 5, number>>>>
  >,
): ExpeditionHeroData {
  const stats = EXPEDITION_GENERATION_STATS[generation as keyof typeof EXPEDITION_GENERATION_STATS];
  if (stats === undefined) throw new Error(`Missing generation stats: S${generation}.`);
  return {
    id,
    name,
    rarity: "SSR",
    generation,
    stats: {
      troopType,
      attackBonus: stats.expeditionAttackDefenseBonus,
      defenseBonus: stats.expeditionAttackDefenseBonus,
      penetrationBonus: 0,
      lifeBonus: 0,
    },
    ...(generation >= 16 && Object.keys(knownSkillValues).length === 0 ? {} : {
      exclusiveWeapon: {
        maxPenetrationBonus: stats.exclusiveWeaponMaxPenetrationLifeBonus,
        maxLifeBonus: stats.exclusiveWeaponMaxPenetrationLifeBonus,
        skillDefinitionIds: Object.keys(knownSkillValues),
        knownSkillValues,
      },
    }),
    expeditionSkills,
  };
}

function combat(
  id: string,
  name: string,
  expeditionSkillSlot: 1 | 2 | 3,
  levelValues: ExpeditionSkillRecord["levelValues"],
  combatSkillDefinitionId: string,
  description: string,
): ExpeditionSkillRecord {
  return {
    id,
    name,
    expeditionSkillSlot,
    levelValues,
    combatRelevant: true,
    combatSkillDefinitionId,
    description,
  };
}

function nonCombat(
  id: string,
  name: string,
  expeditionSkillSlot: 1 | 2 | 3,
  levelValues: ExpeditionSkillRecord["levelValues"],
  description: string,
): ExpeditionSkillRecord {
  return {
    id,
    name,
    expeditionSkillSlot,
    levelValues,
    combatRelevant: false,
    description,
  };
}
