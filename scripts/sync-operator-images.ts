import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitBlobSha } from "../src/game-data/git-blob";
import { rawImageUrl, treeUrl } from "../src/game-data/github-requests";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import { operatorImageConversions, operatorImageDirectories, operatorImageInventory, operatorImageSource, type ImageItem, type OperatorImageManifest } from "../src/game-data/operator-images";
import type { OperatorClass } from "../src/game-data/operators";
import { arg, exists, readJson, sha256 } from "./operator-dataset-io";
import { loadSharp, type Sharp, type SyncDependencies } from "./sync-operator-module-art";
import { pngInfo, type PngFile } from "./sync-operator-skill-icons";

// Illustrations and faction logos (converted to WebP) and class and subclass icons (copied as is) from Arknight-Images at the
// pinned revision, for the operators of the catalog. Each file is checked against the git blob hash of the pinned tree and,
// when the manifest already lists it, against its recorded SHA-256.

type TreeEntry = { path: string; type: string; sha: string };
type Conversion = OperatorImageManifest["conversions"]["illustrations"];
type Section = keyof typeof operatorImageDirectories;

export const rawUrl = (path: string) => rawImageUrl(operatorImageSource.revision, path).toString();

export async function convertImage(sharp: Sharp, original: Buffer, conversion: Conversion): Promise<Buffer> {
  const { maxSize, quality, alphaQuality, effort } = conversion;
  return sharp(original).resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true }).webp({ quality, alphaQuality, effort }).toBuffer();
}

async function webpInfo(sharp: Sharp, data: Buffer): Promise<PngFile> {
  const { width, height } = await sharp(data).metadata();
  if (!width || !height) throw new Error("Converted file without dimensions");
  return { bytes: data.length, sha256: sha256(data), width, height };
}

/** Blob hashes of the source directories at the pinned revision, from tree listings (no file is downloaded). */
async function readTree(fetch: SyncDependencies["fetch"]): Promise<Map<string, string>> {
  const json = async (url: string) => { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response.json() as Promise<{ tree: TreeEntry[]; truncated?: boolean }>; };
  const listings = new Map<string, TreeEntry[]>([["", (await json(treeUrl(operatorImageSource.repository, operatorImageSource.revision).toString())).tree]]);
  const listing = async (directory: string): Promise<TreeEntry[]> => {
    const cached = listings.get(directory);
    if (cached) return cached;
    const parent = directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "";
    const name = directory.slice(parent ? parent.length + 1 : 0);
    const entry = (await listing(parent)).find((item) => item.path === name && item.type === "tree");
    if (!entry) throw new Error(`No ${directory} directory at ${operatorImageSource.revision}`);
    const result = await json(treeUrl(operatorImageSource.repository, entry.sha).toString());
    if (result.truncated) throw new Error(`Truncated tree listing of ${directory}`);
    listings.set(directory, result.tree);
    return result.tree;
  };
  const blobs = new Map<string, string>();
  for (const directory of ["characters", "factions", "classes", "ui/subclass"]) {
    for (const entry of await listing(directory)) if (entry.type === "blob") blobs.set(`${directory}/${entry.path}`, entry.sha);
  }
  return blobs;
}

/** Runs the tasks with at most `limit` of them at a time, keeping the order of the results. */
export async function pool<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]!); }
  }));
  return results;
}

const defaultDependencies: SyncDependencies = { fetch: (url) => fetch(url), sharp: () => loadSharp(operatorImageConversions.illustrations.tool) };

