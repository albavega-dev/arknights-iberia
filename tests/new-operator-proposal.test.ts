import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { cnOnlyName, isLatinName, mainPowerKey, proposeAffiliations, proposeFactions, proposeRegionalEntries, terraCnStartToDate, type Affiliation, type FactionEntry, type NewOperator, type PrtsOperator, type TerraOperator } from "../src/game-data/new-operator-proposal.js";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions.js";
import { fetchArtists, fetchPrts, fetchTerra, main, oneLine, propose, writeProposal, type NewOperatorProposal } from "../scripts/propose-new-operators.js";

const power = (nationId: string | null, groupId: string | null = null, teamId: string | null = null) => ({ nationId, groupId, teamId });
const operator = (id: string, overrides: Partial<NewOperator> = {}): NewOperator => ({ id, cnName: `${id}-cn`, appellation: `${id} Name`, mainPower: power("rhodes"), subPower: [], ...overrides });
const prtsRow = (charId: string, cnOnlineTime: string): PrtsOperator => ({ charId, page: `${charId}-页`, cnOnlineTime });
const terraRow = (id: string, name: string, startTime?: string, event = "Event"): TerraOperator => ({ id, name, page: `${name} Page`, ...(startTime ? { event, startTime } : {}) });

test("a Terra Wiki CN start gives the CN date: the wiki keeps a UTC-6 clock", () => {
  assert.equal(terraCnStartToDate("2019-04-29 20:00:00"), "2019-04-30", "20:00 of the day before");
  assert.equal(terraCnStartToDate("2020-03-17 02:00:00"), "2020-03-17", "02:00 is the 16:00 opening");
  assert.equal(terraCnStartToDate("2026-12-31 20:00:00"), "2027-01-01");
  for (const bad of ["2026-10-14", "2026-02-30 10:00:00", ""]) assert.throws(() => terraCnStartToDate(bad), /Unreadable Terra Wiki start time/);
});

test("a CN-only name is the CN appellation in the Latin alphabet, never a wiki name", () => {
  for (const name of ["Aegis", "de Toledo", "Kal'tsit·Esperanta", "Yūtenji Nyamu", "Mr.Nothing", "Thermal-EX", "GALLUS²", '"Justice Knight"', "Pozëmka"]) assert.equal(isLatinName(name), true, name);
  for (const name of ["Зима", "Позёмка", "时隙", "Aegis 2号", "", "   "]) assert.equal(isLatinName(name), false, name);
  assert.equal(cnOnlyName({ appellation: " Aegis " }), "Aegis");
  assert.equal(cnOnlyName({ appellation: "Гум" }), undefined);
  const result = proposeRegionalEntries([operator("char_a", { appellation: "Aegis" })], [prtsRow("char_a", "2026-09-04 16:00:00")], [terraRow("char_a", "Aigis")]);
  assert.equal(result.entries[0]!.nameEnglish, "Aegis", "the wiki name is ignored");
  assert.equal(result.entries[0]!.nameStatus, "cn-appellation");
});

test("names come from the CN appellation and dates from PRTS", () => {
  const result = proposeRegionalEntries([operator("char_a", { appellation: "Alpha" }), operator("char_b")], [prtsRow("char_a", "2026-08-01 16:00:00"), prtsRow("char_b", "2026-08-15 10:00:00")], [terraRow("char_a", "Wiki Alpha", "2026-07-31 20:00:00"), terraRow("char_b", "Beta", "2026-08-01 20:00:00", "Other")]);
  assert.deepEqual(result.entries[0], { id: "char_a", nameEnglish: "Alpha", nameStatus: "cn-appellation", cnReleaseDate: "2026-08-01", globalReleaseDate: null, cnReleaseDateProvenance: { status: "community-listed", source: "https://prts.wiki/w/char_a-%E9%A1%B5" } });
  assert.equal(result.entries[1]!.cnReleaseDate, "2026-08-15", "PRTS is kept when the wiki event differs");
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.notes, ["char_b: PRTS 2026-08-15, Terra Wiki event 2026-08-02; PRTS kept (its date is the release, the wiki's is the event)"]);
});

