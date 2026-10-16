import type { OptimizerProfiler } from "./profiling";
import { TROOP_TYPES, type SideId, type TroopType } from "../types";
import { heroSGeneration } from "../validationUi/heroCategory";
import { getValidationCatalog, resolveBodySkillConfigs, allocateRallyTroopsByRatio, type RallyTroopRatios,
  type ValidationTroopInput } from "../validationUi";
import { rescaleTroop } from "./troopAllocation";
import type { OptimizationInput, RallyCandidate, SearchConstraint } from "./types";
import { isHeroAvailableAtStage } from "../progression";
import { validationStageId } from "../validationUi/stageConfig";

import { buildHeroPoolAudit, optimizerGeneration, optimizerRecentHeadEligible, recentGenerations } from "./heroSearchPolicy";
import { hasLegalBodyEffectFamilies } from "./criterion/bodyPreprocess";
import { enumerateBodyCombinations, generateBodyEnumerationDomain } from "./criterion/bodyEnumeration";

import { optimizationHeroIds, optimizerHeadWeaponLevels } from "./heroPools";
import { createEmptyHeadCandidate, currentHeadHeroIds, currentHeadWeaponLevels, resolveSearchDimensions } from "./searchDimensions";
const catalog = getValidationCatalog();

/** Existing heads are constants; candidate-pool filters only govern new heads. */
export function fixedHeadForSearch(input: OptimizationInput, constraints: SearchConstraint, side: SideId = "A") {
  const dimensions = resolveSearchDimensions(input, { side,
    fixedHead: TROOP_TYPES.every((troop) => constraints.fixedLeaders?.[troop] !== undefined),
    fixedBody: constraints.fixedBodyExact === true });
  if (dimensions.headSearchEnabled) return undefined;
  return dimensions.attributeInputMode === "FINAL_REPORT" || !TROOP_TYPES.every((troop) => constraints.fixedLeaders?.[troop] !== undefined) ? currentHeadHeroIds(input, side)
    : dimensions.headMode === "EMPTY_HEAD" ? createEmptyHeadCandidate().leaderHeroIds
    : Object.fromEntries(TROOP_TYPES.map((troop) => [troop, constraints.fixedLeaders?.[troop] ?? null])) as Record<TroopType, string | null>;
}

export function candidateHeadWeaponLevels(input: OptimizationInput, head: RallyCandidate["leaderHeroIds"],
  constraints: SearchConstraint, side: SideId = "A") {
  const actual = currentHeadWeaponLevels(input, side);
  return fixedHeadForSearch(input, constraints, side) === undefined
    ? optimizerHeadWeaponLevels(input, head, side) : Object.fromEntries(TROOP_TYPES.flatMap((troop) => {
      const id = head[troop]; return id ? [[id, actual[id] ?? 0]] : [];
    }));
}

export function candidateKey(candidate: RallyCandidate, equivalentMemberPositions = false): string {
  const members = equivalentMemberPositions
    ? [...candidate.memberSkillIds].sort()
    : candidate.memberSkillIds;
  return `${TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|")}|${members.join("|")}|${TROOP_TYPES.map((troop) => candidate.ratios[troop]).join("|")}${candidate.headWeaponLevels ? ":w:" + Object.entries(candidate.headWeaponLevels).sort().map(([id, n]) => `${id}=${n}`).join(",") : ""}${candidate.bodySkillLevels ? ":bl:" + candidate.bodySkillLevels.join(",") : ""}${candidate.troopLevels ? ":tl:" + TROOP_TYPES.map((t) => candidate.troopLevels![t]).join(",") : ""}`;
}

export function generateRatioGrid(step: number): readonly RallyTroopRatios[] {
  if (!Number.isSafeInteger(step) || step < 1 || 100 % step !== 0) {
    throw new RangeError("Ratio step must divide 100.");
  }
  const ratios: RallyTroopRatios[] = [];
  for (let shield = 0; shield <= 100; shield += step) {
    for (let lancer = 0; lancer <= 100 - shield; lancer += step) {
      ratios.push({ shield, lancer, marksman: 100 - shield - lancer });
    }
  }
  return ratios;
}

