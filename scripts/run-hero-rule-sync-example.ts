import {
  createSequenceRandomSource,
  getTroopConstant,
  runPureTroopBattleScenario,
  type HeroFormationInput,
  type PureTroopScenarioSideInput,
} from "../src/index";

const troop = (count: number, damageCoefficient: number) => ({
  count,
  attack: 2.4,
  penetration: 1.8,
  defense: 2.2,
  life: 1.6,
  troopLevel: "T6",
  troopConstant: getTroopConstant("T6"),
  damageCoefficient,
});

function side(
  heroes: readonly HeroFormationInput[],
  reportHeroIds: readonly string[],
): PureTroopScenarioSideInput {
  return {
    shield: troop(120, 1),
    lancer: troop(100, 3),
    marksman: troop(80, 4),
    heroes,
    reportHeroIds,
  };
}

const sideAHeroes: readonly HeroFormationInput[] = [
  { heroId: "hero.sr.baxiti", position: "leader" },
  { heroId: "hero.sr.patelike", position: "member", selectedMemberSkillId: "hero-skill.patelike.life" },
  { heroId: "hero.body.jiexi", position: "member", selectedMemberSkillId: "hero-skill.jiexi.penetration" },
  { heroId: "hero.body.shuyun", position: "member", selectedMemberSkillId: "hero-skill.shuyun.attack" },
  { heroId: "hero.sr.lumubogen", position: "member", selectedMemberSkillId: "hero-skill.lumubogen.penetration-reduction" },
];

const sideBHeroes: readonly HeroFormationInput[] = [
  { heroId: "hero.sr.xieergai", position: "leader" },
  { heroId: "hero.sr.lingshuang", position: "member", selectedMemberSkillId: "hero-skill.lingshuang.attack-reduction" },
  { heroId: "hero.body.jiexi", position: "member", selectedMemberSkillId: "hero-skill.jiexi.penetration" },
  { heroId: "hero.body.shuyun", position: "member", selectedMemberSkillId: "hero-skill.shuyun.attack" },
  { heroId: "hero.body.jiesaier", position: "member", selectedMemberSkillId: "hero-skill.jiesaier.penetration" },
];

const result = runPureTroopBattleScenario({
  id: "confirmed-hero-rule-sync-audit",
  sideA: side(sideAHeroes, [
    "hero.r.youjin", "hero.r.shimisi", "hero.r.chali", "hero.r.kelaoruisi",
  ]),
  sideB: side(sideBHeroes, [
    "hero.r.youjin", "hero.r.shimisi", "hero.r.chali", "hero.r.kelaoruisi",
  ]),
  maxRounds: 2,
}, {
  randomSource: createSequenceRandomSource([.12, .82, .31, .73, .24, .91]),
});

console.log(result.readableTrace);
