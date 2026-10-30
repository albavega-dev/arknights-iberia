import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildExpectedCatalog,
  buildReport,
  bundleOperatorRow,
  checkMigrations,
  catalogOperatorRow,
  compareBundle,
  compareFiles,
  operatorFingerprint,
  pickFingerprintColumns,
  verifyCatalog,
  type CatalogManifests,
  type CatalogSources,
  type DbBiographyRow,
  type DbOperatorRow,
  type ExpectedDifference,
  type VerificationInput,
} from "../src/game-data/operator-catalog-verification";
import { catalogOperator } from "../src/game-data/operator-catalog";
import type { OperatorRecord } from "../src/game-data/operators";

const manifests: CatalogManifests = {
  global: [
    { id: "char_001_a", name: "Alpha", cnReleaseDate: "2020-01-01", source: "https://example.test/release" },
    { id: "char_002_b", name: "Beta", cnReleaseDate: "2020-02-02", source: "https://example.test/release" },
  ],
  regional: [
    { id: "char_900_c", nameEnglish: "Gamma", cnReleaseDate: "2026-05-05", globalReleaseDate: null },
    { id: "char_901_d", nameEnglish: "Delta", cnReleaseDate: null, globalReleaseDate: null },
  ],
  regionalReleaseSource: "https://example.test/regional",
};
const sources: CatalogSources = {
  repository: "owner/repo",
  revisions: { en: "en-revision", cn: "cn-revision" },
  handbookHashes: { en: "AA".repeat(32), cn: "BB".repeat(32) },
};

const row = (overrides: Partial<DbOperatorRow> & Pick<DbOperatorRow, "id" | "name">): DbOperatorRow => ({
  cn_name: null,
  global_name: null,
  class_name: "Guard",
  sub_class_id: null,
  rarity: 6,
  slug: `operator-${overrides.id.replaceAll("_", "-")}`,
  source_locale: "en",
  source_repository: "owner/repo",
  source_revision: "en-revision",
  source_data_version: "en-revision",
  cn_only: false,
  availability_status: "global-snapshot",
  cn_release_date: null,
  global_release_date: null,
  main_power_nation_id: null,
  main_power_group_id: null,
  main_power_team_id: null,
  main_faction_id: null,
  cn_source_revision: null,
  regional_metadata_source: "bundle-v1",
  ...overrides,
});
const regionalRow = (id: string, name: string, cnReleaseDate: string | null, overrides: Partial<DbOperatorRow> = {}) =>
  row({ id, name, cn_only: true, source_locale: "cn", source_revision: "cn-revision", source_data_version: "cn-revision", cn_source_revision: "cn-revision", availability_status: "cn-snapshot-candidate", cn_release_date: cnReleaseDate, ...overrides });

const operators = (): DbOperatorRow[] => [
  row({ id: "char_001_a", name: "Alpha", cn_release_date: "2020-01-01" }),
  row({ id: "char_002_b", name: "Beta", cn_release_date: "2020-02-02" }),
  regionalRow("char_900_c", "Gamma", "2026-05-05"),
  regionalRow("char_901_d", "Delta", null),
];
const biography = (operator_id: string, region: "en" | "cn", overrides: Partial<DbBiographyRow> = {}): DbBiographyRow => ({
  operator_id,
  region,
  source_repository: "owner/repo",
  source_revision: region === "en" ? "en-revision" : "cn-revision",
  source_path: `${region}/handbook.json`,
  source_sha256: (region === "en" ? "aa" : "bb").repeat(32),
  ...overrides,
});
const biographies = (): DbBiographyRow[] => [biography("char_001_a", "en"), biography("char_002_b", "en"), biography("char_900_c", "cn"), biography("char_901_d", "cn")];
const indexOf = (region: (id: string) => string) => Object.fromEntries(["char_001_a", "char_002_b", "char_900_c", "char_901_d"].map((id) => [id, { region: region(id) }]));
const regionOf = (id: string) => (id.startsWith("char_9") ? "cn" : "en");
const columns = { operators: ["id", "name"], operator_biographies: ["operator_id"] };

