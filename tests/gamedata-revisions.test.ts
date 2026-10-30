import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { portraitRevision } from "../src/game-data/asset-revisions";
import {
  gameDataBuildingTableHashes, gameDataReleaseTableHashes, gameDataRevisions, gameDataSkillTableHashes, gameDataTableHashes, pinnedGameDataTableHashes,
} from "../src/game-data/gamedata-revisions";

describe("GameData pinned revisions", () => {
  it("pins full 40-character commits for both regions", () => {
    for (const revision of Object.values(gameDataRevisions)) assert.match(revision, /^[0-9a-f]{40}$/);
  });

  it("records an uppercase SHA-256 for every pinned table", () => {
    const hashes = [...Object.values(gameDataTableHashes), ...Object.values(gameDataSkillTableHashes), ...Object.values(gameDataBuildingTableHashes)].flatMap((tables) => Object.values(tables));
    assert.equal(hashes.length, 14);
    for (const hash of hashes) assert.match(hash, /^[0-9A-F]{64}$/);
    assert.equal(new Set(hashes).size, 13, "only range_table is identical in both regions");
  });

  it("pins the CN release-date tables only for CN", () => {
    assert.deepEqual(Object.keys(gameDataReleaseTableHashes.en), []);
    assert.deepEqual(Object.keys(gameDataReleaseTableHashes.cn), ["gacha_table", "roguelike_topic_table"]);
    for (const hash of Object.values(gameDataReleaseTableHashes.cn)) assert.match(hash!, /^[0-9A-F]{64}$/);
  });

  it("joins every pinned table of a region", () => {
    assert.equal(Object.keys(pinnedGameDataTableHashes("en")).length, 9);
    assert.equal(Object.keys(pinnedGameDataTableHashes("cn")).length, 11);
    assert.equal(pinnedGameDataTableHashes("cn").gacha_table, gameDataReleaseTableHashes.cn.gacha_table);
    assert.equal(pinnedGameDataTableHashes("en").character_table, gameDataTableHashes.en.character_table);
    assert.equal(pinnedGameDataTableHashes("en").gacha_table, undefined);
  });

  it("pins a different building table per region", () => {
    assert.notEqual(gameDataBuildingTableHashes.en.building_data, gameDataBuildingTableHashes.cn.building_data);
  });

  it("keeps the skill tables distinct from the character tables", () => {
    for (const region of ["en", "cn"] as const) {
      assert.notEqual(gameDataSkillTableHashes[region].skill_table, gameDataTableHashes[region].character_table);
    }
    assert.notEqual(gameDataSkillTableHashes.en.skill_table, gameDataSkillTableHashes.cn.skill_table);
  });
});

describe("portrait manifest", () => {
  it("records the pinned portrait commit", async () => {
    const manifest = JSON.parse(await readFile("data/operator-portrait-manifest.json", "utf8")) as { source: { commit: string } };
    assert.equal(manifest.source.commit, portraitRevision);
  });
});
