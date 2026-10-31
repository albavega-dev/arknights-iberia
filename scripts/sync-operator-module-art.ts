import { createRequire } from "node:module";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { gitBlobSha } from "../src/game-data/git-blob";
import { rawImageUrl, treeUrl } from "../src/game-data/github-requests";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import { moduleArtConversion, moduleArtSource, moduleStageSources, type ModuleArtManifest } from "../src/game-data/operator-module-art";
import { arg, exists, readJson, sha256 } from "./operator-dataset-io";
import { pngInfo, type PngFile } from "./sync-operator-skill-icons";

// Module illustrations (equip/icon, converted to WebP) and level icons (equip/stage, copied as is) from Arknight-Images at the
// pinned revision. Only the files of the modules in the dataset and the three level icons are downloaded; each one is checked
// against the git blob hash of the pinned tree and, when the manifest already lists it, against its recorded SHA-256.

type SharpImage = {
  resize(width: number, height: number, options: { fit: "inside"; withoutEnlargement: boolean }): SharpImage;
  webp(options: { quality: number; alphaQuality: number; effort: number }): SharpImage;
  toBuffer(): Promise<Buffer>;
  metadata(): Promise<{ width?: number; height?: number }>;
};
export type Sharp = (input: Buffer) => SharpImage;
export type SyncDependencies = { fetch: (url: string) => Promise<Response>; sharp: () => Sharp };
type TreeEntry = { path: string; type: string; sha: string };
type FileInfo = PngFile;

/** sharp is not a dependency of the project: it is the copy Next.js installs, and its version must match the fixed conversion. */
export function loadSharp(): Sharp {
  const fromNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
  // The package does not export its package.json: read it next to the resolved entry point.
  const entry = fromNext.resolve("sharp");
  const marker = `${sep}node_modules${sep}sharp${sep}`;
  const { version } = JSON.parse(readFileSync(join(entry.slice(0, entry.lastIndexOf(marker) + marker.length), "package.json"), "utf8")) as { version: string };
  if (`sharp ${version}` !== moduleArtConversion.tool) throw new Error(`Found sharp ${version}; the conversion is fixed to ${moduleArtConversion.tool}`);
  return fromNext("sharp") as Sharp;
}

/** Module ids of the dataset, sorted: the only illustrations the sync downloads. */
export function moduleArtInventory(profiles: readonly { modules: readonly { id: string }[] }[]): string[] {
  const ids = profiles.flatMap((profile) => profile.modules.map((module) => module.id));
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate module ids in the dataset");
  return ids.sort((a, b) => a.localeCompare(b, "en"));
}

export const rawUrl = (path: string) => rawImageUrl(moduleArtSource.revision, path).toString();

export async function convertModuleArt(sharp: Sharp, original: Buffer): Promise<Buffer> {
  const { maxSize, quality, alphaQuality, effort } = moduleArtConversion;
  return sharp(original).resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true }).webp({ quality, alphaQuality, effort }).toBuffer();
}

async function webpInfo(sharp: Sharp, data: Buffer): Promise<FileInfo> {
  const { width, height } = await sharp(data).metadata();
  if (!width || !height) throw new Error("Converted file without dimensions");
  return { bytes: data.length, sha256: sha256(data), width, height };
}

export function buildModuleArtManifest(art: ReadonlyMap<string, { original: FileInfo; converted: FileInfo }>, stages: ReadonlyMap<string, FileInfo>): ModuleArtManifest {
  const source = (path: string) => { const full = `${moduleArtSource.directory}/${path}`; return { source: full, url: rawUrl(full) }; };
  return {
    contractVersion: "1",
    source: { ...moduleArtSource },
    conversion: { ...moduleArtConversion },
    art: Object.fromEntries([...art].sort(([a], [b]) => a.localeCompare(b, "en")).map(([id, files]) => [`${id}.webp`, { ...source(`icon/${id}.png`), ...files }])),
    stages: Object.fromEntries(Object.entries(moduleStageSources).map(([local, file]) => {
      const info = stages.get(local);
      if (!info) throw new Error(`Missing level icon ${file}`);
      return [local, { ...source(`stage/${file}`), ...info }];
    })),
  };
}

