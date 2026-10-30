import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { moduleModeNames, unnamedModeTags } from "../src/game-data/operator-module-modes";
import type { OperatorModulesProfile } from "../src/game-data/operator-modules";

const directory = path.resolve("data/operator-modules");

test("every mode and theme tag the modules dataset uses has a name", async () => {
  const tags = [];
  for (const file of (await readdir(directory)).filter((name) => name.startsWith("char_"))) {
    const profile = JSON.parse(await readFile(path.join(directory, file), "utf8")) as OperatorModulesProfile;
    tags.push(...profile.modules.flatMap((item) => item.levels.flatMap((level) => level.modes ?? [])));
  }
  assert.ok(tags.length > 0);
  assert.deepEqual(unnamedModeTags(tags), []);
  assert.deepEqual(new Set(tags.flatMap((tag) => [tag.gameTag, tag.mapTag]).filter(Boolean)), new Set(["roguelike", "sandbox", "rogue_yan", "rogue_6"]));
});

test("the four names and their sources", () => {
  assert.equal(moduleModeNames.gameTags.roguelike!.name, "Integrated Strategies");
  assert.equal(moduleModeNames.gameTags.sandbox!.name, "Reclamation Algorithm");
  assert.equal(moduleModeNames.mapTags.rogue_yan!.name, "Sui's Garden of Grotesqueries");
  for (const entry of [moduleModeNames.gameTags.roguelike!, moduleModeNames.gameTags.sandbox!, moduleModeNames.mapTags.rogue_yan!]) {
    assert.equal(entry.source.kind, "wiki");
    assert.match(entry.source.url!, /^https:\/\/arknights\.wiki\.gg\/wiki\//);
  }
  // rogue_6 comes from the pinned CN roguelike table, with its hash.
  const rogue6 = moduleModeNames.mapTags.rogue_6!;
  assert.equal(rogue6.name, "沉沦者的黑流树海");
  assert.equal(rogue6.region, "cn");
  assert.deepEqual([rogue6.source.kind, rogue6.source.revision, rogue6.source.path, rogue6.source.field], ["gamedata", gameDataRevisions.cn, "cn/gamedata/excel/roguelike_topic_table.json", "topics.rogue_6.name"]);
  assert.match(rogue6.source.sha256!, /^[0-9A-F]{64}$/);
});

test("unknown tags are reported once each, sorted", () => {
  assert.deepEqual(unnamedModeTags([{ gameTag: "roguelike", mapTag: "rogue_9" }, { gameTag: "other", mapTag: null }, { mapTag: "rogue_9" }]), ["gameTag other", "mapTag rogue_9"]);
});
