import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { imageRepository, imageRevision } from "../src/game-data/asset-revisions";
import { gameDataSkillTableHashes, type GameDataRegion } from "../src/game-data/gamedata-revisions";
import { baseSkillIconLocalName, baseSkillIconsSourceDirectory, masteryIconFiles, masteryIconsSourceDirectory, roomIconLocalName, roomIconSources, roomIconsSourceDirectory, skillIconLocalName, skillIconsContractVersion, resolveSkillIconSource, type SkillIconEntry, type SkillIconsManifest } from "../src/game-data/operator-skill-icons";
import { gitBlobSha } from "../src/game-data/git-blob";
import { rawImageUrl, treeUrl } from "../src/game-data/github-requests";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import type { OperatorSkillsProfile } from "../src/game-data/operator-skills";
import { arg, exists, readJson, sha256, tableFlag } from "./operator-dataset-io";
import { readSkillsDataset } from "./generate-operator-skills";

const regions: readonly GameDataRegion[] = ["en", "cn"];
export const skillIconsRepository = imageRepository;
export const skillIconsDirectory = "skills";
const revisionPattern = /^[0-9a-f]{40}$/;

export type SkillRecord = Readonly<{ region: GameDataRegion; skillId: string }>;
export type BaseSkillRecord = Readonly<{ region: GameDataRegion; iconId: string }>;
export type SkillTable = Readonly<Record<string, { iconId?: string | null } | undefined>>;
export type PngFile = Readonly<{ bytes: number; sha256: string; width: number; height: number }>;

export function pngInfo(data: Buffer): PngFile {
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG file");
  return { bytes: data.length, sha256: sha256(data), width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Pure part of the sync: which inventoried file serves each catalog skill, and which skills have none. */
export function resolveCatalogIcons(skills: readonly SkillRecord[], skillTables: Readonly<Record<GameDataRegion, SkillTable>>, inventory: ReadonlySet<string>) {
  const bySkill: Record<GameDataRegion, Record<string, string>> = { en: {}, cn: {} };
  const missing: Record<GameDataRegion, string[]> = { en: [], cn: [] };
  const sources = new Set<string>();
  for (const { region, skillId } of skills) {
    const source = resolveSkillIconSource(skillId, skillTables[region][skillId]?.iconId, inventory);
    if (!source) { if (!missing[region].includes(skillId)) missing[region].push(skillId); continue; }
    bySkill[region][skillId] = skillIconLocalName(source);
    sources.add(source);
  }
  for (const region of regions) missing[region].sort((a, b) => a.localeCompare(b, "en"));
  return { bySkill, missing, sources: [...sources].sort((a, b) => a.localeCompare(b, "en")) };
}

/** Which inventoried base skill icons the catalog uses, and which `skillIcon` ids have no file. Fails if two ids share a local name. */
export function resolveCatalogBaseIcons(records: readonly BaseSkillRecord[], inventory: ReadonlySet<string>) {
  const missing: Record<GameDataRegion, string[]> = { en: [], cn: [] };
  const byLocal = new Map<string, string>();
  const sources = new Set<string>();
  for (const { region, iconId } of records) {
    const local = baseSkillIconLocalName(iconId);
    const previous = byLocal.get(local);
    if (previous !== undefined && previous !== iconId) throw new Error(`Base skill icons ${previous} and ${iconId} share the local name ${local}`);
    byLocal.set(local, iconId);
    if (inventory.has(`${iconId}.png`)) sources.add(`${iconId}.png`);
    else if (!missing[region].includes(iconId)) missing[region].push(iconId);
  }
  for (const region of regions) missing[region].sort((a, b) => a.localeCompare(b, "en"));
  return { missing, sources: [...sources].sort((a, b) => a.localeCompare(b, "en")) };
}

export type BaseIconFiles = Readonly<{ resolved: ReturnType<typeof resolveCatalogBaseIcons>; files: ReadonlyMap<string, PngFile>; roomFiles: ReadonlyMap<string, PngFile> }>;

export function buildSkillIconsManifest(revision: string, resolved: ReturnType<typeof resolveCatalogIcons>, files: ReadonlyMap<string, PngFile>, masteryFiles: ReadonlyMap<string, PngFile>, base: BaseIconFiles): SkillIconsManifest {
  if (!revisionPattern.test(revision)) throw new Error("The revision must be a full 40-character commit hash");
  const entry = (directory: string, source: string, info: PngFile | undefined): SkillIconEntry => {
    if (!info) throw new Error(`Missing downloaded file: ${directory}/${source}`);
    return { source: `${directory}/${source}`, url: `https://raw.githubusercontent.com/${skillIconsRepository}/${revision}/${directory}/${encodeURIComponent(source)}`, ...info };
  };
  const icons: Record<string, SkillIconEntry> = {};
  for (const source of resolved.sources) icons[skillIconLocalName(source)] = entry(skillIconsDirectory, source, files.get(source));
  const mastery = Object.fromEntries(masteryIconFiles.map((file) => [file, entry(masteryIconsSourceDirectory, file, masteryFiles.get(file))]));
  const baseSkills = Object.fromEntries(base.resolved.sources.map((source) => [baseSkillIconLocalName(source.slice(0, -".png".length)), entry(baseSkillIconsSourceDirectory, source, base.files.get(source))]));
  const rooms = Object.fromEntries(Object.entries(roomIconSources).map(([room, source]) => [roomIconLocalName(room), entry(roomIconsSourceDirectory, source, base.roomFiles.get(source))]));
  const sort = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b, "en")));
  return {
    contractVersion: skillIconsContractVersion,
    source: { repository: skillIconsRepository, revision, directory: skillIconsDirectory },
    icons: sort(icons),
    skills: { en: sort(resolved.bySkill.en), cn: sort(resolved.bySkill.cn) },
    missing: resolved.missing,
    mastery,
    baseSkills: sort(baseSkills),
    baseSkillsMissing: base.resolved.missing,
    rooms: sort(rooms),
  };
}

