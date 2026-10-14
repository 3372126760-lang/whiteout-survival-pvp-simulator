import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createLegacyBodySearchPool } from "../optimizer/criterion/bodyEnumeration";
import { getAvailableMemberSkills } from "../validationUi";

describe("Criterion-disabled legacy body-domain memory safety", () => {
  it("uses the complete S11 B0 domain without materializing millions of ordered identity rows or running formal battles", () => {
    const input = { ...createDefaultValidationInput(), serverStage: "s11" as const };
    const pool = createLegacyBodySearchPool(input, {}, {});
    const sourceSkillCount = getAvailableMemberSkills("s11").reduce((count, option) => count + option.sourceSkillIds.length, 0);
    expect(pool.audit.sourceSkillCount).toBe(sourceSkillCount);
    expect(pool.audit.rawBodyCombinationCount).toBe(pool.audit.sourceSkillCount ** 4);
    expect(pool.audit.afterSameEffectMax2 + pool.audit.rejectedDuringGenerationBySameEffectFamily)
      .toBe(pool.audit.rawBodyCombinationCount);
    expect(pool.rows.length).toBe(pool.audit.finalPreprocessedBodyCount);
    expect(pool.rows.length).toBeLessThan(pool.audit.afterProbabilityDominance / 20);
    expect(pool.rows.every((row) => row.bodySlots.length === 4 && new Set(row.bodySlots.map((slot) => slot.runtimeInstanceId)).size === 4)).toBe(true);
    expect(pool.audit.formalSeedOrderEquivalenceClaimed).toBe(false);
    expect(pool.audit.rejectedBySemanticEquivalence).toBeGreaterThan(0);
    expect(pool.audit.semanticMergeReasons.length).toBeGreaterThan(0);
  }, 30_000);
});
