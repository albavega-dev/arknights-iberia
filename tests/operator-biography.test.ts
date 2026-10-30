import assert from "node:assert/strict";
import test from "node:test";
import { extractBiography, auditBiographies, biographyReadResult, fixedBiographyRevisions, selectCurrentBiographies, validateBiography } from "../src/game-data/operator-biography";

const source = { repository: "test", revision: "fixed", path: "handbook.json", sha256: "fixed" } as const;
function handbook(storyTitle: string, storyText: string, id = "id") { return { handbookDict: { [id]: { storyTextAudio: [{ storyTitle, stories: [{ storyText }] }] } } }; }

test("extracts EN Basic Info and preserves original text", () => {
  const result = extractBiography("id", "en", handbook("Basic Info", "[Code Name] Kroos\n[Gender] Female\n[Combat Experience] Undisclosed\n[Infection Status]"), source);
  assert.ok(result); assert.equal(result.fields[0].key, "codeName"); assert.equal(result.fields[2].value, "Undisclosed"); assert.equal(result.fields[3].state, "empty"); assert.match(result.originalText, /Kroos/); assert.equal(result.profile, null);
});

test("extracts an independent EN Profile without changing Basic Info", () => {
  const value = { handbookDict: { id: { storyTextAudio: [{ storyTitle: "Basic Info", stories: [{ storyText: "[Race] Sarkaz" }] }, { storyTitle: "Profile", stories: [{ storyText: "Short profile" }] }] } } };
  const result = extractBiography("id", "en", value, source);
  assert.ok(result); assert.deepEqual(result.fields[0], { key: "race", label: "Race", value: "Sarkaz", state: "value" }); assert.deepEqual(result.profile, { storyTitle: "Profile", text: "Short profile" });
});

test("represents a missing regional Profile explicitly", () => {
  const value = handbook("基础档案", "【种族】萨卡兹");
  const result = extractBiography("id", "cn", value, source);
  assert.ok(result); assert.equal(result.profile, null);
});
test("extracts CN labels without translating values or special fields", () => {
  const result = extractBiography("id", "cn", handbook("基础档案", "【姓名】岳羽由加莉\n【入学年级】十一年级\n【出身地】未录入"), source);
  assert.ok(result); assert.equal(result.fields[0].key, "name"); assert.equal(result.fields[1].key, "unrecognized:入学年级"); assert.equal(result.fields[2].value, "未录入");
});
test("handles multiline text and missing records", () => {
  const result = extractBiography("id", "en", handbook("Basic Info", "[Infection Status]\nLine one\nLine two"), source);
  assert.ok(result); assert.equal(result.fields[0].value, "Line one\nLine two"); assert.deepEqual(result.unrecognizedLines, []); assert.equal(extractBiography("missing", "en", handbook("Basic Info", ""), source), null);
});
test("audits complete unique regional coverage", () => {
  const records = [extractBiography("a", "en", handbook("Basic Info", "[Gender] Female", "a"), source)!, extractBiography("b", "cn", handbook("基础档案", "【性别】女", "b"), source)!];
  assert.deepEqual(auditBiographies(records, ["a", "b"]), { expectedCount: 2, extractedCount: 2, missing: [], unexpected: [], coverage: { gender: 2 } });
});

test("rejects invalid IDs, regions, hashes, fields and missing text", () => {
  const record = extractBiography("a", "en", handbook("Basic Info", "[Gender] Female", "a"), source)!;
  const result = validateBiography({ ...record, operatorId: "not-an-operator", region: "jp", source: { ...source, sha256: "bad" }, fields: [{ ...record.fields[0], state: "unknown" }], originalText: undefined });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.length >= 5);
});

test("preserves unknown values and selects the configured revision, not the lexicographically highest", () => {
  const configuredRevision = "2222222";
  const lexicographicallyHigher = "zzzzzzz";
  const oldRecord = extractBiography("char_a", "en", handbook("Basic Info", "[Gender] Undisclosed", "char_a"), { ...source, revision: configuredRevision, sha256: "1".repeat(64) })!;
  const newerLookingRecord = extractBiography("char_a", "en", handbook("Basic Info", "[Gender] Female", "char_a"), { ...source, revision: lexicographicallyHigher, sha256: "2".repeat(64) })!;
  assert.equal(validateBiography(oldRecord).ok, true);
  assert.equal(oldRecord.fields[0].value, "Undisclosed");
  const selection = selectCurrentBiographies([newerLookingRecord, oldRecord], { en: configuredRevision, cn: "cn-fixed" });
  assert.deepEqual(selection.records, [oldRecord]);
  assert.deepEqual(selection.missing, []);
  assert.equal([oldRecord, newerLookingRecord].length, 2);
});

test("keeps EN and CN revisions separate", () => {
  const en = extractBiography("char_a", "en", handbook("Basic Info", "[Gender] Female", "char_a"), { ...source, revision: fixedBiographyRevisions.en, sha256: "a".repeat(64) })!;
  const cn = extractBiography("char_a", "cn", handbook("基础档案", "【性别】女", "char_a"), { ...source, revision: fixedBiographyRevisions.cn, sha256: "b".repeat(64) })!;
  assert.deepEqual(selectCurrentBiographies([en, cn]).records.map((record) => record.region), ["cn", "en"]);
});

test("reports a missing configured revision and rejects exact duplicates", () => {
  const record = extractBiography("char_a", "en", handbook("Basic Info", "[Gender] Female", "char_a"), { ...source, revision: "other", sha256: "a".repeat(64) })!;
  assert.deepEqual(selectCurrentBiographies([record], { en: "configured", cn: "cn-fixed" }).missing, [{ operatorId: "char_a", region: "en", revision: "configured" }]);
  assert.throws(() => selectCurrentBiographies([record, record], { en: "other", cn: "cn-fixed" }), /Duplicate biography revisions/);
});

test("wraps a loaded biography and reports a missing one with the pinned revision", () => {
  const record = extractBiography("char_a", "en", handbook("Basic Info", "[Gender] Female", "char_a"), source)!;
  assert.deepEqual(biographyReadResult(record, "char_a", "en"), { status: "found", biography: record });
  assert.deepEqual(biographyReadResult(null, "char_b", "en"), { status: "not-found", operatorId: "char_b", region: "en", revision: fixedBiographyRevisions.en });
});
