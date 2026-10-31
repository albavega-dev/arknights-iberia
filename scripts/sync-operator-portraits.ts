import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import { compareCodeUnits } from "../src/game-data/string-order";
import { portraitConversion, portraitSource, portraitUrl, type PortraitManifest } from "../src/game-data/operator-portraits";
import { arg, exists, readJson, sha256 } from "./operator-dataset-io";
import { pool } from "./sync-operator-images";
import { loadSharp, type Sharp, type SyncDependencies } from "./sync-operator-module-art";
import { pngInfo, type PngFile } from "./sync-operator-skill-icons";

// Portraits of the catalog operators from the official web CDN, converted to WebP without resizing. The CDN has no revisions:
// every download is checked against the Content-MD5 the server sends, and a recorded SHA-256 must still match while the
// server keeps the same Content-MD5. The CDN refuses requests that carry a Referer; none is sent.

export const contentMd5 = (data: Buffer) => createHash("md5").update(data).digest("base64");

export async function convertPortrait(sharp: Sharp, original: Buffer): Promise<Buffer> {
  const { quality, alphaQuality, effort } = portraitConversion;
  return sharp(original).webp({ quality, alphaQuality, effort }).toBuffer();
}

async function webpInfo(sharp: Sharp, data: Buffer): Promise<PngFile> {
  const { width, height } = await sharp(data).metadata();
  if (!width || !height) throw new Error("Converted file without dimensions");
  return { bytes: data.length, sha256: sha256(data), width, height };
}

const defaultDependencies: SyncDependencies = { fetch: (url, init) => fetch(url, init), sharp: () => loadSharp(portraitConversion.tool) };

export async function main(argv: readonly string[] = process.argv, dependencies: SyncDependencies = defaultDependencies): Promise<void> {
  const catalogPath = arg("--catalog", argv);
  const outManifest = arg("--out-manifest", argv);
  const outDir = arg("--out-dir", argv);
  const cacheDir = argv.includes("--cache-dir") ? arg("--cache-dir", argv) : null;
  const force = argv.includes("--force");
  if ((await Promise.all([outManifest, outDir].map(exists))).some(Boolean) && !force) throw new Error("Output exists; pass --force to overwrite");
  const sharp = dependencies.sharp();
  const ids = ((await readJson(catalogPath)) as { operators: { id: string }[] }).operators.map((operator) => operator.id).sort(compareCodeUnits);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate operator ids in the catalog");
  const previous = await exists(outManifest) ? await readJson(outManifest) as Partial<PortraitManifest> : null;
  const recorded = previous?.contractVersion === "1" ? previous.portraits ?? {} : {};

  const fetchPortrait = async (id: string): Promise<{ data: Buffer; md5: string; etag: string } | null> => {
    const url = portraitUrl(id);
    const cached = cacheDir ? join(cacheDir, `${id}.png`) : null;
    const head = await dependencies.fetch(url, { method: "HEAD" });
    if (head.status === 404) return null;
    if (!head.ok) throw new Error(`${id}: HTTP ${head.status}`);
    const md5 = head.headers.get("content-md5");
    if (!md5) throw new Error(`${id}: the CDN sent no Content-MD5`);
    let data = cached && await exists(cached) ? await readFile(cached) : null;
    let etag = head.headers.get("etag") ?? "";
    if (!data || contentMd5(data) !== md5) {
      const response = await dependencies.fetch(url);
      if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      const sent = response.headers.get("content-md5");
      if (!sent || contentMd5(data) !== sent) throw new Error(`${id}: the download does not match its Content-MD5`);
      if (sent !== md5) throw new Error(`${id}: the portrait changed during the sync`);
      etag = response.headers.get("etag") ?? etag;
      if (cached) { await mkdir(cacheDir!, { recursive: true }); await writeFile(cached, data); }
    }
    return { data, md5, etag };
  };

  const converted = new Map<string, Buffer>();
  const missing: string[] = [];
  const entries = await pool(ids, 8, async (id) => {
    const portrait = await fetchPortrait(id);
    if (!portrait) { missing.push(id); return null; }
    const previousEntry = recorded[`${id}.webp`];
    if (previousEntry && previousEntry.contentMd5 === portrait.md5 && previousEntry.original.sha256 !== sha256(portrait.data)) throw new Error(`${id}: SHA-256 differs from the manifest`);
    const webp = await convertPortrait(sharp, portrait.data);
    converted.set(`${id}.webp`, webp);
    return [`${id}.webp`, { source: portraitUrl(id), contentMd5: portrait.md5, etag: portrait.etag, original: pngInfo(portrait.data), converted: await webpInfo(sharp, webp) }] as const;
  });
  const manifest: PortraitManifest = {
    contractVersion: "1",
    source: { ...portraitSource },
    conversion: { ...portraitConversion },
    portraits: Object.fromEntries(entries.filter((entry) => entry !== null)),
    missing: missing.sort(compareCodeUnits),
  };
  await mkdir(outDir, { recursive: true });
  for (const name of (await readdir(outDir)).filter((name) => !converted.has(name))) await rm(join(outDir, name));
  for (const [name, data] of converted) await writeFile(join(outDir, name), data);
  await writeFile(outManifest, serializeDatasetJson(manifest), "utf8");
  const total = [...converted.values()].reduce((sum, data) => sum + data.length, 0);
  console.log(`Wrote ${converted.size} portraits (${total} bytes); ${missing.length} missing on the CDN`);
}

if (process.argv[1]?.endsWith("sync-operator-portraits.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
