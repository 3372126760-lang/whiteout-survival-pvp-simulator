import type { OptimizerProfiler } from "../profiling";
import { TROOP_TYPES } from "../../types";
import { deriveBatchSeed } from "../../validationUi";
import { candidateKey, candidateToInput, currentRallyRatios, generateAllHeadFormations, headHeroPoolAudit, generateFormations, generateRatioGrid } from "../candidateGenerator";
import type { OptimizationInput, OptimizationConfig, OptimizationProgress, RallyCandidate } from "../types";
import { defaultTheoryOptions, validateTheoryOptions, type TheoryTemplate, type SelectionReason } from "./types";
import { createTheoryTemplateBuilder } from "./templateBuilder";
import { estimateTheoryCandidate } from "./staticEstimator";
import { createRatioAdjacency, scanLineupRatios } from "./theoryPreFilter";

export function headLineupKey(head: RallyCandidate["leaderHeroIds"]): string {
  return TROOP_TYPES.map((troop) => head[troop] ?? "").join("|");
}
export function preFilterRallyCandidates(input: OptimizationInput, config: OptimizationConfig,
  onProgress?: (progress: OptimizationProgress) => void, profiler?: OptimizerProfiler) {
  const options = config.theory ?? defaultTheoryOptions(); validateTheoryOptions(options);
  profiler?.begin("候选生成", 1);
  const formations = generateAllHeadFormations(input, config.constraints, profiler);
  profiler?.end();
  const heroPoolAudit = headHeroPoolAudit(input, config.constraints, profiler);
  for (const candidate of config.protectedCandidates ?? []) {
    if (!formations.some((formation) => headLineupKey(formation.leaderHeroIds) === headLineupKey(candidate.leaderHeroIds)))
      throw new Error("Protected manual candidate is outside the legal hero pool.");
    const fixed = config.constraints.fixedMemberSkillIds ?? [];
    const remaining = [...candidate.memberSkillIds];
    for (const skill of fixed) {
      const index = remaining.indexOf(skill);
      if (index < 0) throw new Error("Protected manual candidate violates fixed body constraints.");
      remaining.splice(index, 1);
    }
    if (config.constraints.fixedBodyExact && remaining.length > 0)
      throw new Error("Protected manual candidate violates fixed body constraints.");
    const legal = generateFormations(input, { ...config.constraints,
      fixedLeaders: candidate.leaderHeroIds, fixedBodyExact: true,
      fixedMemberSkillIds: candidate.memberSkillIds }, 1);
    if (!legal.length) throw new Error("Protected manual candidate is outside the legal body pool.");
  }
  const grid = generateRatioGrid(options.ratioStep);
  const adjacency = createRatioAdjacency(grid, options.ratioStep);
  const buildTemplate = createTheoryTemplateBuilder(options);
  const templates = new Map<string, TheoryTemplate>();
  const candidates = new Map<string, RallyCandidate>();
  const lineups: { head: RallyCandidate["leaderHeroIds"]; scannedRatios: number; localPeaks: number; selectedRatios: number }[] = [];
  let localPeaksDetected = 0;
  const add = (candidate: RallyCandidate) => {
    const key = candidateKey(candidate), previous = candidates.get(key);
    candidates.set(key, previous === undefined ? candidate : { ...previous,
      selectionReasons: [...new Set([...(previous.selectionReasons ?? []), ...(candidate.selectionReasons ?? [])])] });
  };
  const templateKey = (candidate: Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">) =>
    `${headLineupKey(candidate.leaderHeroIds)}:${candidate.memberSkillIds.join("|")}`;
  profiler?.begin("Theory阵容模板与扫描调度", formations.length);
  for (const [index, formation] of formations.entries()) {
    // Nonzero reference counts retain mixed-level constants and unlocks. Actual ratio scanning is floating point.
    const template = buildTemplate(candidateToInput(input, { ...formation,
      ratios: { shield: 34, lancer: 33, marksman: 33 } }));
    if ([input.sideA.leaderHeroIds, input.sideB.leaderHeroIds, ...(config.protectedCandidates ?? []).map((candidate) => candidate.leaderHeroIds)]
      .some((head) => headLineupKey(head ?? {}) === headLineupKey(formation.leaderHeroIds))) templates.set(templateKey(formation), template);
    const result = scanLineupRatios(grid, adjacency, (ratio) => estimateTheoryCandidate(template,
      TROOP_TYPES.map((troop) => ratio[troop])), options, deriveBatchSeed(config.firstSeed, index + 2_000_000), profiler);
    for (const selection of result.selections) add({ ...formation, ratios: selection.ratios,
      theoryEstimate: selection.estimate, selectionReasons: selection.selectionReasons });
    localPeaksDetected += result.localPeaksDetected;
    lineups.push({ head: formation.leaderHeroIds, scannedRatios: result.scanned,
      localPeaks: result.localPeaksDetected, selectedRatios: result.selections.length });
    if ((index + 1) % 10 === 0 || index + 1 === formations.length)
      onProgress?.({ stage: "Theory · 全车头全比例扫描", completed: index + 1, total: formations.length });
  }
  profiler?.end();
  const currentRatio = currentRallyRatios(input);
  const referenceHead = formations.find((formation) => headLineupKey(formation.leaderHeroIds) ===
    headLineupKey(input.sideB.leaderHeroIds ?? {}));
  const protectedKeys = new Set<string>();
  const protect = (candidate: RallyCandidate, reason: SelectionReason) => {
    const key = templateKey(candidate);
    const template = templates.get(key) ?? buildTemplate(candidateToInput(input, { ...candidate,
      ratios: { shield: 34, lancer: 33, marksman: 33 } }));
    add({ ...candidate, theoryEstimate: estimateTheoryCandidate(template, TROOP_TYPES.map((troop) => candidate.ratios[troop])),
      selectionReasons: [...(candidate.selectionReasons ?? []), reason] });
    protectedKeys.add(candidateKey(candidate));
  };
  if (referenceHead !== undefined) protect({ ...referenceHead, ratios: currentRatio }, "protectedReference");
  for (const candidate of config.protectedCandidates ?? []) protect(candidate, "protectedReference");
  const currentFormation = formations.find((formation) => headLineupKey(formation.leaderHeroIds) === headLineupKey(input.sideA.leaderHeroIds ?? {}));
  if (currentFormation !== undefined) protect({ ...currentFormation, ratios: currentRatio }, "currentConfig");
  if (!formations.length) {
    const baseline: RallyCandidate = { leaderHeroIds: input.sideA.leaderHeroIds ?? {},
      memberSkillIds: input.sideA.bodySkills?.map((body) => body.skillId) ?? input.sideA.selectedMemberSkillIds,
      ratios: currentRatio, selectionReasons: ["currentConfig"] };
    add(baseline); protectedKeys.add(candidateKey(baseline));
  }
  return { heroPoolAudit, candidates: [...candidates.values()], protectedKeys, formations, lineups, options, grid,
    theoryCandidateCount: formations.length * grid.length, localPeaksDetected };
}