export type SyncDependencies = { fetch: (url: string) => Promise<Response> };
type TreeEntry = { path: string; type: string; sha: string };

/**
 * Git blob id of every file directly inside each directory of the image repository at the pinned revision. Each level
 * is listed on its own, so a large directory never needs a recursive (and possibly truncated) listing.
 */
export async function listImageDirectories(fetch: SyncDependencies["fetch"], revision: string, directories: readonly string[]): Promise<Map<string, Map<string, string>>> {
  const listings = new Map<string, TreeEntry[]>();
  const list = async (tree: string): Promise<TreeEntry[]> => {
    const cached = listings.get(tree);
    if (cached) return cached;
    const url = treeUrl(imageRepository, tree).toString();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const body = await response.json() as { tree?: TreeEntry[]; truncated?: boolean };
    if (!Array.isArray(body.tree) || body.truncated) throw new Error(`${url}: incomplete tree listing`);
    listings.set(tree, body.tree);
    return body.tree;
  };
  const result = new Map<string, Map<string, string>>();
  for (const directory of directories) {
    let tree = revision;
    for (const segment of directory.split("/")) {
      const child = (await list(tree)).find((entry) => entry.path === segment && entry.type === "tree");
      if (!child) throw new Error(`No ${directory} directory at ${revision}`);
      tree = child.sha;
    }
    result.set(directory, new Map((await list(tree)).filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha])));
  }
  return result;
}

/** Source path ("skills/skill_icon_x.png") -> SHA-256 of every file a skill icons manifest lists. */
export function recordedHashes(manifest: SkillIconsManifest | null): Map<string, string> {
  if (!manifest) return new Map();
  return new Map([manifest.icons, manifest.mastery, manifest.baseSkills, manifest.rooms].flatMap((group) => Object.values(group).map((entry) => [entry.source, entry.sha256] as const)));
}

const defaultDependencies: SyncDependencies = { fetch: (url) => fetch(url) };

export type SkillIconsInput = Readonly<{
  profiles: readonly OperatorSkillsProfile[];
  skillTables: Readonly<Record<GameDataRegion, SkillTable>>;
  /** The manifest being replaced: its SHA-256 must still match every file it lists. */
  previous: SkillIconsManifest | null;
  cacheDir: string | null;
}>;
export type SkillIconsOutput = Readonly<{ manifest: SkillIconsManifest; icons: Map<string, Buffer>; mastery: Map<string, Buffer>; baseSkills: Map<string, Buffer>; rooms: Map<string, Buffer> }>;

/**
 * Downloads the skill, mastery, base skill and room icons the catalog uses from Arknight-Images at the pinned revision
 * (`imageRevision`). Each file is checked against the git blob id of the pinned tree and, when the previous manifest lists
 * it, against its recorded SHA-256. Returns the manifest and the files under their local names.
 */
