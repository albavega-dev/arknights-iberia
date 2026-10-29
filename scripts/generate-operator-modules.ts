import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gameDataFavorTableHashes, gameDataRepository, gameDataRevisions, gameDataSkillTableHashes, gameDataTableHashes, type GameDataRegion } from "../src/game-data/gamedata-revisions";
import { modulesDatasetContractVersion, modulesDatasetLimits, sharedFileName, validateDatasetIndex, type DatasetFile, type DatasetIndex, type DatasetSharedFile, type DatasetSource } from "../src/game-data/operator-dataset";
import { buildOperatorModules, buildOperatorTrait, moduleDescriptions, traitDescriptions, type OperatorModulesProfile, type SourceModuleTables } from "../src/game-data/operator-modules";
import { buildGlossary, type GlossaryEntry, type GlossaryTable } from "../src/game-data/operator-skills";
import { arg, exists, operatorDatasetFile, readCatalog, readJson, sha256, tableFlag, writeDatasetDirectory } from "./operator-dataset-io";

export const modulesDatasetName = "operator-modules";
const catalogSize = 432;
const regions: readonly GameDataRegion[] = ["en", "cn"];
const tables = ["character_table", "uniequip_table", "battle_equip_table", "range_table", "gamedata_const", "favor_table"] as const;
type ModulesTable = (typeof tables)[number];
type HashTable = Readonly<Record<GameDataRegion, Readonly<Record<ModulesTable, string>>>>;

export type ModulesGlossary = { region: GameDataRegion; terms: Record<string, GlossaryEntry> };
export type ModulesDataset = { sources: Record<GameDataRegion, DatasetSource>; tables: Record<GameDataRegion, Record<string, DatasetSource>>; profiles: OperatorModulesProfile[]; glossaries: ModulesGlossary[] };
export type ModulesGeneratorOptions = Readonly<{
  expectedHashes?: HashTable;
  releaseManifest?: string;
  regionalManifest?: string;
  catalogSize?: number;
  limits?: Readonly<{ fileBytes: number; totalBytes: number }>;
  /** Directory of the module type icons; every icon a module uses must exist there. */
  iconDirectory?: string;
}>;

export const glossaryFileName = (region: GameDataRegion) => `glossary-${region}`;

function defaultHashes(): HashTable {
  return Object.fromEntries(regions.map((region) => [region, { ...gameDataTableHashes[region], range_table: gameDataSkillTableHashes[region].range_table, gamedata_const: gameDataSkillTableHashes[region].gamedata_const, ...gameDataFavorTableHashes[region] }])) as unknown as HashTable;
}

export function buildModulesDataset(input: Readonly<Record<GameDataRegion, Readonly<Record<ModulesTable, unknown>>>>, catalog: ReadonlyMap<string, GameDataRegion>, hashes: HashTable): ModulesDataset {
  const sourceTables = Object.fromEntries(regions.map((region) => [region, input[region] as unknown as SourceModuleTables])) as Record<GameDataRegion, SourceModuleTables>;
  const profiles: OperatorModulesProfile[] = [];
  const descriptions: Record<GameDataRegion, string[]> = { en: [], cn: [] };
  for (const [operatorId, region] of [...catalog].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const profile = buildOperatorModules(operatorId, region, sourceTables);
    // The trait lives in the stats files, but its terms stay in this glossary, which the trait view reads.
    descriptions[region].push(...traitDescriptions(buildOperatorTrait(operatorId, sourceTables[region].character_table[operatorId]!)));
    for (const item of profile.modules) descriptions[item.region].push(...moduleDescriptions(item));
    profiles.push(profile);
  }
  const glossaries = regions.map((region): ModulesGlossary => {
    const dictionary = (input[region].gamedata_const as { termDescriptionDict?: GlossaryTable }).termDescriptionDict;
    if (!dictionary) throw new Error(`The ${region} game data constants have no term dictionary`);
    return { region, terms: buildGlossary(descriptions[region], dictionary) };
  });
  const source = (region: GameDataRegion, table: ModulesTable): DatasetSource => ({ repository: gameDataRepository, revision: gameDataRevisions[region], path: `${region}/gamedata/excel/${table}.json`, sha256: hashes[region][table] });
  const sources = Object.fromEntries(regions.map((region) => [region, source(region, "battle_equip_table")])) as Record<GameDataRegion, DatasetSource>;
  const pinned = Object.fromEntries(regions.map((region) => [region, Object.fromEntries(tables.map((table) => [table, source(region, table)]))])) as Record<GameDataRegion, Record<string, DatasetSource>>;
  return { sources, tables: pinned, profiles, glossaries };
}

