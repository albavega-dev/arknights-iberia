import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { buildCatalogRecords, type CatalogTableHashes, type RegionalManifest, type ReleaseManifest } from "../scripts/generate-operator-bundle";
import { biographiesDirectory, buildCatalogDataset, catalogDirectory, main, readCatalogDataset } from "../scripts/generate-operator-catalog";
import { validateOperatorCatalog, type OperatorCatalog } from "../src/game-data/operator-catalog";
import { compareCodeUnits } from "../src/game-data/string-order";

const character = (name: string) => ({ name, profession: "WARRIOR", rarity: "TIER_6", isNotObtainable: false, phases: [{}], subProfessionId: "swordmaster" });
const tables = {
  enCharacter: { char_a: character("Alpha"), char_b: character("Beta") },
  cnCharacter: { char_a: character("阿尔法"), char_b: character("贝塔"), char_cn: character("伽马"), char_cn2: character("德尔塔") },
  enHandbook: { handbookDict: Object.fromEntries(["char_a", "char_b"].map((id) => [id, { storyTextAudio: [{ storyTitle: "Basic Info", stories: [{ storyText: "[Race] Sarkaz" }] }] }])) },
  cnHandbook: { handbookDict: Object.fromEntries(["char_cn", "char_cn2"].map((id) => [id, { storyTextAudio: [{ storyTitle: "基础档案", stories: [{ storyText: "【种族】萨卡兹" }] }] }])) },
};
const release: ReleaseManifest = { releaseDateStatus: "verified", coverage: { datedCnDates: 2, undatedCnDates: 0 }, operators: [{ id: "char_a", cnReleaseDate: "2020-01-01", source: "https://example.test/release" }, { id: "char_b", cnReleaseDate: "2020-02-02", source: "https://example.test/release" }] };
const regional = (provenance: unknown = { status: "verified", source: "https://example.test/news" }): RegionalManifest => ({
  sources: { releaseTable: "https://example.test/regional" },
  operators: [
    { id: "char_cn", nameEnglish: "Gamma", cnReleaseDate: "2026-10-09", globalReleaseDate: null, cnReleaseDateProvenance: provenance },
    { id: "char_cn2", nameEnglish: "Delta", cnReleaseDate: "2026-07-31", globalReleaseDate: null },
  ],
});
const sha = (text: string) => createHash("sha256").update(text).digest("hex").toUpperCase();
const texts = Object.fromEntries(Object.entries(tables).map(([key, value]) => [key, JSON.stringify(value)])) as Record<keyof typeof tables, string>;
const hashes: CatalogTableHashes = { character: { en: sha(texts.enCharacter), cn: sha(texts.cnCharacter) }, handbook: { en: sha(texts.enHandbook), cn: sha(texts.cnHandbook) } };

async function workspace(regionalManifest: RegionalManifest = regional()) {
  const directory = await mkdtemp(join(tmpdir(), "operator-catalog-generator-"));
  const argv = ["node", "generate-operator-catalog.ts"];
  for (const [key, flag] of [["enCharacter", "--en-character"], ["cnCharacter", "--cn-character"], ["enHandbook", "--en-handbook"], ["cnHandbook", "--cn-handbook"]] as const) {
    const path = join(directory, `${key}.json`);
    await writeFile(path, texts[key], "utf8");
    argv.push(flag, path);
  }
  await writeFile(join(directory, "release.json"), JSON.stringify(release), "utf8");
  await writeFile(join(directory, "regional.json"), JSON.stringify(regionalManifest), "utf8");
  const output = join(directory, "out");
  return { directory, output, argv: [...argv, "--out-dir", output], options: { hashes, releaseManifest: join(directory, "release.json"), regionalManifest: join(directory, "regional.json") } };
}

const quiet = () => { mock.method(console, "log", () => undefined); mock.method(console, "warn", () => undefined); };

