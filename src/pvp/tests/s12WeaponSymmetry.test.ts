import { describe, expect, it } from "vitest";
import { CONFIRMED_HERO_SKILL_DEFINITIONS, createHeroSkillSystem, createValidationPreviewState,
  runValidationBattle, type TroopType } from "../../pvp";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { selectSimulationHero } from "../../ui/simulationWeaponSelection";
import { createPersistedEnvelope, restorePersistedConfig } from "../../storage";
import { encodeSimpleShare, decodeSimpleShare } from "../../ui/simpleShare";

describe("A/B S12 full-weapon canonical selection", () => {
  it.each([["shield", "hero.s12.hervor"], ["lancer", "hero.s12.karol"], ["marksman", "hero.s12.ligeia"]] as const)(
    "%s %s writes and runs Lv10 symmetrically", (troop: TroopType, id) => {
      const base = createDefaultValidationInput();
      const a = selectSimulationHero(base.sideA, troop, id), b = selectSimulationHero(base.sideA, troop, id);
      const configured = { ...base, serverStage: "s12" as const, scenarioType: "RALLY" as const,
        battleContext: "rally" as const, attributeInputMode: "prediction" as const, maxRounds: 1,
        sideA: a, sideB: b };
      const restored = restorePersistedConfig(createPersistedEnvelope(configured, 1000)).input;
      expect(restored.sideA.simulationWeaponLevels?.[id]).toBe(10);
      expect(restored.sideB.simulationWeaponLevels?.[id]).toBe(10);
      const share = decodeSimpleShare(encodeSimpleShare(restored, 1000));
      expect(share.input.sideB.simulationWeaponLevels?.[id]).toBe(10);
      const battle = runValidationBattle(restored), initial = createValidationPreviewState(restored);
      expect(battle.heroStatCorrections.A).toEqual(battle.heroStatCorrections.B);
      expect(battle.heroStatCorrections.B?.simulationWeaponContribution).toEqual(battle.heroStatCorrections.A?.simulationWeaponContribution);
      expect(Object.values(battle.heroStatCorrections.B!.simulationWeaponContribution).some((row) => row.penetration > 0 && row.life > 0)).toBe(true);
      const weapon = CONFIRMED_HERO_SKILL_DEFINITIONS.find((s) => s.heroId === id && s.positionRule.kind === "exclusiveWeapon")!;
      for (const side of [initial.sideA, initial.sideB]) {
        expect(side.heroStates.find((h) => h.heroId === id)?.weaponLevel).toBe(10);
        expect(side.heroStates.find((h) => h.heroId === id)?.skillStates.find((s) => s.skillId === weapon.id)).toMatchObject({ enabled: true, level: 5 });
      }
      // Compare identical battle roles: actual Rally A/B scene gates intentionally differ.
      const prepared = createHeroSkillSystem({ definitions: CONFIRMED_HERO_SKILL_DEFINITIONS,
        randomSource: { next: () => .99 } }).prepareRound({ ...initial, battleContext: weapon.battleContexts![0]! }).state;
      const effects = (side: typeof prepared.sideA) => side.armyEffects.filter((e) => e.identity.sourceSkillId === weapon.id).map((e) => e.definition);
      expect(effects(prepared.sideA).length).toBeGreaterThan(0);
      expect(effects(prepared.sideA)).toEqual(effects(prepared.sideB));
    });
  it("preserves explicit Lv0/custom values independently of optimizer full-weapon defaults", () => {
    const base = createDefaultValidationInput().sideB, id = "hero.s12.hervor";
    expect(selectSimulationHero({ ...base, simulationWeaponLevels: { [id]: 0 } }, "shield", id).simulationWeaponLevels?.[id]).toBe(0);
    expect(selectSimulationHero({ ...base, simulationWeaponLevels: { [id]: 7 } }, "shield", id).simulationWeaponLevels?.[id]).toBe(7);
  });
});
