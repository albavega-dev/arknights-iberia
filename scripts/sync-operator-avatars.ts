import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitBlobSha } from "../src/game-data/git-blob";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import { avatarConversion, avatarDirectory, avatarInventory, avatarSource, avatarSourceDirectory, type OperatorAvatarManifest } from "../src/game-data/operator-avatars";
import { arg, exists, readJson, sha256 } from "./operator-dataset-io";
import { loadSharp, type SyncDependencies } from "./sync-operator-module-art";
import { pngInfo } from "./sync-operator-skill-icons";
import { convertImage, pool, rawUrl, readTree } from "./sync-operator-images";

// Base face avatars of the catalog operators from Arknight-Images at the pinned revision, converted to WebP. Each file is
// checked against the git blob hash of the pinned tree and, when the manifest already lists it, against its recorded SHA-256.

const defaultDependencies: SyncDependencies = { fetch: (url) => fetch(url), sharp: () => loadSharp(avatarConversion.tool) };

export async function main(argv: readonly string[] = process.argv, dependencies: SyncDependencies = defaultDependencies): Promise<void> {
  const catalogPath = arg("--catalog", argv);
  const outManifest = arg("--out-manifest", argv);
  const outDirectory = join(arg("--out-assets", argv), avatarDirectory);
  const cacheDir = argv.includes("--cache-dir") ? arg("--cache-dir", argv) : null;
  if ((await exists(outManifest) || await exists(outDirectory)) && !argv.includes("--force")) throw new Error("Output exists; pass --force to overwrite");
  const sharp = dependencies.sharp();
  const catalog = await readJson(catalogPath) as { operators: { id: string }[] };
  const tree = await readTree(dependencies.fetch, [avatarSourceDirectory]);
  const previous = await exists(outManifest) ? await readJson(outManifest) as OperatorAvatarManifest : null;
  const recorded = new Map(Object.values(previous?.avatars ?? {}).map((entry) => [entry.source, entry.original.sha256] as const));
  const written = new Map<string, Buffer>();
  const convert = async ({ source, local }: { source: string; local: string }) => {
    const blob = tree.get(source);
    if (!blob) throw new Error(`${source} is not in the pinned tree`);
    const cached = cacheDir ? join(cacheDir, source) : null;
    let data = cached && await exists(cached) ? await readFile(cached) : null;
    if (!data || gitBlobSha(data) !== blob) {
      const response = await dependencies.fetch(rawUrl(source));
      if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (gitBlobSha(data) !== blob) throw new Error(`${source}: the download does not match the git blob hash`);
      if (cached) { await mkdir(dirname(cached), { recursive: true }); await writeFile(cached, data); }
    }
    const expected = recorded.get(source);
    if (expected && sha256(data) !== expected) throw new Error(`${source}: SHA-256 differs from the manifest`);
    const webp = await convertImage(sharp, data, avatarConversion);
    const { width, height } = await sharp(webp).metadata();
    if (!width || !height) throw new Error(`${local}: converted file without dimensions`);
    written.set(local, webp);
    return [local, { source, url: rawUrl(source), original: pngInfo(data), converted: { bytes: webp.length, sha256: sha256(webp), width, height } }] as const;
  };
  const manifest: OperatorAvatarManifest = {
    contractVersion: "1",
    source: { ...avatarSource },
    conversion: { ...avatarConversion },
    avatars: Object.fromEntries(await pool(avatarInventory(catalog.operators), 4, convert)),
  };
  await mkdir(outDirectory, { recursive: true });
  for (const name of (await readdir(outDirectory)).filter((name) => !written.has(name))) await rm(join(outDirectory, name));
  for (const [name, data] of written) await writeFile(join(outDirectory, name), data);
  await writeFile(outManifest, serializeDatasetJson(manifest), "utf8");
  console.log(`Wrote ${written.size} avatars (${[...written.values()].reduce((sum, data) => sum + data.length, 0)} bytes)`);
}

if (process.argv[1]?.endsWith("sync-operator-avatars.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
