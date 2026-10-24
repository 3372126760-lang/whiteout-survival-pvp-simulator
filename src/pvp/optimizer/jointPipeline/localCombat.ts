import type { PreprocessedBodyRow } from "../criterion/bodyPreprocess";
import type { RallyCandidate } from "../types";
import { candidateKey } from "../candidateGenerator";
import { localRatioGrid } from "./ratioGrid";

/** A bounded real-battle escape lane. It never changes the J formula or steals
 * initial recall slots. Body rows have already passed the actual constraints. */
export function localCombatNeighbors(parent: RallyCandidate, bodies: readonly PreprocessedBodyRow[],
  bodyIndex: number | undefined, score: (body: number) => number, bodyLimit = 18): RallyCandidate[] {
  const changed = (ratios: RallyCandidate["ratios"], body?: PreprocessedBodyRow): RallyCandidate => ({
    leaderHeroIds: parent.leaderHeroIds,
    ...(parent.headWeaponLevels ? { headWeaponLevels: parent.headWeaponLevels } : {}),
    ...(parent.troopLevels ? { troopLevels: parent.troopLevels } : {}),
    memberSkillIds: body?.ids ?? parent.memberSkillIds,
    bodySkillLevels: body?.semantic.skills.map(s => s.skillLevel) ?? parent.bodySkillLevels ?? parent.memberSkillIds.map(() => 5),
    ratios, recalledBy: ["localBattleNeighbor"], selectionReasons: ["fineSearch"],
  });
  const ratios = localRatioGrid(parent.ratios, 1, 1).filter(r =>
    r.shield !== parent.ratios.shield || r.lancer !== parent.ratios.lancer || r.marksman !== parent.ratios.marksman).map(r => changed(r));
  const base = bodyIndex === undefined ? undefined : bodies[bodyIndex];
  const same = (row: PreprocessedBodyRow) => row.semantic.skills.map(s => `${s.skillId}@${s.skillLevel}`);
  const baseIds = base ? same(base) : [];
  const candidates: { index: number; score: number }[] = [];
  if (baseIds.length === 4) for (const [index, row] of bodies.entries()) {
    if (index === bodyIndex || row.ids.length !== 4) continue;
    const remaining = [...baseIds]; let common = 0;
    for (const id of same(row)) { const i = remaining.indexOf(id); if (i >= 0) { common++; remaining.splice(i, 1); } }
    if (common === 3) candidates.push({ index, score: score(index) });
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  // Reserve half of the budget for mechanism champions. A low-J vulnerability
  // or survival replacement must not compete exclusively with damage copies.
  const selected = new Set(candidates.slice(0, Math.ceil(bodyLimit / 2)).map(c => c.index));
  const axes = ["vulnerability", "damageBuff", "penetrationBuff", "attackBuff",
    "ordinaryReceivedReduction", "lifeBuff", "averageDelayedSkillPerAttack", "enemyAttackDebuff"] as const;
  for (const axis of axes) {
    if (selected.size >= bodyLimit) break;
    const champion = candidates.filter(c => !selected.has(c.index)).sort((a, b) =>
      (bodies[b.index]!.semantic[axis] ?? 0) - (bodies[a.index]!.semantic[axis] ?? 0) || b.score - a.score || a.index - b.index)[0];
    if (champion) selected.add(champion.index);
  }
  for (const c of candidates) { if (selected.size >= bodyLimit) break; selected.add(c.index); }
  const rows = [...ratios, ...[...selected].map(index => changed(parent.ratios, bodies[index]!))];
  return [...new Map(rows.map(row => [candidateKey(row), row])).values()];
}

/** Inputs are ordered by their existing score; reserve distinct Head lineups
 * before allowing one Head to occupy all exploration slots. */
export function diverseCombatParents(rows: readonly RallyCandidate[], limit: number): RallyCandidate[] {
  const result: RallyCandidate[] = [], heads = new Set<string>(), keys = new Set<string>();
  for (const row of rows) {
    const head = JSON.stringify(Object.entries(row.leaderHeroIds).sort());
    if (heads.has(head) || result.length >= limit) continue;
    result.push(row); heads.add(head); keys.add(candidateKey(row));
  }
  for (const row of rows) {
    if (result.length >= limit) break;
    if (!keys.has(candidateKey(row))) { result.push(row); keys.add(candidateKey(row)); }
  }
  return result;
}
