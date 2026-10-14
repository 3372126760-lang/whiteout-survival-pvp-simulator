import { describe, expect, it } from "vitest";
import { createDefaultValidationInput } from "../../ui/defaultInput";
import { initializeOptimizationHeroPool, optimizationHeroIds, setOptimizationPoolEnabled,
  setOwnedHero } from "../optimizer/heroPools";

const first = "hero.s11.eleonora", second = "hero.s11.lloyd";
const fixture = () => ({ ...createDefaultValidationInput(), ownedHeroIds: [first],
  optimizerHeroPool: {
    A: { [first]: { enabled: true, weaponLevel: 6 }, [second]: { enabled: true, weaponLevel: 4 } },
    B: { [first]: { enabled: true, weaponLevel: 2 }, [second]: { enabled: true, weaponLevel: 8 } },
  } });

describe("separate ownership and optimizer participation", () => {
  it("disables unowned saved entries on both sides without losing weapon levels", () => {
    const input = initializeOptimizationHeroPool(fixture());
    expect(input.optimizerHeroPool!.A![second]).toEqual({ enabled: false, weaponLevel: 4 });
    expect(input.optimizerHeroPool!.B![second]).toEqual({ enabled: false, weaponLevel: 8 });
    expect(optimizationHeroIds(input)).toEqual([first]);
  });
  it("select all changes only owned legal participation on the selected side", () => {
    const source = initializeOptimizationHeroPool(fixture());
    const cleared = setOptimizationPoolEnabled(source, "A", false);
    const selected = setOptimizationPoolEnabled(cleared, "A", true);
    expect(selected.ownedHeroIds).toEqual(source.ownedHeroIds);
    expect(selected.optimizerHeroPool!.A![first]).toEqual({ enabled: true, weaponLevel: 6 });
    expect(selected.optimizerHeroPool!.A![second]).toEqual({ enabled: false, weaponLevel: 4 });
    expect(selected.optimizerHeroPool!.B).toEqual(source.optimizerHeroPool!.B);
  });
  it("cannot enable an unowned hero by a direct event", () => {
    const input = setOptimizationPoolEnabled(fixture(), "A", true, second);
    expect(input.optimizerHeroPool!.A![second]).toEqual({ enabled: false, weaponLevel: 4 });
    expect(input.ownedHeroIds).toEqual([first]);
  });
  it("removing and reacquiring ownership preserves weapons without automatically re-enabling", () => {
    const removed = setOwnedHero(fixture(), first, false);
    for (const side of ["A", "B"] as const) expect(removed.optimizerHeroPool![side]![first]!.enabled).toBe(false);
    const restored = setOwnedHero(removed, first, true);
    expect(restored.optimizerHeroPool!.A![first]).toEqual({ enabled: false, weaponLevel: 6 });
    expect(restored.optimizerHeroPool!.B![first]).toEqual({ enabled: false, weaponLevel: 2 });
  });
});
