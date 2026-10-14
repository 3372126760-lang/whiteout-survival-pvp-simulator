// Previous multi-peak search workflow; body legality follows current optimizer constraints.
import { TROOP_TYPES, type TroopType } from "../../../src/pvp/types";
import { getValidationCatalog, resolveBodySkillConfigs, allocateRallyTroopsByRatio, type RallyTroopRatios,
  type ValidationTroopInput } from "../../../src/pvp/validationUi";
import { rescaleTroop } from "../../../src/pvp/optimizer/troopAllocation";
import type { OptimizationInput, RallyCandidate, SearchConstraint } from "../../../src/pvp/optimizer/types";
import { isHeroAvailableAtStage } from "../../../src/pvp/progression";
import { validationStageId } from "../../../src/pvp/validationUi/stageConfig";
import { hasLegalBodyEffectFamilies } from "../../../src/pvp/optimizer/criterion/bodyPreprocess";
import { enumeratePreprocessedBodyPool } from "../../../src/pvp/optimizer/criterion/bodyEnumeration";

const catalog = getValidationCatalog();

export function candidateKey(candidate: RallyCandidate, equivalentMemberPositions = false): string {
  const members = equivalentMemberPositions
    ? [...candidate.memberSkillIds].sort()
    : candidate.memberSkillIds;
  return `${TROOP_TYPES.map((troop) => candidate.leaderHeroIds[troop] ?? "").join("|")}|${members.join("|")}|${TROOP_TYPES.map((troop) => candidate.ratios[troop]).join("|")}`;
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

export function candidateToInput(input: OptimizationInput, candidate: RallyCandidate): OptimizationInput {
  const deployment = input.sideA.rallyDeployment;
  if (deployment === undefined) throw new Error("Optimizer requires rally deployment on side A.");
  const finalReport = input.attributeInputMode !== "prediction";
  const totalTroops = finalReport ? TROOP_TYPES.reduce((sum, troop) => sum + input.sideA.troops[troop].count, 0)
    : deployment.totalTroops;
  const counts = finalReport ? allocateRallyTroopsByRatio({ totalTroops, ratios: candidate.ratios }) : undefined;
  const leaderIds = TROOP_TYPES.flatMap((troop) => candidate.leaderHeroIds[troop] ?? []);
  const bodySkills = resolveBodySkillConfigs(candidate.memberSkillIds, leaderIds,
    validationStageId(input)).map((body, index) => ({ ...body,
    skillLevel: input.sideA.bodySkills?.[index]?.skillId === body.skillId
      ? input.sideA.bodySkills[index]!.skillLevel
      : input.sideA.bodySkills?.find((old) => old.skillId === body.skillId)
        ?.skillLevel ?? body.skillLevel }));
  return {
    ...input,
    scenarioType: "RALLY",
    battleContext: "rally",
    sideA: {
      ...input.sideA,
      leaderHeroId: null,
      leaderHeroIds: candidate.leaderHeroIds,
      selectedMemberSkillIds: candidate.memberSkillIds,
      bodySkills,
      ...(counts === undefined ? {} : { troops: Object.fromEntries(TROOP_TYPES.map((troop) =>
        [troop, rescaleTroop(input.sideA.troops[troop], counts[troop])])) as Record<TroopType, ValidationTroopInput> }),
      rallyDeployment: { totalTroops, ratios: candidate.ratios },
    },
  };
}

/** Final report troop counts are authoritative; prediction uses deployment ratios. */
export function currentRallyRatios(input: OptimizationInput): RallyTroopRatios {
  if (input.attributeInputMode === "prediction") return input.sideA.rallyDeployment!.ratios;
  const total = TROOP_TYPES.reduce((sum, troop) => sum + input.sideA.troops[troop].count, 0);
  if (total <= 0) throw new Error("Optimizer requires positive attacker troop count.");
  return Object.fromEntries(TROOP_TYPES.map((troop) =>
    [troop, input.sideA.troops[troop].count * 100 / total])) as unknown as RallyTroopRatios;
}

export function availableHeadHeroesByTroop(input: OptimizationInput,
  constraints: SearchConstraint): Record<TroopType, (string | null)[]> {
  return Object.fromEntries(TROOP_TYPES.map((troop) => {
    const choices = catalog.leaderHeroes.filter((hero) => hero.troopType === troop &&
      isHeroAvailableAtStage(hero, validationStageId(input)) &&
      (constraints.minGeneration === undefined || (hero.generation ?? 0) >= constraints.minGeneration) &&
      !constraints.forbiddenHeroIds?.includes(hero.heroId) &&
      (input.availableHeroIds === undefined || input.availableHeroIds.includes(hero.heroId)) &&
      (constraints.heroPoolIds === undefined || constraints.heroPoolIds.includes(hero.heroId)) &&
      (constraints.allowedPositions?.[hero.heroId]?.includes("leader") ?? true))
      .sort((a, b) => (b.generation ?? 0) - (a.generation ?? 0)).map((hero) => hero.heroId);
    const fixed = constraints.fixedLeaders?.[troop];
    if (fixed !== undefined) {
      if (fixed !== null && !choices.includes(fixed)) throw new Error(`Fixed leader ${fixed} is not eligible.`);
      return [troop, [fixed]];
    }
    const required = constraints.requiredHeroIds?.filter((id) => choices.includes(id)) ?? [];
    if (required.length > 1) throw new Error(`Multiple required leaders for ${troop}.`);
    return [troop, required.length ? required : choices.length ? choices : [null]];
  })) as Record<TroopType, (string | null)[]>;
}

export function generateFormations(
  input: OptimizationInput,
  constraints: SearchConstraint,
  limit: number,
): readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Formation limit must be positive.");
  const stageId = validationStageId(input);
  const allowedHero = (id: string): boolean => {
    const hero = catalog.leaderHeroes.find((entry) => entry.heroId === id);
    if (hero === undefined) return false;
    const generation = hero.generation ?? 0;
    return isHeroAvailableAtStage(hero, stageId) &&
      (constraints.minGeneration === undefined || generation >= constraints.minGeneration) &&
      !constraints.forbiddenHeroIds?.includes(id) &&
      (input.availableHeroIds === undefined || input.availableHeroIds.includes(id)) &&
      (constraints.heroPoolIds === undefined || constraints.heroPoolIds.includes(id));
  };
  const leaders: Record<TroopType, string | null> = { shield: null, lancer: null, marksman: null };
  const leaderChoices = availableHeadHeroesByTroop(input, constraints);
  for (const troop of TROOP_TYPES) {
    const fixed = constraints.fixedLeaders?.[troop];
    if (fixed !== undefined) {
      if (fixed !== null && !leaderChoices[troop].includes(fixed)) throw new Error(`Fixed leader ${fixed} is not eligible.`);
      leaders[troop] = fixed;
      continue;
    }
    const required = constraints.requiredHeroIds?.find((id) => leaderChoices[troop].includes(id));
    const current = input.sideA.leaderHeroIds?.[troop];
    leaders[troop] = required ?? (current !== undefined && current !== null && leaderChoices[troop].includes(current)
      ? current : leaderChoices[troop][0] ?? null);
  }
  const memberSources = catalog.memberSkills.flatMap((entry) => entry.sourceHeroIds.map((heroId, index) => ({
    heroId, skillId: entry.sourceSkillIds[index]!, effectKey: entry.effectKey,
  }))).filter((entry) => allowedHero(entry.heroId) &&
    (constraints.allowedPositions?.[entry.heroId]?.includes("member") ?? true))
    .sort((a, b) => {
      const generationA = catalog.leaderHeroes.find((hero) => hero.heroId === a.heroId)?.generation ?? 0;
      const generationB = catalog.leaderHeroes.find((hero) => hero.heroId === b.heroId)?.generation ?? 0;
      return generationB - generationA;
    });
  const fixedMembers = constraints.fixedMemberSkillIds ?? [];
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
    const selectedHeroes = TROOP_TYPES.flatMap((troop) => leaderIds[troop] === null ? [] : [leaderIds[troop]!]);
    let memberHeroes: readonly { readonly heroId: string; readonly skillId: string }[];
    try { memberHeroes = resolveBodySkillConfigs(memberIds, selectedHeroes, stageId); }
    catch { return; }
    const bodyHeroIds = memberHeroes.map((entry) => entry.heroId);
    const allHeroes = [...selectedHeroes, ...bodyHeroIds];
    if (!hasLegalBodyEffectFamilies(memberIds)) return;
    if (constraints.requiredHeroIds?.some((id) => !allHeroes.includes(id))) return;
    if (constraints.requiredHeroIds?.some((id) =>
      TROOP_TYPES.some((troop) => leaderChoices[troop].includes(id) &&
        leaderIds[troop] !== id))) return;
    const key = `${TROOP_TYPES.map((troop) => leaderIds[troop] ?? "").join("|")}|${constraints.equivalentMemberPositions ? [...memberIds].sort().join("|") : memberIds.join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    formations.push({ leaderHeroIds: { ...leaderIds }, memberSkillIds: [...memberIds] });
  };
  push(leaders, initialMembers);
  if (formations.length >= limit) return formations;
  // Reserve room for body search, but visit each role across the full pool first.
  const headBudget = constraints.fixedBodyExact ? limit : Math.max(2, Math.ceil(limit * .65));
  const opponentHead = Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
    input.sideB.leaderHeroIds?.[troop] ?? null])) as Record<TroopType, string | null>;
  if (TROOP_TYPES.every((troop) => leaderChoices[troop].includes(opponentHead[troop])))
    push(opponentHead, initialMembers);
  const ranks = Math.max(...TROOP_TYPES.map((troop) => leaderChoices[troop].length));
  for (let rank = 0; rank < ranks && formations.length < headBudget; rank += 1) {
    for (const troop of TROOP_TYPES) {
      const heroId = leaderChoices[troop][rank];
      if (heroId !== undefined && formations.length < headBudget)
        push({ ...leaders, [troop]: heroId }, initialMembers);
    }
  }
  for (let rank = 0; rank < ranks && formations.length < headBudget; rank += 1) {
    push(Object.fromEntries(TROOP_TYPES.map((troop) => [troop,
      leaderChoices[troop][rank % leaderChoices[troop].length]!])) as
      Record<TroopType, string | null>, initialMembers);
  }
  for (const shield of leaderChoices.shield) for (const lancer of leaderChoices.lancer)
    for (const marksman of leaderChoices.marksman) {
      if (formations.length < headBudget) push({ shield, lancer, marksman }, initialMembers);
    }
  if (constraints.fixedBodyExact || fixedMembers.length === 4) return formations;
  // Include complete body substitutions under the current effect-family rule.
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
  constraints: SearchConstraint): readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] {
  const choices = availableHeadHeroesByTroop(input, constraints);
  const rows: Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] = [];
  for (const shield of choices.shield) for (const lancer of choices.lancer)
    for (const marksman of choices.marksman) {
      const [row] = generateFormations(input, { ...constraints,
        fixedLeaders: { shield, lancer, marksman } }, 1);
      if (row !== undefined) rows.push(row);
    }
  return rows;
}

export function generateBodyFormations(input: OptimizationInput, constraints: SearchConstraint,
  head: RallyCandidate["leaderHeroIds"]): readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[] {
  return enumeratePreprocessedBodyPool(input, constraints, head).rows.map((row) =>
    ({ leaderHeroIds: head, memberSkillIds: row.memberSkillIds }));
}
