import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { gameDataRepository, gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { validateBiography } from "../src/game-data/operator-biography";
import { catalogLimits, validateOperatorCatalog, type OperatorCatalog } from "../src/game-data/operator-catalog";
import { biographiesDatasetContractVersion, checkDatasetLimits, datasetWarningRatio, validateDatasetIndex, type DatasetIndex } from "../src/game-data/operator-dataset";

const catalogPath = path.resolve("data/operator-catalog/index.json");
const biographiesDirectory = path.resolve("data/operator-biographies");
const expectedOperators = 432;
const expectedCnOnly = 17;

async function readCatalog(): Promise<{ catalog: OperatorCatalog; bytes: number }> {
  const content = await readFile(catalogPath);
  return { catalog: JSON.parse(content.toString("utf8")) as OperatorCatalog, bytes: content.byteLength };
}

async function readIndex(): Promise<{ index: DatasetIndex; indexBytes: number }> {
  const content = await readFile(path.join(biographiesDirectory, "index.json"));
  return { index: JSON.parse(content.toString("utf8")) as DatasetIndex, indexBytes: content.byteLength };
}

async function manifestIds(file: string): Promise<string[]> {
  return (JSON.parse(await readFile(path.resolve("data", file), "utf8")) as { operators: { id: string }[] }).operators.map((entry) => entry.id);
}

test("operator catalog is valid, pins the source revisions and stays within its limit", async () => {
  const { catalog, bytes } = await readCatalog();
  assert.deepEqual(validateOperatorCatalog(catalog), []);
  assert.deepEqual(catalog.limits, catalogLimits);
  assert.equal(catalog.limits.fileBytes, 786_432);
  // Below the 90% warning threshold the generator reports.
  assert.ok(bytes < catalog.limits.fileBytes * datasetWarningRatio, `${bytes} bytes`);
  for (const region of ["en", "cn"] as const) {
    assert.equal(catalog.sources[region].revision, gameDataRevisions[region]);
    assert.equal(catalog.sources[region].repository, gameDataRepository);
  }
});

test("operator catalog lists exactly the operators of the release manifests in their region", async () => {
  const { catalog } = await readCatalog();
  assert.equal(catalog.operators.length, expectedOperators);
  const global = await manifestIds("operator-cn-release-manifest.json");
  const regional = await manifestIds("operator-regional-manifest.json");
  assert.deepEqual(catalog.operators.filter((entry) => !entry.cnOnly).map((entry) => entry.id), [...global].sort((a, b) => a.localeCompare(b, "en")));
  assert.deepEqual(catalog.operators.filter((entry) => entry.cnOnly).map((entry) => entry.id), [...regional].sort((a, b) => a.localeCompare(b, "en")));
  assert.equal(regional.length, expectedCnOnly);
});

test("CN release dates with their own provenance keep it in the catalog", async () => {
  const { catalog } = await readCatalog();
  const regional = JSON.parse(await readFile(path.resolve("data/operator-regional-manifest.json"), "utf8")) as { operators: { id: string; cnReleaseDate: string | null; cnReleaseDateProvenance?: { status: string; source: string } }[] };
  const declared = regional.operators.filter((entry) => entry.cnReleaseDateProvenance);
  assert.ok(declared.length > 0);
  for (const entry of declared) {
    const operator = catalog.operators.find((item) => item.id === entry.id)!;
    assert.deepEqual([operator.cnReleaseDate, operator.cnReleaseDateStatus, operator.cnReleaseDateSource], [entry.cnReleaseDate, entry.cnReleaseDateProvenance!.status, entry.cnReleaseDateProvenance!.source]);
  }
});

test("Global operators carry the CN release date status of the release manifest", async () => {
  const { catalog } = await readCatalog();
  const release = JSON.parse(await readFile(path.resolve("data/operator-cn-release-manifest.json"), "utf8")) as { releaseDateStatus: string };
  const statuses = new Set(catalog.operators.filter((entry) => !entry.cnOnly).map((entry) => entry.cnReleaseDateStatus));
  assert.deepEqual([...statuses], [release.releaseDateStatus]);
});

test("biographies index is valid and lists every catalog operator in its region", async () => {
  const { index } = await readIndex();
  const { catalog } = await readCatalog();
  assert.deepEqual(validateDatasetIndex(index, biographiesDatasetContractVersion), []);
  assert.deepEqual(Object.fromEntries(Object.entries(index.operators).map(([id, entry]) => [id, entry.region])), Object.fromEntries(catalog.operators.map((entry) => [entry.id, entry.sourceLocale])));
  for (const region of ["en", "cn"] as const) assert.equal(index.sources[region].revision, gameDataRevisions[region]);
});

test("biographies directory has exactly the indexed files and the index", async () => {
  const { index } = await readIndex();
  const expected = [...Object.values(index.operators).map((entry) => entry.file), "index.json"].sort();
  assert.deepEqual((await readdir(biographiesDirectory)).sort(), expected);
});

test("biography files match the index and are valid records of the pinned handbook", async () => {
  const { index, indexBytes } = await readIndex();
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const content = await readFile(path.join(biographiesDirectory, entry.file));
    assert.equal(content.byteLength, entry.bytes, `${operatorId} bytes`);
    assert.equal(createHash("sha256").update(content).digest("hex").toUpperCase(), entry.sha256, `${operatorId} sha256`);
    const result = validateBiography(JSON.parse(content.toString("utf8")));
    assert.ok(result.ok, `${operatorId} is a valid biography`);
    assert.deepEqual([result.value.operatorId, result.value.region], [operatorId, entry.region]);
    assert.deepEqual(result.value.source, index.sources[entry.region]);
  }
  const { errors, warnings } = checkDatasetLimits(index, indexBytes);
  assert.deepEqual([errors, warnings], [[], []]);
});
