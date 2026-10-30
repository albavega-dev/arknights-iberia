import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { earliestEvent, eventSlug, parseTerraEvents, proposeGlobalUpdates, terraEventsQuery, terraStartToOpensAt, type TerraGlobalEvent } from "../src/game-data/global-update-proposal.js";
import { assertGlobalUpdates } from "../src/game-data/operator-global-updates.js";
import type { OperatorRecord } from "../src/game-data/operators.js";
import { fetchTerraEvents, main, proposeFor } from "../scripts/propose-global-update.js";

const event = (name: string, title: string, startTime: string, page = title): TerraGlobalEvent => ({ name, event: title, page, startTime });
const operators = [{ id: "char_a", name: "Alpha" }, { id: "char_b", name: "Kal'tsit Beta" }, { id: "char_c", name: "Gamma" }];
const record = (id: string): OperatorRecord => ({ id, name: id, class: "Guard", subClassId: null, rarity: 6, slug: id, cnOnly: false, availabilityStatus: "global-snapshot", cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null });

test("a Terra Wiki UTC time becomes the Global server time (UTC-7, all year)", () => {
  assert.equal(terraStartToOpensAt("2026-10-14 17:00:00"), "2026-10-14T10:00:00-07:00");
  assert.equal(terraStartToOpensAt("2026-11-30 17:00:00"), "2026-11-30T10:00:00-07:00");
  assert.equal(terraStartToOpensAt("2026-03-01 05:30:00"), "2026-02-28T22:30:00-07:00", "the local date can be the day before");
  for (const bad of ["2026-10-14", "2026-02-30 10:00:00", "2026-10-14T17:00:00", ""]) assert.throws(() => terraStartToOpensAt(bad), /Unreadable Terra Wiki start time/);
});

test("operators are grouped by the event that gives them, as community-listed entries that pass the strict check", () => {
  const { updates, unresolved } = proposeGlobalUpdates(operators, [
    event("Alpha", "Late Event", "2026-12-10 17:00:00"),
    event("alpha", "Early Event", "2026-11-05 17:00:00", "Early Event/Rerun"),
    event("Kal'tsit Beta", "Early Event", "2026-11-05 17:00:00", "Early Event/Rerun"),
    event("Kal'tsit Beta", "Late Event", "2026-12-10 17:00:00"),
    event("Gamma", "Café: Ünïcode Event", "2026-11-16 17:00:00"),
  ]);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(updates.map((item) => [item.id, item.opensAt, item.operatorIds, item.status]), [
    ["global-early-event", "2026-11-05T10:00:00-07:00", ["char_a", "char_b"], "community-listed"],
    ["global-cafe-unicode-event", "2026-11-16T10:00:00-07:00", ["char_c"], "community-listed"],
  ]);
  assert.equal(updates[0]!.sourceUrl, "https://arknights.wiki.gg/wiki/Early_Event%2FRerun", "the wiki page of the event, encoded");
  assert.doesNotThrow(() => assertGlobalUpdates(operators.map((operator) => record(operator.id)), { schemaVersion: 2, updates }));
});

test("operators the wiki does not know are returned apart, and nothing is invented", () => {
  const result = proposeGlobalUpdates(operators, [event("Alpha", "Event", "2026-11-05 17:00:00")]);
  assert.deepEqual(result.updates.map((item) => item.operatorIds), [["char_a"]]);
  assert.deepEqual(result.unresolved.map((item) => item.id), ["char_b", "char_c"]);
  assert.deepEqual(proposeGlobalUpdates([], []), { updates: [], unresolved: [] });
});

test("two events that open at the same time are ordered by name", () => {
  const { updates } = proposeGlobalUpdates(operators.slice(0, 2), [event("Alpha", "Zeta", "2026-11-05 17:00:00"), event("Kal'tsit Beta", "Beta Event", "2026-11-05 17:00:00")]);
  assert.deepEqual(updates.map((item) => item.name), ["Beta Event", "Zeta"]);
});

test("the Cargo query asks for the Global start of the events of the operators, quoting names", () => {
  const query = terraEventsQuery(["Alpha", "Kal'tsit Beta"]);
  assert.equal(query.get("action"), "cargoquery");
  assert.equal(query.get("where"), "Operators.name IN ('Alpha', 'Kal''tsit Beta') AND server='global'");
  assert.match(query.get("fields")!, /Events\._pageName=page/);
});

test("Terra Wiki responses are validated", () => {
  assert.deepEqual(parseTerraEvents({ cargoquery: [{ title: { name: "A", event: "E", page: "P", startTime: "2026-10-14 17:00:00", startTime__precision: "0" } }] }), [event("A", "E", "2026-10-14 17:00:00", "P")]);
  assert.throws(() => parseTerraEvents({ error: { code: "x" } }), /Unexpected Terra Wiki response/);
  assert.throws(() => parseTerraEvents(null), /Unexpected Terra Wiki response/);
  assert.throws(() => parseTerraEvents({ cargoquery: [{ title: { name: "A" } }] }), /Unexpected Terra Wiki row/);
  assert.throws(() => parseTerraEvents({ cargoquery: [{}] }), /Unexpected Terra Wiki row/);
});