test("without PRTS the date comes from the earliest Terra Wiki event, with a note", () => {
  const terra = [terraRow("char_a", "Alpha", "2026-09-01 20:00:00", "Late"), terraRow("char_a", "Alpha", "2026-07-31 20:00:00", "Early"), terraRow("char_a", "Alpha")];
  const down = proposeRegionalEntries([operator("char_a")], undefined, terra);
  assert.equal(down.entries[0]!.cnReleaseDate, "2026-08-01");
  assert.equal(down.entries[0]!.cnReleaseDateProvenance.source, "https://arknights.wiki.gg/wiki/Alpha_Page");
  assert.match(down.notes[0]!, /PRTS did not answer/);
  const missing = proposeRegionalEntries([operator("char_a")], [], terra);
  assert.deepEqual(missing.notes, ["char_a: PRTS has no date; CN date from the Terra Wiki event Early"]);
});

test("only an appellation outside the Latin alphabet or a missing date are left to a person", () => {
  const result = proposeRegionalEntries(
    [operator("char_a", { appellation: "Зима" }), operator("char_b"), operator("char_c")],
    [prtsRow("char_a", "2026-09-04 16:00:00"), prtsRow("char_b", ""), prtsRow("char_c", "2026-09-04 16:00:00")],
    [],
  );
  assert.deepEqual(result.entries.map((entry) => [entry.id, entry.nameEnglish]), [["char_c", "char_c Name"]]);
  assert.deepEqual(result.unresolved.map((item) => [item.id, item.field]), [["char_a", "nameEnglish"], ["char_b", "cnReleaseDate"]]);
  assert.deepEqual(result.unresolved[0]!.evidence, { appellation: "Зима" });
});

const faction = (id: string, mainPower: ReturnType<typeof power>, mainFactionId: string | null, extra: Partial<FactionEntry> = {}): FactionEntry => ({ id, name: id, factionId: mainPowerKey(mainPower), ...mainPower, status: "unresolved", source: "ArknightsGamedata character_table.json mainPower", regional: false, mainFactionId, factionName: mainFactionId ? `${mainFactionId} name` : null, factionStatus: "terra-wiki-supported", factionSource: "https://arknights.wiki.gg/api.php", ...extra });

test("the main faction is copied from the operators with the same identifiers", () => {
  const manifest = {
    policy: { pendingManualReview: ["char_review"] },
    operators: [
      faction("char_r1", power("rhodes"), "faction:rhodes-island"),
      faction("char_r2", power("rhodes"), "faction:rhodes-island"),
      faction("char_review", power("kazimierz", "pinus"), null, { factionStatus: "pending-manual-review" }),
      faction("char_p", power("kazimierz", "pinus"), "faction:pinus-sylvestris"),
      faction("char_x1", power("yan", "x"), "faction:a"),
      faction("char_x2", power("yan", "x"), "faction:b"),
    ],
  };
  const result = proposeFactions([operator("char_a", { subPower: [power("iberia")] }), operator("char_b", { mainPower: power("kazimierz", "pinus") }), operator("char_c", { mainPower: power("sami") }), operator("char_d", { mainPower: power("yan", "x") })], manifest);
  assert.deepEqual(result.entries[0], { id: "char_a", subPowerPresent: true, name: "char_a-cn", factionId: "mainPower:rhodes|null|null", nationId: "rhodes", groupId: null, teamId: null, status: "unresolved", source: "ArknightsGamedata character_table.json mainPower", regional: true, mainFactionId: "faction:rhodes-island", factionName: "faction:rhodes-island name", factionStatus: "terra-wiki-supported", factionSource: "https://arknights.wiki.gg/api.php" });
  assert.equal(result.entries[1]!.mainFactionId, "faction:pinus-sylvestris", "operators under manual review do not count");
  assert.equal("subPowerPresent" in result.entries[1]!, false);
  assert.deepEqual(result.unresolved.map((item) => [item.id, item.reason]), [["char_c", "no operator has these identifiers"], ["char_d", "operators with these identifiers have different factions"]]);
});

const affiliation = (operatorId: string, affiliationId: string, field: string, sourceValue?: string): Affiliation => ({ operatorId, affiliationId, relation: "sub-power", sourceField: `character_table.json → subPower[].${field}`, ...(sourceValue ? { sourceValue } : {}), source: {}, status: "verified" });

