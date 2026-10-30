import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import manifestData from "../data/operator-global-updates.json" with { type: "json" };
import { GlobalUpdatesManifestError, assertGlobalUpdates, getNewOperatorIds, getNewOperatorIdsLenient, type GlobalUpdate, type GlobalUpdatesManifest } from "../src/game-data/operator-global-updates.js";
import { catalogOperatorRecord, type OperatorCatalog } from "../src/game-data/operator-catalog.js";
import { operatorCardBadge, type OperatorRecord } from "../src/game-data/operators.js";

const operator = (id: string, cnOnly = false): OperatorRecord => ({ id, name: id, class: "Guard", subClassId: null, rarity: 6, slug: id, cnOnly, availabilityStatus: cnOnly ? "cn-snapshot-candidate" : "global-snapshot", cnReleaseDate: "2026-01-01", globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null });
const update = (id: string, opensAt: string, operatorIds: string[], status: GlobalUpdate["status"] = "verified"): GlobalUpdate => ({ id, name: id, opensAt, operatorIds, sourceUrl: `https://example.test/${id}`, status });
const manifest = (...updates: GlobalUpdate[]): GlobalUpdatesManifest => ({ schemaVersion: 2, updates });
const records = ["a", "b", "c", "d"].map((id) => operator(`char_${id}`));
const first = update("first", "2026-10-14T10:00:00-07:00", ["char_a", "char_b"]);
const second = update("second", "2026-11-25T10:00:00-08:00", ["char_c"]);
const ids = (set: ReadonlySet<string>) => [...set];
const messages = () => { const lines: string[] = []; return { lines, warn: (line: string) => { lines.push(line); } }; };

test("the new operators are those of the latest verified update that has opened", () => {
  const both = manifest(second, first);
  assert.deepEqual(ids(getNewOperatorIds(records, both, new Date("2026-10-14T16:59:59Z"))), [], "nothing before the first opening");
  assert.deepEqual(ids(getNewOperatorIds(records, both, new Date("2026-10-14T17:00:00Z"))), ["char_a", "char_b"], "the opening time is in Global server time (UTC-7)");
  assert.deepEqual(ids(getNewOperatorIds(records, both, new Date("2026-11-25T17:59:59Z"))), ["char_a", "char_b"], "an update added in advance does not apply yet");
  assert.deepEqual(ids(getNewOperatorIds(records, both, new Date("2026-11-25T18:00:00Z"))), ["char_c"], "the newest opened update replaces the previous one");
  assert.deepEqual(ids(getNewOperatorIds(records, manifest(first, second), new Date("2027-01-01T00:00:00Z"))), ["char_c"], "the order of the file does not matter");
});

test("unverified updates never select operators", () => {
  const draft = update("draft", "2026-12-01T10:00:00-08:00", ["char_d"], "unverified");
  assert.deepEqual(ids(getNewOperatorIds(records, manifest(first, draft), new Date("2027-01-01T00:00:00Z"))), ["char_a", "char_b"]);
  assert.deepEqual(ids(getNewOperatorIds(records, manifest(draft), new Date("2027-01-01T00:00:00Z"))), []);
});

test("strict mode rejects every inconsistency, whatever the date", () => {
  const rejects = (value: GlobalUpdatesManifest, pattern: RegExp) => assert.throws(() => assertGlobalUpdates(records, value), (error: unknown) => error instanceof GlobalUpdatesManifestError && pattern.test(error.message));
  rejects({ ...manifest(first), schemaVersion: 1 }, /Unsupported Global updates schema: 1/);
  rejects({ schemaVersion: 2 } as GlobalUpdatesManifest, /no updates/);
  rejects(manifest(first, first), /Duplicate Global update ID: first/);
  for (const opensAt of ["2026-10-14", "2026-10-14T10:00:00", "2026-02-30T10:00:00-07:00", "2026-10-14T25:00:00-07:00", "later"]) rejects(manifest({ ...first, opensAt }), /Invalid Global update opening time: first/);
  rejects(manifest({ ...first, status: "draft" as never }), /Invalid Global update status/);
  rejects(manifest({ ...first, sourceUrl: "not a url" }), /Invalid Global update source/);
  rejects(manifest({ ...first, sourceUrl: "http://example.test" }), /Invalid Global update source/);
  rejects(manifest({ ...first, operatorIds: "char_a" as never }), /Invalid operator list/);
  rejects(manifest({ ...first, operatorIds: ["char_a", "char_a"] }), /Duplicate operator ID/);
  rejects(manifest({ ...first, operatorIds: ["a"] }), /Invalid operator ID/);
  rejects(manifest({ ...first, operatorIds: ["char_zz"] }), /Unknown operator ID in Global update: char_zz/);
  assert.throws(() => assertGlobalUpdates([operator("char_a"), operator("char_b", true)], manifest(first)), /CN-only operator in Global update: char_b/);
  assert.throws(() => getNewOperatorIds(records, manifest({ ...first, operatorIds: ["char_zz"] }), new Date("2000-01-01T00:00:00Z")), GlobalUpdatesManifestError, "an update that has not opened is checked too");
  assert.doesNotThrow(() => assertGlobalUpdates(records, manifest(first, second, update("draft", "2030-01-01T00:00:00Z", [], "unverified"))));
});

