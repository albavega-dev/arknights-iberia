import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gameDataRepository, gameDataRevisions, gameDataTableHashes, type GameDataRegion, type GameDataTable } from "../src/game-data/gamedata-revisions";
import { datasetContractVersion, statsDatasetContractVersion, validateDatasetIndex, type DatasetFile, type DatasetIndex } from "../src/game-data/operator-dataset";
import { buildOperatorTrait } from "../src/game-data/operator-modules";
import { applyRevisionChanges, arg, changedFields, exists, operatorDatasetFile, readCatalog, readJson as json, reportVerification, revisionChanges, sha256, tableFlag, verificationMode, verifyUpdate, writeDatasetDirectory, type DatasetVerification } from "./operator-dataset-io";
import { attachModuleStats, extractOperatorStatsProfiles, type OperatorStatsProfile } from "../src/game-data/operator-stats";

export const statsDatasetName = "operator-stats";
const regions: readonly GameDataRegion[] = ["en", "cn"];
const tables: readonly GameDataTable[] = ["character_table", "uniequip_table", "battle_equip_table"];

type StatsSource = OperatorStatsProfile["source"];
export type StatsDatasetProfile = Omit<OperatorStatsProfile, "source">;
export type StatsDataset = { contractVersion: "2" | "3"; sources: Record<GameDataRegion, StatsSource>; profiles: StatsDatasetProfile[] };
export type StatsGeneratorOptions = Readonly<{
  expectedHashes?: Readonly<Record<GameDataRegion, Readonly<Record<GameDataTable, string>>>>;
  releaseManifest?: string;
  regionalManifest?: string;
  catalogSize?: number;
  limits?: Readonly<{ fileBytes: number; totalBytes: number }>;
}>;
export type StatsVerification = DatasetVerification;

export { arg, readCatalog, tableFlag };

export function buildStatsDataset(input: Readonly<Record<GameDataRegion, Readonly<Record<GameDataTable, unknown>>>>, catalog: ReadonlyMap<string, GameDataRegion>, sources: Record<GameDataRegion, StatsSource>): StatsDataset {
  const profiles: StatsDatasetProfile[] = [];
  for (const region of regions) {
    const wanted = new Set([...catalog].filter(([, value]) => value === region).map(([id]) => id));
    const extracted = extractOperatorStatsProfiles(input[region].character_table, region, sources[region]).filter((profile) => wanted.has(profile.operatorId));
    const found = new Set(extracted.map((profile) => profile.operatorId));
    const missing = [...wanted].filter((id) => !found.has(id));
    if (missing.length) throw new Error(`Catalog operators missing from the ${region} character table: ${missing.join(", ")}`);
    const characters = input[region].character_table as Record<string, Parameters<typeof buildOperatorTrait>[1]>;
    const withTraits = extracted.map((profile) => ({ ...profile, trait: buildOperatorTrait(profile.operatorId, characters[profile.operatorId]!) }));
    for (const profile of attachModuleStats(withTraits, input[region].uniequip_table, input[region].battle_equip_table, region)) { const { source, ...rest } = profile; void source; profiles.push(rest); }
  }
  profiles.sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en"));
  return { contractVersion: statsDatasetContractVersion, sources, profiles };
}

export function datasetFiles(dataset: StatsDataset): DatasetFile[] {
  return dataset.profiles.map((profile) => operatorDatasetFile(profile.operatorId, profile.region as GameDataRegion, profile));
}

export async function readStatsDataset(directory: string): Promise<StatsDataset> {
  const index = await json(join(directory, "index.json")) as DatasetIndex;
  // A contract 2 directory is still read, as the reference of --verify-against.
  const errors = validateDatasetIndex(index, index.contractVersion === datasetContractVersion ? datasetContractVersion : statsDatasetContractVersion);
  if (errors.length) throw new Error(`Invalid dataset index: ${errors.join("; ")}`);
  const profiles: StatsDatasetProfile[] = [];
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const text = await readFile(join(directory, entry.file), "utf8");
    if (sha256(text) !== entry.sha256) throw new Error(`Dataset file hash mismatch: ${entry.file}`);
    const profile = JSON.parse(text) as StatsDatasetProfile;
    if (profile.operatorId !== operatorId || profile.region !== entry.region) throw new Error(`Dataset file identity mismatch: ${entry.file}`);
    profiles.push(profile);
  }
  return { contractVersion: index.contractVersion as StatsDataset["contractVersion"], sources: index.sources as Record<GameDataRegion, StatsSource>, profiles };
}

// Declared normalisations for comparing against an earlier manifest:
// contract 1 stores the source in every profile instead of the index, and the
// module enrichment of contract 1 wrote moduleSourceRegion "preferred" for the profile region; contracts before 3 have no trait,
// which is then left out of the comparison so the rest of each profile must stay identical.
function comparableReference(profile: Record<string, unknown>, region: GameDataRegion): Record<string, unknown> {
  const { source, ...rest } = profile; void source;
  const modules = Array.isArray(rest.modules) ? rest.modules.map((module: Record<string, unknown>) => module.moduleSourceRegion === "preferred" ? { ...module, moduleSourceRegion: region } : module) : rest.modules;
  return { ...rest, modules };
}