test("the request goes to the Terra Wiki API only and fails on an HTTP error", async () => {
  const seen: string[] = [];
  const reply = (body: unknown, status = 200) => async (input: URL | RequestInfo) => { seen.push(String(input)); return new Response(JSON.stringify(body), { status }); };
  mock.method(globalThis, "fetch", reply({ cargoquery: [] }));
  try {
    assert.deepEqual(await fetchTerraEvents(["Alpha"]), []);
    assert.match(seen[0]!, /^https:\/\/arknights\.wiki\.gg\/api\.php\?action=cargoquery/);
    mock.restoreAll();
    mock.method(globalThis, "fetch", reply({}, 503));
    await assert.rejects(fetchTerraEvents(["Alpha"]), /Terra Wiki 503/);
  } finally { mock.restoreAll(); }
});

test("the script reads the operators from the detection report or from a list, with their EN names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "global-update-proposal-"));
  try {
    const table = join(directory, "character_table.json");
    const report = join(directory, "report.json");
    await writeFile(table, JSON.stringify({ char_a: { name: "Alpha" }, char_b: { name: "Beta" }, char_x: {} }), "utf8");
    await writeFile(report, JSON.stringify({ findings: { roster: { arrivedInGlobal: ["char_b"] } } }), "utf8");
    const asked: string[][] = [];
    const fetchEvents = async (names: readonly string[]) => { asked.push([...names]); return [event("Alpha", "Event", "2026-11-05 17:00:00")]; };
    assert.deepEqual((await proposeFor([`--en-character=${table}`, "--ids=char_a"], fetchEvents)).updates.map((item) => item.operatorIds), [["char_a"]]);
    assert.deepEqual((await proposeFor([`--en-character=${table}`, `--from-report=${report}`], fetchEvents)).unresolved.map((item) => item.id), ["char_b"]);
    assert.deepEqual(asked, [["Alpha"], ["Beta"]]);
    await writeFile(report, JSON.stringify({ findings: {} }), "utf8");
    assert.deepEqual(await proposeFor([`--en-character=${table}`, `--from-report=${report}`], async () => { throw new Error("not called without operators"); }), { updates: [], unresolved: [] });
    await assert.rejects(proposeFor([`--en-character=${table}`, "--ids=char_x"], fetchEvents), /char_x has no name/);
    await assert.rejects(proposeFor(["--ids=char_a"], fetchEvents), /Missing --en-character/);
    await assert.rejects(proposeFor([`--en-character=${table}`], fetchEvents), /Missing --from-report or --ids/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the command prints the proposal and exits with 2 when an operator needs a person", async () => {
  const directory = await mkdtemp(join(tmpdir(), "global-update-main-"));
  try {
    const table = join(directory, "character_table.json");
    await writeFile(table, JSON.stringify({ char_a: { name: "Alpha" }, char_b: { name: "Beta" } }), "utf8");
    const out: string[] = [];
    const known = async () => [event("Alpha", "Event", "2026-11-05 17:00:00"), event("Beta", "Event", "2026-11-05 17:00:00")];
    assert.equal(await main(["node", "x", `--en-character=${table}`, "--ids=char_a,char_b"], known, (line) => out.push(line)), 0);
    assert.equal(JSON.parse(out[0]!).updates[0].operatorIds.length, 2);
    assert.equal(await main(["node", "x", `--en-character=${table}`, "--ids=char_a,char_b"], async () => [event("Alpha", "Event", "2026-11-05 17:00:00")], (line) => out.push(line)), 2);
    assert.deepEqual(JSON.parse(out[1]!).unresolved.map((item: { id: string }) => item.id), ["char_b"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the earliest event of an empty list is undefined, and ties keep the first", () => {
  assert.equal(earliestEvent([]), undefined);
  const first = event("A", "First", "2026-11-05 17:00:00");
  assert.equal(earliestEvent([first, event("A", "Second", "2026-11-05 17:00:00")]), first);
  assert.equal(earliestEvent([event("A", "Late", "2026-12-01 17:00:00"), first]), first);
});

test("event slugs keep their results and take linear time on hostile input", () => {
  assert.equal(eventSlug("Café: Ünïcode Event"), "cafe-unicode-event");
  assert.equal(eventSlug("--Critical  Phase--Transition--"), "critical-phase-transition");
  assert.equal(eventSlug("A/B & C"), "a-b-c");
  for (const empty of ["", "---", "!!!", "  "]) assert.equal(eventSlug(empty), "");
  const started = performance.now();
  for (const hostile of ["a" + "-".repeat(200_000) + "!b", "-".repeat(200_000) + "!", "!".repeat(200_000) + "a", "a" + "́".repeat(200_000)]) eventSlug(hostile);
  assert.ok(performance.now() - started < 1000, "hostile inputs finish well under a second");
});