test("affiliations follow the correspondence the known operators have", () => {
  const known = [
    { id: "k1", subPower: [power("columbia")] }, { id: "k2", subPower: [power("columbia")] }, { id: "k3", subPower: [power("columbia")] },
    { id: "k4", subPower: [power(null, "babel")] }, { id: "k5", subPower: [power(null, "babel")] }, { id: "k6", subPower: [power(null, "babel")] },
    { id: "k7", subPower: [power("rhodes")] }, { id: "k8", subPower: [power("rhodes")] },
    { id: "k9", subPower: [power("yan"), power("victoria")] },
    { id: "k10", subPower: [power("sami")] }, { id: "k11", subPower: [power("sami")] },
  ];
  const existing = [
    affiliation("k1", "faction:columbia", "nationId", "columbia"), affiliation("k2", "faction:columbia", "nationId"),
    affiliation("k4", "faction:babel", "groupId", "babel"),
    affiliation("k7", "faction:rhodes-island", "nationId", "rhodes"),
    affiliation("k9", "faction:yan", "nationId"),
    affiliation("k10", "faction:sami", "nationId", "sami"), affiliation("k11", "faction:kjerag", "nationId", "sami"),
  ];
  const source = { region: "cn" };
  const result = proposeAffiliations([
    { ...operator("char_a", { subPower: [power("columbia", "babel"), power("columbia")] }), mainFactionId: null },
    { ...operator("char_b", { subPower: [power("columbia")] }), mainFactionId: "faction:columbia" },
    operator("char_c", { subPower: [power("rhodes"), power("sami"), power("leithanien"), power("yan")] }),
  ], known, existing, source);
  assert.deepEqual(result.entries, [{ operatorId: "char_a", affiliationId: "faction:columbia", relation: "sub-power", sourceField: "character_table.json → subPower[].nationId", sourceValue: "columbia", source, status: "verified" }], "once per operator, never the main faction");
  assert.deepEqual(result.unresolved.map((item) => [item.id, item.field, (item.evidence as { value: string }).value]), [
    ["char_c", "subPower.nationId", "rhodes"], ["char_c", "subPower.nationId", "sami"], ["char_c", "subPower.nationId", "leithanien"], ["char_c", "subPower.nationId", "yan"],
  ], "ties, several affiliations, unknown identifiers and entries without sourceValue on operators with several values");
  assert.deepEqual(result.notes, [
    'char_a: nationId columbia gives faction:columbia ({"faction:columbia":2,"none":1})',
    'char_a: groupId babel gives no affiliation ({"faction:babel":1,"none":2})',
    'char_a: nationId columbia gives faction:columbia ({"faction:columbia":2,"none":1})',
    'char_b: nationId columbia gives faction:columbia ({"faction:columbia":2,"none":1})',
  ]);
});

test("the catalog follows the naming rule: EN game data for Global operators, a Latin-alphabet name for CN-only ones", async () => {
  const catalog = JSON.parse(await readFile("data/operator-catalog/index.json", "utf8")) as { operators: { id: string; name: string; globalName: string | null; cnOnly: boolean }[] };
  for (const entry of catalog.operators) {
    if (entry.cnOnly) assert.ok(isLatinName(entry.name) && entry.globalName === null, `${entry.id} has a Latin-alphabet name and no Global name`);
    else assert.equal(entry.name, entry.globalName, `${entry.id} uses its EN name`);
  }
});

// --- Script --------------------------------------------------------------------------------------------------------

const cnTable = {
  char_400_weedy: { name: "温蒂", mainPower: power("rhodes"), subPower: [power("iberia")] },
  char_401_elysm: { name: "极境", mainPower: power("rhodes"), subPower: [power("iberia")] },
  char_new: { name: "新", appellation: "Newcomer", mainPower: power("rhodes"), subPower: [power("iberia")] },
  char_odd: { name: "怪", appellation: "Odd", mainPower: power("nowhere"), subPower: null },
};
const artistEntry = (id: string, status: "partial" | "pending", role?: string) => ({ operatorId: id, operatorName: id, source: {}, status, general: status === "pending" ? [] : [{ name: "Someone", ...(role ? { role } : {}), evidence: `|illustrator = Someone${role ? ` (${role})` : ""}` }], variants: { base: [], elite2: [] }, outfits: [], error: null });

async function fixture(): Promise<{ directory: string; table: string; report: string }> {
  const directory = await mkdtemp(join(tmpdir(), "new-operator-proposal-"));
  await mkdir(join(directory, "data"));
  for (const name of ["regional", "faction", "affiliation", "artist-credits"]) await copyFile(`data/operator-${name}-manifest.json`, join(directory, "data", `operator-${name}-manifest.json`));
  const table = join(directory, "character_table.json");
  await writeFile(table, JSON.stringify(cnTable));
  const report = join(directory, "report.json");
  await writeFile(report, JSON.stringify({ findings: { roster: { newInCn: ["char_new", "char_odd"] } } }));
  return { directory, table, report };
}