/**
 * Compares the generated stats with a reference manifest or directory. With `revisionChange` (update mode of
 * --verify-against), a change of source is reported once as the expected revision change instead of in every profile.
 */
export function compareStatsManifests(reference: unknown, generated: StatsDataset, options: Readonly<{ revisionChange?: boolean }> = {}): StatsVerification {
  const root = reference as { contractVersion?: string; sources?: Record<string, unknown>; profiles?: Record<string, unknown>[] };
  if (!Array.isArray(root.profiles) || !["1", "2", "3"].includes(root.contractVersion ?? "")) throw new Error("Reference manifest has an unknown contract");
  const result: StatsVerification = { identical: 0, differences: [], missing: [], ignored: 0, removed: [], sources: [], shared: [] };
  const used = new Set<Record<string, unknown>>();
  for (const profile of generated.profiles) {
    const region = profile.region as GameDataRegion;
    const candidate = root.profiles.find((item) => item.operatorId === profile.operatorId && item.region === region);
    if (!candidate) { result.missing.push(`${profile.operatorId}/${region}`); continue; }
    used.add(candidate);
    const referenceSource = root.contractVersion === "1" ? candidate.source : root.sources?.[region];
    const sourceChanged = !isDeepStrictEqual(referenceSource, generated.sources[region]);
    const changes = options.revisionChange ? revisionChanges(JSON.parse(JSON.stringify(referenceSource ?? null)), JSON.parse(JSON.stringify(generated.sources[region]))) : new Map<string, string | null>();
    const expected = applyRevisionChanges(JSON.parse(JSON.stringify(comparableReference(candidate, region))), changes) as Record<string, unknown>;
    const { trait, ...withoutTrait } = profile;
    const actual = JSON.parse(JSON.stringify(root.contractVersion === "3" ? { ...withoutTrait, trait } : withoutTrait)) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((key) => !isDeepStrictEqual(expected[key], actual[key]));
    const fields = changedFields(expected, actual);
    if (sourceChanged && options.revisionChange) result.sources = ["sources"];
    else if (sourceChanged) { keys.push("source"); fields.push("source"); }
    if (keys.length) result.differences.push({ operatorId: profile.operatorId, keys, fields }); else result.identical += 1;
  }
  result.removed = root.profiles.filter((item) => !used.has(item)).map((item) => `${String(item.operatorId)}/${String(item.region)}`);
  result.ignored = result.removed.length;
  return result;
}

export async function writeStatsDataset(directory: string, dataset: StatsDataset, options: Readonly<{ force: boolean; limits?: Readonly<{ fileBytes: number; totalBytes: number }> }>): Promise<{ index: DatasetIndex; totalBytes: number; warnings: string[] }> {
  return writeDatasetDirectory(directory, statsDatasetName, dataset.sources, datasetFiles(dataset), { force: options.force, limits: options.limits, extras: { contractVersion: statsDatasetContractVersion } });
}

export async function main(argv: readonly string[] = process.argv, options: StatsGeneratorOptions = {}): Promise<void> {
  const paths = Object.fromEntries(regions.map((region) => [region, Object.fromEntries(tables.map((table) => [table, arg(tableFlag(region, table), argv)]))])) as Record<GameDataRegion, Record<GameDataTable, string>>;
  const output = arg("--out-dir", argv);
  const force = argv.includes("--force");
  const mode = verificationMode(argv);
  if (await exists(output) && !force) throw new Error("Output exists; pass --force to overwrite");
  const expectedHashes = options.expectedHashes ?? gameDataTableHashes;
  for (const region of regions) for (const table of tables) if (sha256(await readFile(paths[region][table])) !== expectedHashes[region][table]) throw new Error(`Snapshot SHA-256 mismatch: ${tableFlag(region, table)}`);
  const input = Object.fromEntries(await Promise.all(regions.map(async (region) => [region, Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await json(paths[region][table])])))]))) as Record<GameDataRegion, Record<GameDataTable, unknown>>;
  const catalog = await readCatalog(options.releaseManifest ?? "data/operator-cn-release-manifest.json", options.regionalManifest ?? "data/operator-regional-manifest.json", options.catalogSize);
  const sources = Object.fromEntries(regions.map((region) => [region, { repository: gameDataRepository, revision: gameDataRevisions[region], path: `${region}/gamedata/excel/character_table.json`, sha256: expectedHashes[region].character_table }])) as Record<GameDataRegion, StatsSource>;
  const dataset = buildStatsDataset(input, catalog, sources);
  if (mode) {
    const referencePath = arg("--verify-against", argv);
    const reference = (await stat(referencePath)).isDirectory() ? await readStatsDataset(referencePath) : await json(referencePath);
    const verification = compareStatsManifests(reference, dataset, { revisionChange: mode === "update" });
    if (mode === "update") await verifyUpdate([{ label: statsDatasetName, verification, sources: dataset.sources }], argv); else reportVerification(verification);
  }
  const result = await writeStatsDataset(output, dataset, { force, limits: options.limits });
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  const largest = Math.max(...Object.values(result.index.operators).map((entry) => entry.bytes));
  console.log(`Generated ${dataset.profiles.length} stats files (${result.totalBytes} bytes in total, largest ${largest}) at ${output}`);
}

if (process.argv[1]?.endsWith("generate-operator-stats.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
