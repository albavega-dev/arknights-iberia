import test from "node:test";
import assert from "node:assert/strict";
import { applyRefreshPayload } from "../scripts/extract-terra-artist-credits";
import { creditsFor, inGameCredit } from "../scripts/normalize-operator-artist-credits";
import { getOperatorArtistCredit } from "../src/game-data/operator-artist-credits";

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

test("a credited-as-in-game note gives the game's name, with or without quotes and after a skin name", () => {
  assert.deepEqual(inGameCredit('credited as "Ubisoft" in-game'), { credited: "Ubisoft", rest: "" });
  assert.deepEqual(inGameCredit("The Ferry Girl; credited as Studio Montagne in-game"), { credited: "Studio Montagne", rest: "The Ferry Girl" });
  assert.deepEqual(inGameCredit("Marionette's Id, credited as Studio Montagne In-Game "), { credited: "Studio Montagne", rest: "Marionette's Id" });
  for (const role of ["Master of Melodia, credited as Studio Montagne", 'credited as "熊太"', "Skin credited as X in-game", "credited as  in-game", 'credited as "" in-game', "Operator art"]) assert.equal(inGameCredit(role), null, role);
  const started = performance.now();
  for (const hostile of [`${" ".repeat(200_000)}in-game`, `${"credited as ".repeat(20_000)}x in-game`, `${";".repeat(200_000)}credited as x in-game`]) inGameCredit(hostile);
  assert.ok(performance.now() - started < 1000, "hostile notes finish well under a second");
});

test("the in-game credit is the operator art, or the art of the skin named in italics, and keeps the wiki name in the note", () => {
  const entry = (general: { name: string; role?: string; evidence: string }[], elite2: typeof general = []) => ({ operatorId: "char_x", operatorName: "X", source: {}, status: "partial" as const, general, variants: { elite2 } });
  const [art] = creditsFor(entry([{ name: "百慕大飞鱼", role: "credited as Studio Montagne in-game", evidence: "|illustrator = 百慕大飞鱼 (credited as [[Studio Montagne]] in-game)" }]));
  assert.deepEqual([art!.artist, art!.role, art!.notes], ["Studio Montagne", "operator-illustration", "Terra Wiki attributes this art to 百慕大飞鱼; the game credits Studio Montagne."]);
  assert.match(art!.evidence, /百慕大飞鱼/);
  const [skin] = creditsFor(entry([{ name: "Yukuso", role: "The Ferry Girl; credited as Studio Montagne in-game", evidence: "|illustrator = Yukuso (''The Ferry Girl;'' credited as [[Studio Montagne]] in-game)" }]));
  assert.deepEqual([skin!.artist, skin!.role, skin!.outfit], ["Studio Montagne", "promotional-art", "The Ferry Girl"]);
  const [other] = creditsFor(entry([{ name: "A", role: "Collab event, credited as B in-game", evidence: "|illustrator = A (Collab event, credited as B in-game)" }]));
  assert.deepEqual([other!.artist, other!.role], ["B", "collaboration"], "a rest that is not a skin keeps the usual classification");
  const [variant] = creditsFor(entry([], [{ name: "A", role: 'credited as "Ubisoft" in-game', evidence: "|illustrator = A (credited as \"Ubisoft\" in-game) Elite 2" }]));
  assert.deepEqual([variant!.artist, variant!.variant], ["Ubisoft", "elite2"]);
  assert.deepEqual(getOperatorArtistCredit("char_4220_kormr"), [{ artists: ["Studio Montagne"] }], "Koromaru's page shows the game's credit");
});