test("a per-operator provenance replaces the regional source of a CN release date", () => {
  const records = buildCatalogRecords(tables, release, regional(), hashes);
  const byId = new Map(records.operators.map((operator) => [operator.id, operator]));
  assert.deepEqual([byId.get("char_cn")?.cnReleaseDateStatus, byId.get("char_cn")?.cnReleaseDateSource], ["verified", "https://example.test/news"]);
  assert.deepEqual([byId.get("char_cn2")?.cnReleaseDateStatus, byId.get("char_cn2")?.cnReleaseDateSource], ["community-listed", "https://example.test/regional"]);
  assert.equal(byId.get("char_a")?.cnReleaseDateStatus, "verified");
});

test("Global operators take the CN release date status declared by the release manifest", () => {
  const records = buildCatalogRecords(tables, { ...release, releaseDateStatus: "community-listed" }, regional(), hashes);
  assert.deepEqual(records.operators.filter((operator) => !operator.cnOnly).map((operator) => operator.cnReleaseDateStatus), ["community-listed", "community-listed"]);
  for (const releaseDateStatus of [undefined, "official"]) {
    assert.throws(() => buildCatalogRecords(tables, { ...release, releaseDateStatus }, regional(), hashes), /invalid releaseDateStatus/);
  }
});

test("an invalid provenance, or one on an entry without a date, is rejected", () => {
  for (const provenance of [{ status: "rumoured", source: "https://example.test" }, { status: "verified", source: "not a url" }, { status: "verified", source: "https://example.test", note: "x" }]) {
    assert.throws(() => buildCatalogRecords(tables, release, regional(provenance), hashes), /Invalid CN release date provenance for char_cn/);
  }
  const undated = regional();
  const operators = undated.operators!.map((entry) => entry.id === "char_cn" ? { ...entry, cnReleaseDate: null } : entry);
  assert.throws(() => buildCatalogRecords(tables, release, { ...undated, operators }, hashes), /Invalid CN release date provenance/);
});

test("the catalog carries the provenance of every record and validates", () => {
  const { catalog, biographies } = buildCatalogDataset(buildCatalogRecords(tables, release, regional(), hashes));
  assert.deepEqual(validateOperatorCatalog(catalog), []);
  assert.deepEqual(catalog.operators.map((operator) => operator.id), ["char_a", "char_b", "char_cn", "char_cn2"]);
  const gamma = catalog.operators.find((operator) => operator.id === "char_cn")!;
  assert.deepEqual([gamma.sourceLocale, gamma.cnSourceRevision === gamma.sourceRevision, gamma.regionalMetadataSource], ["cn", true, JSON.stringify({ kind: "cn-release", status: "verified", source: "https://example.test/news" })]);
  assert.equal(catalog.operators[0]!.cnSourceRevision, null);
  assert.equal(catalog.sources.en.sha256, hashes.character.en.toLowerCase());
  assert.deepEqual(biographies.records.map((record) => `${record.operatorId}/${record.region}`), ["char_a/en", "char_b/en", "char_cn/cn", "char_cn2/cn"]);
});

test("every operator needs exactly one biography from its own region", () => {
  const records = buildCatalogRecords(tables, release, regional(), hashes);
  assert.throws(() => buildCatalogDataset({ ...records, biographies: records.biographies.slice(1) }), /Biographies do not match the catalog: char_a/);
  assert.throws(() => buildCatalogDataset({ ...records, biographies: [...records.biographies, { ...records.biographies[0]!, operatorId: "char_zz" }] }), /char_zz/);
  assert.throws(() => buildCatalogDataset({ ...records, biographies: records.biographies.map((record) => record.operatorId === "char_a" ? { ...record, region: "cn" as const } : record) }), /char_a/);
});

