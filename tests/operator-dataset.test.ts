import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetIndex, checkDatasetLimits, datasetContractVersion, datasetFileName, datasetLimits, isOperatorId, serializeDatasetJson, sharedFileName, skillsDatasetContractVersion, skillsDatasetLimits, validateDatasetIndex, type DatasetFile } from "../src/game-data/operator-dataset";

const source = { repository: "example/repo", revision: "a".repeat(40), path: "en/gamedata/excel/character_table.json", sha256: "B".repeat(64) };
const file = (operatorId: string, region: "en" | "cn", bytes = 100): DatasetFile => ({ operatorId, region, text: "{}\n", bytes, sha256: "C".repeat(64) });

test("operator ids map to file names without paths", () => {
  assert.equal(isOperatorId("char_003_kalts"), true);
  assert.equal(isOperatorId("../char_003_kalts"), false);
  assert.equal(isOperatorId("CHAR_003"), false);
  assert.equal(datasetFileName("char_1015_aglna2"), "char_1015_aglna2.json");
  assert.throws(() => datasetFileName("char_003/../../secret"), /Invalid operator id/);
  assert.equal(serializeDatasetJson({ a: 1 }), "{\n  \"a\": 1\n}\n");
});

test("dataset index is sorted, carries limits and rejects duplicates", () => {
  const index = buildDatasetIndex("operator-stats", { en: source, cn: source }, [file("char_b", "en"), file("char_a", "cn")]);
  assert.deepEqual(Object.keys(index.operators), ["char_a", "char_b"]);
  assert.deepEqual(index.operators.char_a, { region: "cn", file: "char_a.json", bytes: 100, sha256: "C".repeat(64) });
  assert.deepEqual(index.limits, { fileBytes: 32_768, totalBytes: 6_000_000 });
  assert.deepEqual(validateDatasetIndex(index), []);
  assert.throws(() => buildDatasetIndex("operator-stats", { en: source, cn: source }, [file("char_a", "en"), file("char_a", "cn")]), /Duplicate dataset operator: char_a/);
});

test("dataset index validation reports each structural problem", () => {
  assert.deepEqual(validateDatasetIndex(null), ["Index is not an object"]);
  assert.deepEqual(validateDatasetIndex({ contractVersion: "2", dataset: "x", sources: { en: source, cn: source }, limits: datasetLimits }), ["Missing operators"]);
  const errors = validateDatasetIndex({ contractVersion: "1", dataset: "", sources: { en: source }, operators: { "bad id": {}, char_a: { region: "jp", file: "other.json", bytes: 0, sha256: "nothex" } } });
  assert.deepEqual(errors, ["Unsupported contract: 1", "Missing dataset name", "Missing cn source", "Invalid limits", "Invalid operator id: bad id", "Invalid region for bad id", "Invalid size for bad id", "Invalid hash for bad id", "Unexpected file for char_a", "Invalid region for char_a", "Invalid size for char_a", "Invalid hash for char_a"]);
});

test("dataset limits fail above the limit and warn from ninety percent", () => {
  const index = buildDatasetIndex("operator-stats", { en: source, cn: source }, [file("char_a", "en", 95), file("char_b", "en", 101), file("char_c", "cn", 10)]);
  assert.deepEqual(checkDatasetLimits(index, 50, { fileBytes: 100, totalBytes: 1_000 }), { errors: ["char_b.json is 101 bytes, above the 100-byte limit"], warnings: ["char_a.json is 95 bytes, at least 90% of the 100-byte limit"] });
  assert.deepEqual(checkDatasetLimits(index, 50, { fileBytes: 1_000, totalBytes: 250 }).errors, ["Dataset operator-stats is 256 bytes, above the 250-byte limit"]);
  assert.deepEqual(checkDatasetLimits(index, 50, { fileBytes: 1_000, totalBytes: 280 }).warnings, ["Dataset operator-stats is 256 bytes, at least 90% of the 280-byte limit"]);
  assert.deepEqual(checkDatasetLimits(index, 50), { errors: [], warnings: [] });
});

