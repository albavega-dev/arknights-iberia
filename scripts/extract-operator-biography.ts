import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extractBiography, auditBiographies, type BiographyRegion, type HandbookSource } from "../src/game-data/operator-biography";

const expected = {
  en: { revision: "3aaa25b649fed5dedad9527602826dc487ea07d8", sha256: "07077CD529965C57DA1F602028F1CEEC81B43814AF0D8F131DCBED92B04E0498" },
  cn: { revision: "e4888c5b4d9b57aa3bfd4d109ae70f74cf3b7842", sha256: "B6E6FA4CAFE118B8C0342E7643A6103775F72C173A43467AEEA22DFBEE01D108" },
} as const;

async function readJson(path: string) { return JSON.parse(await readFile(path, "utf8")) as unknown; }
async function hash(path: string) { const bytes = await readFile(path); return createHash("sha256").update(bytes).digest("hex").toUpperCase(); }
function arg(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

async function main() {
  const enPath = arg("--en"); const cnPath = arg("--cn"); const enCharacterPath = arg("--en-character"); const manifestPath = arg("--manifest"); const outPath = arg("--out"); const reportPath = arg("--report");
  if (!enPath || !cnPath || !enCharacterPath || !manifestPath || !outPath || !reportPath) throw new Error("Usage: --en HANDBOOK --cn HANDBOOK --en-character CHARACTER_TABLE --manifest FILE --out FILE --report FILE");
  for (const [region, path] of [["en", enPath], ["cn", cnPath]] as const) {
    const actual = await hash(path); if (actual !== expected[region].sha256) throw new Error(`${region} handbook SHA-256 mismatch`);
  }
  const manifest = await readJson(manifestPath) as { operators?: { id: string }[] };
  const cnIds = new Set((manifest.operators ?? []).map((operator) => operator.id));
  const enTable = await readJson(enCharacterPath) as Record<string, unknown>;
  const enIds = Object.keys(enTable).filter((id) => id.startsWith("char_") && (enTable[id] as Record<string, unknown>)?.isNotObtainable === false && typeof (enTable[id] as Record<string, unknown>)?.name === "string" && ["WARRIOR", "PIONEER", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"].includes(String((enTable[id] as Record<string, unknown>)?.profession)) && Array.isArray((enTable[id] as Record<string, unknown>)?.phases) && /^TIER_[1-6]$/.test(String((enTable[id] as Record<string, unknown>)?.rarity)));
  if (enIds.length !== 415 || cnIds.size !== 17) throw new Error(`Expected 415 EN and 17 CN-only IDs, got ${enIds.length} and ${cnIds.size}`);
  const overlap = enIds.filter((id) => cnIds.has(id)); if (overlap.length) throw new Error(`Regional overlap: ${overlap.join(", ")}`);
  const sources: Record<BiographyRegion, HandbookSource> = {
    en: { repository: "ArknightsAssets/ArknightsGamedata", revision: expected.en.revision, path: "en/gamedata/excel/handbook_info_table.json", sha256: expected.en.sha256 },
    cn: { repository: "ArknightsAssets/ArknightsGamedata", revision: expected.cn.revision, path: "cn/gamedata/excel/handbook_info_table.json", sha256: expected.cn.sha256 },
  };
  const enHandbook = await readJson(enPath); const cnHandbook = await readJson(cnPath); const records = [];
  for (const id of enIds) { const record = extractBiography(id, "en", enHandbook, sources.en); if (!record) throw new Error(`Missing EN Basic Info: ${id}`); records.push(record); }
  for (const id of cnIds) { const record = extractBiography(id, "cn", cnHandbook, sources.cn); if (!record) throw new Error(`Missing CN Basic Info: ${id}`); records.push(record); }
  const audit = auditBiographies(records, [...enIds, ...cnIds]);
  const enAudit = auditBiographies(records.filter((record) => record.region === "en"), enIds);
  const cnAudit = auditBiographies(records.filter((record) => record.region === "cn"), [...cnIds]);
  const unknownLabels = [...new Set(records.flatMap((record) => record.fields.filter((field) => field.key.startsWith("unrecognized:")).map((field) => `${record.region}:${field.label}`)))].sort();
  await writeFile(outPath, JSON.stringify({ sources, records }, null, 2) + "\n", "utf8");
  await writeFile(reportPath, `# Operator biography extraction audit\n\n- EN operators: ${enIds.length}\n- CN-only operators: ${cnIds.size}\n- Extracted biographies: ${records.length}\n- Missing: ${audit.missing.length}\n- Unexpected: ${audit.unexpected.length}\n\n## Coverage by region\n\n### EN\n\n${Object.entries(enAudit.coverage).sort().map(([key, count]) => `- ${key}: ${count}/${enIds.length}`).join("\n")}\n\n### CN\n\n${Object.entries(cnAudit.coverage).sort().map(([key, count]) => `- ${key}: ${count}/${cnIds.size}`).join("\n")}\n\nCoverage counts are computed from non-empty original fields; values and labels are not translated.\n\n## Unrecognized labels\n\n${unknownLabels.length ? unknownLabels.map((label) => `- ${label}`).join("\n") : "- None"}\n\n## Sources\n\n- EN: ${sources.en.revision}, ${sources.en.sha256}\n- CN: ${sources.cn.revision}, ${sources.cn.sha256}\n`, "utf8");
}

if (process.argv[1]?.endsWith("extract-operator-biography.ts")) void main();
