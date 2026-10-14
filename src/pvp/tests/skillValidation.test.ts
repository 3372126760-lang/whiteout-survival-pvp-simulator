import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createSkillValidationCase,
  runSkillValidationCase,
  validateSkillValidationFixture,
  type SkillValidationFixture,
} from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";

const caseDirectory = fileURLToPath(
  new URL("../validation/cases/", import.meta.url),
);

describe("automated skill validation cases", () => {
  it("loads the versioned rapid-fire, ambush, crystal-spear and shield-wall fixtures", () => {
    const files = readdirSync(caseDirectory).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual([
      "ambush.json",
      "crystal-spear.json",
      "rapid-fire.json",
      "shield-wall.json",
    ]);
    for (const file of files) {
      expect(() => validateSkillValidationFixture(readFixture(file))).not.toThrow();
    }
  });

  it("generates paired Rapid Fire inputs with only the A target skill on AUTO", () => {
    const validationCase = createSkillValidationCase(
      readFixture("rapid-fire.json"),
      createDefaultValidationInput(),
    );
    const key = "A:marksman:marksman-rapid-fire";
    expect(validationCase.targetOverrideKeys).toEqual([key]);
    expect(validationCase.baselineInput.triggerOverrides[key]).toBe(
      "FORCE_NOT_TRIGGER",
    );
    expect(validationCase.skillInput.triggerOverrides[key]).toBeUndefined();
    expect(
      validationCase.skillInput.triggerOverrides[
        "B:marksman:marksman-rapid-fire"
      ],
    ).toBe("FORCE_NOT_TRIGGER");
    expect(validationCase.baselineInput.randomSeed).toBe(
      validationCase.skillInput.randomSeed,
    );
  });

  it("accepts Rapid Fire probability, check timing and skill isolation", () => {
    const fixture = readFixture("rapid-fire.json");
    const relaxedFixture: SkillValidationFixture = {
      ...fixture,
      probability: {
        ...fixture.probability!,
        absoluteTolerance: 0.05,
      },
    };
    const report = runSkillValidationCase(
      createSkillValidationCase(relaxedFixture, createDefaultValidationInput()),
      1_000,
    );
    expect(report.probability?.probabilityCheckCount).toBe(1_000);
    expect(report.probability?.theoreticalProbability).toBe(0.1);
    expect(report.nonTargetProbabilitySuccessCount).toBe(0);
    expect(report.passed).toBe(true);
  }, 20_000);

  it("builds a deterministic impact baseline by disabling only the target skill", () => {
    const validationCase = createSkillValidationCase(
      readFixture("shield-wall.json"),
      createDefaultValidationInput(),
    );
    expect(validationCase.baselineInput.disabledSkillIds).toContain(
      "shield-immortal-wall-t12",
    );
    expect(validationCase.skillInput.disabledSkillIds).not.toContain(
      "shield-immortal-wall-t12",
    );
    const report = runSkillValidationCase(validationCase, 10);
    expect(report.probability).toBeNull();
    expect(report.nonTargetProbabilitySuccessCount).toBe(0);
    expect(Number.isFinite(report.impact.averageRemainingIncrease)).toBe(true);
    expect(Number.isFinite(report.impact.averageEnemyDamageChange)).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("reports paired deltas from the baseline and single-skill batches", () => {
    const report = runSkillValidationCase(
      createSkillValidationCase(
        {
          ...readFixture("crystal-spear.json"),
          probability: {
            theoretical: 0.15,
            absoluteTolerance: 1,
            expectedChecksPerTrial: 1,
          },
        },
        createDefaultValidationInput(),
      ),
      50,
    );
    const side = report.fixture.targetSide;
    expect(report.impact.averageDamageIncrease).toBeCloseTo(
      report.skill.averageDamage[side] - report.baseline.averageDamage[side],
      12,
    );
    expect(report.impact.averageRemainingIncrease).toBeCloseTo(
      report.skill.expectedRemaining[side].total -
        report.baseline.expectedRemaining[side].total,
      12,
    );
    expect(report.impact.averageRoundsChange).toBeCloseTo(
      report.skill.averageRounds - report.baseline.averageRounds,
      12,
    );
  });
});

function readFixture(file: string): SkillValidationFixture {
  return JSON.parse(
    readFileSync(`${caseDirectory}/${file}`, "utf8"),
  ) as SkillValidationFixture;
}
