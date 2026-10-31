import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { curatedProvenance, datasetRegistry, type CuratedProvenanceId, type DatasetEntry } from "../src/game-data/dataset-registry";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { compareCodeUnits } from "../src/game-data/string-order";
import { reverifiers, reverifyText, type Context } from "../scripts/reverify-curated-provenance";

const ids = Object.keys(curatedProvenance) as CuratedProvenanceId[];
const [oldEn, oldCn, newEn, newCn] = ["1", "2", "3", "4"].map((digit) => digit.repeat(40)) as [string, string, string, string];
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

/** Context over in-memory tables: `tables[revision][table]`. */
function context(tables: Record<string, Record<string, unknown>>, hashes: Record<string, string> = {}): Context {
  const reader = (revision: string) => async (table: string) => tables[revision]?.[table] ?? {};
  return {
    revisions: { en: newEn, cn: newCn },
    current: { en: reader(newEn), cn: reader(newCn) },
    currentHash: (region, table) => hashes[`${region === "en" ? newEn : newCn} ${table}`],
    previous: (_region, revision) => reader(revision),
    previousHash: (_region, revision, table) => hashes[`${revision} ${table}`],
  };
}

test("there is a reverifier for every registered curated file, and the file exists", async () => {
  assert.deepEqual(Object.keys(reverifiers).sort(compareCodeUnits), [...ids].sort(compareCodeUnits));
  for (const id of ids) assert.ok((await readJson(curatedProvenance[id].file)) && reverifiers[id].references(await readJson(curatedProvenance[id].file)).length > 0, `${id} records revisions`);
});

test("every revision recorded in a curated file is the pinned one of its region", async () => {
  for (const id of ids) {
    for (const reference of reverifiers[id].references(await readJson(curatedProvenance[id].file))) {
      assert.equal(reference.revision, gameDataRevisions[reference.region], `${id}: ${reference.label} (${reference.region}) is checked against the pinned revision; run data:regenerate`);
    }
  }
});

test("every file of data/ that cites GameData is generated from the pinned revisions or registered as curated", async () => {
  const generated = new Set((Object.values(datasetRegistry) as DatasetEntry[]).filter((entry) => entry.generator.kind === "update").flatMap((entry) => entry.outputs));
  const curated = new Set<string>(ids.map((id) => curatedProvenance[id].file));
  for (const name of await readdir("data")) {
    const path = `data/${name}`;
    if (!name.endsWith(".json") || generated.has(path)) continue;
    if (/ArknightsGamedata|\/gamedata\/excel\//.test(await readFile(path, "utf8"))) assert.ok(curated.has(path), `${path} cites GameData: register it in curatedProvenance (src/game-data/dataset-registry.ts)`);
  }
});

test("no test writes a GameData revision by hand", async () => {
  // Synthetic hashes only: blob hashes of fixed contents and placeholder commits.
  const allowed = new Set(["ce013625030ba8dba906f756967f9e9ca394464a", "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", "0123456789abcdef0123456789abcdef01234567", "fedcba9876543210fedcba9876543210fedcba98"]);
  for (const name of await readdir("tests")) {
    if (!/\.(ts|mjs)$/.test(name)) continue;
    for (const literal of (await readFile(`tests/${name}`, "utf8")).match(/\b[0-9a-f]{40}\b/g) ?? []) {
      assert.ok(allowed.has(literal) || /^(.)\1+$/.test(literal), `tests/${name}: ${literal} must come from gamedata-revisions.ts`);
    }
  }
});

test("a revision moves when every value it backs is identical, with its table hash", async () => {
  const source = `{ "mapTags": { "a": { "source": { "kind": "gamedata", "revision": "${oldCn}", "path": "cn/gamedata/excel/topic_table.json", "field": "topics.a.name", "sha256": "OLD" } } } }\n`;
  const tables = { [oldCn]: { topic_table: { topics: { a: { name: "Same" } } } }, [newCn]: { topic_table: { topics: { a: { name: "Same" } } } } };
  const result = await reverifyText("module-modes", source, context(tables, { [`${oldCn} topic_table`]: "OLD", [`${newCn} topic_table`]: "NEW" }));
  assert.deepEqual(result.differences, []);
  assert.equal(result.text, source.replace(oldCn, newCn).replace("OLD", "NEW"));
  await assert.rejects(reverifyText("module-modes", source.replace("OLD", "OTHER"), context(tables, { [`${oldCn} topic_table`]: "OLD", [`${newCn} topic_table`]: "NEW" })), /recorded topic_table hash/);
});

test("a changed value keeps the revision of its file and region and is reported", async () => {
  const entry = (id: string, region: string, revision: string) => `{ "operatorId": "${id}", "affiliationId": "x", "sourceField": "character_table.json → subPower[].nationId", "source": { "region": "${region}", "revision": "${revision}" } }`;
  const source = `{ "associations": [${entry("char_a", "en", oldEn)}, ${entry("char_b", "en", oldEn)}, ${entry("char_c", "cn", oldCn)}] }\n`;
  const power = (nationId: string) => ({ subPower: [{ nationId }] });
  const result = await reverifyText("affiliations", source, context({
    [oldEn]: { character_table: { char_a: power("iberia"), char_b: power("laterano") } },
    [newEn]: { character_table: { char_a: power("iberia"), char_b: power("columbia") } },
    [oldCn]: { character_table: { char_c: power("sargon") } },
    [newCn]: { character_table: { char_c: power("sargon") } },
  }));
  assert.deepEqual(result.differences.map((item) => [item.region, item.label, item.previous, item.current]), [["en", "char_b x", ["laterano"], ["columbia"]]]);
  assert.ok(result.text.includes(oldEn) && !result.text.includes(newEn), "the EN group keeps its revision");
  assert.ok(result.text.includes(newCn) && !result.text.includes(oldCn), "the CN group moves");
});

test("the regional comparison moves with recomputed counts", async () => {
  const source = `{\n  "comparison": {\n    "en": {\n      "revision": "${oldEn}",\n      "playableCount": 1,\n      "skippedCount": 1\n    },\n    "cn": {\n      "revision": "${newCn}",\n      "playableCount": 1,\n      "skippedCount": 0\n    }\n  }\n}\n`;
  const operator = { isNotObtainable: false, name: "A", profession: "WARRIOR", phases: [], rarity: "TIER_3" };
  const result = await reverifyText("regional", source, context({
    [oldEn]: { character_table: { char_a: operator, token_x: {} } },
    [newEn]: { character_table: { char_a: operator, token_x: {}, trap_y: {} } },
  }));
  assert.deepEqual(result.differences, []);
  assert.ok(result.text.includes(`"revision": "${newEn}",\n      "playableCount": 1,\n      "skippedCount": 2`));
  assert.deepEqual(result.moved, [`en ${oldEn.slice(0, 7)} -> ${newEn.slice(0, 7)} (1 references)`]);
});
