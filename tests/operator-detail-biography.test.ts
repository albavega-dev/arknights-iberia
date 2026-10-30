import assert from "node:assert/strict";
import test from "node:test";
import { loadOperatorDetailBiography } from "../src/app/operators/[slug]/operator-detail-biography";
import type { OperatorRecord } from "../src/game-data/operators";
import type { BiographyReadResult } from "../src/game-data/operator-biography";

const operator = (id: string, slug: string, cnOnly = false): OperatorRecord => ({ id, name: id, cnName: null, globalName: null, class: "Guard", subClassId: null, rarity: 6, slug, cnOnly, availabilityStatus: cnOnly ? "cn-snapshot-candidate" : "global-snapshot", cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null });
const found = (id: string, region: "en" | "cn"): BiographyReadResult => ({ status: "found", biography: { operatorId: id, region, storyTitle: "Synthetic", source: { repository: "synthetic", revision: "a".repeat(40), path: "synthetic", sha256: "a".repeat(64) }, fields: [{ key: "field", label: "Field", value: id, state: "value" }], originalText: "Paragraph one\n\nParagraph two", unrecognizedLines: [] } });

test("resolves an EN slug to the canonical operator and reads the EN biography", async () => {
  const records = [operator("char_en", "en-operator")]; const calls: Array<[string, "en" | "cn"]> = [];
  const result = await loadOperatorDetailBiography("en-operator", records, async (id, region) => { calls.push([id, region]); return found(id, region); });
  assert.equal(result.status, "operator-found"); assert.deepEqual(calls, [["char_en", "en"]]);
});

test("resolves CN-only operators to CN biographies and preserves not-found", async () => {
  const records = [operator("char_cn", "cn-operator", true)]; const calls: Array<[string, "en" | "cn"]> = [];
  const result = await loadOperatorDetailBiography("cn-operator", records, async (id, region) => { calls.push([id, region]); return { status: "not-found", operatorId: id, region, revision: "a".repeat(40) }; });
  assert.equal(result.status, "operator-found"); assert.equal(result.biography.status, "not-found"); assert.deepEqual(calls, [["char_cn", "cn"]]);
});

test("does not query biographies for an unknown slug", async () => {
  let calls = 0; const result = await loadOperatorDetailBiography("missing", [operator("char_en", "en-operator")], async () => { calls += 1; return found("char_en", "en"); });
  assert.deepEqual(result, { status: "operator-not-found" }); assert.equal(calls, 0);
});