const input = (overrides: Partial<VerificationInput> = {}): VerificationInput => ({
  manifests,
  sources,
  operators: operators(),
  biographies: biographies(),
  indexes: { stats: indexOf(regionOf), skills: indexOf(regionOf), modules: indexOf(regionOf) },
  privileges: { "operators.INSERT": false, "operators.UPDATE": false },
  migrations: { journal: [{ when: 1, hash: "h1" }], applied: [{ hash: "h1", createdAt: "1" }] },
  schema: { expected: columns, actual: columns },
  ...overrides,
});
const find = (results: ReturnType<typeof verifyCatalog>, code: string) => results.find((item) => item.code === code)!;

describe("operator catalog verification", () => {
  it("accepts a consistent catalog in the legacy storage form", () => {
    const results = verifyCatalog(input());
    assert.deepEqual(results.filter((item) => item.status !== "ok").map((item) => item.code), []);
    assert.deepEqual(find(results, "names").detail, { legacy: 4, current: 0, invalid: 0 });
    assert.deepEqual(find(results, "counts").detail, { operators: 4, cnOnly: 2, global: 2 });
  });

  it("accepts the current storage form for names and detailed regional metadata", () => {
    const detailed = JSON.stringify({ kind: "cn-release", status: "verified", source: "https://example.test/release" });
    const community = JSON.stringify({ kind: "cn-release", status: "community-listed", source: "https://example.test/regional" });
    const rows = [
      row({ id: "char_001_a", name: "Alpha", cn_name: "甲", global_name: "Alpha", cn_release_date: "2020-01-01", regional_metadata_source: detailed }),
      row({ id: "char_002_b", name: "Beta", cn_name: "乙", global_name: "Beta", cn_release_date: "2020-02-02", regional_metadata_source: detailed }),
      regionalRow("char_900_c", "Gamma", "2026-05-05", { cn_name: "丙", regional_metadata_source: community }),
      regionalRow("char_901_d", "Delta", null, { cn_name: "丁" }),
    ];
    const results = verifyCatalog(input({ operators: rows }));
    assert.deepEqual(results.filter((item) => item.status !== "ok").map((item) => item.code), []);
    assert.deepEqual(find(results, "names").detail, { legacy: 0, current: 4, invalid: 0 });
    assert.deepEqual(find(results, "regional-metadata").detail, { legacy: 1, detailed: 3 });
  });

  it("reports missing, extra and duplicated IDs", () => {
    const duplicated: CatalogManifests = { ...manifests, regional: [...manifests.regional, { id: "char_001_a", nameEnglish: "Dup", cnReleaseDate: null, globalReleaseDate: null }] };
    const results = verifyCatalog(input({ manifests: duplicated, operators: [...operators().slice(1), row({ id: "char_777_x", name: "Extra" })] }));
    assert.deepEqual(find(results, "ids").detail, { missing: 1, extra: 1, duplicatedInManifests: 1, database: 4 });
    assert.equal(find(results, "ids").status, "fail");
    assert.deepEqual(find(results, "ids").failedIds, ["char_001_a", "char_001_a", "char_777_x"]);
  });

  it("fails the counts when the numbers differ", () => {
    const counts = find(verifyCatalog(input({ operators: operators().slice(1) })), "counts");
    assert.equal(counts.status, "fail");
    assert.equal(counts.failed, 2);
  });

  it("detects wrong region, availability and source locale", () => {
    const rows = operators();
    rows[0] = row({ id: "char_001_a", name: "Alpha", cn_release_date: "2020-01-01", cn_only: true });
    rows[1] = row({ id: "char_002_b", name: "Beta", cn_release_date: "2020-02-02", availability_status: "cn-snapshot-candidate" });
    rows[2] = regionalRow("char_900_c", "Gamma", "2026-05-05", { source_locale: "en" });
    assert.deepEqual(find(verifyCatalog(input({ operators: rows })), "region").failedIds, ["char_001_a", "char_002_b", "char_900_c"]);
  });

  it("validates names for every storage form", () => {
    const base = operators();
    const cases: [number, Partial<DbOperatorRow>][] = [
      [0, { name: "Other" }],
      [0, { cn_name: "甲", global_name: "Different" }],
      [0, { global_name: "Alpha" }],
      [2, { cn_name: "丙", global_name: "Gamma" }],
      [2, { cn_name: null, global_name: "Gamma" }],
    ];
    for (const [position, change] of cases) {
      const rows = base.map((item, index) => (index === position ? { ...item, ...change } : item));
      assert.equal(find(verifyCatalog(input({ operators: rows })), "names").status, "fail", JSON.stringify(change));
    }
    const mixed = base.map((item, index) => (index === 0 ? { ...item, cn_name: "甲", global_name: "Alpha" } : item));
    const names = find(verifyCatalog(input({ operators: mixed })), "names");
    assert.deepEqual(names.failedIds, ["mixed-name-forms"]);
  });

  it("checks the stored slug, its uniqueness and the public slugs", () => {
    const rows = operators();
    rows[0] = { ...rows[0], slug: "custom" };
    rows[1] = { ...rows[1], slug: "custom" };
    assert.deepEqual(find(verifyCatalog(input({ operators: rows })), "slug").failedIds, ["char_001_a", "char_002_b"]);
    const same = [row({ id: "char_001_a", name: "Same", cn_release_date: "2020-01-01" }), row({ id: "char_002_b", name: "Same", cn_release_date: "2020-02-02" })];
    const slug = find(verifyCatalog(input({ operators: same })), "slug");
    assert.equal(slug.detail?.publicSlugs, 2);
  });

  it("checks CN and Global release dates", () => {
    const rows = operators();
    rows[0] = { ...rows[0], cn_release_date: "2020-01-02" };
    rows[2] = { ...rows[2], global_release_date: "2026-06-06" };
    assert.deepEqual(find(verifyCatalog(input({ operators: rows })), "dates").failedIds, ["char_001_a", "char_900_c"]);
  });

  it("fails regional metadata that is neither legacy nor the expected value", () => {
    const rows = operators();
    rows[0] = { ...rows[0], regional_metadata_source: "unexpected" };
    const check = find(verifyCatalog(input({ operators: rows })), "regional-metadata");
    assert.deepEqual([check.status, check.failedIds], ["fail", ["char_001_a"]]);
  });

  it("checks the revisions and the repository", () => {
    const rows = operators();
    rows[0] = { ...rows[0], source_revision: "old" };
    rows[1] = { ...rows[1], cn_source_revision: "cn-revision" };
    rows[2] = { ...rows[2], cn_source_revision: null };
    rows[3] = { ...rows[3], source_repository: "other/repo" };
    assert.equal(find(verifyCatalog(input({ operators: rows })), "revisions").failed, 4);
  });

  it("checks biographies: region, revision, hash, duplicates, orphans and gaps", () => {
    const mismatches = [
      biography("char_001_a", "cn"),
      biography("char_002_b", "en", { source_revision: "old" }),
      biography("char_900_c", "cn", { source_sha256: "cc".repeat(32) }),
      biography("char_901_d", "cn", { source_repository: "other/repo" }),
    ];
    assert.equal(find(verifyCatalog(input({ biographies: mismatches })), "biographies").failed, 4);
    const extra = [...biographies(), biography("char_001_a", "en", { source_revision: "newer" }), biography("char_555_z", "en")];
    const check = find(verifyCatalog(input({ biographies: extra.slice(1) })), "biographies");
    assert.deepEqual(check.failedIds, ["char_001_a", "char_555_z"]);
    assert.equal(check.detail?.missing, 0);
    const duplicate = find(verifyCatalog(input({ biographies: [...biographies(), biography("char_002_b", "en")] })), "biographies");
    assert.ok(duplicate.failedIds?.includes("char_002_b"));
  });

  it("checks that every indexed operator exists in the same region", () => {
    const stats = { ...indexOf(regionOf), char_001_a: { region: "cn" }, char_404_n: { region: "en" } };
    const results = verifyCatalog(input({ indexes: { stats, skills: indexOf(regionOf), modules: Object.fromEntries(Object.entries(indexOf(regionOf)).slice(1)) } }));
    assert.deepEqual(find(results, "index-stats").failedIds, ["char_001_a", "char_404_n"]);
    assert.equal(find(results, "index-skills").status, "ok");
    assert.deepEqual([find(results, "index-modules").status, find(results, "index-modules").detail], ["ok", { withoutFile: 1 }]);
  });

  it("compares applied migrations with the journal", () => {
    const journal = [{ when: 1, hash: "h1" }, { when: 2, hash: "h2" }];
    assert.equal(checkMigrations({ journal, applied: [{ hash: "h1", createdAt: "1" }, { hash: "h2", createdAt: "2" }] }).status, "ok");
    assert.equal(checkMigrations({ journal, applied: [{ hash: "h1", createdAt: "1" }] }).failed, 2);
    assert.equal(checkMigrations({ journal, applied: [{ hash: "h1", createdAt: "1" }, { hash: "h2", createdAt: "3" }] }).failed, 1);
    assert.equal(checkMigrations({ journal, applied: [{ hash: "h1", createdAt: "1" }, { hash: "h2", createdAt: "2" }, { hash: "h3", createdAt: "4" }] }).status, "fail");
    assert.deepEqual(checkMigrations({ journal, applied: { unavailable: "42501" } }), { code: "migrations", status: "unavailable", checked: 2, failed: 0, detail: { reason: "42501" } });
  });

  it("fails when the role can write or the schema differs", () => {
    const privileges = find(verifyCatalog(input({ privileges: { "operators.INSERT": true, "operators.UPDATE": false, "operator_biographies.DELETE": true } })), "read-only-role");
    assert.deepEqual([privileges.status, privileges.failed], ["fail", 2]);
    const schema = find(verifyCatalog(input({ schema: { expected: columns, actual: { operators: ["id"] } } })), "schema-columns");
    assert.deepEqual(schema.failedIds, ["operator_biographies", "operators"]);
  });

  it("builds the expected catalog from both manifests", () => {
    const { operators: expected, duplicates } = buildExpectedCatalog(manifests);
    assert.deepEqual([expected.size, duplicates], [4, []]);
    assert.equal(expected.get("char_901_d")?.metadataSource, "bundle-v1");
  });

  it("uses the per-operator provenance of a regional date instead of the common source", () => {
    const official = { status: "verified" as const, source: "https://example.test/news" };
    const withProvenance: CatalogManifests = { ...manifests, regional: [{ ...manifests.regional[0]!, cnReleaseDateProvenance: official }, manifests.regional[1]!] };
    assert.equal(buildExpectedCatalog(withProvenance).operators.get("char_900_c")?.metadataSource, JSON.stringify({ kind: "cn-release", ...official }));
    const rows = operators().map((item) => item.id === "char_900_c" ? { ...item, regional_metadata_source: JSON.stringify({ kind: "cn-release", ...official }) } : item);
    assert.equal(find(verifyCatalog(input({ manifests: withProvenance, operators: rows })), "regional-metadata").status, "ok");
    assert.equal(find(verifyCatalog(input({ operators: rows })), "regional-metadata").status, "fail");
  });
});

