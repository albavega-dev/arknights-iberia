import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gameDataBuildingTableHashes, gameDataRepository, gameDataRevisions, gameDataSkillTableHashes, gameDataTableHashes, type GameDataRegion } from "../src/game-data/gamedata-revisions";
import { sharedFileName, skillsDatasetContractVersion, skillsDatasetLimits, validateDatasetIndex, type DatasetFile, type DatasetIndex, type DatasetSharedFile, type DatasetSource } from "../src/game-data/operator-dataset";
import { baseSkillDescriptions, buildGlossary, buildOperatorBaseSkills, buildOperatorSkills, skillDescriptions, type GlossaryEntry, type GlossaryTable, type OperatorSkillsProfile } from "../src/game-data/operator-skills";
import { arg, exists, operatorDatasetFile, readCatalog, readJson, sha256, tableFlag, writeDatasetDirectory } from "./operator-dataset-io";

export const skillsDatasetName = "operator-skills";
const catalogSize = 432;
const regions: readonly GameDataRegion[] = ["en", "cn"];
const tables = ["character_table", "skill_table", "range_table", "gamedata_const", "building_data"] as const;
type SkillsTable = (typeof tables)[number];
type HashTable = Readonly<Record<GameDataRegion, Readonly<Record<SkillsTable, string>>>>;

export type SkillsGlossary = { region: GameDataRegion; terms: Record<string, GlossaryEntry> };
export type SkillsDataset = { sources: Record<GameDataRegion, DatasetSource>; tables: Record<GameDataRegion, Record<string, DatasetSource>>; profiles: OperatorSkillsProfile[]; glossaries: SkillsGlossary[] };
export type SkillsGeneratorOptions = Readonly<{
  expectedHashes?: HashTable;
  releaseManifest?: string;
  regionalManifest?: string;
  catalogSize?: number;
  limits?: Readonly<{ fileBytes: number; totalBytes: number }>;
}>;

export const glossaryFileName = (region: GameDataRegion) => `glossary-${region}`;

function defaultHashes(): HashTable {
  return Object.fromEntries(regions.map((region) => [region, { character_table: gameDataTableHashes[region].character_table, ...gameDataSkillTableHashes[region], ...gameDataBuildingTableHashes[region] }])) as unknown as HashTable;
}

export function buildSkillsDataset(input: Readonly<Record<GameDataRegion, Readonly<Record<SkillsTable, unknown>>>>, catalog: ReadonlyMap<string, GameDataRegion>, hashes: HashTable): SkillsDataset {
  const profiles: OperatorSkillsProfile[] = [];
  const glossaries: SkillsGlossary[] = [];
  for (const region of regions) {
    const characters = input[region].character_table as Record<string, Parameters<typeof buildOperatorSkills>[2] | undefined>;
    const skillTable = input[region].skill_table as Parameters<typeof buildOperatorSkills>[3];
    const rangeTable = input[region].range_table as Parameters<typeof buildOperatorSkills>[4];
    const building = input[region].building_data as { chars?: Record<string, Parameters<typeof buildOperatorBaseSkills>[1] | undefined>; buffs?: Parameters<typeof buildOperatorBaseSkills>[2] };
    if (!building.chars || !building.buffs) throw new Error(`The ${region} building data has no characters or buffs`);
    const descriptions: string[] = [];
    for (const operatorId of [...catalog].filter(([, value]) => value === region).map(([id]) => id).sort((a, b) => a.localeCompare(b, "en"))) {
      const character = characters[operatorId];
      if (!character) throw new Error(`Catalog operator ${operatorId} is missing from the ${region} character table`);
      const buildingCharacter = building.chars[operatorId];
      if (!buildingCharacter) throw new Error(`Catalog operator ${operatorId} is missing from the ${region} building data`);
      const profile: OperatorSkillsProfile = { ...buildOperatorSkills(operatorId, region, character, skillTable, rangeTable), baseSkills: buildOperatorBaseSkills(operatorId, buildingCharacter, building.buffs) };
      for (const skill of profile.skills) descriptions.push(...skillDescriptions(skill));
      descriptions.push(...baseSkillDescriptions(profile.baseSkills));
      profiles.push(profile);
    }
    const dictionary = (input[region].gamedata_const as { termDescriptionDict?: GlossaryTable }).termDescriptionDict;
    if (!dictionary) throw new Error(`The ${region} game data constants have no term dictionary`);
    glossaries.push({ region, terms: buildGlossary(descriptions, dictionary) });
  }
  profiles.sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en"));
  const source = (region: GameDataRegion, table: SkillsTable): DatasetSource => ({ repository: gameDataRepository, revision: gameDataRevisions[region], path: `${region}/gamedata/excel/${table}.json`, sha256: hashes[region][table] });
  const sources = Object.fromEntries(regions.map((region) => [region, source(region, "skill_table")])) as Record<GameDataRegion, DatasetSource>;
  const sourceTables = Object.fromEntries(regions.map((region) => [region, Object.fromEntries(tables.map((table) => [table, source(region, table)]))])) as Record<GameDataRegion, Record<string, DatasetSource>>;
  return { sources, tables: sourceTables, profiles, glossaries };
}