test("the web gives no labels and a warning for an invalid file", () => {
  const now = new Date("2027-01-01T00:00:00Z");
  for (const bad of [{ ...manifest(first), schemaVersion: 1 }, manifest(first, { ...second, operatorIds: ["char_zz"] }), manifest(first, { ...second, opensAt: "tomorrow" }), { schemaVersion: 2 } as GlobalUpdatesManifest]) {
    const { lines, warn } = messages();
    assert.deepEqual(ids(getNewOperatorIdsLenient(records, bad, now, warn)), []);
    assert.ok(lines.length > 0 && lines.every((line) => line.startsWith("Global updates: ")));
  }
  const { lines, warn } = messages();
  assert.deepEqual(ids(getNewOperatorIdsLenient(records, null as never, now, warn)), [], "an unreadable manifest does not throw");
  assert.equal(lines.length, 1);
  const odd = messages();
  const thrower = { get schemaVersion(): number { throw "broken"; } } as unknown as GlobalUpdatesManifest;
  assert.deepEqual(ids(getNewOperatorIdsLenient(records, thrower, now, odd.warn)), []);
  assert.deepEqual(odd.lines, ["Global updates: unreadable manifest"]);
  assert.deepEqual(ids(getNewOperatorIdsLenient(records, manifest(first), new Date("2026-01-01T00:00:00Z"), odd.warn)), [], "a valid file with nothing opened yet gives no labels");
  assert.equal(odd.lines.length, 1);
});

test("the web ignores a CN-only operator, keeps the others and warns", () => {
  const mixed = [operator("char_a"), operator("char_b", true), operator("char_c")];
  const { lines, warn } = messages();
  assert.deepEqual(ids(getNewOperatorIdsLenient(mixed, manifest(update("u", "2026-10-14T10:00:00-07:00", ["char_a", "char_b", "char_c"])), new Date("2026-10-15T00:00:00Z"), warn)), ["char_a", "char_c"]);
  assert.deepEqual(lines, ["Global updates: CN-only operator in Global update: char_b"]);
  assert.throws(() => getNewOperatorIds(mixed, manifest(update("u", "2026-10-14T10:00:00-07:00", ["char_a", "char_b", "char_c"])), new Date("2026-10-15T00:00:00Z")), /CN-only operator/);
});

test("the web gives the same result as strict mode for a valid file, without warnings", () => {
  const { lines, warn } = messages();
  const now = new Date("2026-12-01T00:00:00Z");
  assert.deepEqual(ids(getNewOperatorIdsLenient(records, manifest(first, second), now, warn)), ids(getNewOperatorIds(records, manifest(first, second), now)));
  assert.deepEqual(lines, []);
});

test("a CN-only operator card is always upcoming, never new", () => {
  assert.equal(operatorCardBadge({ cnOnly: true }, true), "upcoming");
  assert.equal(operatorCardBadge({ cnOnly: true }, false), "upcoming");
  assert.equal(operatorCardBadge({ cnOnly: false }, true), "new");
  assert.equal(operatorCardBadge({ cnOnly: false }, false), null);
});

test("the project manifest is consistent with the catalog and lists the Episode 17 operators", async () => {
  const catalog = JSON.parse(await readFile("data/operator-catalog/index.json", "utf8")) as OperatorCatalog;
  const real = catalog.operators.map(catalogOperatorRecord);
  const project = manifestData as unknown as GlobalUpdatesManifest;
  assert.doesNotThrow(() => assertGlobalUpdates(real, project));
  const episode = project.updates.find((item) => item.id === "global-episode-17-critical-phase-transition")!;
  assert.deepEqual(episode.operatorIds, ["char_4227_gallus", "char_4225_tanya", "char_4228_closur", "char_4226_veen", "char_1052_kalts2"]);
  assert.equal(episode.status, "verified");
  assert.deepEqual(ids(getNewOperatorIds(real, manifest(episode), new Date("2026-10-16T00:00:00Z"))), episode.operatorIds);
  assert.ok(project.updates.every((item) => item.operatorIds.every((id) => real.some((record) => record.id === id && !record.cnOnly))), "every listed operator is a Global operator of the catalog");
});
