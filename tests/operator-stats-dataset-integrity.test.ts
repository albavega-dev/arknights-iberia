import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { checkDatasetLimits, validateDatasetIndex, type DatasetIndex } from "../src/game-data/operator-dataset";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions";

const directory = path.resolve("data/operator-stats");
const expectedOperators = 432;

async function readIndex(): Promise<{ index: DatasetIndex; indexBytes: number }> {
  const text = await readFile(path.join(directory, "index.json"));
  return { index: JSON.parse(text.toString("utf8")) as DatasetIndex, indexBytes: text.byteLength };
}

test("stats dataset index is valid and lists every operator with its region", async () => {
  const { index } = await readIndex();
  assert.deepEqual(validateDatasetIndex(index), []);
  const entries = Object.entries(index.operators);
  assert.equal(entries.length, expectedOperators);
  for (const [, entry] of entries) assert.ok(entry.region === "en" || entry.region === "cn");
});

test("stats dataset directory has exactly the indexed files and the index", async () => {
  const { index } = await readIndex();
  const expected = [...Object.values(index.operators).map((entry) => entry.file), "index.json"].sort();
  const actual = (await readdir(directory)).sort();
  assert.deepEqual(actual, expected);
});

test("stats dataset files match the bytes, hash, id and region in the index", async () => {
  const { index } = await readIndex();
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const content = await readFile(path.join(directory, entry.file));
    assert.equal(content.byteLength, entry.bytes, `${operatorId} bytes`);
    assert.equal(createHash("sha256").update(content).digest("hex").toUpperCase(), entry.sha256.toUpperCase(), `${operatorId} sha256`);
    const profile = JSON.parse(content.toString("utf8")) as { operatorId: string; region: string };
    assert.equal(profile.operatorId, operatorId);
    assert.equal(profile.region, entry.region);
  }
});

test("stats dataset pins the source revisions and stays within its limits", async () => {
  const { index, indexBytes } = await readIndex();
  for (const region of ["en", "cn"] as const) {
    assert.equal(index.sources[region].revision, gameDataRevisions[region]);
    assert.match(index.sources[region].revision, /^[0-9a-f]{40}$/);
  }
  assert.deepEqual(checkDatasetLimits(index, indexBytes).errors, []);
});