export async function collectSkillIcons(input: SkillIconsInput, dependencies: SyncDependencies = defaultDependencies): Promise<SkillIconsOutput> {
  const revision = imageRevision;
  const recorded = recordedHashes(input.previous);
  const listings = await listImageDirectories(dependencies.fetch, revision, [skillIconsDirectory, masteryIconsSourceDirectory, baseSkillIconsSourceDirectory, roomIconsSourceDirectory]);
  const inventory = (directory: string) => new Set([...listings.get(directory)!.keys()].filter((name) => name.endsWith(".png")));
  const download = async (directory: string, name: string): Promise<Buffer> => {
    const path = `${directory}/${name}`;
    const blob = listings.get(directory)!.get(name);
    if (!blob) throw new Error(`${path} is not in the pinned tree`);
    const cached = input.cacheDir ? join(input.cacheDir, path) : null;
    let data = cached && await exists(cached) ? await readFile(cached) : null;
    if (!data || gitBlobSha(data) !== blob) {
      const response = await dependencies.fetch(rawImageUrl(revision, path).toString());
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (gitBlobSha(data) !== blob) throw new Error(`${path}: the download does not match the git blob hash`);
      if (cached) { await mkdir(dirname(cached), { recursive: true }); await writeFile(cached, data); }
    }
    const expected = recorded.get(path);
    if (expected && sha256(data) !== expected) throw new Error(`${path}: SHA-256 differs from the manifest`);
    return data;
  };
  const downloadAll = async (directory: string, names: readonly string[]) => {
    const files = new Map<string, Buffer>();
    for (const name of names) files.set(name, await download(directory, name));
    return files;
  };
  const infos = (files: ReadonlyMap<string, Buffer>) => new Map([...files].map(([name, data]) => [name, pngInfo(data)]));

  const skills = input.profiles.flatMap((profile) => profile.skills.map((skill) => ({ region: profile.region as GameDataRegion, skillId: skill.skillId })));
  const resolved = resolveCatalogIcons(skills, input.skillTables, inventory(skillIconsDirectory));
  const files = await downloadAll(skillIconsDirectory, resolved.sources);
  const masteryFiles = await downloadAll(masteryIconsSourceDirectory, masteryIconFiles);
  const baseRecords = input.profiles.flatMap((profile) => profile.baseSkills.flatMap((slot) => slot.stages.map((stage) => ({ region: profile.region as GameDataRegion, iconId: stage.icon }))));
  const baseResolved = resolveCatalogBaseIcons(baseRecords, inventory(baseSkillIconsSourceDirectory));
  const baseFiles = await downloadAll(baseSkillIconsSourceDirectory, baseResolved.sources);
  const roomFiles = await downloadAll(roomIconsSourceDirectory, Object.values(roomIconSources));
  return {
    manifest: buildSkillIconsManifest(revision, resolved, infos(files), infos(masteryFiles), { resolved: baseResolved, files: infos(baseFiles), roomFiles: infos(roomFiles) }),
    icons: new Map([...files].map(([source, data]) => [skillIconLocalName(source), data])),
    mastery: masteryFiles,
    baseSkills: new Map([...baseFiles].map(([source, data]) => [baseSkillIconLocalName(source.slice(0, -".png".length)), data])),
    rooms: new Map(Object.entries(roomIconSources).map(([room, source]) => [roomIconLocalName(room), roomFiles.get(source)!])),
  };
}

export async function main(argv: readonly string[] = process.argv, dependencies: SyncDependencies = defaultDependencies): Promise<void> {
  if (argv.includes("--revision")) throw new Error("The source revision is fixed: imageRevision in src/game-data/asset-revisions.ts");
  const outManifest = arg("--out-manifest", argv);
  const outDirectories = { icons: arg("--out-assets", argv), mastery: arg("--out-mastery-assets", argv), baseSkills: arg("--out-base-skill-assets", argv), rooms: arg("--out-room-assets", argv) };
  if ((await Promise.all([outManifest, ...Object.values(outDirectories)].map(exists))).some(Boolean) && !argv.includes("--force")) throw new Error("Output exists; pass --force to overwrite");
  const skillTables = {} as Record<GameDataRegion, SkillTable>;
  for (const region of regions) {
    const path = arg(tableFlag(region, "skill_table"), argv);
    if (sha256(await readFile(path)) !== gameDataSkillTableHashes[region].skill_table) throw new Error(`Snapshot SHA-256 mismatch: ${tableFlag(region, "skill_table")}`);
    skillTables[region] = await readJson(path) as SkillTable;
  }
  const output = await collectSkillIcons({
    profiles: (await readSkillsDataset(arg("--skills-dir", argv))).profiles,
    skillTables,
    previous: await exists(outManifest) ? await readJson(outManifest) as SkillIconsManifest : null,
    cacheDir: argv.includes("--cache-dir") ? arg("--cache-dir", argv) : null,
  }, dependencies);
  for (const [group, directory] of Object.entries(outDirectories) as [keyof typeof outDirectories, string][]) {
    await mkdir(directory, { recursive: true });
    for (const [name, data] of output[group]) await writeFile(join(directory, name), data);
  }
  await writeFile(outManifest, serializeDatasetJson(output.manifest), "utf8");
  const { manifest } = output;
  console.log(`Wrote ${output.icons.size} icons; skills with icon EN ${Object.keys(manifest.skills.en).length}, CN ${Object.keys(manifest.skills.cn).length}; without icon EN ${manifest.missing.en.length}, CN ${manifest.missing.cn.length}`);
  console.log(`Wrote ${output.baseSkills.size} base skill icons (without file EN ${manifest.baseSkillsMissing.en.length}, CN ${manifest.baseSkillsMissing.cn.length}) and ${output.rooms.size} room icons`);
}

if (process.argv[1]?.endsWith("sync-operator-skill-icons.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