/** Reserve head visits if an old budget would otherwise be consumed by ratios alone. */
export function selectCoarseRatioGrid(grid: readonly RallyTroopRatios[], maxCandidates: number,
  hasHeadAlternatives: boolean): readonly RallyTroopRatios[] {
  if (!hasHeadAlternatives || maxCandidates > grid.length) return grid;
  const count = Math.max(1, maxCandidates - Math.min(30, maxCandidates - 1));
  if (count === 1) return [grid[0]!];
  return Array.from({ length: count }, (_, index) => grid[Math.round(index * (grid.length - 1) / (count - 1))]!);
}

export function refineRatios(origin: RallyTroopRatios, step: number, radius: number): readonly RallyTroopRatios[] {
  const found = new Map<string, RallyTroopRatios>();
  found.set(`${origin.shield}/${origin.lancer}/${origin.marksman}`, origin);
  for (let shield = Math.max(0, origin.shield - radius); shield <= Math.min(100, origin.shield + radius); shield += step) {
    for (let lancer = Math.max(0, origin.lancer - radius); lancer <= Math.min(100 - shield, origin.lancer + radius); lancer += step) {
      const marksman = 100 - shield - lancer;
      if (Math.abs(marksman - origin.marksman) > radius) continue;
      found.set(`${shield}/${lancer}/${marksman}`, { shield, lancer, marksman });
    }
  }
  return [...found.values()];
}

export function candidateToInput(input: OptimizationInput, candidate: RallyCandidate, side: SideId = "A"): OptimizationInput {
  const sideKey = side === "A" ? "sideA" : "sideB", own = input[sideKey];
  const deployment = own.rallyDeployment;
  if (deployment === undefined) throw new Error(`Optimizer requires rally deployment on side ${side}.`);
  const finalReport = input.attributeInputMode !== "prediction";
  const totalTroops = finalReport ? TROOP_TYPES.reduce((sum, troop) => sum + own.troops[troop].count, 0)
    : deployment.totalTroops;
  const counts = finalReport ? allocateRallyTroopsByRatio({ totalTroops, ratios: candidate.ratios }) : undefined;
  const head = finalReport ? currentHeadHeroIds(input, side) : candidate.leaderHeroIds;
  const leaderIds = TROOP_TYPES.flatMap((troop) => head[troop] ?? []);
  const bodySkills = resolveBodySkillConfigs(candidate.memberSkillIds, leaderIds,
    validationStageId(input), side).map((body, index) => ({ ...body,
    skillLevel: candidate.bodySkillLevels?.[index] ?? (own.bodySkills?.[index]?.skillId === body.skillId
      ? own.bodySkills[index]!.skillLevel
      : own.bodySkills?.find((old) => old.skillId === body.skillId)
        ?.skillLevel ?? body.skillLevel) }));
  return {
    ...input,
    scenarioType: "RALLY",
    battleContext: "rally",
    [sideKey]: {
      ...own,
      leaderHeroId: null,
      leaderHeroIds: head,
      simulationWeaponLevels: { ...own.simulationWeaponLevels,
        ...(finalReport ? currentHeadWeaponLevels(input, side) : candidate.headWeaponLevels ?? optimizerHeadWeaponLevels(input, head, side)) },
      selectedMemberSkillIds: candidate.memberSkillIds,
      bodySkills,
      troops: counts === undefined && candidate.troopLevels === undefined ? own.troops : Object.fromEntries(TROOP_TYPES.map((troop) => [troop, {
        ...(counts === undefined ? own.troops[troop] : rescaleTroop(own.troops[troop], counts[troop])),
        ...(candidate.troopLevels ? { troopLevel: candidate.troopLevels[troop] } : {}),
      }])) as Record<TroopType, ValidationTroopInput>,
      rallyDeployment: { totalTroops, ratios: candidate.ratios },
    },
  };
}

/** Final report troop counts are authoritative; prediction uses deployment ratios. */
export function currentRallyRatios(input: OptimizationInput, side: SideId = "A"): RallyTroopRatios {
  const own = side === "A" ? input.sideA : input.sideB;
  if (input.attributeInputMode === "prediction") return own.rallyDeployment!.ratios;
  const total = TROOP_TYPES.reduce((sum, troop) => sum + own.troops[troop].count, 0);
  if (total <= 0) throw new Error("Optimizer requires positive attacker troop count.");
  return Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, own.troops[troop].count * 100 / total])) as unknown as RallyTroopRatios;
}

