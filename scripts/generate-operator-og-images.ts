import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import { ogConversion, ogIllustrationDirectory, ogImageDirectory, ogImageFile, ogInventory, ogSiteImageFile, type OperatorOgManifest } from "../src/game-data/operator-og-images";
import { exists, readJson, sha256 } from "./operator-dataset-io";
import { loadSharp } from "./sync-operator-module-art";

// JPEG previews (1200x630) of the local E0 illustrations for Open Graph, plus a shared site image. Only the illustrations
// that are new or changed are converted; the rest are checked against the manifest. `--check` converts nothing: it fails
// when an illustration has no preview or a file differs from the manifest.

const assetsPath = "public/assets";
const manifestFile = "data/operator-og-manifest.json";
const siteSources = { background: `${assetsPath}/backgrounds/mystic-sea.png`, mark: `${assetsPath}/anchor.svg` };
const { width, height, quality } = ogConversion;

type SharpImage = {
  resize(width: number, height: number, options: { fit: "cover" | "inside"; position?: string }): SharpImage;
  blur(sigma: number): SharpImage;
  modulate(options: { brightness: number }): SharpImage;
  composite(layers: { input: Buffer; left: number; top: number }[]): SharpImage;
  jpeg(options: { quality: number; mozjpeg: boolean }): SharpImage;
  metadata(): Promise<{ width?: number }>;
  toBuffer(): Promise<Buffer>;
};
type SharpFactory = (input: Buffer) => SharpImage;

/** Illustration contained at full height over a blurred, darkened copy of itself, so no crop cuts the operator. */
async function convertOperator(sharp: SharpFactory, illustration: Buffer): Promise<Buffer> {
  const backdrop = await sharp(illustration).resize(width, height, { fit: "cover", position: "attention" }).blur(28).modulate({ brightness: 0.55 }).toBuffer();
  const subject = await sharp(illustration).resize(width, height, { fit: "inside" }).toBuffer();
  const { width: subjectWidth = width } = await sharp(subject).metadata();
  return sharp(backdrop).composite([{ input: subject, left: Math.round((width - subjectWidth) / 2), top: 0 }]).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/** Site background cropped to the card with the anchor mark in the centre. */
async function convertSite(sharp: SharpFactory, background: Buffer, mark: Buffer): Promise<Buffer> {
  const base = await sharp(background).resize(width, height, { fit: "cover", position: "centre" }).modulate({ brightness: 0.7 }).toBuffer();
  const size = 220;
  const glyph = Buffer.from(mark.toString("utf8").replaceAll("currentColor", "#f4f7fb").replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`).replace('stroke-width="2"', 'stroke-width="1.4"'));
  const icon = await sharp(glyph).toBuffer();
  return sharp(base).composite([{ input: icon, left: Math.round((width - size) / 2), top: Math.round((height - size) / 2) }]).jpeg({ quality, mozjpeg: true }).toBuffer();
}

export type GenerateResult = Readonly<{ converted: number; kept: number; removed: number }>;

/** `root` is the repository root; the tests point it to a folder with a few small images. */
export async function main(argv: readonly string[] = process.argv, root = ".", loadSharpFactory: () => SharpFactory = () => loadSharp(ogConversion.tool) as unknown as SharpFactory): Promise<GenerateResult> {
  const check = argv.includes("--check");
  const assetsRoot = join(root, assetsPath);
  const manifestPath = join(root, manifestFile);
  const outDirectory = join(assetsRoot, ogImageDirectory);
  const illustrations = ogInventory(await readdir(join(assetsRoot, ogIllustrationDirectory)));
  const previous = await exists(manifestPath) ? await readJson(manifestPath) as OperatorOgManifest : null;
  const problems: string[] = [];
  const sharp = check ? null : loadSharpFactory();
  const images: OperatorOgManifest["images"] = {};
  let converted = 0;
  for (const id of illustrations) {
    const file = ogImageFile(id);
    const source = `${ogIllustrationDirectory}/${id}_1.webp`;
    const sourceData = await readFile(join(assetsRoot, source));
    const entry = previous?.images[file];
    const target = join(outDirectory, file);
    const current = entry && entry.sourceSha256 === sha256(sourceData) && await exists(target) ? await readFile(target) : null;
    if (entry && current && sha256(current) === entry.converted.sha256) { images[file] = entry; continue; }
    if (check) { problems.push(entry && await exists(target) ? `${file}: differs from the manifest or its illustration changed` : `${file}: missing`); continue; }
    const data = await convertOperator(sharp!, sourceData);
    await mkdir(outDirectory, { recursive: true });
    await writeFile(target, data);
    images[file] = { source, sourceSha256: sha256(sourceData), converted: { bytes: data.length, sha256: sha256(data) } };
    converted++;
  }
  const background = await readFile(join(root, siteSources.background));
  const mark = await readFile(join(root, siteSources.mark));
  const siteSourcesSha = { [siteSources.background]: sha256(background), [siteSources.mark]: sha256(mark) };
  const siteTarget = join(outDirectory, ogSiteImageFile);
  const siteCurrent = previous && await exists(siteTarget) ? await readFile(siteTarget) : null;
  let site = previous?.site;
  if (!site || !siteCurrent || sha256(siteCurrent) !== site.converted.sha256 || JSON.stringify(site.sources) !== JSON.stringify(siteSourcesSha)) {
    if (check) problems.push(`${ogSiteImageFile}: missing or differs from the manifest`);
    else {
      const data = await convertSite(sharp!, background, mark);
      await mkdir(outDirectory, { recursive: true });
      await writeFile(siteTarget, data);
      site = { sources: siteSourcesSha, converted: { bytes: data.length, sha256: sha256(data) } };
      converted++;
    }
  }
  const expected = new Set([...illustrations.map(ogImageFile), ogSiteImageFile]);
  const orphans = (await exists(outDirectory) ? await readdir(outDirectory) : []).filter((name) => !expected.has(name));
  if (check) {
    for (const name of orphans) problems.push(`${name}: has no illustration`);
    if (problems.length > 0) throw new Error(`Open Graph previews out of date:\n${problems.join("\n")}`);
    console.log(`OK: ${illustrations.length} operator previews and the site image`);
    return { converted: 0, kept: illustrations.length + 1, removed: 0 };
  }
  for (const name of orphans) await rm(join(outDirectory, name));
  const manifest: OperatorOgManifest = { contractVersion: "1", conversion: { ...ogConversion }, images, site: site! };
  await writeFile(manifestPath, serializeDatasetJson(manifest), "utf8");
  const result = { converted, kept: illustrations.length + 1 - converted, removed: orphans.length };
  console.log(`Converted ${result.converted}, kept ${result.kept}, removed ${result.removed}`);
  return result;
}

if (process.argv[1]?.endsWith("generate-operator-og-images.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
