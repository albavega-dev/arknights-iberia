import test from "node:test";
import assert from "node:assert/strict";
import { applyRefreshPayload } from "../scripts/extract-terra-artist-credits";

const record = {
  operatorId: "char_test",
  operatorName: "Test",
  terraPage: "Test",
  pageId: 1,
  source: { pageUrl: "https://arknights.wiki.gg/wiki/Test", revision: 10 },
  extractedArtists: [{ name: "Existing", evidence: "|illustrator = Existing" }],
  derivedCredits: [{ artist: "Existing", role: "unknown" }],
  variants: { base: [], elite2: [] },
  status: "partial" as const,
};

test("refresh preserves a valid record on missingtitle", () => {
  const result = applyRefreshPayload(record, { id: "char_test", name: "Test" }, "Test", { url: "https://example.test", response: { error: { code: "missingtitle" } } }, null, "2026-10-19T00:00:00.000Z");
  assert.deepEqual(result.extractedArtists, record.extractedArtists);
  assert.deepEqual(result.derivedCredits, record.derivedCredits);
  assert.equal((result.lastRefreshError as { error?: { code?: string } }).error?.code, "missingtitle");
});

test("refresh preserves normalized credits when new source evidence is accepted", () => {
  const result = applyRefreshPayload(record, { id: "char_test", name: "Test" }, "Test", { url: "https://example.test", response: { parse: { pageid: 2, wikitext: "{{Operator infobox\n|illustrator = [[NewArtist]]\n|record = Test\n}}" } } }, { revision: 11, timestamp: "2026-10-18T00:00:00Z", url: "https://example.test/revision" }, "2026-10-19T00:00:00.000Z");
  assert.equal(result.extractedArtists[0].name, "NewArtist");
  assert.deepEqual(result.derivedCredits, record.derivedCredits);
  assert.equal(result.source.revision, 11);
});