test("writes the catalog and one biography file per operator, and reads them back", async () => {
  const { directory, output, argv, options } = await workspace();
  quiet();
  try {
    await main(argv, options);
    assert.deepEqual(await readdir(catalogDirectory(output)), ["index.json"]);
    assert.deepEqual((await readdir(biographiesDirectory(output))).sort(compareCodeUnits), ["char_a.json", "char_b.json", "char_cn.json", "char_cn2.json", "index.json"]);
    const read = await readCatalogDataset(output);
    assert.equal(read.catalog.operators.length, 4);
    assert.equal(read.biographies.records.length, 4);
    const index = JSON.parse(await readFile(join(biographiesDirectory(output), "index.json"), "utf8")) as { contractVersion: string; limits: unknown };
    assert.deepEqual([index.contractVersion, index.limits], ["1", { fileBytes: 16_384, totalBytes: 1_500_000 }]);
  } finally {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses an existing output without --force and a snapshot whose hash differs", async () => {
  const { directory, output, argv, options } = await workspace();
  quiet();
  try {
    await main(argv, options);
    await assert.rejects(main(argv, options), /Output exists; pass --force/);
    await assert.rejects(main([...argv, "--force"], { ...options, hashes: { ...hashes, handbook: { ...hashes.handbook, cn: "0".repeat(64) } } }), /Snapshot SHA-256 mismatch/);
    await assert.rejects(main(["node", "generate-operator-catalog.ts", "--out-dir", join(directory, "other")], options), /Missing --en-character/);
    assert.ok((await stat(output)).isDirectory());
  } finally {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("--verify-against accepts an identical reference and fails without writing on any difference", async () => {
  const { directory, output, argv, options } = await workspace();
  const lines: string[] = [];
  mock.method(console, "log", (line: string) => lines.push(line));
  try {
    await main(argv, options);
    const target = join(directory, "second");
    const second = argv.map((value) => value === output ? target : value);
    await main([...second, "--verify-against", output], options);
    assert.ok(lines.filter((line) => line.startsWith("Verification: 4 identical, 0 different")).length === 2);
    await rm(target, { recursive: true, force: true });
    await writeFile(join(directory, "regional.json"), JSON.stringify(regional({ status: "verified", source: "https://example.test/other" })), "utf8");
    await assert.rejects(main([...second, "--verify-against", output], options), /Verification failed \(Catalog\); output not written/);
    assert.ok(lines.some((line) => line.trim() === "char_cn: cnReleaseDateSource, regionalMetadataSource"));
    await assert.rejects(stat(target));
  } finally {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a catalog above its limit or a biography above its limit is not written", async () => {
  const { directory, output, argv, options } = await workspace();
  quiet();
  try {
    await assert.rejects(main(argv, { ...options, catalogLimits: { fileBytes: 100 } }), /Catalog is \d+ bytes, above the 100-byte limit; output not written/);
    await assert.rejects(main(argv, { ...options, biographiesLimits: { fileBytes: 100, totalBytes: 10_000 } }), /above the 100-byte limit/);
    await assert.rejects(stat(output));
  } finally {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("reading a dataset rejects a tampered biography file or catalog", async () => {
  const { directory, output, argv, options } = await workspace();
  quiet();
  try {
    await main(argv, options);
    const catalogPath = join(catalogDirectory(output), "index.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as OperatorCatalog;
    await writeFile(join(biographiesDirectory(output), "char_a.json"), "{}\n", "utf8");
    await assert.rejects(readCatalogDataset(output), /Dataset file hash mismatch: char_a.json/);
    await writeFile(catalogPath, JSON.stringify({ ...catalog, contractVersion: "9" }), "utf8");
    await assert.rejects(readCatalogDataset(output), /Invalid catalog: Unsupported contract: 9/);
  } finally {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});

test("warns when the catalog reaches 90% of its limit", async () => {
  const { directory, output, argv, options } = await workspace();
  const warnings: string[] = [];
  mock.method(console, "log", () => undefined);
  mock.method(console, "warn", (line: string) => warnings.push(line));
  try {
    await main(argv, options);
    const bytes = (await stat(join(catalogDirectory(output), "index.json"))).size;
    await main([...argv, "--force"], { ...options, catalogLimits: { fileBytes: Math.ceil(bytes / 0.95) } });
    assert.deepEqual(warnings.filter((line) => line.startsWith("Warning: Catalog is")).length, 1);
  } finally {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  }
});
