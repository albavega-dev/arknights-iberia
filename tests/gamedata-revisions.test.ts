import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gameDataRevisions, gameDataSkillTableHashes, gameDataTableHashes } from "../src/game-data/gamedata-revisions";

describe("GameData pinned revisions", () => {
  it("pins full 40-character commits for both regions", () => {
    for (const revision of Object.values(gameDataRevisions)) assert.match(revision, /^[0-9a-f]{40}$/);
  });

  it("records an uppercase SHA-256 for every pinned table", () => {
    const hashes = [...Object.values(gameDataTableHashes), ...Object.values(gameDataSkillTableHashes)].flatMap((tables) => Object.values(tables));
    assert.equal(hashes.length, 12);
    for (const hash of hashes) assert.match(hash, /^[0-9A-F]{64}$/);
  });

  it("keeps the skill tables distinct from the character tables", () => {
    for (const region of ["en", "cn"] as const) {
      assert.notEqual(gameDataSkillTableHashes[region].skill_table, gameDataTableHashes[region].character_table);
    }
    assert.notEqual(gameDataSkillTableHashes.en.skill_table, gameDataSkillTableHashes.cn.skill_table);
  });
});
