import { CONFIRMED_HERO_SKILL_DEFINITIONS, createBattleState, createConfirmedHeroFormation,
  createConfirmedTroopSkillLoadout, type HeroFormationInput } from "../../../pvp";
import { makeSide } from "../helpers";

/** Canonical battle input was subsequently supplied; optimizer options were not. */
export const reneeDecapitationReference = {
  seed: 502926396, canonicalInputAvailable: true, historicalOptimizerOptionsAvailable: false,
  inputFixture: "benchmarks/optimizer/joint-rally-60-39-1-vs-49-1-50-seed-502926396-input.json",
  A: { head: ["hero.s12.hervor", "hero.s11.lloyd", "hero.s3.gelaige"],
    body: ["hero-skill.ruini.dream-mark", "hero-skill.ruini.dream-mark", "hero-skill.jiatuo.golden-guard", "hero-skill.s8.hengdelike.defense-reduction"], ratio: [60, 39, 1] },
  B: { head: ["hero.s12.hervor", "hero.s12.karol", "hero.s12.ligeia"],
    body: ["hero-skill.nuola.multi-troop-combat", "hero-skill.nuola.multi-troop-combat", "hero-skill.jiatuo.golden-guard", "hero-skill.s8.hengdelike.defense-reduction"], ratio: [49, 1, 50] },
} as const;

/** Explicit controlled mechanism fixture. Synthetic C=1, HP=1e12, zero panels,
 * 10000 troops each, all ordinary heroes Lv5 and weapons Lv10. Does NOT claim
 * to reproduce the original seed's R20/R21, winner, J, rank, or formal win rate.
 * The test controls the R20 ambush and Greg procs to verify the chain's semantics.
 */
export function controlledReneeChainState() {
  const formation = (side: "A" | "B") => {
    const row = reneeDecapitationReference[side];
    return createConfirmedHeroFormation([
      ...row.head.map((heroId): HeroFormationInput => ({ heroId, position: "leader", weaponLevel: 10 })),
      ...row.body.map((skillId, index): HeroFormationInput => ({
        heroId: CONFIRMED_HERO_SKILL_DEFINITIONS.find((s) => s.id === skillId)!.heroId,
        position: "member", selectedMemberSkillId: skillId, runtimeInstanceId: `${side}-body-${index}`,
      })),
    ]);
  };
  return createBattleState({ battleContext: "rally",
    sideA: { ...makeSide({ shield: 6000, lancer: 3900, marksman: 100 }, { maxHpPerUnit: 1e12,
      skillStates: { lancer: createConfirmedTroopSkillLoadout("lancer", "T7").filter((s) => s.skillId === "lancer-charge") } }), heroStates: formation("A") },
    sideB: { ...makeSide({ shield: 4900, lancer: 100, marksman: 5000 }, { maxHpPerUnit: 1e12 }), heroStates: formation("B") },
  });
}