export function skillsDatasetFiles(dataset: SkillsDataset): { files: DatasetFile[]; shared: DatasetSharedFile[] } {
  const files = dataset.profiles.map((profile) => operatorDatasetFile(profile.operatorId, profile.region as GameDataRegion, profile));
  const shared = dataset.glossaries.map((glossary): DatasetSharedFile => {
    const { text, bytes, sha256: hash } = operatorDatasetFile("char_shared", glossary.region, glossary);
    return { name: glossaryFileName(glossary.region), text, bytes, sha256: hash };
  });
  return { files, shared };
}

export async function writeSkillsDataset(directory: string, dataset: SkillsDataset, options: Readonly<{ force: boolean; limits?: Readonly<{ fileBytes: number; totalBytes: number }> }>) {
  const { files, shared } = skillsDatasetFiles(dataset);
  return writeDatasetDirectory(directory, skillsDatasetName, dataset.sources, files, { force: options.force, limits: options.limits ?? skillsDatasetLimits, extras: { tables: dataset.tables, shared, contractVersion: skillsDatasetContractVersion } });
}

export async function readSkillsDataset(directory: string): Promise<{ index: DatasetIndex; profiles: OperatorSkillsProfile[]; glossaries: Record<string, SkillsGlossary> }> {
  const index = await readJson(join(directory, "index.json")) as DatasetIndex;
  const errors = validateDatasetIndex(index, skillsDatasetContractVersion);
  if (errors.length) throw new Error(`Invalid dataset index: ${errors.join("; ")}`);
  const profiles: OperatorSkillsProfile[] = [];
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const text = await readFile(join(directory, entry.file), "utf8");
    if (sha256(text) !== entry.sha256) throw new Error(`Dataset file hash mismatch: ${entry.file}`);
    const profile = JSON.parse(text) as OperatorSkillsProfile;
    if (profile.operatorId !== operatorId || profile.region !== entry.region) throw new Error(`Dataset file identity mismatch: ${entry.file}`);
    profiles.push(profile);
  }
  const glossaries: Record<string, SkillsGlossary> = {};
  for (const [name, entry] of Object.entries(index.shared ?? {})) {
    const text = await readFile(join(directory, sharedFileName(name)), "utf8");
    if (sha256(text) !== entry.sha256) throw new Error(`Dataset file hash mismatch: ${entry.file}`);
    glossaries[name] = JSON.parse(text) as SkillsGlossary;
  }
  return { index, profiles, glossaries };
}

export async function main(argv: readonly string[] = process.argv, options: SkillsGeneratorOptions = {}): Promise<void> {
  const paths = Object.fromEntries(regions.map((region) => [region, Object.fromEntries(tables.map((table) => [table, arg(tableFlag(region, table), argv)]))])) as Record<GameDataRegion, Record<SkillsTable, string>>;
  const output = arg("--out-dir", argv);
  const force = argv.includes("--force");
  if (await exists(output) && !force) throw new Error("Output exists; pass --force to overwrite");
  const expectedHashes = options.expectedHashes ?? defaultHashes();
  for (const region of regions) for (const table of tables) if (sha256(await readFile(paths[region][table])) !== expectedHashes[region][table]) throw new Error(`Snapshot SHA-256 mismatch: ${tableFlag(region, table)}`);
  const input = Object.fromEntries(await Promise.all(regions.map(async (region) => [region, Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await readJson(paths[region][table])])))]))) as Record<GameDataRegion, Record<SkillsTable, unknown>>;
  const catalog = await readCatalog(options.releaseManifest ?? "data/operator-cn-release-manifest.json", options.regionalManifest ?? "data/operator-regional-manifest.json", options.catalogSize ?? catalogSize);
  const dataset = buildSkillsDataset(input, catalog, expectedHashes);
  const result = await writeSkillsDataset(output, dataset, { force, limits: options.limits });
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  const largest = Math.max(...Object.values(result.index.operators).map((entry) => entry.bytes));
  console.log(`Generated ${dataset.profiles.length} skills files and ${dataset.glossaries.length} glossaries (${result.totalBytes} bytes in total, largest ${largest}) at ${output}`);
}

if (process.argv[1]?.endsWith("generate-operator-skills.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