const fetchers = (overrides: Partial<Parameters<typeof propose>[1]> = {}) => ({
  prts: async () => [prtsRow("char_new", "2026-11-01 16:00:00")],
  terra: async () => [terraRow("char_new", "Wiki Newcomer", "2026-10-31 20:00:00"), terraRow("char_odd", "Odd")],
  artists: async (item: NewOperator) => artistEntry(item.id, item.id === "char_odd" ? "pending" : "partial"),
  ...overrides,
});

test("the script proposes from the detection report and writes only what is resolved, keeping each file's layout", async () => {
  const { directory, table, report } = await fixture();
  try {
    const empty: NewOperatorProposal = { sources: { prts: "", terraWiki: "" }, regional: [], factions: [], affiliations: [], artistCredits: [], unresolved: [], notes: [] };
    assert.deepEqual(await writeProposal(empty, directory), { added: [], creditsFilled: [], affiliationsAdded: [], kept: [] });
    for (const name of ["regional", "faction", "affiliation", "artist-credits"]) {
      assert.equal(await readFile(join(directory, "data", `operator-${name}-manifest.json`), "utf8"), await readFile(`data/operator-${name}-manifest.json`, "utf8"), `${name} unchanged by an empty write`);
    }
    const lines: string[] = [];
    assert.equal(await main(["node", "script", `--cn-character=${table}`, `--from-report=${report}`, "--write"], fetchers(), (line) => lines.push(line), directory), 2);
    const proposal = JSON.parse(lines[0]!) as NewOperatorProposal;
    assert.deepEqual(proposal.sources, { prts: "ok", terraWiki: "ok" });
    assert.deepEqual(proposal.regional.map((entry) => [entry.id, entry.nameEnglish, entry.cnReleaseDate]), [["char_new", "Newcomer", "2026-11-01"]]);
    assert.deepEqual(proposal.affiliations.map((entry) => [entry.operatorId, entry.affiliationId, entry.source.revision]), [["char_new", "faction:iberia", gameDataRevisions.cn]]);
    assert.deepEqual(proposal.unresolved.map((item) => [item.id, item.field]), [["char_odd", "cnReleaseDate"], ["char_odd", "mainFactionId"], ["char_odd", "artistCredits"]]);
    const regional = await readFile(join(directory, "data/operator-regional-manifest.json"), "utf8");
    assert.match(regional, /"char_4237_jcinta", .* \} \},\n {4}\{ "id": "char_new", "nameEnglish": "Newcomer", .* \} \}\n {2}\]\n\}\n$/, "sorted by id, one line each");
    const factions = JSON.parse(await readFile(join(directory, "data/operator-faction-manifest.json"), "utf8")) as { operators: { id: string }[] };
    assert.equal(factions.operators.at(-1)!.id, "char_new");
    const affiliations = await readFile(join(directory, "data/operator-affiliation-manifest.json"), "utf8");
    assert.ok(affiliations.endsWith(`,\n    { "operatorId": "char_new", "affiliationId": "faction:iberia", "relation": "sub-power", "sourceField": "character_table.json → subPower[].nationId", "sourceValue": "iberia", "source": { "repository": "ArknightsAssets/ArknightsGamedata", "region": "cn", "revision": "${gameDataRevisions.cn}", "path": "cn/gamedata/excel/character_table.json" }, "status": "verified" }\n  ]\n}\n`));
    const credits = JSON.parse(await readFile(join(directory, "data/operator-artist-credits-manifest.json"), "utf8")) as { entries: { operatorId: string }[] };
    assert.deepEqual(credits.entries.slice(-1).map((entry) => entry.operatorId), ["char_new"]);
    const files = async () => Promise.all(["regional", "faction", "affiliation", "artist-credits"].map((name) => readFile(join(directory, "data", `operator-${name}-manifest.json`), "utf8")));
    const before = await files();
    assert.deepEqual(await writeProposal(proposal, directory), { added: [], creditsFilled: [], affiliationsAdded: [], kept: ["char_new"] });
    assert.deepEqual(await files(), before, "writing again changes nothing");
    const creditsPath = join(directory, "data/operator-artist-credits-manifest.json");
    const copied = JSON.parse(await readFile(creditsPath, "utf8")) as { entries: { operatorId: string; status: string }[] };
    copied.entries.find((entry) => entry.operatorId === "char_4236_tmslot")!.status = "pending";
    await writeFile(creditsPath, `${JSON.stringify(copied, null, 2)}\n`);
    const pending = artistEntry("char_4236_tmslot", "partial");
    const filled = await writeProposal({ ...empty, regional: [{ ...proposal.regional[0]!, id: "char_4236_tmslot", nameEnglish: "Other" }], artistCredits: [pending, artistEntry("char_002_amiya", "partial")], affiliations: [{ ...proposal.affiliations[0]!, operatorId: "char_4236_tmslot" }] }, directory);
    assert.deepEqual(filled, { added: [], creditsFilled: ["char_4236_tmslot"], affiliationsAdded: ["char_4236_tmslot faction:iberia"], kept: ["char_4236_tmslot"] }, "pending credits are filled, others and regional entries kept");
    const after = JSON.parse(await readFile(join(directory, "data/operator-artist-credits-manifest.json"), "utf8")) as { entries: { operatorId: string; status: string; general: unknown[] }[] };
    assert.equal(after.entries.find((entry) => entry.operatorId === "char_4236_tmslot")!.status, "partial");
    assert.notDeepEqual(after.entries.find((entry) => entry.operatorId === "char_002_amiya")!.general, pending.general);
    assert.match(await readFile(join(directory, "data/operator-regional-manifest.json"), "utf8"), /"char_4236_tmslot", "nameEnglish": "Timeslot"/);
    await writeFile(join(directory, "data/operator-affiliation-manifest.json"), "{}");
    await assert.rejects(writeProposal({ ...empty, regional: [{ ...proposal.regional[0]!, id: "char_other" }] }, directory), /Unexpected manifest layout/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PRTS down, unknown roles and empty input are handled without guessing", async () => {
  const { directory, table } = await fixture();
  try {
    const down = await propose(["--cn-character=" + table, "--ids=char_new"], fetchers({ prts: async () => { throw new Error("connect timeout"); }, artists: async (item: NewOperator) => artistEntry(item.id, "partial", "guest artist of an event") }), directory);
    assert.equal(down.sources.prts, "unavailable: connect timeout");
    assert.equal(down.regional[0]!.cnReleaseDate, "2026-11-01", "the wiki event date");
    assert.deepEqual(down.unresolved.map((item) => item.reason), ["credits with a role the normalization does not know"]);
    const inGame = await propose(["--cn-character=" + table, "--ids=char_new"], fetchers({ artists: async (item: NewOperator) => artistEntry(item.id, "partial", "credited as Studio Montagne in-game") }), directory);
    assert.deepEqual(inGame.unresolved, [], "a credited-as-in-game note resolves by itself");
    assert.equal(inGame.artistCredits.length, 1);
    const noPage = await propose(["--cn-character=" + table, "--ids=char_new"], fetchers({ terra: async () => [] }), directory);
    assert.deepEqual(noPage.unresolved.map((item) => item.field), ["artistCredits"], "the name comes from the game data and the date from PRTS");
    assert.equal(noPage.regional[0]!.nameEnglish, "Newcomer");
    const lines: string[] = [];
    const quiet = join(directory, "quiet.json");
    await writeFile(quiet, JSON.stringify({ findings: { roster: { newInCn: [] } } }));
    assert.equal(await main(["--cn-character=" + table, `--from-report=${quiet}`], fetchers(), (line) => lines.push(line), directory), 0);
    assert.equal(JSON.parse(lines[0]!).sources.prts, "not queried");
    await assert.rejects(propose(["--ids=char_new"], fetchers(), directory), /Missing --cn-character/);
    await assert.rejects(propose(["--cn-character=" + table], fetchers(), directory), /Missing --from-report or --ids/);
    await assert.rejects(propose(["--cn-character=" + table, "--ids=char_none"], fetchers(), directory), /char_none is not an operator of the CN character table/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("one-line JSON matches the layout of the manifests", () => {
  assert.equal(oneLine({ a: 1, b: { c: "x", d: null }, e: [1, "y"], f: [] }), '{ "a": 1, "b": { "c": "x", "d": null }, "e": [1, "y"], "f": [] }');
});

test("requests go to PRTS and Terra Wiki only and fail on errors", async () => {
  const seen: string[] = [];
  const reply = (bodies: unknown[], status = 200) => async (input: URL | RequestInfo) => { seen.push(String(input)); return new Response(JSON.stringify(bodies.shift()), { status }); };
  try {
    mock.method(globalThis, "fetch", reply([{ cargoquery: [{ title: { charId: "char_a", page: "甲", cnOnlineTime: "2026-01-01 10:00:00" } }, { title: { charId: "char_b", page: "乙" } }] }]));
    assert.deepEqual(await fetchPrts(["char_a", "char_b"]), [{ charId: "char_a", page: "甲", cnOnlineTime: "2026-01-01 10:00:00" }, { charId: "char_b", page: "乙", cnOnlineTime: "" }]);
    assert.match(seen[0]!, /^https:\/\/prts\.wiki\/api\.php\?action=cargoquery/);
    const where = (index: number) => new URL(seen[index]!).searchParams.get("where");
    assert.equal(where(0), "chara.charId IN ('char_a', 'char_b')");
    mock.restoreAll();
    mock.method(globalThis, "fetch", reply([
      { cargoquery: [{ title: { id: "char_a", name: "A", page: "A" } }, { title: { id: "char_b", name: "B's", page: "B" } }] },
      { cargoquery: [{ title: { id: "char_a", event: "E1", startTime: "2026-01-01 20:00:00" } }, { title: { id: "char_a", event: "E2", startTime: "2026-02-01 20:00:00" } }] },
    ]));
    assert.deepEqual(await fetchTerra(["char_a", "char_b's"]), [
      { id: "char_a", name: "A", page: "A", event: "E1", startTime: "2026-01-01 20:00:00" },
      { id: "char_a", name: "A", page: "A", event: "E2", startTime: "2026-02-01 20:00:00" },
      { id: "char_b", name: "B's", page: "B" },
    ]);
    assert.equal(where(1), "OperatorFiles.id IN ('char_a', 'char_b''s')", "quotes are escaped");
    assert.equal(where(2), "OperatorFiles.id IN ('char_a', 'char_b''s') AND EventServerDetails.server='cn'");
    mock.restoreAll();
    mock.method(globalThis, "fetch", reply([{}], 503));
    await assert.rejects(fetchPrts(["char_a"]), /prts\.wiki 503/);
    mock.restoreAll();
    mock.method(globalThis, "fetch", reply([{ error: { code: "x" } }]));
    await assert.rejects(fetchTerra(["char_a"]), /Unexpected arknights\.wiki\.gg response/);
    mock.restoreAll();
    mock.method(globalThis, "fetch", reply([{ cargoquery: [{ title: { id: 1 } }] }, { cargoquery: [] }]));
    await assert.rejects(fetchTerra(["char_a"]), /Unexpected row: id/);
  } finally { mock.restoreAll(); }
});

test("artist credits are read from the Terra Wiki page of the operator", async () => {
  const wikitext = "{{Operator\n|illustrator = *[[Artist]] (E2 artwork)\n*Other\n|cv = x\n}}";
  try {
    mock.method(globalThis, "fetch", async (input: URL | RequestInfo) => {
      const url = String(input);
      assert.match(url, /^https:\/\/arknights\.wiki\.gg\/api\.php\?action=(parse|query)/);
      return new Response(JSON.stringify(url.includes("action=parse") ? { parse: { pageid: 1, wikitext } } : { query: { pages: [{ revisions: [{ revid: 42, timestamp: "2026-10-30T00:00:00Z" }] }] } }));
    });
    const entry = await fetchArtists(operator("char_a"), "Alpha Page");
    assert.equal(entry.status, "verified");
    assert.deepEqual(entry.general.map((artist) => artist.name), ["Artist", "Other"]);
    assert.deepEqual(entry.variants?.elite2?.map((artist) => artist.name), ["Artist"]);
    assert.deepEqual([entry.source.pageUrl, entry.source.revision], ["https://arknights.wiki.gg/wiki/Alpha_Page", 42]);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: "missingtitle" } })));
    const missing = await fetchArtists(operator("char_a"), "Nowhere");
    assert.deepEqual([missing.status, missing.source.revision, missing.error], ["pending", null, { code: "missingtitle" }]);
  } finally { mock.restoreAll(); }
});
