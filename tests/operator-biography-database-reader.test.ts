import assert from "node:assert/strict";
import test from "node:test";
import { fixedBiographyRevisions } from "../src/game-data/operator-biography";
import { mapDrizzleBiographyRow, readBiographyByOperatorId } from "../src/server/db/operator-biography-reader";

test("maps Drizzle camelCase rows to the biography reader contract", () => {
  const mapped = mapDrizzleBiographyRow({
    operatorId: "char_134_ifrit",
    region: "en",
    sourceRepository: "synthetic/repository",
    sourceRevision: fixedBiographyRevisions.en,
    sourcePath: "synthetic/en.json",
    sourceSha256: "a".repeat(64),
    storyTitle: "Basic Info",
    originalText: "[Race] Sarkaz",
    fields: [{ key: "race", label: "Race", value: "Sarkaz", state: "value" }],
    unrecognizedLines: ["unrecognized"],
  });

  assert.equal(mapped.operator_id, "char_134_ifrit");
  assert.equal(mapped.story_title, "Basic Info");
  assert.equal(mapped.original_text, "[Race] Sarkaz");
  assert.deepEqual(mapped.fields, [{ key: "race", label: "Race", value: "Sarkaz", state: "value" }]);
  assert.deepEqual(mapped.unrecognized_lines, ["unrecognized"]);
  assert.equal(mapped.source_revision, fixedBiographyRevisions.en);
});

test("preserves the not-found contract when no Drizzle rows exist", async () => {
  const result = await readBiographyByOperatorId({ query: async () => ({ rows: [] }) }, "char_missing", "en");
  assert.deepEqual(result, { status: "not-found", operatorId: "char_missing", region: "en", revision: fixedBiographyRevisions.en });
});
