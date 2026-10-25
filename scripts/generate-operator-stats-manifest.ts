import { createHash } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { gameDataRepository, gameDataRevisions, gameDataTableHashes, type GameDataRegion, type GameDataTable } from "../src/game-data/gamedata-revisions";
import { attachModuleStats, extractOperatorStatsProfiles, type OperatorStatsProfile } from "../src/game-data/operator-stats";

export const statsManifestByteLimit = 2_000_000;
export const statsManifestWarningBytes = 1_800_000;
const catalogSize = 432;
const regions: readonly GameDataRegion[] = ["en", "cn"];
const tables: readonly GameDataTable[] = ["character_table", "uniequip_table", "battle_equip_table"];

type StatsSource = OperatorStatsProfile["source"];
export type StatsManifestProfile = Omit<OperatorStatsProfile, "source">;
export type StatsManifestV2 = { contractVersion: "2"; sources: Record<GameDataRegion, StatsSource>; profiles: StatsManifestProfile[] };
export type StatsGeneratorOptions = Readonly<{
  expectedHashes?: Readonly<Record<GameDataRegion, Readonly<Record<GameDataTable, string>>>>;
  releaseManifest?: string;
  regionalManifest?: string;
  catalogSize?: number;
  byteLimit?: number;
  warningBytes?: number;
}>;
export type StatsVerification = { identical: number; differences: { operatorId: string; keys: string[] }[]; missing: string[]; ignored: number };

export function tableFlag(region: GameDataRegion, table: GameDataTable): string { return `--${region}-${table.replace(/_table$/, "").replaceAll("_", "-")}`; }
export function arg(name: string, argv: readonly string[]): string { const index = argv.indexOf(name); const value = argv[index + 1]; if (index < 0 || !value || value.startsWith("--")) throw new Error(`Missing ${name}`); return value; }
async function hash(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase(); }
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }

export async function readCatalog(releasePath: string, regionalPath: string, expectedSize: number): Promise<Map<string, GameDataRegion>> {
  const ids = (manifest: unknown, label: string) => { const operators = (manifest as { operators?: { id?: unknown }[] }).operators; if (!Array.isArray(operators)) throw new Error(`${label} has no operators`); return operators.map((item) => { if (typeof item.id !== "string") throw new Error(`${label} has an operator without id`); return item.id; }); };
  const catalog = new Map<string, GameDataRegion>();
  for (const [id, region] of [...ids(await json(releasePath), "Release manifest").map((id) => [id, "en"] as const), ...ids(await json(regionalPath), "Regional manifest").map((id) => [id, "cn"] as const)]) {
    if (catalog.has(id)) throw new Error(`Duplicate catalog operator: ${id}`);
    catalog.set(id, region);
  }
  if (catalog.size !== expectedSize) throw new Error(`Catalog has ${catalog.size} operators; expected ${expectedSize}`);
  return catalog;
}

export function buildStatsManifest(input: Readonly<Record<GameDataRegion, Readonly<Record<GameDataTable, unknown>>>>, catalog: ReadonlyMap<string, GameDataRegion>, sources: Record<GameDataRegion, StatsSource>): StatsManifestV2 {
  const profiles: StatsManifestProfile[] = [];
  for (const region of regions) {
    const wanted = new Set([...catalog].filter(([, value]) => value === region).map(([id]) => id));
    const extracted = extractOperatorStatsProfiles(input[region].character_table, region, sources[region]).filter((profile) => wanted.has(profile.operatorId));
    const found = new Set(extracted.map((profile) => profile.operatorId));
    const missing = [...wanted].filter((id) => !found.has(id));
    if (missing.length) throw new Error(`Catalog operators missing from the ${region} character table: ${missing.join(", ")}`);
    for (const profile of attachModuleStats(extracted, input[region].uniequip_table, input[region].battle_equip_table, region)) { const { source, ...rest } = profile; void source; profiles.push(rest); }
  }
  profiles.sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en"));
  return { contractVersion: "2", sources, profiles };
}

export function serializeStatsManifest(manifest: StatsManifestV2): string {
  return `{"contractVersion":"2","sources":${JSON.stringify(manifest.sources)},"profiles":[\n${manifest.profiles.map((profile) => JSON.stringify(profile)).join(",\n")}\n]}\n`;
}

// Declared normalisations for comparing against an earlier manifest:
// contract 1 stores the source in every profile instead of the header, and the
// module enrichment of contract 1 wrote moduleSourceRegion "preferred" for the profile region.
function comparableReference(profile: Record<string, unknown>, region: GameDataRegion): Record<string, unknown> {
  const { source, ...rest } = profile; void source;
  const modules = Array.isArray(rest.modules) ? rest.modules.map((module: Record<string, unknown>) => module.moduleSourceRegion === "preferred" ? { ...module, moduleSourceRegion: region } : module) : rest.modules;
  return { ...rest, modules };
}

