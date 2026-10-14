import { readFileSync, writeFileSync } from "node:fs";
import console from "node:console";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const template = readFileSync(new URL("docs/pvp-model-core-and-skills-template.md", root), "utf8");
const inventory = readFileSync(new URL("hero_skill_inventory.md", root), "utf8");
const start = inventory.indexOf("## 口径与注意事项");
const end = inventory.lastIndexOf("## 数据来源");
if (start < 0 || end <= start || !template.includes("<!-- HERO_DATABASE -->")) {
  throw new Error("Hero inventory or report template has changed its expected structure.");
}

let database = inventory.slice(start, end).trim();
database = database.replace(/^(#{2,5})(?= )/gm, (_, hashes) => `${hashes}#`);
database = database.replace(
  /(- \*\*验证状态（战报口径）\*\*：)\*\*(confirmed|provisional|unverified)\*\*/g,
  (_, lead, status) => `${lead}${status === "confirmed" ? "✅" : "⚠️"} **${status}**`,
);

const skillRows = [...database.matchAll(/^##### \d+\. /gm)].length;
const heroRows = [...database.matchAll(/^#### [^#\n]+（[^\n]*`hero\./gm)].length;
const generations = [...database.matchAll(/^### S(\d+)$/gm)].map((match) => Number(match[1]));
const flaggedRows = [...database.matchAll(/^- \*\*验证状态（战报口径）\*\*：(?:✅|⚠️)/gm)].length;
if (skillRows !== 204 || heroRows !== 62 || flaggedRows !== skillRows ||
    generations.length !== 16 || generations.some((value, index) => value !== index + 1)) {
  throw new Error(`Incomplete hero inventory: skills=${skillRows}, heroes=${heroRows}, flags=${flaggedRows}, seasons=${generations.join(",")}`);
}

const output = fileURLToPath(new URL("PVP_MODEL_CORE_AND_HERO_SKILLS.md", root));
const rootRelativeTemplate = template
  .replaceAll("](../src/", "](src/")
  .replaceAll("](pvp-troop-level-rules.md)", "](docs/pvp-troop-level-rules.md)")
  .replaceAll("](../hero_skill_inventory.md)", "](hero_skill_inventory.md)")
  .replaceAll("](../S8_RULE_MIGRATION_2026-09-27.md)", "](S8_RULE_MIGRATION_2026-09-27.md)")
  .replaceAll("](../S9_S10_RULE_MIGRATION_2026-09-27.md)", "](S9_S10_RULE_MIGRATION_2026-09-27.md)")
  .replaceAll("](../S11_RULE_MIGRATION_2026-09-27.md)", "](S11_RULE_MIGRATION_2026-09-27.md)")
  .replaceAll("](../S12_S16_RULE_MIGRATION_2026-09-27.md)", "](S12_S16_RULE_MIGRATION_2026-09-27.md)")
  .replaceAll("](../PVP_RULE_MIGRATION_2026-09-27.md)", "](PVP_RULE_MIGRATION_2026-09-27.md)")
  .replaceAll("](../PVP_RULE_MIGRATION_2026-09-26.md)", "](PVP_RULE_MIGRATION_2026-09-26.md)");
writeFileSync(output, rootRelativeTemplate.replace("<!-- HERO_DATABASE -->", database) + "\n", "utf8");
console.log(`Wrote ${output}; heroes=${heroRows}, skills=${skillRows}, seasons=S1-S16`);