export function headHeroPoolAudit(input: OptimizationInput, constraints: SearchConstraint, profiler?: OptimizerProfiler, side: SideId = "A") {
  profiler?.begin("英雄目录合法性过滤", catalog.leaderHeroes.length, catalog.leaderHeroes.length, false);
  const eligible = catalog.leaderHeroes.filter((hero) =>
    isHeroAvailableAtStage(hero, validationStageId(input)) &&
    (constraints.minGeneration === undefined || (hero.generation ?? 0) >= constraints.minGeneration) &&
    !constraints.forbiddenHeroIds?.includes(hero.heroId) &&
    optimizationHeroIds(input, side).includes(hero.heroId) &&
    (constraints.heroPoolIds === undefined || constraints.heroPoolIds.includes(hero.heroId)) &&
    (constraints.allowedPositions?.[hero.heroId]?.includes("leader") ?? true) &&
    (constraints.fixedLeaders?.[hero.troopType] === undefined || constraints.fixedLeaders[hero.troopType] === hero.heroId));
  profiler?.end(false);
  return buildHeroPoolAudit(input, eligible, side, profiler);
}

export function availableHeadHeroesByTroop(input: OptimizationInput,
  constraints: SearchConstraint, profiler?: OptimizerProfiler, side: SideId = "A"): Record<TroopType, (string | null)[]> {
  const fixed = fixedHeadForSearch(input, constraints, side);
  if (fixed !== undefined) return Object.fromEntries(TROOP_TYPES.map((troop) => [troop, [fixed[troop] ?? null]])) as Record<TroopType, (string | null)[]>;
  return Object.fromEntries(TROOP_TYPES.map((troop) => {
    const choices = headHeroPoolAudit(input, constraints, profiler, side).optimizerHeroPoolAfterFilter.filter((hero) => hero.troopType === troop &&
      isHeroAvailableAtStage(hero, validationStageId(input)) &&
      (constraints.minGeneration === undefined || (hero.generation ?? 0) >= constraints.minGeneration) &&
      !constraints.forbiddenHeroIds?.includes(hero.heroId) &&
      optimizationHeroIds(input, side).includes(hero.heroId) &&
      (constraints.heroPoolIds === undefined || constraints.heroPoolIds.includes(hero.heroId)) &&
      (constraints.allowedPositions?.[hero.heroId]?.includes("leader") ?? true))
      .sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0)).map((hero) => hero.heroId);
    const fixed = constraints.fixedLeaders?.[troop];
    if (fixed !== undefined) {
      if (fixed !== null && !choices.includes(fixed)) {
        const hero = catalog.leaderHeroes.find((entry) => entry.heroId === fixed && entry.troopType === troop);
        if (!hero || !isHeroAvailableAtStage(hero, validationStageId(input)) || constraints.forbiddenHeroIds?.includes(fixed) ||
          !optimizationHeroIds(input, side).includes(fixed)) throw new Error(`Fixed leader ${fixed} is not eligible.`);
        return [troop, []];
      }
      return [troop, [fixed]];
    }
    const required = constraints.requiredHeroIds?.filter((id) => choices.includes(id)) ?? [];
    if (required.length > 1) throw new Error(`Multiple required leaders for ${troop}.`);
    return [troop, required.length ? required : choices];
  })) as Record<TroopType, (string | null)[]>;
}

