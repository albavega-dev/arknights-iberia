import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { gitBlobSha } from "../src/game-data/gamedata-diff";
import { isFullCommit, parseTableList, snapshotDirectoryName, snapshotFile, snapshotManifest, snapshotMismatches, snapshotUrl, tablesFromReport } from "../src/game-data/gamedata-snapshot";

const commit = "3aaa25b649fed5dedad9527602826dc487ea07d8";
const report = (status: Record<string, unknown>) => ({ findings: { revisions: { gamedata: { en: status } } } });

describe("snapshot naming and table lists", () => {
  it("names the directory after the region and the short commit", () => {
    assert.equal(snapshotDirectoryName("cn", commit), "cn-3aaa25b");
    assert.equal(snapshotUrl(commit, "en", "skill_table"), `https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/${commit}/en/gamedata/excel/skill_table.json`);
  });

  it("accepts only full commits and plain table names", () => {
    assert.equal(isFullCommit(commit), true);
    assert.equal(isFullCommit("3aaa25b"), false);
    assert.deepEqual(parseTableList("a_table, b_table,a_table"), ["a_table", "b_table"]);
    assert.throws(() => parseTableList("../secret"), /Invalid table names/);
    assert.throws(() => parseTableList(" , "), /empty/);
  });
});

describe("snapshot files", () => {
  const data = Buffer.from('{"a":1}');

  it("records bytes, SHA-256 and blob hash of a verified download", () => {
    const file = snapshotFile("en", commit, "range_table", data, gitBlobSha(data));
    assert.equal(file.bytes, data.length);
    assert.equal(file.sha256, createHash("sha256").update(data).digest("hex").toUpperCase());
    assert.equal(file.blobSha, gitBlobSha(data));
    assert.equal(file.sourcePath, "en/gamedata/excel/range_table.json");
  });

  it("rejects a download that does not match its blob hash", () => {
    assert.throws(() => snapshotFile("en", commit, "range_table", data, "0".repeat(40)), /blob hash/);
  });

  it("sorts the manifest by table and reports mismatches against recorded hashes", () => {
    const a = snapshotFile("en", commit, "b_table", data, gitBlobSha(data));
    const b = snapshotFile("en", commit, "a_table", data, gitBlobSha(data));
    const manifest = snapshotManifest("en", commit, [a, b]);
    assert.deepEqual(manifest.files.map((file) => file.table), ["a_table", "b_table"]);
    assert.deepEqual(snapshotMismatches([a, b], { a_table: a.sha256, b_table: "X" }), ["b_table"]);
    assert.deepEqual(snapshotMismatches([a], {}), []);
  });
});

describe("tables from the update report", () => {
  it("reads the latest revision and the needed tables", () => {
    assert.deepEqual(tablesFromReport(report({ latest: commit, changed: true, neededTables: ["skill_table"], listMayBeIncomplete: false }), "en"), { revision: commit, tables: ["skill_table"] });
  });

  it("refuses an unchanged region, an incomplete list or a missing region", () => {
    assert.throws(() => tablesFromReport(report({ latest: commit, changed: false, neededTables: [], listMayBeIncomplete: false }), "en"), /no new/);
    assert.throws(() => tablesFromReport(report({ latest: commit, changed: true, neededTables: ["a"], listMayBeIncomplete: true }), "en"), /incomplete/);
    assert.throws(() => tablesFromReport(report({ latest: commit, changed: true, neededTables: ["a"], listMayBeIncomplete: false }), "cn"), /no latest cn/);
  });
});
