import { writeFileSync } from "node:fs";
import { createDefaultValidationInput } from "../src/ui/defaultInput";
import { getValidationCatalog } from "../src/pvp/validationUi";
import { isHeroAvailableAtStage } from "../src/pvp/progression";
import { buildHeroPoolAudit } from "../src/pvp/optimizer/heroSearchPolicy";
const input = { ...createDefaultValidationInput(), serverStage: "s11" as const };
const audit = buildHeroPoolAudit(input, getValidationCatalog().leaderHeroes.filter((hero) => isHeroAvailableAtStage(hero, "s11")));
writeFileSync("examples/optimizer-hero-pool-audit.json", JSON.stringify(audit, null, 2), "utf8");
process.stdout.write(JSON.stringify({ counts: audit.counts, rarityFilteredHeroes: audit.rarityFilteredHeroes,
 strict: audit.dominanceRelations.filter((r) => r.status === "strictlyDominated"),
 likely: audit.dominanceRelations.filter((r) => r.status === "likelyDominated"),
 remaining: audit.optimizerHeroPoolAfterFilter.length })+"\n");