export function generateFormations(
  input: OptimizationInput,
  constraints: SearchConstraint,
  limit: number,
  profiler?: OptimizerProfiler,
): readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Formation limit must be positive.");
  if (fixedHeadForSearch(input, constraints) !== undefined) return generateAllHeadFormations(input, constraints, profiler);
  const stageId = validationStageId(input);
  const leaders: Record<TroopType, string | null> = { shield: null, lancer: null, marksman: null };
  const leaderChoices = availableHeadHeroesByTroop(input, constraints, profiler);
  for (const troop of TROOP_TYPES) {
    const fixed = constraints.fixedLeaders?.[troop];
    if (fixed !== undefined) {
      if (fixed !== null && !leaderChoices[troop].includes(fixed)) return [];
      leaders[troop] = fixed;
      continue;
    }
    const required = constraints.requiredHeroIds?.find((id) => leaderChoices[troop].includes(id));
    const current = input.sideA.leaderHeroIds?.[troop];
    leaders[troop] = required ?? (current !== undefined && current !== null && leaderChoices[troop].includes(current)
      ? current : leaderChoices[troop][0] ?? null);
  }
  const fixedMembers = constraints.fixedMemberSkillIds ?? [];
  const memberSources = catalog.memberSkills.flatMap((entry) => entry.sourceHeroIds.map((heroId, index) => ({
    heroId, skillId: entry.sourceSkillIds[index]!, effectKey: entry.effectKey,
  }))).filter((entry) => isHeroAvailableAtStage(catalog.leaderHeroes.find((hero) => hero.heroId === entry.heroId)!, stageId) &&
    !constraints.forbiddenHeroIds?.includes(entry.heroId) &&
    (input.rallyBodyPoolIds === undefined || input.rallyBodyPoolIds.includes(entry.heroId)) &&
    (constraints.allowedPositions?.[entry.heroId]?.includes("member") ?? true))
    .sort((a, b) => {
      const generationA = catalog.leaderHeroes.find((hero) => hero.heroId === a.heroId)?.generation ?? 0;
      const generationB = catalog.leaderHeroes.find((hero) => hero.heroId === b.heroId)?.generation ?? 0;
      return generationB - generationA;
    });
  if (fixedMembers.length > 4) throw new RangeError("At most four member skills can be fixed.");
  for (const skillId of fixedMembers) {
    if (!memberSources.some((source) => source.skillId === skillId)) {
      throw new RangeError(`Fixed member skill ${skillId} is not eligible at server stage ${stageId}.`);
    }
  }
  const fixedHeroIds = fixedMembers.map((skillId) =>
    memberSources.find((source) => source.skillId === skillId)!.heroId);
  const initialMembers = [...fixedMembers];
  if (constraints.fixedBodyExact) {
    if (constraints.fixedMemberSkillIds === undefined) {
      throw new Error("固定当前车身需要明确的车身列表。");
    }
  }
  const reserved = new Set(fixedHeroIds);
  for (const skillId of constraints.fixedBodyExact ? [] : input.sideA.selectedMemberSkillIds) {
    if (initialMembers.length >= 4) break;
    const source = memberSources.find((entry) => entry.skillId === skillId);
    if (source !== undefined && hasLegalBodyEffectFamilies([...initialMembers, skillId])) {
      initialMembers.push(skillId);
      reserved.add(source.heroId);
    }
  }
  for (const entry of constraints.fixedBodyExact ? [] : memberSources) {
    if (initialMembers.length >= 4) break;
    if (hasLegalBodyEffectFamilies([...initialMembers, entry.skillId])) {
      initialMembers.push(entry.skillId);
      reserved.add(entry.heroId);
    }
  }
  for (const requiredId of constraints.fixedBodyExact ? [] : constraints.requiredHeroIds ?? []) {
    if (reserved.has(requiredId)) continue;
    const source = memberSources.find((entry) => entry.heroId === requiredId);
    if (source === undefined || initialMembers.length === 0 || fixedMembers.length >= 4) continue;
    const replaceAt = initialMembers.length === 4 ? 3 : initialMembers.length;
    const replaced = initialMembers[replaceAt];
    if (replaced !== undefined) reserved.delete(memberSources.find((entry) => entry.skillId === replaced)?.heroId ?? "");
    initialMembers[replaceAt] = source.skillId;
    reserved.add(requiredId);
  }
  const formations: Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] = [];
  const seen = new Set<string>();
  const push = (leaderIds: Record<TroopType, string | null>, memberIds: readonly string[]): void => {
    if (formations.length >= limit) return;
    if (!optimizerRecentHeadEligible(input, leaderIds) || !hasLegalBodyEffectFamilies(memberIds)) return;
    const selectedHeroes = TROOP_TYPES.flatMap((troop) => leaderIds[troop] === null ? [] : [leaderIds[troop]!]);
    let memberHeroes: readonly { readonly heroId: string; readonly skillId: string }[];
    try { memberHeroes = resolveBodySkillConfigs(memberIds, selectedHeroes, stageId); }
    catch { return; }
    const bodyHeroIds = memberHeroes.map((entry) => entry.heroId);
    const allHeroes = [...selectedHeroes, ...bodyHeroIds];
    if (constraints.requiredHeroIds?.some((id) => !allHeroes.includes(id))) return;
    if (constraints.requiredHeroIds?.some((id) =>
      TROOP_TYPES.some((troop) => leaderChoices[troop].includes(id) &&
        leaderIds[troop] !== id))) return;
    const key = `${TROOP_TYPES.map((troop) => leaderIds[troop] ?? "").join("|")}|${constraints.equivalentMemberPositions ? [...memberIds].sort().join("|") : memberIds.join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    formations.push({ leaderHeroIds: { ...leaderIds }, memberSkillIds: [...memberIds] });
  };
  // A greedy four-copy seed can violate the optimizer's effect-family limit;
  // use a legal body seed without changing the exact manual configuration.
  const initialBody = hasLegalBodyEffectFamilies(initialMembers) ? initialMembers :
    firstLegalBodyFormation(input, constraints, leaders)?.memberSkillIds;
  if (initialBody !== undefined) push(leaders, initialBody);
  if (formations.length >= limit) return formations;
  // Reserve room for body search, but visit each role across the full pool first.
  const headBudget = constraints.fixedBodyExact ? limit : Math.max(2, Math.ceil(limit * .65));
  const opponentHead = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    input.sideB.leaderHeroIds?.[troop] ?? null])) as Record<TroopType, string | null>;
  if (TROOP_TYPES.every((troop) => leaderChoices[troop].includes(opponentHead[troop])))
    push(opponentHead, initialBody ?? initialMembers);
  const ranks = Math.max(...TROOP_TYPES.map((troop) => leaderChoices[troop].length));
  for (let rank = 0; rank < ranks && formations.length < headBudget; rank += 1) {
    for (const troop of TROOP_TYPES) {
      const heroId = leaderChoices[troop][rank];
      if (heroId !== undefined && formations.length < headBudget)
        push({ ...leaders, [troop]: heroId }, initialBody ?? initialMembers);
    }
  }
  for (let rank = 0; rank < ranks && formations.length < headBudget; rank += 1) {
    push(Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      leaderChoices[troop][rank % leaderChoices[troop].length]!])) as
      Record<TroopType, string | null>, initialBody ?? initialMembers);
  }
  for (const shield of leaderChoices.shield) for (const lancer of leaderChoices.lancer)
    for (const marksman of leaderChoices.marksman) {
      if (formations.length < headBudget) push({ shield, lancer, marksman }, initialBody ?? initialMembers);
    }
  if (constraints.fixedBodyExact || fixedMembers.length === 4) return formations;
  // Include complete legal body substitutions before local slot refinement.
  for (const first of memberSources) {
    const single = [...fixedMembers];
    while (single.length < 4) single.push(first.skillId);
    push(leaders, single);
    for (const second of memberSources) {
      if (second.skillId === first.skillId) continue;
      for (let count = 1; count < 4 - fixedMembers.length; count += 1) {
        const pair = [...fixedMembers, ...Array<string>(count).fill(first.skillId)];
        while (pair.length < 4) pair.push(second.skillId);
        push(leaders, pair);
      }
    }
  }
  for (let rank = 0; rank < memberSources.length && formations.length < limit; rank += 1) {
    for (let slot = fixedMembers.length; slot < 4; slot += 1) {
      const entry = memberSources[rank]!;
      const next = [...initialMembers];
      next[slot] = entry.skillId;
      push(leaders, next);
    }
  }
  for (let rank = 1; rank < memberSources.length && formations.length < limit; rank += 1) {
    for (let firstSlot = fixedMembers.length; firstSlot < 4; firstSlot += 1) {
      for (let secondSlot = firstSlot + 1; secondSlot < 4; secondSlot += 1) {
        const first = memberSources[rank];
        const second = memberSources[rank + 1];
        if (first === undefined || second === undefined) continue;
        const next = [...initialMembers];
        next[firstSlot] = first.skillId;
        next[secondSlot] = second.skillId;
        push(leaders, next);
      }
    }
  }
  return formations;
}

/** Stage 1 coverage is independent of the later ratio/refinement budget. */
export function generateAllHeadFormations(input: OptimizationInput,
  constraints: SearchConstraint, profiler?: OptimizerProfiler, side: SideId = "A"): readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] {
  const fixed = fixedHeadForSearch(input, constraints, side);
  if (fixed !== undefined) {
    const body = firstLegalBodyFormation(input, constraints, fixed, side);
    return body === undefined ? [] : [body];
  }
  const choices = availableHeadHeroesByTroop(input, constraints, profiler, side);
  const rows: Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] = [];
  if(!TROOP_TYPES.every((t)=>choices[t].length))return rows;
  // Validate the independent body domain once; greedy four-copy seeds must not
  // suppress all legal heads after the same-effect-family constraint.
  const eligibleHeads: RallyCandidate["leaderHeroIds"][] = [];
  for(const shield of choices.shield)for(const lancer of choices.lancer)for(const marksman of choices.marksman) {
    const leaderHeroIds = {shield,lancer,marksman};
    if (optimizerRecentHeadEligible(input, leaderHeroIds, side)) eligibleHeads.push(leaderHeroIds);
  }
  const first = eligibleHeads[0];
  if (first === undefined) return rows;
  const exampleBody = firstLegalBodyFormation(input, constraints, first, side)?.memberSkillIds;
  if (exampleBody === undefined) return rows;
  for (const leaderHeroIds of eligibleHeads) rows.push({leaderHeroIds,memberSkillIds:exampleBody});
  return rows;
}

/** Counts the head domain before and after recentness; bodies are audited separately. */
export function headFormationGenerationAudit(input: OptimizationInput, constraints: SearchConstraint,
  profiler?: OptimizerProfiler, side: SideId = "A") {
  if (fixedHeadForSearch(input, constraints, side) !== undefined) return {
    allLegalHeadCount: 1, effectiveHeroGeneration: 0, recentGenerationWindow: [0, 0] as const,
    recentEligibleHeadCount: 1, rejectedByRecentGenerationCount: 0 };
  const choices = availableHeadHeroesByTroop(input, constraints, profiler, side);
  const effectiveHeroGeneration = optimizerGeneration(input, side), recent = recentGenerations(effectiveHeroGeneration);
  const recentGenerationWindow = [Math.max(1, effectiveHeroGeneration - 2), effectiveHeroGeneration] as const;
  const recentIds = new Set(catalog.leaderHeroes.filter((hero) => recent.includes(heroSGeneration(hero) ?? 0)).map((hero) => hero.heroId));
  const allLegalHeadCount = TROOP_TYPES.reduce((count, troop) => count * choices[troop].length, 1);
  const rejectedByRecentGenerationCount = effectiveHeroGeneration < 3 ? 0 : TROOP_TYPES.reduce((count, troop) =>
    count * choices[troop].filter((id) => id === null || !recentIds.has(id)).length, 1);
  return { allLegalHeadCount, effectiveHeroGeneration, recentGenerationWindow,
    recentEligibleHeadCount: allLegalHeadCount - rejectedByRecentGenerationCount, rejectedByRecentGenerationCount };
}

/** A legal example is obtained without allocating the entire body domain. */
function firstLegalBodyFormation(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"], side: SideId = "A") {
  const result = enumerateBodyCombinations(generateBodyEnumerationDomain(input, constraints, head, side), { limit: 1 });
  const row = result.rows[0];
  return row ? { leaderHeroIds: head, memberSkillIds: row.memberSkillIds } : undefined;
}

/** Compatibility API: every returned row has already passed the family branch rule.
 * Exact raw identity-domain counts come from bodyEnumeration.audit, not this array. */
export function generateRawBodyFormations(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"], side: SideId = "A"): readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] {
  return enumerateBodyCombinations(generateBodyEnumerationDomain(input, constraints, head, side)).rows.map((row) =>
    ({ leaderHeroIds: head, memberSkillIds: row.memberSkillIds }));
}

export function generateBodyFormations(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"], side: SideId = "A"): readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] {
  return generateRawBodyFormations(input, constraints, head, side);
}
