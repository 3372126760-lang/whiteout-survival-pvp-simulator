import { TROOP_TYPES } from "../../types";
import { createValidationPreviewState } from "../../validationUi";
import { resolveTroopAttribute } from "../../effects";
import type { EffectLifecycle } from "../../types/effect";
import type { SignatureBinding } from "../criterion/signatures";
import { stateBindings } from "../criterion/signatures";
import type { PreprocessedBodyRow } from "../criterion/bodyPreprocess";
import { candidateHeadWeaponLevels, candidateToInput } from "../candidateGenerator";
import type { OptimizationConfig, OptimizationInput, RallyCandidate } from "../types";

export const DAMAGE_HORIZON = 20, REDUCTION_HORIZON = 40;
export interface ProbabilityReduction { probability: number; value: number; }
export function expectedIncomingMultiplier(stable: number, effects: readonly ProbabilityReduction[]): number {
  let states = [{ value: stable, probability: 1 }];
  for (const e of effects) {
    if (e.probability <= 0) continue;
    if (e.probability >= 1) { states.forEach((s) => { s.value += e.value; }); continue; }
    states = states.flatMap((s) => [{ value: s.value, probability: s.probability * (1 - e.probability) },
      { value: s.value + e.value, probability: s.probability * e.probability }]);
  }
  return states.reduce((sum, s) => sum + s.probability / Math.max(1e-9, 1 + s.value), 0);
}
export function equivalentReduction(stable: number, effects: readonly ProbabilityReduction[]): number {
  return 1 / expectedIncomingMultiplier(stable, effects) - 1;
}
/** Fixed absolute windows and typed periods, including delayed activation. */
export function roundCoverage(lifecycle: EffectLifecycle | undefined, horizon: number, duration?: number): number {
  let active = 0;
  for (let round = 1; round <= horizon; round++) if (activeInRound(lifecycle, round, duration)) active++;
  return active / horizon;
}
function activeInRound(lifecycle: EffectLifecycle | undefined, round: number, duration?: number): boolean {
  if (lifecycle?.activeRounds) return lifecycle.activeRounds.includes(round);
  const start = lifecycle?.firstActiveRound ?? (lifecycle?.activationTiming === "nextRound" ? 2 : 1);
  if (round < start) return false;
  if (lifecycle?.periodRounds) return (round - start) % lifecycle.periodRounds < (lifecycle.activeWindowRounds ?? lifecycle.durationRounds ?? duration ?? 1);
  return round < start + (lifecycle?.durationRounds ?? duration ?? Infinity);
}
interface ReductionTerm { id: string; value: number; probabilities: readonly number[]; }
interface Recipe { linear: Map<string, number>; reductions: Map<string, ReductionTerm[]>; channels: Float64Array; }
interface Route { key: string; lane: number; inverse: boolean; }
interface ReductionLookup { lane: number; headIds: Uint32Array; bodyIds: Uint32Array; bodyTypes: number; values: Float64Array; }
export interface JointCoefficientTable {
  headCount: number; bodyCount: number; headBase: Float64Array;
  routes: readonly Route[]; headValues: Float64Array;
  headFactors: Float64Array;
  bodyOffsets: Uint32Array; bodyTerms: Uint32Array; bodyValues: Float64Array;
  headChannels: Float64Array; bodyChannels: Float64Array;
  reductions: readonly ReductionLookup[];
  incomingNormalShare: number;
}
function emptyRecipe(): Recipe { return { linear: new Map(), reductions: new Map(), channels: new Float64Array(6) }; }
const sharedReceived = new Set(["receivedDamageReduction", "receivedNormalAttackReduction", "receivedSkillDamageReduction"]);
function groupKey(kind: string, group: string, attribute: string): string {
  if (kind === "damageReduction" && sharedReceived.has(group)) return "receivedSharedDivisor";
  if (kind === "attributeModifier") return `attribute:${attribute}:${group}`;
  if (kind === "defenseModifier") return "attribute:defense:sharedDefense";
  return `${kind}:${group}:${attribute}`;
}
/** Build once per Head or Body from typed definitions, never from localized descriptions. */
function compileRecipe(bindings: readonly (SignatureBinding & { enemy?: boolean })[], enemyShares: readonly number[], curves = new Map<string, readonly number[]>()): Recipe {
  const recipe = emptyRecipe();
  for (const binding of bindings) {
    const skill = binding.skill, level = skill.levelValues[binding.level]; if (!level) continue;
    const p = level.probability ?? skill.probability ?? 1;
    const action = "actionMechanic" in skill ? skill.actionMechanic : undefined;
    // A delayed mark produces an independent damage event, not a multiplier.
    // Read its typed schedule once while compiling; the S/O and J formulas and
    // the formal mark/event mechanism remain unchanged.
    if (!binding.enemy && action?.kind === "targetBoundMark" && level.effects.some((e) => e.kind === "targetBoundMark" && e.markId === action.markId)) {
      const first = action.schedule.interval + (action.schedule.mode === "nextAttack" ? 1 : 0) + action.damageDelayRounds;
      const events = Math.max(0, 1 + Math.floor((DAMAGE_HORIZON - first) / action.schedule.interval));
      for (const [troop, name] of TROOP_TYPES.entries()) if (action.schedule.source === "army" || action.schedule.source === name)
        recipe.channels[3 + troop]! += p * action.damageCoefficient * events / DAMAGE_HORIZON;
    }
    const interval = action?.kind === "attackCountTrigger" ? action.schedule.interval : 1;
    const duration = level.durationRounds ?? skill.durationRounds;
    for (const effect of level.effects) {
      const enemy = !!binding.enemy !== ("recipient" in effect && effect.recipient === "enemyArmy");
      const source = effect.scope.source === "army" ? -1 : effect.scope.source === "self" ? binding.source ?? -1 : TROOP_TYPES.indexOf(effect.scope.source);
      const defensive = ["damageReduction", "defenseModifier", "baseDefenseMultiplier", "directDamageCancellation"].includes(effect.kind);
      const lifecycle = effect.lifecycle ?? (level.periodRounds ? { periodRounds: level.periodRounds,
        firstActiveRound: level.periodStartRound ?? 1, activeWindowRounds: duration ?? 1 } :
        "activationTiming" in skill && skill.activationTiming === "nextRound" ? { activationTiming: "nextRound" as const } : undefined);
      const fixedDuration = skill.trigger === "passive" ? duration : undefined;
      const sourceWeight = effect.scope.incomingSourceTroop ? enemyShares[TROOP_TYPES.indexOf(effect.scope.incomingSourceTroop)]! : 1;
      const linked = "linkedToSkillId" in effect ? bindings.find((b) => b.skill.id === effect.linkedToSkillId && b.source === binding.source && !!b.enemy === !!binding.enemy) : undefined;
      const linkedProbability = linked ? linked.skill.levelValues[linked.level]?.probability ?? linked.skill.probability ?? 1 : 1;
      const probability = p * linkedProbability;
      const cooldown = level.cooldownRounds ?? skill.cooldownRounds ?? 0;
      const triggerRate = 1 / Math.max(1, interval, 1 + Math.max(0, cooldown - 1) * probability);
      const eventWeight = probability * triggerRate * roundCoverage(lifecycle, DAMAGE_HORIZON, fixedDuration);
      const activeDuration = skill.trigger === "passive" || level.periodRounds ? 1 : duration ?? effect.lifecycle?.durationRounds ?? 1;
      const presence = interval > 1 || cooldown > 1 ? probability * Math.min(1, activeDuration * triggerRate)
        : 1 - (1 - probability) ** activeDuration;
      const damageWeight = presence * roundCoverage(lifecycle, DAMAGE_HORIZON, fixedDuration);
      for (let troop = 0; troop < 3; troop++) {
        if (!enemy && source >= 0 && source !== troop) continue;
        if (defensive && effect.scope.target && !["all", "currentTarget"].includes(effect.scope.target) && effect.scope.target !== TROOP_TYPES[troop]) continue;
        if (!enemy && effect.kind === "extraDamage") {
          const targetCount = effect.scope.target === "all" ? enemyShares.filter((v) => v > 0).length : 1;
          recipe.channels[3 + troop]! += eventWeight * effect.coefficient * targetCount; continue;
        }
        if (!enemy && effect.kind === "sameMainAttackSegment") { recipe.channels[troop]! += eventWeight * effect.damageScale; continue; }
        if (!("value" in effect) || !("group" in effect)) continue;
        const attribute = "attribute" in effect ? effect.attribute : "";
        let survival = false, output = false, inverse = false, reduction = false;
        switch (effect.kind) {
          case "attributeModifier": survival = !enemy && ["life", "defense"].includes(attribute); output = !enemy && !survival; break;
          case "attributeReduction": survival = enemy ? ["attack", "penetration"].includes(attribute) : ["defense", "life"].includes(attribute); output = !survival; inverse = !enemy; break;
          case "defenseModifier": survival = !enemy; break;
          case "damageReduction": case "baseDefenseMultiplier": survival = !enemy; reduction = survival; break;
          case "directDamageCancellation": survival = !enemy; inverse = true; break;
          case "damageIncrease": case "baseDamageMultiplier": output = !enemy; break;
          case "incomingDamageIncrease": case "defenseReduction": output = enemy; break;
          case "outgoingDamageReduction": survival = enemy; output = !enemy; inverse = !enemy; break;
        }
        if (!survival && !output) continue;
        for (let channel = 0; channel < 2; channel++) {
          const damageType = channel ? "skillDamage" : "normalAttack";
          if (effect.scope.damageType && !["all", damageType].includes(effect.scope.damageType) ||
              effect.group === "receivedNormalAttackReduction" && channel !== 0 ||
              effect.group === "receivedSkillDamageReduction" && channel !== 1 ||
              effect.group === "normalAttackDamageIncrease" && channel !== 0 ||
              effect.group === "skillDamageIncrease" && channel !== 1) continue;
          const lane = (survival ? 0 : 6) + channel * 3 + troop;
          const key = `${lane}|${inverse ? "inverse:" : ""}${groupKey(effect.kind, effect.group, attribute)}`;
          if (reduction) {
            const terms = recipe.reductions.get(key) ?? [];
            // Effects of a single trigger share a Bernoulli draw; four Body runtime
            // instances remain independent. Temporal states are integrated before inversion.
            const curveKey = JSON.stringify([lifecycle, fixedDuration, presence * sourceWeight]);
            let probabilities = curves.get(curveKey);
            if (!probabilities) { probabilities = Array.from({ length: REDUCTION_HORIZON }, (_, round) =>
              activeInRound(lifecycle, round + 1, fixedDuration) ? Math.min(1, presence * sourceWeight) : 0); curves.set(curveKey, probabilities); }
            const id = `${binding.runtimeId}:${skill.id}`, existing = terms.find((t) => t.id === id && JSON.stringify(t.probabilities) === JSON.stringify(probabilities));
            if (existing) existing.value += effect.value;
            else terms.push({ id, value: effect.value, probabilities });
            recipe.reductions.set(key, terms);
          } else {
            const weight = survival ? presence * roundCoverage(lifecycle, REDUCTION_HORIZON, fixedDuration) : damageWeight;
            recipe.linear.set(key, (recipe.linear.get(key) ?? 0) + (effect.kind === "directDamageCancellation" ? -effect.value : effect.value) * weight * sourceWeight);
          }
        }
      }
    }
  }
  return recipe;
}
function reductionProfile(terms: readonly ReductionTerm[]): string {
  return JSON.stringify(terms.map((t) => [t.value, t.probabilities]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
/** Exact same-group E[1/(1+sum)] over trigger states and the 40 absolute rounds. */
export function combinedReductionFactor(a: readonly ReductionTerm[], b: readonly ReductionTerm[]): number {
  const terms = [...a, ...b], cache = new Map<string, number>(); let incoming = 0;
  for (let round = 0; round < REDUCTION_HORIZON; round++) {
    const events = terms.map((t) => ({ probability: t.probabilities[round]!, value: t.value }));
    const key = events.map((e) => e.probability).join(",");
    let value = cache.get(key); if (value === undefined) { value = expectedIncomingMultiplier(0, events); cache.set(key, value); }
    incoming += value;
  }
  return REDUCTION_HORIZON / incoming;
}
export function createJointCoefficientTable(input: OptimizationInput, config: OptimizationConfig,
  heads: readonly Pick<RallyCandidate, "leaderHeroIds" | "memberSkillIds">[], bodies: readonly PreprocessedBodyRow[]): JointCoefficientTable {
  const side = config.candidateSide ?? "A", ownKey = side === "A" ? "sideA" : "sideB";
  const enemy = side === "A" ? "B" : "A", enemyOwn = input[side === "A" ? "sideB" : "sideA"];
  const enemyTotal = TROOP_TYPES.reduce((sum, t) => sum + enemyOwn.troops[t].count, 0);
  const shares = TROOP_TYPES.map((t) => enemyTotal ? enemyOwn.troops[t].count / enemyTotal : 1 / 3);
  const curves = new Map<string, readonly number[]>();
  const bodyRecipes = bodies.map((body) => compileRecipe(body.semantic.skills.flatMap((s, i) => input.disabledSkillIds.includes(s.skillId) ? [] :
    [{ skill: s.definition, level: s.skillLevel, runtimeId: `body-${i}` }]), shares, curves));
  const base = new Float64Array(heads.length * 6);
  const headRecipes = heads.map((head, i) => {
    const candidate = { ...head, memberSkillIds: [], ratios: { shield: 34, lancer: 33, marksman: 33 },
      headWeaponLevels: candidateHeadWeaponLevels(input, head.leaderHeroIds, config.constraints, side) };
    const state = createValidationPreviewState(candidateToInput(input, candidate, side)), own = state[ownKey];
    const bindings = [...stateBindings(state, side), ...stateBindings(state, enemy).map((b) => ({ ...b, enemy: true }))].filter((b) => !input.disabledSkillIds.includes(b.skill.id));
    const recipe = compileRecipe(bindings, shares, curves);
    for (const [troop, t] of TROOP_TYPES.entries()) {
      const unit = own.troops[t];
      const factor = (attr: "attack" | "penetration" | "defense" | "life") => 1 + resolveTroopAttribute(own, t, attr, 1, { targetTroop: "shield", damageType: "normalAttack" }).effectiveValue;
      base[i * 6 + troop] = unit.troopHpCoefficient * unit.troopConstant * factor("life") * factor("defense");
      base[i * 6 + 3 + troop] = unit.damageCoefficient * unit.troopConstant * factor("attack") * factor("penetration");
      // Weapon stat buffs are already summed with targetBuff by the report adapter.
      for (const key of [...recipe.linear.keys()]) if (key.includes(`attribute:`) && key.includes(":buff") && Number(key.split("|")[0]) % 3 === troop) recipe.linear.delete(key);
    }
    return recipe;
  });
  const routes: Route[] = [...new Set([...headRecipes, ...bodyRecipes].flatMap((r) => [...r.linear.keys()]))].sort().map((key) =>
    ({ key, lane: Number(key.split("|")[0]), inverse: key.includes("|inverse:") }));
  const headValues = Float64Array.from(headRecipes.flatMap((r) => routes.map((g) => r.linear.get(g.key) ?? 0)));
  const headFactors = new Float64Array(heads.length * 12).fill(1);
  for (let head = 0; head < heads.length; head++) for (const [i, route] of routes.entries()) {
    const factor = Math.max(1e-9, 1 + headValues[head * routes.length + i]!);
    headFactors[head * 12 + route.lane]! *= route.inverse ? 1 / factor : factor;
  }
  const offsets = [0], terms: number[] = [], values: number[] = [];
  for (const body of bodyRecipes) {
    for (const [i, route] of routes.entries()) if (body.linear.has(route.key)) { terms.push(i); values.push(body.linear.get(route.key)!); }
    offsets.push(terms.length);
  }
  const reductions: ReductionLookup[] = [...new Set([...headRecipes, ...bodyRecipes].flatMap((r) => [...r.reductions.keys()]))].sort().map((key) => {
    const intern = (rows: Recipe[]) => {
      const unique = new Map<string, number>(), laws: readonly ReductionTerm[][] = [];
      const ids = Uint32Array.from(rows.map((r) => { const law = r.reductions.get(key) ?? [], signature = reductionProfile(law);
        let id = unique.get(signature); if (id === undefined) { id = unique.size; unique.set(signature, id); (laws as ReductionTerm[][]).push(law); } return id; }));
      return { ids, laws };
    };
    const h = intern(headRecipes), b = intern(bodyRecipes);
    return { lane: Number(key.split("|")[0]), headIds: h.ids, bodyIds: b.ids, bodyTypes: b.laws.length,
      values: Float64Array.from(h.laws.flatMap((hl) => b.laws.map((bl) => combinedReductionFactor(hl, bl)))) };
  });
  // Scope projection uses the fixed opponent's typed extra-attack channels;
  // direct S/O bases never divide by opponent unit damage or HP.
  const enemyRecipe = compileRecipe(stateBindings(createValidationPreviewState(input), enemy), shares);
  const normal = 3 + enemyRecipe.channels.slice(0, 3).reduce((a, b) => a + b, 0), skill = enemyRecipe.channels.slice(3).reduce((a, b) => a + b, 0);
  return { headCount: heads.length, bodyCount: bodies.length, headBase: base, routes, headValues, headFactors,
    bodyOffsets: Uint32Array.from(offsets), bodyTerms: Uint32Array.from(terms), bodyValues: Float64Array.from(values),
    headChannels: Float64Array.from(headRecipes.flatMap((r) => [...r.channels])), bodyChannels: Float64Array.from(bodyRecipes.flatMap((r) => [...r.channels])),
    reductions, incomingNormalShare: normal / (normal + skill) };
}
/** Scratch arrays and compact lookups only on the per-pair hot path. */
export function combineJointCoefficients(table: JointCoefficientTable, head: number, body: number, s: Float64Array, o: Float64Array, scratch: Float64Array): void {
  for (let lane = 0; lane < 12; lane++) scratch[lane] = table.headFactors[head * 12 + lane]!;
  // Replace a Head group's factor with its summed Head+Body factor. Work is
  // proportional to this Body's sparse terms, not all registry groups.
  for (let cursor = table.bodyOffsets[body]!; cursor < table.bodyOffsets[body + 1]!; cursor++) {
    const i = table.bodyTerms[cursor]!, route = table.routes[i]!, base = Math.max(1e-9, 1 + table.headValues[head * table.routes.length + i]!);
    const factor = Math.max(1e-9, base + table.bodyValues[cursor]!) / base;
    scratch[route.lane]! *= route.inverse ? 1 / factor : factor;
  }
  for (const r of table.reductions) scratch[r.lane]! *= r.values[r.headIds[head]! * r.bodyTypes + r.bodyIds[body]!]!;
  for (let i = 0; i < 3; i++) {
    const normal = 1 + table.headChannels[head * 6 + i]! + table.bodyChannels[body * 6 + i]!;
    const skill = table.headChannels[head * 6 + 3 + i]! + table.bodyChannels[body * 6 + 3 + i]!;
    s[i] = table.headBase[head * 6 + i]! / (table.incomingNormalShare / scratch[i]! + (1 - table.incomingNormalShare) / scratch[3 + i]!);
    o[i] = table.headBase[head * 6 + 3 + i]! * (normal * scratch[6 + i]! + skill * scratch[9 + i]!);
  }
}
