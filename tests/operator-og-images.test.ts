import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { ogConversion, ogImageFile, ogImageUrlFrom, ogInventory, ogSiteImageFile, ogSiteImageUrl, type OperatorOgManifest } from "../src/game-data/operator-og-images";
import { compareCodeUnits } from "../src/game-data/string-order";
import { loadSharp } from "../scripts/sync-operator-module-art";

const maxBytes = 300_000;
const manifest = JSON.parse(await readFile("data/operator-og-manifest.json", "utf8")) as OperatorOgManifest;
const catalog = JSON.parse(await readFile("data/operator-catalog/index.json", "utf8")) as { operators: { id: string }[] };

test("lists the operators that have an E0 illustration, sorted, and ignores E2 and other files", () => {
  assert.deepEqual(ogInventory(["char_002_amiya_2.webp", "char_003_kalts_1.webp", "char_002_amiya_1.webp", "notes.txt", "char_1.webp"]), ["char_002_amiya", "char_003_kalts"]);
});

test("uses the preview of an operator and the site image for an operator without it", () => {
  assert.equal(ogImageUrlFrom({ [ogImageFile("char_002_amiya")]: {} }, "char_002_amiya"), "/assets/operator-og-images/char_002_amiya.jpg");
  assert.equal(ogImageUrlFrom({}, "char_002_amiya"), ogSiteImageUrl());
  assert.equal(ogImageUrlFrom({ "../x.jpg": {} }, "../x"), ogSiteImageUrl());
});

test("every catalog operator with an E0 illustration has a preview listed in the manifest and on disk", async () => {
  const illustrated = new Set(ogInventory(await readdir("public/assets/operator-illustrations")));
  const missing = catalog.operators.filter((operator) => illustrated.has(operator.id) && !(ogImageFile(operator.id) in manifest.images)).map((operator) => operator.id);
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(manifest.images), [...illustrated].map(ogImageFile));
  const files = new Set(await readdir("public/assets/operator-og-images"));
  assert.deepEqual([...files].sort(compareCodeUnits), [...Object.keys(manifest.images), ogSiteImageFile].sort(compareCodeUnits));
});

test("previews are JPEG files of the fixed size, within the weight limit and with the recorded size", async () => {
  const sharp = loadSharp(ogConversion.tool) as unknown as (input: Buffer) => { metadata(): Promise<{ format?: string; width?: number; height?: number }> };
  const entries = [...Object.entries(manifest.images).map(([file, entry]) => [file, entry.converted.bytes] as const), [ogSiteImageFile, manifest.site.converted.bytes] as const];
  for (const [file, bytes] of entries) {
    const data = await readFile(`public/assets/operator-og-images/${file}`);
    assert.equal(data.length, bytes, `${file}: size recorded in the manifest`);
    assert.ok(data.length <= maxBytes, `${file}: ${data.length} bytes exceeds ${maxBytes}`);
  }
  for (const file of [ogSiteImageFile, ogImageFile("char_002_amiya")]) {
    const { format, width, height } = await sharp(await readFile(`public/assets/operator-og-images/${file}`)).metadata();
    assert.deepEqual({ format, width, height }, { format: "jpeg", width: ogConversion.width, height: ogConversion.height }, file);
  }
});
