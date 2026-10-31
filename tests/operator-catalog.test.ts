import assert from "node:assert/strict";
import test from "node:test";
import { carryPreviousSlugs, catalogOperator, catalogOperatorRecord, isReleaseDateProvenance, regionalMetadataSource, validateOperatorCatalog, type OperatorCatalog } from "../src/game-data/operator-catalog";
import type { OperatorRecord } from "../src/game-data/operators";

const source = (region: string) => ({ repository: "owner/repo", revision: `${region}-revision`, path: `${region}/character_table.json`, sha256: "ab".repeat(32) });
const sources = { en: source("en"), cn: source("cn") };
const record = (id: string, overrides: Partial<OperatorRecord> = {}): OperatorRecord => ({
  id, name: id, cnName: "名", globalName: id, class: "Guard", subClassId: null, rarity: 6, slug: `operator-${id}`, cnOnly: false, availabilityStatus: "global-snapshot",
  cnReleaseDate: "2020-01-01", cnReleaseDateStatus: "verified", cnReleaseDateSource: "https://example.test/release", globalReleaseDate: null,
  mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null, ...overrides,
});
const catalog = (operators: OperatorCatalog["operators"] = [catalogOperator(record("char_a"), sources), catalogOperator(record("char_b", { cnOnly: true, availabilityStatus: "cn-snapshot-candidate", globalName: null, cnReleaseDate: null, cnReleaseDateStatus: null, cnReleaseDateSource: null }), sources)]): OperatorCatalog =>
  ({ contractVersion: "2", dataset: "operator-catalog", sources, limits: { fileBytes: 1000 }, operators });

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
  const errors = validateOperatorCatalog({ ...catalog(), contractVersion: "3", dataset: "other", sources: { en: { ...sources.en, path: "", sha256: "x" } }, limits: { fileBytes: 0 }, operators: undefined });
  assert.deepEqual(errors, ["Unsupported contract: 3", "Unexpected dataset: other", "Missing en source path", "Invalid en source hash", "Missing cn source", "Invalid limits", "Missing operators"]);
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

test("turns a catalog operator back into the record shown by the pages, without provenance", () => {
  const original = record("char_a", { cnName: null, mainFactionId: "rhodes" });
  const { cnReleaseDateStatus, cnReleaseDateSource, ...shown } = original;
  assert.deepEqual([cnReleaseDateStatus, cnReleaseDateSource], ["verified", "https://example.test/release"]);
  assert.deepEqual(catalogOperatorRecord(catalogOperator(original, sources)), shown);
});

test("previous slugs are sorted, well formed and never in use", () => {
  const [a, b] = catalog().operators;
  const cases: [OperatorCatalog["operators"], RegExp][] = [
    [[{ ...a!, previousSlugs: ["Old Name"] }, b!], /Invalid previous slugs for char_a/],
    [[{ ...a!, previousSlugs: "old" as never }, b!], /Invalid previous slugs for char_a/],
    [[{ ...a!, previousSlugs: ["zeta", "alpha"] }, b!], /Previous slugs of char_a are not sorted and unique/],
    [[{ ...a!, previousSlugs: ["old", "old"] }, b!], /not sorted and unique/],
    [[{ ...a!, previousSlugs: ["char-b"] }, b!], /Previous slug char-b of char_a is in use/],
    [[{ ...a!, previousSlugs: ["operator-char_b"] }, b!], /Invalid previous slugs/],
    [[{ ...a!, previousSlugs: ["old"] }, { ...b!, previousSlugs: ["old"] }], /Previous slug old belongs to char_a and char_b/],
  ];
  for (const [operators, pattern] of cases) assert.match(validateOperatorCatalog(catalog(operators)).join("; "), pattern);
  assert.deepEqual(validateOperatorCatalog(catalog([{ ...a!, previousSlugs: ["alpha", "beta"] }, b!])), []);
});

test("a regeneration keeps the previous slugs and adds the public slug of every renamed operator", () => {
  const entry = (id: string, name: string, previousSlugs: string[] = []) => ({ ...catalogOperator(record(id, { name, globalName: name }), sources), previousSlugs });
  const before = [entry("char_a", "Aigis"), entry("char_b", "Keep", ["keep-old"]), entry("char_c", "Twin")];
  const renamed = carryPreviousSlugs(before, [entry("char_a", "Aegis"), entry("char_b", "Keep"), entry("char_c", "Twin")]);
  assert.deepEqual(renamed.map((operator) => [operator.id, operator.previousSlugs]), [["char_a", ["aigis"]], ["char_b", ["keep-old"]], ["char_c", []]]);
  assert.deepEqual(carryPreviousSlugs(renamed, [entry("char_a", "Aegis"), entry("char_b", "Keep"), entry("char_c", "Twin")]), renamed, "a second run changes nothing");
  const back = carryPreviousSlugs(renamed, [entry("char_a", "Aigis"), entry("char_b", "Keep"), entry("char_c", "Twin")]);
  assert.deepEqual(back[0]!.previousSlugs, ["aegis"], "a slug in use again is no longer previous");
  const collision = carryPreviousSlugs(renamed, [entry("char_a", "Aegis"), entry("char_b", "Keep"), entry("char_c", "Aegis")]);
  assert.deepEqual(collision.map((operator) => operator.previousSlugs), [["aegis", "aigis"], ["keep-old"], ["twin"]], "the collision suffix moves the slug of both operators");
  const taken = carryPreviousSlugs(renamed, [entry("char_a", "Aegis"), entry("char_b", "Keep"), entry("char_c", "Aigis")]);
  assert.deepEqual(taken.map((operator) => operator.previousSlugs), [[], ["keep-old"], ["twin"]], "a previous slug another operator now uses is dropped");
  assert.deepEqual(carryPreviousSlugs([], [entry("char_new", "New")])[0]!.previousSlugs, []);
  for (const result of [renamed, back, collision, taken]) assert.deepEqual(validateOperatorCatalog(catalog(result)).filter((error) => /[Pp]revious slug/.test(error)), []);
});
