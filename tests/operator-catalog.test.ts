import assert from "node:assert/strict";
import test from "node:test";
import { catalogOperator, isReleaseDateProvenance, regionalMetadataSource, validateOperatorCatalog, type OperatorCatalog } from "../src/game-data/operator-catalog";
import type { OperatorRecord } from "../src/game-data/operators";

const source = (region: string) => ({ repository: "owner/repo", revision: `${region}-revision`, path: `${region}/character_table.json`, sha256: "ab".repeat(32) });
const sources = { en: source("en"), cn: source("cn") };
const record = (id: string, overrides: Partial<OperatorRecord> = {}): OperatorRecord => ({
  id, name: id, cnName: "名", globalName: id, class: "Guard", subClassId: null, rarity: 6, slug: `operator-${id}`, cnOnly: false, availabilityStatus: "global-snapshot",
  cnReleaseDate: "2020-01-01", cnReleaseDateStatus: "verified", cnReleaseDateSource: "https://example.test/release", globalReleaseDate: null,
  mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null, ...overrides,
});
const catalog = (operators: OperatorCatalog["operators"] = [catalogOperator(record("char_a"), sources), catalogOperator(record("char_b", { cnOnly: true, availabilityStatus: "cn-snapshot-candidate", globalName: null, cnReleaseDate: null, cnReleaseDateStatus: null, cnReleaseDateSource: null }), sources)]): OperatorCatalog =>
  ({ contractVersion: "1", dataset: "operator-catalog", sources, limits: { fileBytes: 1000 }, operators });

test("recognises a well-formed release date provenance only", () => {
  assert.equal(isReleaseDateProvenance({ status: "verified", source: "https://example.test/news" }), true);
  assert.equal(isReleaseDateProvenance({ status: "community-listed", source: "https://example.test" }), true);
  for (const value of [null, [], "verified", { status: "verified" }, { status: "official", source: "https://example.test" }, { status: "verified", source: "http://example.test" }, { status: "verified", source: "https://example.test", extra: 1 }]) assert.equal(isReleaseDateProvenance(value), false, JSON.stringify(value));
});

test("maps records to catalog entries with their regional metadata", () => {
  assert.equal(regionalMetadataSource({ cnReleaseDateStatus: null, cnReleaseDateSource: null }), "bundle-v1");
  assert.equal(JSON.parse(regionalMetadataSource({ cnReleaseDateSource: "https://example.test" })).status, "unclassified");
  const [global, cnOnly] = catalog().operators;
  assert.deepEqual([global!.sourceLocale, global!.sourceRevision, global!.cnSourceRevision], ["en", "en-revision", null]);
  assert.deepEqual([cnOnly!.sourceLocale, cnOnly!.sourceDataVersion, cnOnly!.cnSourceRevision, cnOnly!.regionalMetadataSource], ["cn", "cn-revision", "cn-revision", "bundle-v1"]);
  assert.equal(catalogOperator({ ...record("char_c"), cnName: undefined, globalName: undefined, cnReleaseDateStatus: undefined }, sources).cnName, null);
});

test("accepts a consistent catalog", () => assert.deepEqual(validateOperatorCatalog(catalog()), []));

test("rejects malformed catalogs, sources and limits", () => {
  for (const value of [null, [], "catalog"]) assert.deepEqual(validateOperatorCatalog(value), ["Catalog is not an object"]);
  const errors = validateOperatorCatalog({ ...catalog(), contractVersion: "2", dataset: "other", sources: { en: { ...sources.en, path: "", sha256: "x" } }, limits: { fileBytes: 0 }, operators: undefined });
  assert.deepEqual(errors, ["Unsupported contract: 2", "Unexpected dataset: other", "Missing en source path", "Invalid en source hash", "Missing cn source", "Invalid limits", "Missing operators"]);
});

test("rejects invalid, unsorted, duplicated or inconsistent operators", () => {
  const [a, b] = catalog().operators;
  const cases: [OperatorCatalog["operators"], RegExp][] = [
    [[{ ...a!, rarity: 9 as never }, b!], /operators\[0\]\.rarity/],
    [[b!, a!], /not sorted by id at char_a/],
    [[a!, { ...b!, slug: a!.slug }], /Duplicate slug for char_b/],
    [[{ ...a!, extra: true } as never, b!], /Unexpected fields for char_a/],
    [[{ ...a!, sourceRevision: "old" }, b!], /Provenance of char_a does not match its source: sourceRevision/],
    [[a!, { ...b!, cnSourceRevision: null, regionalMetadataSource: "plain" }], /cnSourceRevision, regionalMetadataSource/],
  ];
  for (const [operators, pattern] of cases) assert.match(validateOperatorCatalog(catalog(operators)).join("; "), pattern);
  assert.match(validateOperatorCatalog(catalog([null as never])).join("; "), /operators\[0\]: must be an object/);
});