export async function main(argv: readonly string[] = process.argv, dependencies: SyncDependencies = defaultDependencies): Promise<void> {
  const catalogPath = arg("--catalog", argv);
  const outManifest = arg("--out-manifest", argv);
  const outAssets = arg("--out-assets", argv);
  const cacheDir = argv.includes("--cache-dir") ? arg("--cache-dir", argv) : null;
  const force = argv.includes("--force");
  const outDirectories = Object.fromEntries(Object.entries(operatorImageDirectories).map(([section, directory]) => [section, join(outAssets, directory)])) as Record<Section, string>;
  if ((await Promise.all([outManifest, ...Object.values(outDirectories)].map(exists))).some(Boolean) && !force) throw new Error("Output exists; pass --force to overwrite");
  const sharp = dependencies.sharp();
  const catalog = await readJson(catalogPath) as { operators: { id: string; class: OperatorClass; subClassId: string }[] };
  const tree = await readTree(dependencies.fetch);
  const inventory = operatorImageInventory(catalog.operators, new Set(tree.keys()));
  const previous = await exists(outManifest) ? await readJson(outManifest) as OperatorImageManifest : null;
  const recorded = new Map<string, string>([
    ...[...Object.values(previous?.illustrations ?? {}), ...Object.values(previous?.factions ?? {})].map((entry) => [entry.source, entry.original.sha256] as const),
    ...[...Object.values(previous?.classes ?? {}), ...Object.values(previous?.subclasses ?? {})].map((entry) => [entry.source, entry.sha256] as const),
  ]);
  const source = async (path: string): Promise<Buffer> => {
    const blob = tree.get(path);
    if (!blob) throw new Error(`${path} is not in the pinned tree`);
    const cached = cacheDir ? join(cacheDir, path) : null;
    let data = cached && await exists(cached) ? await readFile(cached) : null;
    if (!data || gitBlobSha(data) !== blob) {
      const response = await dependencies.fetch(rawUrl(path));
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (gitBlobSha(data) !== blob) throw new Error(`${path}: the download does not match the git blob hash`);
      if (cached) { await mkdir(dirname(cached), { recursive: true }); await writeFile(cached, data); }
    }
    const expected = recorded.get(path);
    if (expected && sha256(data) !== expected) throw new Error(`${path}: SHA-256 differs from the manifest`);
    return data;
  };
  const files = new Map<Section, Map<string, Buffer>>(Object.keys(operatorImageDirectories).map((section) => [section as Section, new Map()]));
  const convert = (section: "illustrations" | "factions") => async (item: ImageItem) => {
    const original = await source(item.source);
    const webp = await convertImage(sharp, original, operatorImageConversions[section]);
    files.get(section)!.set(item.local, webp);
    return [item.local, { source: item.source, url: rawUrl(item.source), original: pngInfo(original), converted: await webpInfo(sharp, webp) }] as const;
  };
  const copy = (section: "classes" | "subclasses") => async (item: ImageItem) => {
    const data = await source(item.source);
    files.get(section)!.set(item.local, data);
    return [item.local, { source: item.source, url: rawUrl(item.source), ...pngInfo(data) }] as const;
  };
  const manifest: OperatorImageManifest = {
    contractVersion: "1",
    source: { ...operatorImageSource },
    conversions: { illustrations: { ...operatorImageConversions.illustrations }, factions: { ...operatorImageConversions.factions } },
    illustrations: Object.fromEntries(await pool(inventory.illustrations, 4, convert("illustrations"))),
    factions: Object.fromEntries(await pool(inventory.factions, 4, convert("factions"))),
    classes: Object.fromEntries(await pool(inventory.classes, 4, copy("classes"))),
    subclasses: Object.fromEntries(await pool(inventory.subclasses, 4, copy("subclasses"))),
  };
  for (const [section, written] of files) {
    const directory = outDirectories[section];
    await mkdir(directory, { recursive: true });
    for (const name of (await readdir(directory)).filter((name) => !written.has(name))) await rm(join(directory, name));
    for (const [name, data] of written) await writeFile(join(directory, name), data);
  }
  await writeFile(outManifest, serializeDatasetJson(manifest), "utf8");
  const summary = [...files].map(([section, written]) => `${written.size} ${section} (${[...written.values()].reduce((sum, data) => sum + data.length, 0)} bytes)`);
  console.log(`Wrote ${summary.join(", ")}`);
}

if (process.argv[1]?.endsWith("sync-operator-images.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