test("shared files are indexed, validated and counted in the limits", () => {
  const shared = (name: string, bytes = 40) => ({ name, text: "{}\n", bytes, sha256: "D".repeat(64) });
  const tables = { en: { skill_table: source }, cn: { skill_table: source } };
  const index = buildDatasetIndex("operator-skills", { en: source, cn: source }, [file("char_a", "en", 10)], { tables, shared: [shared("glossary-en"), shared("glossary-cn", 95)] });
  assert.deepEqual(Object.keys(index.shared ?? {}), ["glossary-cn", "glossary-en"]);
  assert.deepEqual(index.shared?.["glossary-en"], { file: "glossary-en.json", bytes: 40, sha256: "D".repeat(64) });
  assert.deepEqual(index.tables, tables);
  assert.deepEqual(validateDatasetIndex(index), []);
  assert.deepEqual(checkDatasetLimits(index, 5, { fileBytes: 100, totalBytes: 1_000 }), { errors: [], warnings: ["glossary-cn.json is 95 bytes, at least 90% of the 100-byte limit"] });
  assert.deepEqual(checkDatasetLimits(index, 5, { fileBytes: 90, totalBytes: 1_000 }).errors, ["glossary-cn.json is 95 bytes, above the 90-byte limit"]);
  assert.deepEqual(checkDatasetLimits(index, 5, { fileBytes: 1_000, totalBytes: 149 }).errors, ["Dataset operator-skills is 150 bytes, above the 149-byte limit"]);
  assert.equal(sharedFileName("glossary-en"), "glossary-en.json");
  for (const name of ["index", "Glossary", "../x", "a_b", ""]) assert.throws(() => sharedFileName(name), /Invalid shared file name/);
  assert.throws(() => buildDatasetIndex("x", { en: source, cn: source }, [], { shared: [shared("a"), shared("a")] }), /Duplicate shared file: a/);
  assert.equal("shared" in buildDatasetIndex("x", { en: source, cn: source }, []), false);
});

test("shared file validation reports each problem", () => {
  const index = { contractVersion: "2", dataset: "x", sources: { en: source, cn: source }, limits: datasetLimits, operators: {}, shared: { index: { file: "index.json", bytes: 1, sha256: "C".repeat(64) }, ok: { file: "other.json", bytes: 0, sha256: "bad" } } };
  assert.deepEqual(validateDatasetIndex(index), ["Invalid shared file name: index", "Unexpected file for shared ok", "Invalid size for shared ok", "Invalid hash for shared ok"]);
});

test("each dataset declares its own limits in the index and is checked against them", () => {
  assert.deepEqual(datasetLimits, { fileBytes: 32_768, totalBytes: 6_000_000 });
  assert.deepEqual(skillsDatasetLimits, { fileBytes: 65_536, totalBytes: 6_000_000 });
  const stats = buildDatasetIndex("operator-stats", { en: source, cn: source }, [file("char_a", "en", 40_000)]);
  const skills = buildDatasetIndex("operator-skills", { en: source, cn: source }, [file("char_a", "en", 40_000), file("char_b", "en", 60_000)], { limits: skillsDatasetLimits });
  assert.deepEqual(stats.limits, datasetLimits);
  assert.deepEqual(skills.limits, skillsDatasetLimits);
  assert.deepEqual(checkDatasetLimits(stats, 10).errors, ["char_a.json is 40000 bytes, above the 32768-byte limit"]);
  assert.deepEqual(checkDatasetLimits(skills, 10), { errors: [], warnings: ["char_b.json is 60000 bytes, at least 90% of the 65536-byte limit"] });
  assert.deepEqual(checkDatasetLimits(skills, 10, datasetLimits).errors.length, 2, "an explicit limit overrides the declared one");
  assert.deepEqual(validateDatasetIndex(skills), []);
  assert.deepEqual(validateDatasetIndex({ ...skills, limits: { fileBytes: 0, totalBytes: 5 } }), ["Invalid limits"]);
  assert.deepEqual(validateDatasetIndex({ ...skills, limits: { fileBytes: 10, totalBytes: 5 } }), ["Invalid limits"]);
  assert.deepEqual(validateDatasetIndex({ ...skills, limits: undefined }), ["Invalid limits"]);
});

test("each dataset declares its own contract version and is validated against the expected one", () => {
  assert.equal(datasetContractVersion, "2");
  assert.equal(skillsDatasetContractVersion, "3");
  const stats = buildDatasetIndex("operator-stats", { en: source, cn: source }, [file("char_a", "en", 10)]);
  const skills = buildDatasetIndex("operator-skills", { en: source, cn: source }, [file("char_a", "en", 10)], { contractVersion: skillsDatasetContractVersion });
  assert.equal(stats.contractVersion, "2");
  assert.equal(skills.contractVersion, "3");
  assert.deepEqual(validateDatasetIndex(stats), []);
  assert.deepEqual(validateDatasetIndex(skills, skillsDatasetContractVersion), []);
  assert.deepEqual(validateDatasetIndex(skills), ["Unsupported contract: 3"]);
  assert.deepEqual(validateDatasetIndex(stats, skillsDatasetContractVersion), ["Unsupported contract: 2"]);
});
