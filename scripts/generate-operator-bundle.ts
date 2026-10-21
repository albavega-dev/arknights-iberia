import { createHash } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { normalizeCharacterTable } from "../src/game-data/operator-import";
import { fixedBiographyRevisions, extractBiography } from "../src/game-data/operator-biography";
import { bundleSha256, validateOperatorBundle, type BundleSource, type OperatorBundle } from "../src/game-data/operator-bundle";
import { getOperatorAdditionalFactionIds, getOperatorMainFactionId } from "../src/game-data/operator-factions";
import { applyRegionalDisplayNames, type RegionalNameEntry } from "../src/game-data/operator-regional-names";

const refs = {
  character: { en: { revision: "3aaa25b649fed5dedad9527602826dc487ea07d8", sha256: "DDAC29AF8BF303D3DFDD92EC7D6C822605EABD0625AE544B97434DE517F9E7C3" }, cn: { revision: "e4888c5b4d9b57aa3bfd4d109ae70f74cf3b7842", sha256: "12652FA249763EA1D1F8F147F2EFE6A98EFEE593F38DBEF471DDBC9A234B70E5" } },
  handbook: { en: { revision: fixedBiographyRevisions.en, sha256: "07077CD529965C57DA1F602028F1CEEC81B43814AF0D8F131DCBED92B04E0498" }, cn: { revision: fixedBiographyRevisions.cn, sha256: "B6E6FA4CAFE118B8C0342E7643A6103775F72C173A43467AEEA22DFBEE01D108" } },
} as const;
type Region = "en" | "cn";
export function source(repository: string, revision: string, path: string, hash: string): BundleSource { return { repository, revision, path, sha256: hash.toLowerCase() }; }
async function hash(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase(); }
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }
type ReleaseEntry = { id: string; cnReleaseDate: string; source: string };
type ReleaseManifest = { coverage?: { verifiedCnDates?: number; unverifiedCnDates?: number }; operators?: ReleaseEntry[] };
type RegionalEntry = RegionalNameEntry & { cnReleaseDate: string | null; globalReleaseDate?: string | null };
type RegionalManifest = { sources?: { releaseTable?: string }; operators?: RegionalEntry[] };
export function arg(name: string, argv: readonly string[] = process.argv): string { const index = argv.indexOf(name); const value = argv[index + 1]; if (index < 0 || !value || value.startsWith("--")) throw new Error(`Missing ${name}`); return value; }
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const previousArgv = process.argv;
  process.argv = [...argv];
  try {
  const enCharacter = arg("--en-character", argv); const cnCharacter = arg("--cn-character", argv); const enHandbook = arg("--en-handbook", argv); const cnHandbook = arg("--cn-handbook", argv); const output = arg("--out", argv);
  if (await stat(output).then(() => true, () => false) && !process.argv.includes("--force")) throw new Error("Output exists; pass --force to overwrite");
  const paths = { enCharacter, cnCharacter, enHandbook, cnHandbook }; const actual = await Promise.all(Object.values(paths).map(hash));
  const expected = [refs.character.en.sha256, refs.character.cn.sha256, refs.handbook.en.sha256, refs.handbook.cn.sha256];
  if (actual.some((value, index) => value !== expected[index])) throw new Error("Snapshot SHA-256 mismatch");
  const [enTable, cnTable, enBook, cnBook] = await Promise.all(Object.values(paths).map(json));
  const regionalManifest = await json("data/operator-regional-manifest.json") as RegionalManifest;
  const regionalEntries = regionalManifest.operators ?? [];
  const en = normalizeCharacterTable(enTable).operators; const cn = normalizeCharacterTable(cnTable).operators.map((item) => ({ ...item, cnOnly: !en.some((candidate) => candidate.id === item.id), availabilityStatus: !en.some((candidate) => candidate.id === item.id) ? "cn-snapshot-candidate" as const : item.availabilityStatus }));
  const enIds = new Set(en.map((item) => item.id)); const cnById = new Map(cn.map((item) => [item.id, item]));
  const operators = applyRegionalDisplayNames([...en, ...cn.filter((item) => !enIds.has(item.id))].map((operator) => {
    const cnOperator = cnById.get(operator.id);
    const isCnOnly = !enIds.has(operator.id);
    return {
      ...operator,
      name: isCnOnly ? cnOperator?.name ?? operator.name : operator.name,
      cnName: cnOperator?.name ?? null,
      globalName: isCnOnly ? null : operator.name,
      mainFactionId: getOperatorMainFactionId(operator.id),
      additionalFactionIds: [...getOperatorAdditionalFactionIds(operator.id)].sort((a, b) => a.localeCompare(b, "en")),
    };
  }), regionalEntries).sort((a, b) => a.id.localeCompare(b.id, "en"));
  const releaseManifest = await json("data/operator-cn-release-manifest.json") as ReleaseManifest;
  const releaseEntries = releaseManifest.operators ?? [];
  if (releaseManifest.coverage?.verifiedCnDates !== releaseEntries.length || releaseManifest.coverage?.unverifiedCnDates !== 0) throw new Error("CN release manifest coverage is not fully reviewed");
  const releaseById = new Map<string, ReleaseEntry>();
  for (const entry of releaseEntries) { if (releaseById.has(entry.id)) throw new Error(`Duplicate CN release manifest ID: ${entry.id}`); releaseById.set(entry.id, entry); }
  const regionalById = new Map<string, RegionalEntry>();
  for (const entry of regionalEntries) { if (regionalById.has(entry.id)) throw new Error(`Duplicate regional manifest ID: ${entry.id}`); regionalById.set(entry.id, entry); }
  const operatorIds = new Set(operators.map((item) => item.id));
  if (releaseById.size + regionalById.size !== operators.length || [...releaseById.keys(), ...regionalById.keys()].some((id) => !operatorIds.has(id)) || [...releaseById.keys()].some((id) => regionalById.has(id)) || [...operatorIds].some((id) => !releaseById.has(id) && !regionalById.has(id))) throw new Error("CN release manifests do not match the generated operator IDs");
  const regionalSource = regionalManifest.sources?.releaseTable;
  if (!regionalSource) throw new Error("Regional manifest is missing its release-table source");
  const datedOperators = operators.map((operator) => { const verified = releaseById.get(operator.id); const regional = regionalById.get(operator.id); if (verified) return { ...operator, cnReleaseDate: verified.cnReleaseDate, cnReleaseDateStatus: "verified" as const, cnReleaseDateSource: verified.source }; if (regional) return { ...operator, cnReleaseDate: regional.cnReleaseDate, globalReleaseDate: regional.globalReleaseDate ?? null, cnReleaseDateStatus: regional.cnReleaseDate === null ? null : "community-listed" as const, cnReleaseDateSource: regional.cnReleaseDate === null ? null : regionalSource }; throw new Error(`Missing CN release metadata for ${operator.id}`); });
  const biographySources = { en: source("ArknightsAssets/ArknightsGamedata", refs.handbook.en.revision, "en/gamedata/excel/handbook_info_table.json", refs.handbook.en.sha256), cn: source("ArknightsAssets/ArknightsGamedata", refs.handbook.cn.revision, "cn/gamedata/excel/handbook_info_table.json", refs.handbook.cn.sha256) };
  const biographies = ([...en.map((item) => [item.id, "en", enBook] as const), ...cn.filter((item) => !enIds.has(item.id)).map((item) => [item.id, "cn", cnBook] as const)]).flatMap(([id, region, book]) => { const record = extractBiography(id, region as Region, book, biographySources[region as Region]); return record ? [record] : []; }).sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en") || a.region.localeCompare(b.region, "en"));
  const body = { contractVersion: "1" as const, sources: { en: source("ArknightsAssets/ArknightsGamedata", refs.character.en.revision, "en/gamedata/excel/character_table.json", refs.character.en.sha256), cn: source("ArknightsAssets/ArknightsGamedata", refs.character.cn.revision, "cn/gamedata/excel/character_table.json", refs.character.cn.sha256) }, biographySources, operators: datedOperators, biographies, coverage: { operators: datedOperators.length, biographies: { en: biographies.filter((item) => item.region === "en").length, cn: biographies.filter((item) => item.region === "cn").length, total: biographies.length } } };
  const bundle: OperatorBundle = { ...body, integrity: { algorithm: "sha256", sha256: bundleSha256(body) } }; const validation = validateOperatorBundle(bundle); if (!validation.ok) throw new Error(validation.issues.map((item) => `${item.path}: ${item.message}`).join("; "));
  const temp = `${output}.${process.pid}.partial`; await writeFile(temp, `${JSON.stringify(bundle, null, 2)}\n`, "utf8"); await rename(temp, output); console.log(`Generated ${operators.length} operators and ${biographies.length} biographies`); console.log(`SHA-256 ${bundle.integrity.sha256}`);
  } finally {
    process.argv = previousArgv;
  }
}
if (process.argv[1]?.endsWith("generate-operator-bundle.ts"))
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Bundle generation failed"); process.exitCode = 1; });
