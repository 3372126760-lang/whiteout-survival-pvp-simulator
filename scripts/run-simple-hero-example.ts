import {
  getTroopConstant,
  runPureTroopBattleScenario,
  type HeroFormationInput,
  type PureTroopScenarioSideInput,
} from "../src/index";

const side = (
  heroes: readonly HeroFormationInput[],
  counts: readonly [number, number, number],
): PureTroopScenarioSideInput => {
  const troop = (count: number, damageCoefficient: number) => ({
    count,
    attack: 0.2,
    penetration: 0.15,
    defense: 0.18,
    life: 0.12,
    troopLevel: "T6",
    troopConstant: getTroopConstant("T6"),
    damageCoefficient,
  });
  return {
    shield: troop(counts[0], 1),
    lancer: troop(counts[1], 3),
    marksman: troop(counts[2], 4),
    heroes,
  };
};

const result = runPureTroopBattleScenario({
  id: "simple-confirmed-hero-skills-demo",
  sideA: side([
    { heroId: "hero.head.fulinte", position: "leader" },
    { heroId: "hero.body.shuyun", position: "member", selectedMemberSkillId: "hero-skill.shuyun.attack" },
    { heroId: "hero.s5.nuola", position: "member", selectedMemberSkillId: "hero-skill.nuola.multi-troop-combat" },
  ], [120, 100, 80]),
  sideB: side([
    { heroId: "hero.s14.cara", position: "leader" },
    { heroId: "hero.body.jiexi", position: "member", selectedMemberSkillId: "hero-skill.jiexi.penetration" },
    { heroId: "hero.s8.hengdelike", position: "member", selectedMemberSkillId: "hero-skill.s8.hengdelike.defense-reduction" },
  ], [110, 90, 100]),
  maxRounds: 3,
});

console.log(result.readableTrace);
