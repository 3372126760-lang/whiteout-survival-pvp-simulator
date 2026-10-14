import { createEngineCandidateRunner, evaluateSingleCandidate, createStageSeeds, SingleWinObjective } from "../src/pvp/optimizer";
import { ratioNeighbors } from "../src/pvp/optimizer/theory";
import { rallyHeadSearchFixture, opponentCandidate } from "../src/pvp/tests/fixtures/rallyHeadSearch";
const candidate = { ...opponentCandidate(), leaderHeroIds: { shield: "hero.s1.nataliya", lancer: "hero.s11.lloyd", marksman: "hero.s11.rufus" }, ratios: { shield: 45, lancer: 10, marksman: 45 } };
const run = createEngineCandidateRunner(rallyHeadSearchFixture());
for (const trials of [50,200]) {
 const rows = [candidate.ratios,...ratioNeighbors(candidate.ratios,5)].map((ratios) => evaluateSingleCandidate({ ...candidate,ratios },36000, createStageSeeds(91,trials,200000),run));
 process.stdout.write(JSON.stringify({trials,rows: rows.map((row) => ({ratio: row.candidate.ratios, winRate:row.winRate, self:row.selfRemaining.total.mean, enemy:row.enemyRemaining.total.mean,compare:SingleWinObjective.compare(row,rows[0]!) }))})+"\n");
}
