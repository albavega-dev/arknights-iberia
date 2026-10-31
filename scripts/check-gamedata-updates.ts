/**
 * Read-only detection of GameData and image updates. Writes nothing in the repository or in any database.
 *
 *   pnpm data:check-updates --level=revisions
 *   pnpm data:check-updates --level=tables --download-dir=<directory outside the repository> [--en-snapshot=<dir>] [--cn-snapshot=<dir>]
 *
 * Exit code: 0 nothing new, 2 something to review, 1 error. The JSON report goes to stdout and holds no local paths.
 * GITHUB_TOKEN is optional (it only raises the API rate limit) and is never printed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { imageRepository, imageRevision } from "../src/game-data/asset-revisions";
import {
  assetChangesByDirectory, assetCoverage, changedAssetPaths, skillIconNames, catalogModuleIds, changedBlobs, compareFileLimit, diffKeyed, diffModules, diffOperators, diffSkills,
  diffBaseSkills, exitCodeFor, handbookEntries, mayBeTruncated, missingLabels, newGlossaryTerms, playableOperatorIds,
  redact, resolvedSkillGaps, revisionStatus, skillIdsOf, subClassIdsOf, usedRangeIds, compareRoster, type CompareFile,
} from "../src/game-data/gamedata-diff";
import { portraitChanges, portraitUrl, type PortraitHead, type PortraitManifest } from "../src/game-data/operator-portraits";
import { pool } from "./sync-operator-images";
import { gameDataRepository, gameDataRevisions, pinnedGameDataTableHashes, type GameDataRegion } from "../src/game-data/gamedata-revisions";
import { directoryBlobs, fetchBytes, github, token } from "./github-api";
import { compareUrl, contentsUrl, gameDataDirectory, latestCommitUrl, rawGameDataUrl, treeUrl } from "../src/game-data/github-requests";
import { operatorArchetypeLabels } from "../src/game-data/operator-archetypes";
import { skillDataGaps } from "../src/game-data/skill-data-gaps";
import { assetRegistry, registryChangeChecks, registryCoverage, registryImageDirectories, registryTables, type ChangeCheck, type CoverageNeed } from "../src/game-data/dataset-registry";

const regions: readonly GameDataRegion[] = ["en", "cn"];
// Tables, comparisons, image directories and coverage checks come from the dataset registry.
const imageDirectories = registryImageDirectories(imageRepository);
const neededTables: readonly string[] = registryTables();

const hasFlag = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

type Commit = { sha: string };
type Compare = { status: string; files?: CompareFile[] };

async function latestCommit(repository: string, directory?: string): Promise<string> {
  const commits = await github<Commit[]>(latestCommitUrl(repository, directory));
  if (!commits[0]?.sha) throw new Error(`No commits found for ${repository}`);
  return commits[0].sha;
}

async function compareFiles(repository: string, base: string, head: string): Promise<CompareFile[]> {
  if (base === head) return [];
  const files: CompareFile[] = [];
  for (let page = 1; page <= compareFileLimit / 100; page += 1) {
    const result = await github<Compare>(compareUrl(repository, base, head, page));
    const batch = result.files ?? [];
    files.push(...batch);
    if (batch.length < 100) break;
  }
  return files;
}

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
const idsOf = (manifest: { operators: { id: string }[] }) => manifest.operators.map((item) => item.id);

async function revisionsLevel() {
  const gamedata: Record<string, unknown> = {};
  const latest: Record<string, string> = {};
  const latestBlobs: Partial<Record<GameDataRegion, Record<string, string>>> = {};
  for (const region of regions) {
    const directory = gameDataDirectory(region);
    latest[region] = await latestCommit(gameDataRepository, directory);
    // Exact comparison: the blob hash of every table at the pinned and at the latest commit, from Git trees.
    try {
      const before = await directoryBlobs(gameDataRepository, gameDataRevisions[region], directory);
      const after = await directoryBlobs(gameDataRepository, latest[region], directory);
      const tables = changedBlobs(before, after);
      latestBlobs[region] = after;
      gamedata[region] = { ...revisionStatus(gameDataRevisions[region], latest[region]), tables, neededTables: tables.filter((table) => neededTables.includes(table)), listMayBeIncomplete: false };
    } catch {
      gamedata[region] = { ...revisionStatus(gameDataRevisions[region], latest[region]), tables: [], neededTables: [...neededTables], listMayBeIncomplete: true };
    }
  }
  const imageHead = await latestCommit(imageRepository);
  const imageFiles = await compareFiles(imageRepository, imageRevision, imageHead);
  const images = { ...revisionStatus(imageRevision, imageHead), byDirectory: assetChangesByDirectory(imageFiles, imageDirectories), changedPaths: changedAssetPaths(imageFiles, imageDirectories), listMayBeIncomplete: mayBeTruncated(imageFiles) };
  // The portrait CDN has no revisions: a HEAD request per catalog operator compares its Content-MD5 with the manifest.
  const portraitManifest = await readJson<PortraitManifest>("data/operator-portrait-manifest.json");
  const catalogIds = [...idsOf(await readJson("data/operator-cn-release-manifest.json")), ...idsOf(await readJson("data/operator-regional-manifest.json"))];
  const heads = new Map(await pool(catalogIds, 8, async (id): Promise<[string, PortraitHead]> => {
    try {
      const response = await fetch(portraitUrl(id), { method: "HEAD" });
      return [id, { status: response.status, contentMd5: response.headers.get("content-md5") }];
    } catch {
      return [id, { status: 0, contentMd5: null }];
    }
  }));
  const portraits = portraitChanges(portraitManifest, catalogIds, heads);
  return { latest, latestBlobs, gamedata, images, portraits, imageHead };
}

async function download(url: URL, target: string, blob?: string): Promise<Buffer> {
  const data = await fetchBytes(url, blob);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, data);
  return data;
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex").toUpperCase();

async function tablesLevel(revisions: Awaited<ReturnType<typeof revisionsLevel>>) {
  const downloadDir = hasFlag("download-dir");
  if (!downloadDir) throw new Error("--download-dir is required for --level=tables");
  const target = resolve(downloadDir);
  const rel = relative(process.cwd(), target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("--download-dir must be outside the repository");
  const snapshots: Partial<Record<GameDataRegion, string>> = { en: hasFlag("en-snapshot"), cn: hasFlag("cn-snapshot") };

  const blobs = new Map<GameDataRegion, Map<string, string>>();
  const blobOf = async (region: GameDataRegion, table: string) => {
    if (!blobs.has(region) && revisions.latestBlobs[region]) blobs.set(region, new Map(Object.entries(revisions.latestBlobs[region]!).map(([name, sha]) => [`${name}.json`, sha])));
    if (!blobs.has(region)) {
      const listing = await github<{ name: string; sha: string }[]>(contentsUrl(gameDataRepository, revisions.latest[region]!, gameDataDirectory(region)));
      blobs.set(region, new Map(listing.map((entry) => [entry.name, entry.sha])));
    }
    return blobs.get(region)!.get(`${table}.json`);
  };

  // When a tree query failed the list is unknown, so every needed table is treated as changed.
  const changed = (region: GameDataRegion, table: string) => {
    const status = revisions.gamedata[region] as { neededTables: string[]; listMayBeIncomplete: boolean };
    return status.listMayBeIncomplete || status.neededTables.includes(table);
  };
  const cache = new Map<string, unknown>();
  const load = async (region: GameDataRegion, table: string, side: "before" | "after"): Promise<unknown> => {
    if (!neededTables.includes(table)) throw new Error(`${table} is not a table of the dataset registry`);
    const key = `${region}/${table}/${side === "after" && changed(region, table) ? "after" : "before"}`;
    if (cache.has(key)) return cache.get(key);
    let data: Buffer;
    if (key.endsWith("/after")) {
      const blob = await blobOf(region, table);
      if (!blob) throw new Error(`${region}/${table} is not in the latest revision`);
      data = await download(rawGameDataUrl(revisions.latest[region]!, region, table), join(target, `${region}-${revisions.latest[region].slice(0, 7)}`, `${table}.json`), blob);
    } else {
      const local = snapshots[region] ? join(snapshots[region]!, `${table}.json`) : undefined;
      const exists = local ? await stat(local).then(() => true, () => false) : false;
      data = exists ? await readFile(local!) : await download(rawGameDataUrl(gameDataRevisions[region], region, table), join(target, `${region}-${gameDataRevisions[region].slice(0, 7)}`, `${table}.json`));
      if (sha256(data) !== (pinnedGameDataTableHashes(region) as Record<string, string>)[table]) throw new Error(`The ${region} baseline of ${table} does not match the pinned SHA-256`);
    }
    const value = JSON.parse(data.toString("utf8")) as unknown;
    cache.set(key, value);
    return value;
  };

  const catalog = {
    en: idsOf(await readJson("data/operator-cn-release-manifest.json")),
    cnOnly: idsOf(await readJson("data/operator-regional-manifest.json")),
  };
  const roster = compareRoster(catalog, playableOperatorIds(await load("en", "character_table", "after")), playableOperatorIds(await load("cn", "character_table", "after")));
  // Existing EN operators are read from the EN tables; CN-only operators and new CN operators from the CN tables.
  const scope: Record<GameDataRegion, string[]> = { en: [...catalog.en], cn: [...catalog.cnOnly, ...roster.newInCn] };

  type CheckContext = { region: GameDataRegion; ids: string[]; before: (table: string) => Promise<unknown>; after: (table: string) => Promise<unknown> };
  const checks: Record<ChangeCheck, (context: CheckContext) => Promise<unknown>> = {
    operators: async ({ ids, before, after }) => diffOperators(await before("character_table"), await after("character_table"), ids),
    skills: async ({ ids, before, after }) => diffSkills(await before("skill_table"), await after("skill_table"), skillIdsOf(await after("character_table"), ids)),
    modules: async ({ ids, before, after }) => diffModules({ uniequip: await before("uniequip_table"), battleEquip: await before("battle_equip_table") }, { uniequip: await after("uniequip_table"), battleEquip: await after("battle_equip_table") }, ids),
    // An unchanged handbook needs no comparison and is not downloaded.
    biographies: async ({ region, ids, before, after }) => (changed(region, "handbook_info_table") ? diffKeyed(handbookEntries(await before("handbook_info_table")), handbookEntries(await after("handbook_info_table")), ids) : diffKeyed({}, {}, ids)),
    base: async ({ ids, before, after }) => diffBaseSkills(await before("building_data"), await after("building_data"), ids),
    ranges: async ({ ids, before, after }) => diffKeyed(await before("range_table") as Record<string, unknown>, await after("range_table") as Record<string, unknown>, usedRangeIds(await after("character_table"), ids)),
    newGlossaryTerms: async ({ before, after }) => newGlossaryTerms(await before("gamedata_const"), await after("gamedata_const")),
  };

  const perRegion = async (region: GameDataRegion) => {
    const context: CheckContext = { region, ids: scope[region], before: (table) => load(region, table, "before"), after: (table) => load(region, table, "after") };
    const existing: Record<string, unknown> = {};
    for (const check of registryChangeChecks()) existing[check] = await checks[check](context);
    // Labels, coverage and skill data gaps read these tables whatever the registered comparisons.
    return { existing, charAfter: await context.after("character_table"), uniAfter: await context.after("uniequip_table"), battleAfter: await context.after("battle_equip_table"), skillAfter: await context.after("skill_table") };
  };
  const results = { en: await perRegion("en"), cn: await perRegion("cn") };

  const moduleIcons = new Set((await readdir(assetRegistry["module-type-icons"].localDirectories[0])).filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)));
  const modeNames = await readJson<{ gameTags: Record<string, unknown>; mapTags: Record<string, unknown> }>("data/operator-module-modes.json");
  const labelsFor = (region: GameDataRegion) => missingLabels({ characterTable: results[region].charAfter, uniequipTable: results[region].uniAfter, battleEquip: results[region].battleAfter, ids: scope[region], archetypeLabels: operatorArchetypeLabels, modeNames, moduleIcons });
  const labels = { en: labelsFor("en"), cn: labelsFor("cn") };

  const gaps = skillDataGaps.filter((gap) => gap.fix);
  const resolved = [...new Set([...resolvedSkillGaps(results.en.skillAfter, gaps), ...resolvedSkillGaps(results.cn.skillAfter, gaps)])];

  // Image coverage is checked against the latest image tree, so operators that were missing before show up when they arrive.
  let assets: unknown;
  const tree = await github<{ tree: { path: string; type: string }[]; truncated: boolean }>(treeUrl(imageRepository, revisions.imageHead, true));
  if (tree.truncated) assets = { unavailable: "the image tree was truncated" };
  else {
    const paths = new Set(tree.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path));
    const needs: Record<CoverageNeed, string[]> = {
      catalogOperators: regions.flatMap((region) => scope[region]),
      catalogSkillIcons: regions.flatMap((region) => skillIconNames(results[region].skillAfter, skillIdsOf(results[region].charAfter, scope[region]))),
      catalogModules: regions.flatMap((region) => catalogModuleIds(results[region].uniAfter, scope[region], { withInitial: false })),
      catalogSubclasses: [...new Set(regions.flatMap((region) => subClassIdsOf(results[region].charAfter, scope[region])))],
    };
    assets = assetCoverage(paths, registryCoverage().map((coverage) => ({ reportKey: coverage.reportKey, ids: needs[coverage.need], path: coverage.path })));
  }
  return { roster, existing: { en: results.en.existing, cn: results.cn.existing }, labels, skillDataGapsResolved: resolved, assets, downloadedTables: [...cache.keys()].filter((key) => key.endsWith("/after")).length };
}

async function main() {
  const level = hasFlag("level") ?? "revisions";
  if (level !== "revisions" && level !== "tables") throw new Error("--level must be revisions or tables");
  const revisions = await revisionsLevel();
  const findings: Record<string, unknown> = { revisions: { gamedata: revisions.gamedata, images: revisions.images, portraits: revisions.portraits } };
  if (level === "tables") Object.assign(findings, await tablesLevel(revisions));
  const report = { level, findings };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = exitCodeFor(report);
}

main().catch((error: unknown) => {
  const message = redact(error instanceof Error ? error.message : String(error), [token, process.cwd(), process.env.HOME, process.env.USERPROFILE]);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
