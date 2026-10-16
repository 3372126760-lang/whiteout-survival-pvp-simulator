import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { CanonicalBodyEffectRegistry } from "../src/pvp/bodyEffects/canonicalRegistry";
import { enumeratePreprocessedBodyPool } from "../src/pvp/optimizer/criterion/bodyEnumeration";
import { enumerateCanonicalBodyPool } from "../src/pvp/optimizer/jointPipeline/canonicalBodies";
import { generateAllHeadFormations } from "../src/pvp/optimizer/candidateGenerator";
import { validationStageId } from "../src/pvp/validationUi/stageConfig";
import type { OptimizationConfig, OptimizationInput } from "../src/pvp/optimizer/types";

const fixturePath = process.argv[2] ?? "benchmarks/optimizer/joint-rally-gen12-input.json";
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { input: OptimizationInput; optimizerConfig: OptimizationConfig };
const { input, optimizerConfig: config } = fixture, side = config.candidateSide ?? "A";
const heads = generateAllHeadFormations(input, config.constraints, undefined, side);
const registry = new CanonicalBodyEffectRegistry(undefined, validationStageId(input));
const legacy = enumeratePreprocessedBodyPool(input, config.constraints, heads[0]!.leaderHeroIds, { jointPolicy: true, candidateSide: side });
const next = enumerateCanonicalBodyPool(input, config.constraints, heads[0]!.leaderHeroIds, side);
const result = { inputFixture: fixturePath, inputSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  headCount: heads.length, historicalBodyCount: 57313, historicalInputAvailable: false,
  currentReproducibleBodyCount: legacy.bodies.length, difference: legacy.bodies.length - 57313,
  historicalCountReproduced: legacy.bodies.length === 57313,
  discrepancy: legacy.bodies.length - 57313,
  interpretation: "The historical input was not supplied. These are measured stages of the saved reproducible fixture, not an invented reconstruction of 57313. Raw unordered hero count is a reference universe; legacy actually prunes multiplicity in ordered slots, then numeric aliases, then selected commuting permutations.",
  legacyAudit: legacy.audit, canonicalAudit: next.audit.canonical,
  categoryCounts: registry.categoryCounts(), automaticCategoryCounts: registry.categoryCounts(true),
  canonicalEffects: registry.effects.map((e) => ({ canonicalBodyEffectId: e.canonicalBodyEffectId,
    representativeSkillId: e.representative.id, representativeHeroId: e.representative.heroId, category: e.category,
    optimizerExcluded: e.optimizerExcluded, aliases: e.aliases.map((a) => a.id), semanticKey: e.semanticKey })) };
if (!fixturePath.endsWith("-input.json")) throw new Error("Fixture filename must end with -input.json.");
const output = process.argv[3] ?? join("artifacts/benchmarks/optimizer", basename(fixturePath).replace(/-input\.json$/, "-body-audit.json"));
if (resolve(output) === resolve(fixturePath)) throw new Error("Audit output must not overwrite its input fixture.");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(`Head ${heads.length}; old J Body ${legacy.bodies.length}; canonical ${registry.effects.length} → ${registry.automaticEffects.length}; new Body ${next.bodies.length}; saved ${output}\n`);
