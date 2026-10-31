import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { main } from "../scripts/generate-operator-og-images";
import { ogConversion, type OperatorOgManifest } from "../src/game-data/operator-og-images";
import { compareCodeUnits } from "../src/game-data/string-order";
import { loadSharp } from "../scripts/sync-operator-module-art";

type Create = (input: { create: { width: number; height: number; channels: 3; background: string } }) => { webp(): { toBuffer(): Promise<Buffer> }; png(): { toBuffer(): Promise<Buffer> }; jpeg(): { toBuffer(): Promise<Buffer> } };
const sharp = loadSharp(ogConversion.tool) as unknown as Create;
const solid = (width: number, height: number, background: string) => sharp({ create: { width, height, channels: 3, background } });
const anchor = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="4" r="2" /></svg>';
const quiet = { log: console.log };

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "og-images-"));
  const assets = join(root, "public/assets");
  await mkdir(join(assets, "operator-illustrations"), { recursive: true });
  await mkdir(join(assets, "backgrounds"), { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(assets, "operator-illustrations/char_001_a_1.webp"), await solid(300, 400, "#aa3333").webp().toBuffer());
  await writeFile(join(assets, "operator-illustrations/char_002_b_1.webp"), await solid(500, 200, "#33aa33").webp().toBuffer());
  await writeFile(join(assets, "operator-illustrations/char_002_b_2.webp"), await solid(500, 200, "#3333aa").webp().toBuffer());
  await writeFile(join(assets, "backgrounds/mystic-sea.png"), await solid(1600, 900, "#223344").png().toBuffer());
  await writeFile(join(assets, "anchor.svg"), anchor);
  return root;
}

const readManifest = async (root: string) => JSON.parse(await readFile(join(root, "data/operator-og-manifest.json"), "utf8")) as OperatorOgManifest;
const previews = async (root: string) => (await readdir(join(root, "public/assets/operator-og-images"))).sort(compareCodeUnits);
const run = async (root: string, ...flags: string[]) => {
  console.log = () => undefined;
  try { return await main(["node", "script", ...flags], root); } finally { console.log = quiet.log; }
};

test("converts every E0 illustration and the site image to JPEG files of the fixed size and records them", async () => {
  const root = await fixture();
  try {
    assert.deepEqual(await run(root), { converted: 3, kept: 0, removed: 0 });
    assert.deepEqual(await previews(root), ["char_001_a.jpg", "char_002_b.jpg", "site.jpg"]);
    const manifest = await readManifest(root);
    assert.deepEqual(Object.keys(manifest.images), ["char_001_a.jpg", "char_002_b.jpg"]);
    assert.equal(manifest.images["char_001_a.jpg"]!.source, "operator-illustrations/char_001_a_1.webp");
    assert.deepEqual(Object.keys(manifest.site.sources), ["public/assets/backgrounds/mystic-sea.png", "public/assets/anchor.svg"]);
    for (const name of await previews(root)) {
      const data = await readFile(join(root, "public/assets/operator-og-images", name));
      const { format, width, height } = await (sharp as unknown as (input: Buffer) => { metadata(): Promise<{ format?: string; width?: number; height?: number }> })(data).metadata();
      assert.deepEqual({ format, width, height }, { format: "jpeg", width: 1200, height: 630 }, name);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a second run converts nothing and a changed illustration converts only itself", async () => {
  const root = await fixture();
  try {
    await run(root);
    const before = await readManifest(root);
    assert.deepEqual(await run(root), { converted: 0, kept: 3, removed: 0 });
    assert.deepEqual(await readManifest(root), before);
    await writeFile(join(root, "public/assets/operator-illustrations/char_001_a_1.webp"), await solid(300, 400, "#ffffff").webp().toBuffer());
    assert.deepEqual(await run(root), { converted: 1, kept: 2, removed: 0 });
    const after = await readManifest(root);
    assert.notEqual(after.images["char_001_a.jpg"]!.converted.sha256, before.images["char_001_a.jpg"]!.converted.sha256);
    assert.equal(after.images["char_002_b.jpg"]!.converted.sha256, before.images["char_002_b.jpg"]!.converted.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a changed site source regenerates the site image, a damaged preview is rebuilt and one without illustration is removed", async () => {
  const root = await fixture();
  try {
    await run(root);
    await writeFile(join(root, "public/assets/backgrounds/mystic-sea.png"), await solid(1600, 900, "#884422").png().toBuffer());
    assert.deepEqual(await run(root), { converted: 1, kept: 2, removed: 0 });
    await writeFile(join(root, "public/assets/operator-og-images/char_002_b.jpg"), "damaged");
    await writeFile(join(root, "public/assets/operator-og-images/char_999_gone.jpg"), "orphan");
    assert.deepEqual(await run(root), { converted: 1, kept: 2, removed: 1 });
    assert.deepEqual(await previews(root), ["char_001_a.jpg", "char_002_b.jpg", "site.jpg"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("--check passes when everything is current and lists every problem without writing", async () => {
  const root = await fixture();
  try {
    await assert.rejects(run(root, "--check"), /char_001_a\.jpg: missing[\s\S]*site\.jpg: missing or differs/);
    assert.deepEqual(await readdir(join(root, "data")), []);
    await run(root);
    assert.deepEqual(await run(root, "--check"), { converted: 0, kept: 3, removed: 0 });
    await writeFile(join(root, "public/assets/operator-og-images/char_001_a.jpg"), "damaged");
    await writeFile(join(root, "public/assets/operator-og-images/char_999_gone.jpg"), "orphan");
    await writeFile(join(root, "public/assets/anchor.svg"), `${anchor}\n`);
    await assert.rejects(run(root, "--check"), (error: Error) => /char_001_a\.jpg: differs from the manifest/.test(error.message) && /char_999_gone\.jpg: has no illustration/.test(error.message) && /site\.jpg: missing or differs/.test(error.message));
    assert.equal(await readFile(join(root, "public/assets/operator-og-images/char_001_a.jpg"), "utf8"), "damaged");
  } finally { await rm(root, { recursive: true, force: true }); }
});
