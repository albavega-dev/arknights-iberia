import { createHash } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { normalizeCharacterTable } from "../src/game-data/operator-import";
import { extractBiography, type OperatorBiography } from "../src/game-data/operator-biography";
import { bundleSha256, validateOperatorBundle, type BundleSource, type OperatorBundle } from "../src/game-data/operator-bundle";
import { isReleaseDateProvenance, type ReleaseDateProvenance } from "../src/game-data/operator-catalog";
import { getOperatorAdditionalFactionIds, getOperatorMainFactionId } from "../src/game-data/operator-factions";
import { applyRegionalDisplayNames, type RegionalNameEntry } from "../src/game-data/operator-regional-names";
import type { OperatorRecord } from "../src/game-data/operators";
import { gameDataHandbookTableHashes, gameDataRepository, gameDataRevisions, gameDataTableHashes } from "../src/game-data/gamedata-revisions";

const refs = {
  character: { en: { revision: gameDataRevisions.en, sha256: gameDataTableHashes.en.character_table }, cn: { revision: gameDataRevisions.cn, sha256: gameDataTableHashes.cn.character_table } },
  handbook: { en: { revision: gameDataRevisions.en, sha256: gameDataHandbookTableHashes.en.handbook_info_table }, cn: { revision: gameDataRevisions.cn, sha256: gameDataHandbookTableHashes.cn.handbook_info_table } },
} as const;
type Region = "en" | "cn";
export function source(repository: string, revision: string, path: string, hash: string): BundleSource { return { repository, revision, path, sha256: hash.toLowerCase() }; }
async function hash(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase(); }
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }
type ReleaseEntry = { id: string; cnReleaseDate: string; status: unknown; source: string };
export type ReleaseManifest = { coverage?: { datedCnDates?: number; undatedCnDates?: number }; operators?: ReleaseEntry[] };
type RegionalEntry = RegionalNameEntry & { cnReleaseDate: string | null; globalReleaseDate?: string | null; cnReleaseDateProvenance?: unknown };
export type RegionalManifest = { sources?: { releaseTable?: string }; operators?: RegionalEntry[] };
export type CatalogTables = Readonly<{ enCharacter: unknown; cnCharacter: unknown; enHandbook: unknown; cnHandbook: unknown }>;
export type CatalogTableHashes = Readonly<{ character: Readonly<Record<Region, string>>; handbook: Readonly<Record<Region, string>> }>;
export type CatalogRecords = { sources: Record<Region, BundleSource>; biographySources: Record<Region, BundleSource>; operators: OperatorRecord[]; biographies: OperatorBiography[] };
const pinnedHashes: CatalogTableHashes = { character: { en: refs.character.en.sha256, cn: refs.character.cn.sha256 }, handbook: { en: refs.handbook.en.sha256, cn: refs.handbook.cn.sha256 } };
export function arg(name: string, argv: readonly string[] = process.argv): string { const index = argv.indexOf(name); const value = argv[index + 1]; if (index < 0 || !value || value.startsWith("--")) throw new Error(`Missing ${name}`); return value; }

/** Snapshot tables passed with --en-character, --cn-character, --en-handbook and --cn-handbook, checked against the pinned hashes. */
export async function readCatalogTables(argv: readonly string[], hashes: CatalogTableHashes = pinnedHashes): Promise<CatalogTables> {
  const paths = [arg("--en-character", argv), arg("--cn-character", argv), arg("--en-handbook", argv), arg("--cn-handbook", argv)];
  const expected = [hashes.character.en, hashes.character.cn, hashes.handbook.en, hashes.handbook.cn];
  const actual = await Promise.all(paths.map(hash));
  if (actual.some((value, index) => value !== expected[index]!.toUpperCase())) throw new Error("Snapshot SHA-256 mismatch");
  const [enCharacter, cnCharacter, enHandbook, cnHandbook] = await Promise.all(paths.map(json));
  return { enCharacter, cnCharacter, enHandbook, cnHandbook };
}

