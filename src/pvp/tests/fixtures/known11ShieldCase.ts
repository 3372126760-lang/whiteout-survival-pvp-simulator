/** User supplied observations, NOT a runnable fabricated opponent/config. */
export const KNOWN_11_SHIELD_CASE={
  source:"2026-10-07 user report in optimizer-restructure attachment",
  status:"awaitingFullBattleConfig" as const,
  ratios:{shield:57,lancer:3,marksman:40},
  bodySkillIds:["hero-skill.wuming.wind-shelter","hero-skill.wuming.wind-shelter","hero-skill.nuola.multi-troop-combat","hero-skill.nuola.multi-troop-combat"],
  weakHead:{shield:"hero.s10.gregory",lancer:"hero.s3.miya",marksman:"hero.s11.rufus"},
  strongHead:{shield:"hero.s11.eleonora",lancer:"hero.s3.miya",marksman:"hero.s11.rufus"},
  observed:{weakApproxWinRate:.795,strongWins:2694,strongTrials:3000,strongWinRate:.898},
  missing:["both sides full report attributes and basis","troop counts and levels","weapon levels and skill levels","external buffs/debuffs","opponent exact heroes/body","full imported bonus context"],
};