describe("fingerprint and report", () => {
  it("serializes the fixed columns of each row in order", () => {
    const rows = operators();
    const picked = pickFingerprintColumns(rows[2]);
    assert.deepEqual(Object.keys(picked), ["id", "name", "cn_name", "global_name", "cn_release_date", "global_release_date", "regional_metadata_source"]);
    assert.match(operatorFingerprint(rows.map(pickFingerprintColumns)), /^[0-9a-f]{64}$/);
    assert.notEqual(operatorFingerprint([]), operatorFingerprint([picked]));
  });

  it("omits failing IDs unless details are requested and compares the fingerprint", () => {
    const checks = verifyCatalog(input({ operators: operators().slice(1) }));
    const plain = buildReport(checks, operators(), 4, { value: "a".repeat(64), dateTextValue: "b".repeat(64), timeZone: "UTC" }, false);
    assert.equal(plain.status, "fail");
    assert.ok(plain.checks.every((item) => !("failedIds" in item)));
    assert.equal(plain.fingerprint.comparison, "not-compared");
    assert.deepEqual(plain.counts, { operators: 4, cnOnly: 2, biographies: 4 });
    const detailed = buildReport(checks, operators(), 4, { value: "a".repeat(64), dateTextValue: "b".repeat(64), timeZone: "UTC", expected: "A".repeat(64) }, true);
    assert.ok(detailed.checks.some((item) => "failedIds" in item));
    assert.equal(detailed.fingerprint.comparison, "match");
    const other = buildReport([], operators(), 4, { value: "a".repeat(64), dateTextValue: "b".repeat(64), timeZone: "UTC", expected: "c".repeat(64) }, false);
    assert.deepEqual([other.status, other.fingerprint.comparison], ["ok", "mismatch"]);
  });
});