export function compareStatsManifests(reference: unknown, generated: StatsManifestV2): StatsVerification {
  const root = reference as { contractVersion?: string; sources?: Record<string, unknown>; profiles?: Record<string, unknown>[] };
  if (!Array.isArray(root.profiles) || (root.contractVersion !== "1" && root.contractVersion !== "2")) throw new Error("Reference manifest has an unknown contract");
  const result: StatsVerification = { identical: 0, differences: [], missing: [], ignored: 0 };
  const used = new Set<Record<string, unknown>>();
  for (const profile of generated.profiles) {
    const region = profile.region as GameDataRegion;
    const candidate = root.profiles.find((item) => item.operatorId === profile.operatorId && item.region === region);
    if (!candidate) { result.missing.push(`${profile.operatorId}/${region}`); continue; }
    used.add(candidate);
    const referenceSource = root.contractVersion === "1" ? candidate.source : root.sources?.[region];
    const expected = JSON.parse(JSON.stringify(comparableReference(candidate, region))) as Record<string, unknown>;
    const actual = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((key) => !isDeepStrictEqual(expected[key], actual[key]));
    if (!isDeepStrictEqual(referenceSource, generated.sources[region])) keys.push("source");
    if (keys.length) result.differences.push({ operatorId: profile.operatorId, keys }); else result.identical += 1;
  }
  result.ignored = root.profiles.filter((item) => !used.has(item)).length;
  return result;
}

export async function main(argv: readonly string[] = process.argv, options: StatsGeneratorOptions = {}): Promise<void> {
  const paths = Object.fromEntries(regions.map((region) => [region, Object.fromEntries(tables.map((table) => [table, arg(tableFlag(region, table), argv)]))])) as Record<GameDataRegion, Record<GameDataTable, string>>;
  const output = arg("--out", argv);
  if (await stat(output).then(() => true, () => false) && !argv.includes("--force")) throw new Error("Output exists; pass --force to overwrite");
  const expectedHashes = options.expectedHashes ?? gameDataTableHashes;
  for (const region of regions) for (const table of tables) if (await hash(paths[region][table]) !== expectedHashes[region][table]) throw new Error(`Snapshot SHA-256 mismatch: ${tableFlag(region, table)}`);
  const input = Object.fromEntries(await Promise.all(regions.map(async (region) => [region, Object.fromEntries(await Promise.all(tables.map(async (table) => [table, await json(paths[region][table])])))]))) as Record<GameDataRegion, Record<GameDataTable, unknown>>;
  const catalog = await readCatalog(options.releaseManifest ?? "data/operator-cn-release-manifest.json", options.regionalManifest ?? "data/operator-regional-manifest.json", options.catalogSize ?? catalogSize);
  const sources = Object.fromEntries(regions.map((region) => [region, { repository: gameDataRepository, revision: gameDataRevisions[region], path: `${region}/gamedata/excel/character_table.json`, sha256: expectedHashes[region].character_table }])) as Record<GameDataRegion, StatsSource>;
  const manifest = buildStatsManifest(input, catalog, sources);
  if (argv.includes("--verify-against")) {
    const verification = compareStatsManifests(await json(arg("--verify-against", argv)), manifest);
    console.log(`Verification: ${verification.identical} identical, ${verification.differences.length} different, ${verification.missing.length} missing, ${verification.ignored} reference profiles outside the catalog`);
    for (const difference of verification.differences.slice(0, 20)) console.log(`  ${difference.operatorId}: ${difference.keys.join(", ")}`);
    if (verification.differences.length || verification.missing.length) throw new Error("Verification failed; output not written");
  }
  const text = serializeStatsManifest(manifest);
  const bytes = Buffer.byteLength(text);
  const limit = options.byteLimit ?? statsManifestByteLimit;
  if (bytes > limit) throw new Error(`Manifest is ${bytes} bytes, above the ${limit}-byte limit; split it per operator`);
  if (bytes >= (options.warningBytes ?? statsManifestWarningBytes)) console.warn(`Warning: manifest is ${bytes} bytes, at least 90% of the ${limit}-byte limit`);
  const temp = `${output}.${process.pid}.partial`;
  await writeFile(temp, text, "utf8");
  await rename(temp, output);
  console.log(`Generated ${manifest.profiles.length} stats profiles (${bytes} bytes) at ${output}`);
}

if (process.argv[1]?.endsWith("generate-operator-stats-manifest.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
