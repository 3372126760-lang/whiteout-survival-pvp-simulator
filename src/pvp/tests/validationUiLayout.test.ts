import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import {
  copySideAToB,
  swapBattleSides,
} from "../../ui/sideConfigActions";

describe("validation UI side-by-side layout", () => {
  it("copies the complete A-side configuration to B without shared nested state", () => {
    const original = createDefaultValidationInput();
    const copied = copySideAToB(original);

    expect(copied.sideB).toEqual(original.sideA);
    expect(copied.sideB).not.toBe(original.sideA);
    expect(copied.sideB.troops).not.toBe(original.sideA.troops);
    expect(copied.sideA).toBe(original.sideA);
    expect(copied.maxRounds).toBe(original.maxRounds);
    expect(copied.battleContext).toBe(original.battleContext);
  });

  it("swaps A and B configurations while preserving global battle controls", () => {
    const original = createDefaultValidationInput();
    const swapped = swapBattleSides(original);

    expect(swapped.sideA).toEqual(original.sideB);
    expect(swapped.sideB).toEqual(original.sideA);
    expect(swapped.sideA).not.toBe(original.sideB);
    expect(swapped.sideB).not.toBe(original.sideA);
    expect(swapped.randomSeed).toBe(original.randomSeed);
    expect(swapped.maxRounds).toBe(original.maxRounds);
  });

  it("renders both sides with identical ordered sections and UI-only side actions", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../ui/main.ts", import.meta.url)),
      "utf8",
    );
    const orderedSections = [
      "出征部队 · 士兵实力对比",
      "属性加成 · 战报百分比",
      "历史战报英雄",
      "当前模拟英雄",
      "车身技能",
      "T12 兵种技能等级",
      "历史报告与当前战斗加成",
      "预期战报加成",
    ];
    let cursor = source.indexOf("function renderSide(");
    for (const section of orderedSections) {
      const next = source.indexOf(`"${section}"`, cursor);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(source).toContain('data-action="copy-a-to-b"');
    expect(source).toContain('data-action="swap-sides"');
    expect(source).toContain('renderSelectedHeroWeapon(scope, sideId, side, selected)');
    expect(source).not.toContain('renderSideSection("专武等级"');
    expect(source).toContain('const sideRole = optimizationTargetLabel(input.scenarioType, sideId)');
    expect(source).not.toContain('sideId === "A" ? "挑战方" : "防守方"');
  });

  it("keeps equal desktop columns through 1000px and stacks below 900px", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../../ui/styles.css", import.meta.url)),
      "utf8",
    );

    expect(css).toMatch(/\.config-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/s);
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).not.toContain("@media (max-width: 1100px)");
    expect(css).toContain(".side-a > .panel-head { box-shadow: inset 4px 0 0 var(--amber);");
    expect(css).toContain(".side-b > .panel-head { box-shadow: inset 4px 0 0 var(--cyan);");
  });
});