/** Blob hashes of equip/icon and equip/stage at the pinned revision, from the tree listing (no file is downloaded). */
async function readTree(fetch: SyncDependencies["fetch"]): Promise<Map<string, string>> {
  const json = async (url: string) => { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response.json() as Promise<{ tree: TreeEntry[]; truncated?: boolean }>; };
  const root = await json(treeUrl(moduleArtSource.repository, moduleArtSource.revision).toString());
  const directory = root.tree.find((entry) => entry.path === moduleArtSource.directory && entry.type === "tree");
  if (!directory) throw new Error(`No ${moduleArtSource.directory} directory at ${moduleArtSource.revision}`);
  const listing = await json(treeUrl(moduleArtSource.repository, directory.sha, true).toString());
  if (listing.truncated) throw new Error("Truncated tree listing");
  return new Map(listing.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
}

const defaultDependencies: SyncDependencies = { fetch: (url) => fetch(url), sharp: loadSharp };

export async function main(argv: readonly string[] = process.argv, dependencies: SyncDependencies = defaultDependencies): Promise<void> {
  const modulesDir = arg("--modules-dir", argv);
  const outManifest = arg("--out-manifest", argv);
  const outArt = arg("--out-art", argv);
  const outStages = arg("--out-stages", argv);
  const cacheDir = argv.includes("--cache-dir") ? arg("--cache-dir", argv) : null;
  const force = argv.includes("--force");
  if ((await Promise.all([outManifest, outArt, outStages].map(exists))).some(Boolean) && !force) throw new Error("Output exists; pass --force to overwrite");
  const sharp = dependencies.sharp();
  const profiles = await Promise.all((await readdir(modulesDir)).filter((name) => name.startsWith("char_") && name.endsWith(".json")).map(async (name) => await readJson(join(modulesDir, name)) as { modules: { id: string }[] }));
  const ids = moduleArtInventory(profiles);
  const previous = await exists(outManifest) ? await readJson(outManifest) as ModuleArtManifest : null;
  const recorded = new Map<string, string>([
    ...Object.values(previous?.art ?? {}).map((entry) => [entry.source, entry.original.sha256] as const),
    ...Object.values(previous?.stages ?? {}).map((entry) => [entry.source, entry.sha256] as const),
  ]);
  const tree = await readTree(dependencies.fetch);
  const source = async (path: string): Promise<Buffer> => {
    const blob = tree.get(path);
    if (!blob) throw new Error(`${moduleArtSource.directory}/${path} is not in the pinned tree`);
    const cached = cacheDir ? join(cacheDir, path) : null;
    let data = cached && await exists(cached) ? await readFile(cached) : null;
    if (!data || gitBlobSha(data) !== blob) {
      const response = await dependencies.fetch(rawUrl(`${moduleArtSource.directory}/${path}`));
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (gitBlobSha(data) !== blob) throw new Error(`${path}: the download does not match the git blob hash`);
      if (cached) { await mkdir(dirname(cached), { recursive: true }); await writeFile(cached, data); }
    }
    const expected = recorded.get(`${moduleArtSource.directory}/${path}`);
    if (expected && sha256(data) !== expected) throw new Error(`${path}: SHA-256 differs from the manifest`);
    return data;
  };
  const art = new Map<string, { original: FileInfo; converted: FileInfo }>();
  const converted = new Map<string, Buffer>();
  for (const id of ids) {
    const original = await source(`icon/${id}.png`);
    const webp = await convertModuleArt(sharp, original);
    converted.set(id, webp);
    art.set(id, { original: pngInfo(original), converted: await webpInfo(sharp, webp) });
  }
  const stageFiles = new Map<string, Buffer>();
  for (const [local, file] of Object.entries(moduleStageSources)) stageFiles.set(local, await source(`stage/${file}`));
  const manifest = buildModuleArtManifest(art, new Map([...stageFiles].map(([local, data]) => [local, pngInfo(data)])));
  await mkdir(outArt, { recursive: true });
  for (const name of (await readdir(outArt)).filter((name) => name.endsWith(".webp") && !converted.has(name.slice(0, -".webp".length)))) await rm(join(outArt, name));
  for (const [id, data] of converted) await writeFile(join(outArt, `${id}.webp`), data);
  await mkdir(outStages, { recursive: true });
  for (const [local, data] of stageFiles) await writeFile(join(outStages, local), data);
  await writeFile(outManifest, serializeDatasetJson(manifest), "utf8");
  const total = [...converted.values()].reduce((sum, data) => sum + data.length, 0);
  console.log(`Wrote ${converted.size} module illustrations (${total} bytes) and ${stageFiles.size} level icons`);
}

if (process.argv[1]?.endsWith("sync-operator-module-art.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