describe("bundle comparison", () => {
  const record = (id: string, overrides: Partial<OperatorRecord> = {}): OperatorRecord => ({
    id, name: id, cnName: null, globalName: null, class: "Guard", subClassId: null, rarity: 6, slug: `operator-${id}`, cnOnly: false, availabilityStatus: "global-snapshot",
    cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null, ...overrides,
  });
  const source = (revision: string) => ({ repository: "owner/repo", revision, path: "x.json", sha256: "aa".repeat(32) });
  const bundleSources = { en: source("en-revision"), cn: source("cn-revision") };
  const bio = (operatorId: string, region: "en" | "cn", title = "Title") => ({
    operatorId, region, source: source(region === "en" ? "en-revision" : "cn-revision"), storyTitle: title, originalText: "text", fields: { a: 1 }, unrecognizedLines: [], profile: { storyTitle: "P", text: "profile" },
  }) as never;
  const bundle = (operatorsList: OperatorRecord[], bios: unknown[]) => ({ sources: bundleSources, operators: operatorsList, biographies: bios }) as never;
  const stored = (operatorId: string, region: "en" | "cn", overrides: Partial<DbBiographyRow> = {}): DbBiographyRow => ({
    operator_id: operatorId, region, source_repository: "owner/repo", source_revision: region === "en" ? "en-revision" : "cn-revision", source_path: "x.json", source_sha256: "aa".repeat(32),
    story_title: "Title", original_text: "text", fields: { a: 1 }, unrecognized_lines: [], profile_story_title: "P", profile_text: "profile", ...overrides,
  });

  it("maps a bundle operator to its database row", () => {
    const dated = bundleOperatorRow(record("char_x", { cnOnly: true, cnReleaseDate: "2026-01-01", cnReleaseDateStatus: "community-listed", cnReleaseDateSource: "https://example.test" }), { sources: bundleSources });
    assert.deepEqual([dated.source_locale, dated.cn_source_revision, dated.regional_metadata_source], ["cn", "cn-revision", JSON.stringify({ kind: "cn-release", status: "community-listed", source: "https://example.test" })]);
    const unclassified = bundleOperatorRow(record("char_y", { cnReleaseDateSource: "src" }), { sources: bundleSources });
    assert.equal(JSON.parse(unclassified.regional_metadata_source!).status, "unclassified");
    assert.equal(bundleOperatorRow(record("char_z"), { sources: bundleSources }).regional_metadata_source, "bundle-v1");
  });

  it("accepts a database identical to the bundle", () => {
    const records = [record("char_a"), record("char_b", { cnOnly: true, availabilityStatus: "cn-snapshot-candidate" })];
    const rows = records.map((item) => bundleOperatorRow(item, { sources: bundleSources }));
    const result = compareBundle(bundle(records, [bio("char_a", "en")]), rows, [stored("char_a", "en")]);
    assert.deepEqual([result.status, result.checked, result.failed], ["ok", 3, 0]);
  });

  it("counts differing columns, missing and extra records without printing values", () => {
    const records = [record("char_a"), record("char_b"), record("char_c")];
    const rows = records.map((item) => bundleOperatorRow(item, { sources: bundleSources }));
    rows[0] = { ...rows[0], name: "Changed", rarity: 5 };
    rows.splice(1, 1);
    rows.push(bundleOperatorRow(record("char_extra"), { sources: bundleSources }));
    const bios = [bio("char_a", "en"), bio("char_b", "en"), bio("char_c", "en")];
    const storedRows = [stored("char_a", "en", { story_title: "Other", fields: { a: 2 } }), stored("char_c", "en"), stored("char_extra", "en")];
    const result = compareBundle(bundle(records, bios), rows, storedRows);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.detail, {
      operators: 3, biographies: 3, "biography.fields": 1, "biography.story_title": 1, "extra-biography": 1, "extra-operator": 1, "missing-biography": 1, "missing-operator": 1, name: 1, rarity: 1,
    });
    assert.deepEqual(result.failedIds, ["char_a", "char_b", "char_extra"]);
  });
});

