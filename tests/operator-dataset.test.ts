import assert from "node:assert/strict";
import test from "node:test";
import { buildDatasetIndex, checkDatasetLimits, datasetFileName, isOperatorId, serializeDatasetJson, validateDatasetIndex, type DatasetFile } from "../src/game-data/operator-dataset";

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
  assert.deepEqual(validateDatasetIndex({ contractVersion: "2", dataset: "x", sources: { en: source, cn: source } }), ["Missing operators"]);
  const errors = validateDatasetIndex({ contractVersion: "1", dataset: "", sources: { en: source }, operators: { "bad id": {}, char_a: { region: "jp", file: "other.json", bytes: 0, sha256: "nothex" } } });
  assert.deepEqual(errors, ["Unsupported contract: 1", "Missing dataset name", "Missing cn source", "Invalid operator id: bad id", "Invalid region for bad id", "Invalid size for bad id", "Invalid hash for bad id", "Unexpected file for char_a", "Invalid region for char_a", "Invalid size for char_a", "Invalid hash for char_a"]);
});

test("dataset limits fail above the limit and warn from ninety percent", () => {
  const index = buildDatasetIndex("operator-stats", { en: source, cn: source }, [file("char_a", "en", 95), file("char_b", "en", 101), file("char_c", "cn", 10)]);
  assert.deepEqual(checkDatasetLimits(index, 50, { fileBytes: 100, totalBytes: 1_000 }), { errors: ["char_b.json is 101 bytes, above the 100-byte limit"], warnings: ["char_a.json is 95 bytes, at least 90% of the 100-byte limit"] });
  assert.deepEqual(checkDatasetLimits(index, 50, { fileBytes: 1_000, totalBytes: 250 }).errors, ["Dataset operator-stats is 256 bytes, above the 250-byte limit"]);
  assert.deepEqual(checkDatasetLimits(index, 50, { fileBytes: 1_000, totalBytes: 280 }).warnings, ["Dataset operator-stats is 256 bytes, at least 90% of the 280-byte limit"]);
  assert.deepEqual(checkDatasetLimits(index, 50), { errors: [], warnings: [] });
});
