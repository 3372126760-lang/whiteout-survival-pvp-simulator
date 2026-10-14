import { writeFileSync } from "node:fs";
import { createBattleState, createConfirmedHeroState, MIA_DOOM_ENTANGLEMENT,
  createHeroSkillSystem, createSeededRandomSource, simulateBattle, formatBattleTrace } from "../src/pvp";
import { makeSide } from "../src/pvp/tests/helpers";

const skill = MIA_DOOM_ENTANGLEMENT;
const state = createBattleState({
  sideA: makeSide({ shield: 100 }, { maxHpPerUnit: 1e9 }),
  sideB: { ...makeSide({ shield: 100 }, { maxHpPerUnit: 1e9 }),
    heroStates: [1, 2].map((index) => createConfirmedHeroState({ heroId: skill.heroId,
      position: "member", selectedMemberSkillId: skill.id, runtimeInstanceId: `B-body-${index}` })) },
});
let seed = 91;
while (seed < 1000) { const rng = createSeededRandomSource(seed); if (rng.next() < .5 && rng.next() < .5) break; seed++; }
const result = simulateBattle(state, { maxRounds: 3, heroSkillSystem: createHeroSkillSystem({
  definitions: [skill], randomSource: createSeededRandomSource(seed) }) });
writeFileSync("examples/miya-proc-family-trace.json", JSON.stringify({
  provenance: "Synthetic fixed-seed independent-source regression, not a real game report. TEST troop constant and huge HP keep target identity stable.",
  seed, trace: result.trace,
}, null, 2));
writeFileSync("examples/miya-proc-family-trace.txt", `Synthetic fixed seed ${seed}; not a real game report.\n${formatBattleTrace(result.trace)}`);
process.stdout.write(JSON.stringify({ seed, firstRound: result.trace.rounds[0]!.procEffectFamilies,
  secondRoundVulnerability: result.trace.rounds[1]!.damageEvents.find((event) => event.sourceSide === "B")!.increaseGroups,
}, null, 2) + "\n");