describe("files comparison", () => {
  const source = (revision: string) => ({ repository: "owner/repo", revision, path: "x.json", sha256: "aa".repeat(32) });
  const sources = { en: source("en-revision"), cn: source("cn-revision") };
  const record = (id: string, overrides: Partial<OperatorRecord> = {}): OperatorRecord => ({
    id, name: id, cnName: "名", globalName: id, class: "Guard", subClassId: null, rarity: 6, slug: `operator-${id}`, cnOnly: false, availabilityStatus: "global-snapshot",
    cnReleaseDate: "2026-10-09", cnReleaseDateStatus: "verified", cnReleaseDateSource: "https://example.test/news", globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null, ...overrides,
  });
  const catalog = [catalogOperator(record("char_a"), sources), catalogOperator(record("char_b", { cnOnly: true, availabilityStatus: "cn-snapshot-candidate", globalName: null }), sources)];
  const bio = (operatorId: string, region: "en" | "cn") => ({ operatorId, region, source: source(`${region}-revision`), storyTitle: "Title", originalText: "text", fields: [], unrecognizedLines: [], profile: null }) as never;
  const files = { operators: catalog, biographies: [bio("char_a", "en"), bio("char_b", "cn")] };
  const stored = (operatorId: string, region: "en" | "cn", overrides: Partial<DbBiographyRow> = {}): DbBiographyRow => ({
    operator_id: operatorId, region, source_repository: "owner/repo", source_revision: `${region}-revision`, source_path: "x.json", source_sha256: "aa".repeat(32),
    story_title: "Title", original_text: "text", fields: [], unrecognized_lines: [], profile_story_title: null, profile_text: null, ...overrides,
  });
  const rows = () => catalog.map(catalogOperatorRow);
  const bios = () => [stored("char_a", "en"), stored("char_b", "cn")];
  const expected: ExpectedDifference[] = [
    { column: "cn_release_date", operators: { char_a: "2026-10-08" }, reason: "corrected date" },
    { column: "source_repository", operators: "all", reason: "legacy URL" },
    { column: "cn_source_revision", operators: "global", reason: "legacy CN revision" },
  ];

  it("maps a catalog entry to its database row", () => {
    const row = catalogOperatorRow(catalog[1]!);
    assert.deepEqual([row.source_locale, row.cn_source_revision, row.class_name, row.regional_metadata_source], ["cn", "cn-revision", "Guard", catalog[1]!.regionalMetadataSource]);
  });

  it("accepts a database identical to the files and reports the declarations with no differences", () => {
    const result = compareFiles(files, rows(), bios(), expected);
    assert.deepEqual([result.status, result.checked, result.failed, result.undeclared], ["ok", 4, 0, []]);
    assert.deepEqual(result.declared?.map((item) => [item.column, item.operators, item.differences]), [["cn_release_date", "char_a", 0], ["source_repository", "all", 0], ["cn_source_revision", "global", 0]]);
  });

  it("accepts declared differences only within their scope and stored value", () => {
    const changed = rows().map((row) => ({ ...row, source_repository: "https://github.com/owner/repo", cn_source_revision: "cn-revision", cn_release_date: "2026-10-08" }));
    const result = compareFiles(files, changed, bios(), expected);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.declared?.map((item) => item.differences), [1, 2, 1]);
    assert.deepEqual(result.undeclared, ["char_b cn_release_date"]);
    assert.deepEqual(result.detail, { operators: 2, biographies: 2, cn_release_date: 2, cn_source_revision: 1, source_repository: 2 });
    const otherValue = compareFiles(files, rows().map((row) => row.id === "char_a" ? { ...row, cn_release_date: null } : row), bios(), expected);
    assert.deepEqual(otherValue.undeclared, ["char_a cn_release_date"]);
  });

  it("never declares complete biographies, missing or extra rows", () => {
    const result = compareFiles(files, [...rows().slice(1), { ...rows()[0]!, id: "char_x" }], [stored("char_a", "en", { original_text: "other", fields: [{}] }), stored("char_z", "en")], expected);
    assert.deepEqual(result.undeclared, ["char_a biography.fields", "char_a biography.original_text", "char_a missing-operator", "char_b missing-biography", "char_x extra-operator", "char_z extra-biography"]);
    assert.equal(result.failed, 6);
  });

  it("lists at most fifty undeclared differences while counting all of them", () => {
    const many = Array.from({ length: 60 }, (_, index) => catalogOperatorRow(catalogOperator(record(`char_${String(index).padStart(3, "0")}`), sources)));
    const result = compareFiles({ operators: [], biographies: [] }, many, [], []);
    assert.deepEqual([result.failed, result.undeclared?.length], [60, 50]);
  });

  it("keeps declarations and undeclared differences in the report without details", () => {
    const report = buildReport([compareFiles(files, rows(), bios(), expected)], rows(), 2, { value: "a".repeat(64), dateTextValue: "b".repeat(64), timeZone: "UTC" }, false);
    assert.ok("declared" in report.checks[0]! && "undeclared" in report.checks[0]!);
  });
});
