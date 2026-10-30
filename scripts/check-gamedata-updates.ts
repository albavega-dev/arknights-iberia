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
import { portraitDirectory, portraitRepository, imageRepository, imageRevision } from "../src/game-data/asset-revisions";
import {
  assetChangesByDirectory, assetCoverage, changedAssetPaths, skillIconNames, catalogModuleIds, changedBlobs, compareFileLimit, diffKeyed, diffModules, diffOperators, diffSkills,
  diffBaseSkills, exitCodeFor, handbookEntries, mayBeTruncated, missingLabels, newGlossaryTerms, playableOperatorIds,
  redact, resolvedSkillGaps, revisionStatus, skillIdsOf, usedRangeIds, compareRoster, type CompareFile,
} from "../src/game-data/gamedata-diff";
import { gameDataRepository, gameDataRevisions, pinnedGameDataTableHashes, type GameDataRegion } from "../src/game-data/gamedata-revisions";
import { directoryBlobs, fetchBytes, github, token } from "./github-api";
import { compareUrl, contentsUrl, gameDataDirectory, latestCommitUrl, rawGameDataUrl, treeUrl } from "../src/game-data/github-requests";
import { operatorArchetypeLabels } from "../src/game-data/operator-archetypes";
import { skillDataGaps } from "../src/game-data/skill-data-gaps";

const regions: readonly GameDataRegion[] = ["en", "cn"];
const imageDirectories = ["characters", "skills", "equip", "ui"] as const;
const neededTables = ["character_table", "skill_table", "range_table", "gamedata_const", "building_data", "favor_table", "uniequip_table", "battle_equip_table", "handbook_info_table"] as const;
type Table = (typeof neededTables)[number];

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
      gamedata[region] = { ...revisionStatus(gameDataRevisions[region], latest[region]), tables, neededTables: tables.filter((table) => (neededTables as readonly string[]).includes(table)), listMayBeIncomplete: false };
    } catch {
      gamedata[region] = { ...revisionStatus(gameDataRevisions[region], latest[region]), tables: [], neededTables: [...neededTables], listMayBeIncomplete: true };
    }
  }
  const imageHead = await latestCommit(imageRepository);
  const imageFiles = await compareFiles(imageRepository, imageRevision, imageHead);
  const images = { ...revisionStatus(imageRevision, imageHead), byDirectory: assetChangesByDirectory(imageFiles, imageDirectories), changedPaths: changedAssetPaths(imageFiles, imageDirectories), listMayBeIncomplete: mayBeTruncated(imageFiles) };
  const portraitManifest = await readJson<{ source: { directoryTreeSha: string } }>("data/operator-portrait-manifest.json");
  const root = await github<{ name: string; sha: string }[]>(contentsUrl(portraitRepository, "main"));
  const treeSha = root.find((entry) => entry.name === portraitDirectory)?.sha;
  if (!treeSha) throw new Error(`${portraitRepository} has no ${portraitDirectory} directory`);
  const portraits = revisionStatus(portraitManifest.source.directoryTreeSha, treeSha);
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
  const load = async (region: GameDataRegion, table: Table, side: "before" | "after"): Promise<unknown> => {
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
      if (sha256(data) !== pinnedGameDataTableHashes(region)[table]) throw new Error(`The ${region} baseline of ${table} does not match the pinned SHA-256`);
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

  const perRegion = async (region: GameDataRegion) => {
    const ids = scope[region];
    const [charBefore, charAfter] = [await load(region, "character_table", "before"), await load(region, "character_table", "after")];
    const skillIds = skillIdsOf(charAfter, ids);
    const [skillBefore, skillAfter] = [await load(region, "skill_table", "before"), await load(region, "skill_table", "after")];
    const [uniBefore, uniAfter] = [await load(region, "uniequip_table", "before"), await load(region, "uniequip_table", "after")];
    const [battleBefore, battleAfter] = [await load(region, "battle_equip_table", "before"), await load(region, "battle_equip_table", "after")];
    const [rangeBefore, rangeAfter] = [await load(region, "range_table", "before"), await load(region, "range_table", "after")];
    const [constBefore, constAfter] = [await load(region, "gamedata_const", "before"), await load(region, "gamedata_const", "after")];
    const [buildBefore, buildAfter] = [await load(region, "building_data", "before"), await load(region, "building_data", "after")];
    // An unchanged table needs no comparison, and the handbook has no pinned snapshot to read: do not download it.
    const [bioBefore, bioAfter] = changed(region, "handbook_info_table") ? [await load(region, "handbook_info_table", "before"), await load(region, "handbook_info_table", "after")] : [{}, {}];
    return {
      charAfter, uniAfter, battleAfter, skillAfter,
      operators: diffOperators(charBefore, charAfter, ids),
      skills: diffSkills(skillBefore, skillAfter, skillIds),
      modules: diffModules({ uniequip: uniBefore, battleEquip: battleBefore }, { uniequip: uniAfter, battleEquip: battleAfter }, ids),
      biographies: diffKeyed(handbookEntries(bioBefore), handbookEntries(bioAfter), ids),
      base: diffBaseSkills(buildBefore, buildAfter, ids),
      ranges: diffKeyed(rangeBefore as Record<string, unknown>, rangeAfter as Record<string, unknown>, usedRangeIds(charAfter, ids)),
      newGlossaryTerms: newGlossaryTerms(constBefore, constAfter),
    };
  };
  const results = { en: await perRegion("en"), cn: await perRegion("cn") };

  const moduleIcons = new Set((await readdir("public/assets/operator-modules")).filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -4)));
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
    const all = regions.flatMap((region) => scope[region]);
    assets = assetCoverage(paths, {
      illustrations: all,
      skillIcons: regions.flatMap((region) => skillIconNames(results[region].skillAfter, skillIdsOf(results[region].charAfter, scope[region]))),
      moduleArt: regions.flatMap((region) => catalogModuleIds(results[region].uniAfter, scope[region], { withInitial: false })),
    });
  }
  const strip = (value: (typeof results)["en"]) => ({ operators: value.operators, skills: value.skills, modules: value.modules, biographies: value.biographies, base: value.base, ranges: value.ranges, newGlossaryTerms: value.newGlossaryTerms });
  return { roster, existing: { en: strip(results.en), cn: strip(results.cn) }, labels, skillDataGapsResolved: resolved, assets, downloadedTables: [...cache.keys()].filter((key) => key.endsWith("/after")).length };
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