/** Operators with names, factions and CN release metadata from the manifests, and their biographies. */
export function buildCatalogRecords(tables: CatalogTables, releaseManifest: ReleaseManifest, regionalManifest: RegionalManifest, hashes: CatalogTableHashes = pinnedHashes): CatalogRecords {
  const regionalEntries = regionalManifest.operators ?? [];
  const en = normalizeCharacterTable(tables.enCharacter).operators; const cn = normalizeCharacterTable(tables.cnCharacter).operators.map((item) => ({ ...item, cnOnly: !en.some((candidate) => candidate.id === item.id), availabilityStatus: !en.some((candidate) => candidate.id === item.id) ? "cn-snapshot-candidate" as const : item.availabilityStatus }));
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
  const releaseEntries = releaseManifest.operators ?? [];
  if (releaseManifest.coverage?.datedCnDates !== releaseEntries.length || releaseManifest.coverage?.undatedCnDates !== 0) throw new Error("CN release manifest coverage is not fully reviewed");
  const releaseById = new Map<string, ReleaseEntry>();
  for (const entry of releaseEntries) {
    if (releaseById.has(entry.id)) throw new Error(`Duplicate CN release manifest ID: ${entry.id}`);
    if (!isReleaseDateProvenance({ status: entry.status, source: entry.source })) throw new Error(`Invalid CN release date provenance for ${entry.id}`);
    releaseById.set(entry.id, entry);
  }
  const regionalById = new Map<string, RegionalEntry>();
  for (const entry of regionalEntries) { if (regionalById.has(entry.id)) throw new Error(`Duplicate regional manifest ID: ${entry.id}`); regionalById.set(entry.id, entry); }
  const operatorIds = new Set(operators.map((item) => item.id));
  if (releaseById.size + regionalById.size !== operators.length || [...releaseById.keys(), ...regionalById.keys()].some((id) => !operatorIds.has(id)) || [...releaseById.keys()].some((id) => regionalById.has(id)) || [...operatorIds].some((id) => !releaseById.has(id) && !regionalById.has(id))) throw new Error("CN release manifests do not match the generated operator IDs");
  const regionalSource = regionalManifest.sources?.releaseTable;
  if (!regionalSource) throw new Error("Regional manifest is missing its release-table source");
  const regionalDate = (operator: OperatorRecord, regional: RegionalEntry): OperatorRecord => {
    // A per-operator provenance replaces the manifest's common source and is only valid on a dated entry.
    if (regional.cnReleaseDateProvenance !== undefined && (!isReleaseDateProvenance(regional.cnReleaseDateProvenance) || regional.cnReleaseDate === null)) throw new Error(`Invalid CN release date provenance for ${operator.id}`);
    const provenance = regional.cnReleaseDateProvenance as ReleaseDateProvenance | undefined;
    const dated = regional.cnReleaseDate !== null;
    return { ...operator, cnReleaseDate: regional.cnReleaseDate, globalReleaseDate: regional.globalReleaseDate ?? null, cnReleaseDateStatus: dated ? provenance?.status ?? "community-listed" : null, cnReleaseDateSource: dated ? provenance?.source ?? regionalSource : null };
  };
  const datedOperators = operators.map((operator): OperatorRecord => { const verified = releaseById.get(operator.id); const regional = regionalById.get(operator.id); if (verified) return { ...operator, cnReleaseDate: verified.cnReleaseDate, cnReleaseDateStatus: verified.status as ReleaseDateProvenance["status"], cnReleaseDateSource: verified.source }; if (regional) return regionalDate(operator, regional); throw new Error(`Missing CN release metadata for ${operator.id}`); });
  const biographySources = { en: source(gameDataRepository, refs.handbook.en.revision, "en/gamedata/excel/handbook_info_table.json", hashes.handbook.en), cn: source(gameDataRepository, refs.handbook.cn.revision, "cn/gamedata/excel/handbook_info_table.json", hashes.handbook.cn) };
  const biographies = ([...en.map((item) => [item.id, "en", tables.enHandbook] as const), ...cn.filter((item) => !enIds.has(item.id)).map((item) => [item.id, "cn", tables.cnHandbook] as const)]).flatMap(([id, region, book]) => { const record = extractBiography(id, region as Region, book, biographySources[region as Region]); return record ? [record] : []; }).sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en") || a.region.localeCompare(b.region, "en"));
  const sources = { en: source(gameDataRepository, refs.character.en.revision, "en/gamedata/excel/character_table.json", hashes.character.en), cn: source(gameDataRepository, refs.character.cn.revision, "cn/gamedata/excel/character_table.json", hashes.character.cn) };
  return { sources, biographySources, operators: datedOperators, biographies };
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const previousArgv = process.argv;
  process.argv = [...argv];
  try {
  arg("--en-character", argv); arg("--cn-character", argv); arg("--en-handbook", argv); arg("--cn-handbook", argv); const output = arg("--out", argv);
  if (await stat(output).then(() => true, () => false) && !process.argv.includes("--force")) throw new Error("Output exists; pass --force to overwrite");
  const tables = await readCatalogTables(argv);
  const { sources, biographySources, operators: datedOperators, biographies } = buildCatalogRecords(tables, await json("data/operator-cn-release-manifest.json") as ReleaseManifest, await json("data/operator-regional-manifest.json") as RegionalManifest);
  const body = { contractVersion: "1" as const, sources, biographySources, operators: datedOperators, biographies, coverage: { operators: datedOperators.length, biographies: { en: biographies.filter((item) => item.region === "en").length, cn: biographies.filter((item) => item.region === "cn").length, total: biographies.length } } };
  const bundle: OperatorBundle = { ...body, integrity: { algorithm: "sha256", sha256: bundleSha256(body) } }; const validation = validateOperatorBundle(bundle); if (!validation.ok) throw new Error(validation.issues.map((item) => `${item.path}: ${item.message}`).join("; "));
  const temp = `${output}.${process.pid}.partial`; await writeFile(temp, `${JSON.stringify(bundle, null, 2)}\n`, "utf8"); await rename(temp, output); console.log(`Generated ${datedOperators.length} operators and ${biographies.length} biographies`); console.log(`SHA-256 ${bundle.integrity.sha256}`);
  } finally {
    process.argv = previousArgv;
  }
}
if (process.argv[1]?.endsWith("generate-operator-bundle.ts"))
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Bundle generation failed"); process.exitCode = 1; });
