import type { HeroSkillDefinition } from "../types";
import { MIA_DOOM_ENTANGLEMENT } from "./s3Heroes";
import { GWEN_AERIAL_SUPPRESSION } from "./s5Heroes";
import { MAGNUS_STEEL_PHALANX } from "./s9Heroes";
import {
  attributeModifier,
  attributeReduction,
  damageModifier,
  generationSceneWeapon,
  levelFiveGenerationSkill,
  reuseLevelFiveTemplate,
} from "./generationHeroBuilders";

const SOURCE = "2026-09-27 S13 rules inferred from earlier generations; PVP battle report unavailable";
const GISELA = "hero.s13.gisela";
const FLORA = "hero.s13.flora";
const VULCANUS = "hero.s13.vulcanus";

export const GISELA_ALLOY_SHIELD = levelFiveGenerationSkill({
  source: SOURCE, generation: 13,
  id: "hero-skill.gisela.alloy-shield", heroId: GISELA,
  name: "吉塞拉·合金盾牌", slot: 1,
  effects: [attributeModifier(
    "hero-effect.gisela.shield-defense", "defense", .30,
    "heroDefenseBonus", "addToAttribute", "shield",
  )],
});

export const GISELA_TEMPORARY_FORTIFICATION = reuseLevelFiveTemplate(MAGNUS_STEEL_PHALANX, {
  source: SOURCE, generation: 13,
  id: "hero-skill.gisela.temporary-fortification", heroId: GISELA,
  name: "吉塞拉·临时工事", slot: 2,
});

export const GISELA_PROTOTYPE_SHIELD = levelFiveGenerationSkill({
  source: SOURCE, generation: 13,
  id: "hero-skill.gisela.prototype-shield", heroId: GISELA,
  name: "吉塞拉·试作护盾", slot: 3, trigger: "roundStart", probability: .40,
  effects: [damageModifier({
    id: "hero-effect.gisela.prototype-shield", kind: "damageReduction",
    recipient: "selfArmy", group: "receivedDamageReduction", value: .50,
    lifecycle: { activationTiming: "immediate", durationRounds: 1, refreshMode: "replace" },
  })],
  tags: ["oncePerRound", "allArmy"],
});

export const FLORA_THORN_VINE_DANCE: HeroSkillDefinition = {
  ...reuseLevelFiveTemplate(MIA_DOOM_ENTANGLEMENT, {
  source: SOURCE, generation: 13,
  id: "hero-skill.flora.thorn-vine-dance", heroId: FLORA,
  name: "弗洛拉·刺藤曼舞", slot: 1,
  }),
  triggerTiming: "mainAttackAttempt",
};

export const FLORA_THORN_BUSH = levelFiveGenerationSkill({
  source: SOURCE, generation: 13,
  id: "hero-skill.flora.thorn-bush", heroId: FLORA,
  name: "弗洛拉·荆棘花丛", slot: 2,
  effects: [
    damageModifier({ id: "hero-effect.flora.shield-reduction", kind: "damageReduction", recipient: "selfArmy", group: "receivedDamageReduction", value: .25, target: "shield" }),
    damageModifier({ id: "hero-effect.flora.lancer-damage", kind: "damageIncrease", recipient: "selfArmy", group: "commonDamageIncrease", value: .25, source: "lancer" }),
  ],
});

export const FLORA_AROMATIC_MIST = levelFiveGenerationSkill({
  source: SOURCE, generation: 13,
  id: "hero-skill.flora.aromatic-mist", heroId: FLORA,
  name: "弗洛拉·芳香迷雾", slot: 3,
  effects: [
    damageModifier({ id: "hero-effect.flora.aromatic-mist.shield-vulnerability", kind: "incomingDamageIncrease", recipient: "enemyArmy", group: "vulnerability", value: .30, target: "shield", lifecycle: { periodRounds: 4, firstActiveRound: 5, activeWindowRounds: 2 } }),
    damageModifier({ id: "hero-effect.flora.aromatic-mist.marksman-outgoing", kind: "outgoingDamageReduction", recipient: "enemyArmy", group: "enemyOutgoingDamageReduction", value: .30, source: "marksman", lifecycle: { periodRounds: 4, firstActiveRound: 5, activeWindowRounds: 2 } }),
  ],
  tags: ["periodic", "gordonPoisonCloudTemplate"],
});

export const VULCANUS_OVERLORD_FURY = levelFiveGenerationSkill({
  source: SOURCE, generation: 13,
  id: "hero-skill.vulcanus.overlord-fury", heroId: VULCANUS,
  name: "乌尔卡努斯·枭雄之怒", slot: 1,
  effects: [attributeReduction(
    "hero-effect.vulcanus.overlord-fury", "attack", "enemyAttackReduction", .20,
  )],
});

export const VULCANUS_RIFTING_BLADE = reuseLevelFiveTemplate(GWEN_AERIAL_SUPPRESSION, {
  source: SOURCE, generation: 13,
  id: "hero-skill.vulcanus.rifting-blade", heroId: VULCANUS,
  name: "乌尔卡努斯·架裂之刃", slot: 2,
});

const scytheWindow = { periodRounds: 3, firstActiveRound: 3, activeWindowRounds: 1 } as const;

export const VULCANUS_SHATTERED_SCYTHE = levelFiveGenerationSkill({
  source: SOURCE, generation: 13,
  id: "hero-skill.vulcanus.shattered-scythe", heroId: VULCANUS,
  name: "乌尔卡努斯·破碎之镰", slot: 3,
  effects: [
    attributeReduction("hero-effect.vulcanus.shattered-scythe.shield-defense", "defense", "enemyDefenseReduction", .60, { target: "shield", lifecycle: scytheWindow }),
    attributeReduction("hero-effect.vulcanus.shattered-scythe.lancer-defense", "defense", "enemyDefenseReduction", .60, { target: "lancer", lifecycle: scytheWindow }),
    attributeModifier(
      "hero-effect.vulcanus.shattered-scythe.marksman-attack",
      "attack", .60, "heroAttackBonus", "addToAttribute", "marksman",
      scytheWindow,
    ),
  ],
  tags: ["periodic", "bearModelSemantic"],
});

export const S13_WEAPON_SKILL_DEFINITIONS = [
  generationSceneWeapon({ source: SOURCE, generation: 13,
    id: "hero-weapon-skill.gisela.defense-attack", heroId: GISELA,
    name: "吉塞拉专武·自动台", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 13,
    id: "hero-weapon-skill.flora.defense-life", heroId: FLORA,
    name: "弗洛拉专武·自然祝福", attribute: "life", group: "buffLife",
    battleContexts: ["rallyDefense", "garrisonDefense"] }),
  generationSceneWeapon({ source: SOURCE, generation: 13,
    id: "hero-weapon-skill.vulcanus.rally-attack", heroId: VULCANUS,
    name: "乌尔卡努斯专武·王者之威", attribute: "attack", group: "buffAttack",
    battleContexts: ["rallyAttack"] }),
] as const satisfies readonly HeroSkillDefinition[];

export const S13_HERO_SKILL_DEFINITIONS = [
  GISELA_ALLOY_SHIELD, GISELA_TEMPORARY_FORTIFICATION, GISELA_PROTOTYPE_SHIELD,
  FLORA_THORN_VINE_DANCE, FLORA_THORN_BUSH, FLORA_AROMATIC_MIST,
  VULCANUS_OVERLORD_FURY, VULCANUS_RIFTING_BLADE, VULCANUS_SHATTERED_SCYTHE,
  ...S13_WEAPON_SKILL_DEFINITIONS,
] as const satisfies readonly HeroSkillDefinition[];