export async function checkModuleIcons(dataset: ModulesDataset, directory: string): Promise<void> {
  const icons = [...new Set(dataset.profiles.flatMap((profile) => profile.modules.map((module) => module.icon)))].sort();
  const missing: string[] = [];
  for (const icon of icons) if (!await exists(join(directory, `${icon}.png`))) missing.push(icon);
  if (missing.length) throw new Error(`Module type icons missing from ${directory}: ${missing.join(", ")}`);
}

export function modulesDatasetFiles(dataset: ModulesDataset): { files: DatasetFile[]; shared: DatasetSharedFile[] } {
  const files = dataset.profiles.map((profile) => operatorDatasetFile(profile.operatorId, profile.region, profile));
  const shared = dataset.glossaries.map((glossary): DatasetSharedFile => {
    const { text, bytes, sha256: hash } = operatorDatasetFile("char_shared", glossary.region, glossary);
    return { name: glossaryFileName(glossary.region), text, bytes, sha256: hash };
  });
  return { files, shared };
}

export async function writeModulesDataset(directory: string, dataset: ModulesDataset, options: Readonly<{ force: boolean; limits?: Readonly<{ fileBytes: number; totalBytes: number }> }>) {
  const { files, shared } = modulesDatasetFiles(dataset);
  return writeDatasetDirectory(directory, modulesDatasetName, dataset.sources, files, { force: options.force, limits: options.limits ?? modulesDatasetLimits, extras: { tables: dataset.tables, shared, contractVersion: modulesDatasetContractVersion } });
}

export async function readModulesDataset(directory: string): Promise<{ index: DatasetIndex; profiles: OperatorModulesProfile[]; glossaries: Record<string, ModulesGlossary> }> {
  const index = await readJson(join(directory, "index.json")) as DatasetIndex;
  const errors = validateDatasetIndex(index, modulesDatasetContractVersion);
  if (errors.length) throw new Error(`Invalid dataset index: ${errors.join("; ")}`);
  const profiles: OperatorModulesProfile[] = [];
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const text = await readFile(join(directory, entry.file), "utf8");
    if (sha256(text) !== entry.sha256) throw new Error(`Dataset file hash mismatch: ${entry.file}`);
    const profile = JSON.parse(text) as OperatorModulesProfile;
    if (profile.operatorId !== operatorId || profile.region !== entry.region) throw new Error(`Dataset file identity mismatch: ${entry.file}`);
    profiles.push(profile);
  }
  const glossaries: Record<string, ModulesGlossary> = {};
  for (const [name, entry] of Object.entries(index.shared ?? {})) {
    const text = await readFile(join(directory, sharedFileName(name)), "utf8");
    if (sha256(text) !== entry.sha256) throw new Error(`Dataset file hash mismatch: ${entry.file}`);
    glossaries[name] = JSON.parse(text) as ModulesGlossary;
  }
  return { index, profiles, glossaries };
}

export async function main(argv: readonly string[] = process.argv, options: ModulesGeneratorOptions = {}): Promise<void> {
  const paths = Object.fromEntries(regions.map((region) => [region, Object.fromEntries(tables.map((table) => [table, arg(tableFlag(region, table), argv)]))])) as Record<GameDataRegion, Record<ModulesTable, string>>;
  const output = arg("--out-dir", argv);
  const force = argv.includes("--force");
  if (await exists(output) && !force) throw new Error("Output exists; pass --force to overwrite");
  const expectedHashes = options.expectedHashes ?? defaultHashes();
  for (const region of regions) for (const table of tables) if (sha256(await readFile(paths[region][table])) !== expectedHashes[region][table]) throw new Error(`Snapshot SHA-256 mismatch: ${tableFlag(region, table)}`);
  const input = Object.fromEntries(await Promise.all(regions.map(async (region) => [region, Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await readJson(paths[region][table])])))]))) as Record<GameDataRegion, Record<ModulesTable, unknown>>;
  const catalog = await readCatalog(options.releaseManifest ?? "data/operator-cn-release-manifest.json", options.regionalManifest ?? "data/operator-regional-manifest.json", options.catalogSize ?? catalogSize);
  const dataset = buildModulesDataset(input, catalog, expectedHashes);
  await checkModuleIcons(dataset, options.iconDirectory ?? "public/assets/operator-modules");
  const result = await writeModulesDataset(output, dataset, { force, limits: options.limits });
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  const largest = Math.max(...Object.values(result.index.operators).map((entry) => entry.bytes));
  const modules = dataset.profiles.reduce((sum, profile) => sum + profile.modules.length, 0);
  console.log(`Generated ${dataset.profiles.length} modules files with ${modules} modules and ${dataset.glossaries.length} glossaries (${result.totalBytes} bytes in total, largest ${largest}) at ${output}`);
}

if (process.argv[1]?.endsWith("generate-operator-modules.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
