import assert from "node:assert/strict";
import test from "node:test";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { preflightBiographies, verifyBiographyImportEnvelope, type BiographyPreflightInput } from "../src/game-data/operator-biography-import";
import type { BiographyRegion, OperatorBiography } from "../src/game-data/operator-biography";

const revisions = gameDataRevisions;

function biography(operatorId: string, region: BiographyRegion, revision: string = revisions[region], value = "Undisclosed"): OperatorBiography {
  return {
    operatorId, region, storyTitle: region === "en" ? "Basic Info" : "基础档案",
    source: { repository: "fixture", revision, path: `${region}.json`, sha256: "a".repeat(64) },
    fields: [{ key: "dateOfBirth", label: "Date", value, state: value ? "value" : "empty" }],
    originalText: `[Date] ${value}\n[Continuation] next line`, unrecognizedLines: ["retained line"],
  };
}

function input(records: readonly OperatorBiography[], en = ["char_en"], cn = ["char_cn"]): BiographyPreflightInput {
  return { records, expected: { en, cn }, revisions, coverage: "complete" };
}

test("accepts complete synthetic EN/CN coverage and exposes an in-memory plan", () => {
  const result = preflightBiographies(input([biography("char_en", "en"), biography("char_cn", "cn")]));
  assert.equal(result.report.ok, true);
  if (result.report.ok) {
    assert.ok(result.plan);
    assert.ok("envelope" in result);
    assert.ok(result.envelope);
    assert.equal(verifyBiographyImportEnvelope(result.envelope), true);
    assert.deepEqual(result.plan.records.map((record) => record.operatorId), ["char_cn", "char_en"]);
  }
  assert.equal(result.report.expected.total, 2);
  assert.equal(result.report.selected.total, 2);
});

test("reports missing and unexpected regional operators", () => {
  const result = preflightBiographies(input([biography("char_other", "en")], ["char_en"], ["char_cn"]));
  assert.equal(result.report.ok, false);
  assert.ok(result.report.missing.some((item) => item.operatorId === "char_en"));
  assert.ok(result.report.unexpected.includes("char_other"));
});

test("rejects regional overlap and duplicate composite keys", () => {
  const result = preflightBiographies(input([biography("char_same", "en"), biography("char_same", "cn"), biography("char_en", "en"), biography("char_en", "en")] , ["char_same", "char_en"], ["char_same"]));
  assert.equal(result.report.ok, false);
  assert.ok(result.report.errors.some((error) => error.code === "regional-overlap"));
  assert.equal(result.report.duplicates.length, 1);
});

test("requires the configured revision and ignores a lexicographically greater historical revision", () => {
  const historical = biography("char_en", "en", "ffffffffffffffffffffffffffffffffffffffff", "historical");
  const current = biography("char_en", "en", revisions.en, "current");
  const result = preflightBiographies(input([historical, current], ["char_en"], []));
  assert.equal(result.report.ok, true);
  if (result.report.ok) {
    assert.ok(result.plan);
    assert.equal(result.plan.records[0]?.source.revision, revisions.en);
  }
});

test("reports invalid revision configuration and missing current records", () => {
  const result = preflightBiographies({ ...input([biography("char_en", "en")]), revisions: { en: "not-a-revision", cn: revisions.cn } });
  assert.equal(result.report.ok, false);
  assert.ok(result.report.errors.some((error) => error.code === "invalid-revision-config"));
});

test("counts unknown, empty and unrecognized fields without copying original text into the report", () => {
  const record = biography("char_en", "en", revisions.en, "");
  const sensitiveMarker = "SENSITIVE_BIOGRAPHY_MARKER";
  const withSpecialField = { ...record, originalText: sensitiveMarker, unrecognizedLines: [sensitiveMarker], fields: [{ key: "unrecognized:Special", label: "Special", value: "未公开", state: "value" as const }, ...record.fields] };
  const result = preflightBiographies(input([withSpecialField], ["char_en"], []));
  assert.equal(result.report.ok, true);
  assert.equal(result.report.fieldCoverage["unrecognized:Special"]?.unknown, 1);
  assert.equal(result.report.fieldCoverage.dateOfBirth?.empty, 1);
  const serialized = JSON.stringify(result.report);
  assert.ok(serialized.includes("unrecognized-line"));
  assert.ok(serialized.includes("records[0].unrecognizedLines[0]"));
  assert.ok(!serialized.includes(sensitiveMarker));
  assert.ok(!("originalText" in result.report));
  if (result.report.ok) {
    assert.ok(result.plan);
    assert.equal(result.plan.records[0]?.unrecognizedLines[0], sensitiveMarker);
  }
});

test("validation errors do not include invalid record content", () => {
  const sensitiveMarker = "INVALID_BIOGRAPHY_MARKER";
  const invalid = { ...biography("char_en", "en"), originalText: sensitiveMarker, fields: "not-an-array" } as unknown as OperatorBiography;
  const result = preflightBiographies(input([invalid], ["char_en"], []));
  assert.equal(result.report.ok, false);
  assert.ok(!JSON.stringify(result.report).includes(sensitiveMarker));
});

test("keeps the envelope fingerprint stable when input order changes", () => {
  const records = [biography("char_en", "en"), biography("char_cn", "cn")];
  const first = preflightBiographies(input(records));
  const second = preflightBiographies(input([...records].reverse()));
  assert.equal(first.report.ok, true);
  assert.equal(second.report.ok, true);
  if (first.report.ok && second.report.ok) {
    assert.ok("envelope" in first);
    assert.ok("envelope" in second);
    assert.equal(first.envelope.sha256, second.envelope.sha256);
  }
});

test("changes the fingerprint for text, provenance, fields and unrecognized lines", () => {
  const base = preflightBiographies(input([biography("char_en", "en")], ["char_en"], []));
  assert.equal(base.report.ok, true);
  if (!base.report.ok) return;
  assert.ok(base.plan);
  assert.ok("envelope" in base);
  const variants = [
    { ...base.plan.records[0], originalText: "changed" },
    { ...base.plan.records[0], source: { ...base.plan.records[0].source, sha256: "b".repeat(64) } },
    { ...base.plan.records[0], fields: [{ ...base.plan.records[0].fields[0], value: "changed" }] },
    { ...base.plan.records[0], unrecognizedLines: ["changed"] },
  ];
  for (const record of variants) {
    const changed = preflightBiographies(input([record], ["char_en"], []));
    assert.equal(changed.report.ok, true);
    if (changed.report.ok) {
      assert.ok("envelope" in changed);
      assert.notEqual(changed.envelope.sha256, base.envelope.sha256);
    }
  }
});

test("detects envelope mutations in records, IDs, revisions and contract version", () => {
  const result = preflightBiographies(input([biography("char_en", "en")], ["char_en"], []));
  assert.equal(result.report.ok, true);
  if (!result.report.ok) return;
  assert.ok(result.plan);
  assert.ok("envelope" in result);
  const cases = [
    { ...result.envelope, plan: { records: [{ ...result.envelope.plan.records[0], originalText: "changed" }] } },
    { ...result.envelope, expected: { ...result.envelope.expected, en: ["char_other"] } },
    { ...result.envelope, revisions: { ...result.envelope.revisions, en: "ffffffffffffffffffffffffffffffffffffffff" } },
    { ...result.envelope, contractVersion: "1" as const },
  ];
  for (const envelope of cases) assert.equal(verifyBiographyImportEnvelope(envelope as Parameters<typeof verifyBiographyImportEnvelope>[0]), false);
});
