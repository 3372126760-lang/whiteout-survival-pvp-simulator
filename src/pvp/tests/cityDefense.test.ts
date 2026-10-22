import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { createValidationPreviewState, runValidationBattle, toEngineScenario } from "../validationUi/adapter";
import { runBatchSimulation } from "../validationUi/batchSimulation";
import { getValidationCatalog } from "../validationUi/catalog";
import type { ValidationBattleInput } from "../validationUi/types";
import { normalizeBattleInputPolicy } from "../validationUi/inputPolicy";

function input(): ValidationBattleInput {
  return { ...createDefaultValidationInput(), scenarioType: "CITY_DEFENSE", battleContext: "cityDefense",
    attributeInputMode: "prediction", simulationMode: "fixedSeed", randomSeed: 12345, maxRounds: 3 };
}

describe("city defense", () => {
  it("enables defensive weapons only for B and rejects attack-only weapons", () => {
    const base = input();
    const side = { ...base.sideA, leaderHeroIds: { shield: "hero.s3.luogen", lancer: "hero.s3.miya" },
      simulationWeaponLevels: { "hero.s3.luogen": 10, "hero.s3.miya": 10 } };
    const result = runValidationBattle({ ...base, sideA: side, sideB: side });
    const traces = result.trace.rounds.flatMap(r => r.heroSkills);
    expect(traces.some(t => t.side === "B" && t.skillId === "hero-weapon-skill.luogen.defense-defense" && t.triggered)).toBe(true);
    expect(traces.some(t => t.side === "A" && t.skillId.startsWith("hero-weapon-skill.") && t.triggered)).toBe(false);
    expect(traces.some(t => t.skillId === "hero-weapon-skill.miya.rally-attack" && t.triggered)).toBe(false);
  });

  it("keeps four defending body slots and ignores attacker body slots without using rally capacity", () => {
    const base = input();
    const skill = getValidationCatalog().memberSkills[0]!.skillId;
    const side = { ...base.sideA, selectedMemberSkillIds: [skill, skill, skill, skill],
      rallyDeployment: { totalTroops: 1800000, ratios: { shield: 49, lancer: 1, marksman: 50 } } };
    const scenario = toEngineScenario({ ...base, sideA: side, sideB: side });
    expect(scenario.sideA.heroes?.filter(h => h.position === "member")).toHaveLength(0);
    expect(scenario.sideB.heroes?.filter(h => h.position === "member")).toHaveLength(4);
    expect(scenario.sideB.shield.count).toBe(scenario.sideA.shield.count);
  });

  it("adds territory attack and defense to B only and preserves other attributes", () => {
    const base = input();
    const off = createValidationPreviewState(base);
    const on = createValidationPreviewState({ ...base, defenderInTerritory: true });
    expect(on.sideA).toEqual(off.sideA);
    const before = off.sideB.troops.shield.reportAttributeContext!;
    const after = on.sideB.troops.shield.reportAttributeContext!;
    expect(after.attack.targetBuff - before.attack.targetBuff).toBeCloseTo(.1);
    expect(after.defense.targetBuff - before.defense.targetBuff).toBeCloseTo(.1);
    expect(after.penetration).toEqual(before.penetration);
    expect(after.life).toEqual(before.life);
    const single = { ...base, scenarioType: "SINGLE" as const };
    expect(createValidationPreviewState({ ...single, defenderInTerritory: true })).toEqual(createValidationPreviewState(single));
  });

  it("uses furnace attacker and normal defender casualty rules regardless of the legacy selector", () => {
    const result = runValidationBattle({ ...input(), postBattleCasualtyMode: "FURNACE" });
    expect(result.postBattleCasualties.A.mode).toBe("FURNACE");
    expect(result.postBattleCasualties.B.mode).toBe("NORMAL");
    expect(result.postBattleCasualties.B.total.loss).toBe(0);
    const batch = runBatchSimulation(input(), 1);
    expect(batch.skillDamageStatistics?.casualtyModeByTargetSide).toEqual({ A: "FURNACE", B: "NORMAL" });
  });

  it("roundtrips the scene and territory switch and applies independent T12 limits", () => {
    const base = input();
    const troops = Object.fromEntries(Object.entries(base.sideA.troops).map(([t,r]) => [t,{ ...r,t12Level:24 }])) as typeof base.sideA.troops;
    const normalized = normalizeBattleInputPolicy({ ...base, sideA:{...base.sideA,troops},sideB:{...base.sideB,troops} });
    expect(normalized.sideA.troops.shield.t12Level).toBe(3);
    expect(normalized.sideB.troops.shield.t12Level).toBe(24);
    const restored = restorePersistedConfig(createPersistedEnvelope({ ...normalized, defenderInTerritory: true }, 10)).input;
    expect(restored.scenarioType).toBe("CITY_DEFENSE");
    expect(restored.battleContext).toBe("cityDefense");
    expect(restored.defenderInTerritory).toBe(true);
  });
});
