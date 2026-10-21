import assert from "node:assert/strict";
import test from "node:test";
import { fixedBiographyRevisions, type OperatorBiography } from "../src/game-data/operator-biography";
import { readBiographyByOperatorId, type BiographyReadClient } from "../src/server/db/operator-biography-reader";

const source = (region: "en" | "cn") => ({ repository: "synthetic/repository", revision: fixedBiographyRevisions[region], path: `synthetic/${region}.json`, sha256: region === "en" ? "a".repeat(64) : "b".repeat(64) });
const record = (id: string, region: "en" | "cn"): OperatorBiography => ({ operatorId: id, region, storyTitle: "Synthetic profile", source: source(region), fields: [{ key: "structured", label: "Structured", value: id, state: "value" }], originalText: `[synthetic] ${id}`, unrecognizedLines: ["synthetic-unrecognized"], profile: null });

function client(rows: readonly Record<string, unknown>[], calls: string[] = []): BiographyReadClient {
  return { query: async (text, values) => { calls.push(`${text}|${JSON.stringify(values)}`); return { rows }; } };
}

function row(value: OperatorBiography): Record<string, unknown> {
  return { operator_id: value.operatorId, region: value.region, story_title: value.storyTitle, source_repository: value.source.repository, source_revision: value.source.revision, source_path: value.source.path, source_sha256: value.source.sha256, fields: value.fields, original_text: value.originalText, unrecognized_lines: value.unrecognizedLines };
}

test("reads a current EN biography without losing JSONB or source metadata", async () => {
  const expected = record("char_1_en", "en");
  const result = await readBiographyByOperatorId(client([row(expected)]), expected.operatorId, "en");
  assert.deepEqual(result, { status: "found", biography: expected });
});

test("reads a current CN-only biography using the CN revision", async () => {
  const expected = record("char_2_cn", "cn"); const calls: string[] = [];
  const result = await readBiographyByOperatorId(client([row(expected)], calls), expected.operatorId, "cn");
  assert.equal(result.status, "found"); assert.deepEqual((result as { biography: OperatorBiography }).biography, expected);
  assert.match(calls[0], new RegExp(fixedBiographyRevisions.cn, "u"));
});

test("returns an explicit not-found result", async () => {
  const result = await readBiographyByOperatorId(client([]), "char_missing", "en");
  assert.deepEqual(result, { status: "not-found", operatorId: "char_missing", region: "en", revision: fixedBiographyRevisions.en });
});

test("uses the requested region and fixed revision to avoid ambiguity", async () => {
  const expected = record("char_multi", "en"); const calls: string[] = [];
  const result = await readBiographyByOperatorId(client([row(expected)], calls), expected.operatorId, "en");
  assert.equal(result.status, "found"); assert.match(calls[0], /operator_id = \$1/u); assert.match(calls[0], /region = \$2/u); assert.match(calls[0], /source_revision = \$3/u);
  assert.deepEqual(JSON.parse(calls[0].split("|")[1]), ["char_multi", "en", fixedBiographyRevisions.en]);
});

test("performs one parameterized read and never exposes a write path", async () => {
  const calls: string[] = []; const result = await readBiographyByOperatorId(client([], calls), "char_read_only", "cn");
  assert.equal(result.status, "not-found"); assert.equal(calls.length, 1); assert.doesNotMatch(calls[0], /INSERT|UPDATE|DELETE|DROP|TRUNCATE/iu);
});
