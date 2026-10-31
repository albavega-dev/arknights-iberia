import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { imageRepository } from "../src/game-data/asset-revisions";
import { gitBlobSha } from "../src/game-data/git-blob";
import {
  assertGitHubUrl, compareUrl, contentsUrl, gameDataDirectory, gameDataDirectorySegments, gameDataRegion, gameDataTable, gameDataTables, gitObjectId, latestCommitUrl,
  rawGameDataUrl, repositorySegments, treeUrl,
} from "../src/game-data/github-requests";
import { gameDataRepository } from "../src/game-data/gamedata-revisions";
import { directoryBlobs, fetchBytes, github } from "../scripts/github-api";

const commit = "0123456789abcdef0123456789abcdef01234567";
const other = "fedcba9876543210fedcba9876543210fedcba98";
const malicious = ["", "../x", "..", ".", "a/b", "a%2Fb", "https://evil.example/x", "//evil.example", "a?b", "a#b", "a b", "a\\b", "\u0000", "é"];

describe("validated values", () => {
  it("accepts only full lowercase object ids", () => {
    assert.equal(gitObjectId(commit), commit);
    for (const value of [commit.toUpperCase(), commit.slice(0, 39), `${commit}0`, `${commit.slice(0, 39)}g`, "main", 1, null, undefined, ...malicious]) assert.throws(() => gitObjectId(value), /Invalid git object id/, String(value));
  });

  it("accepts only en and cn as regions", () => {
    assert.equal(gameDataRegion("en"), "en");
    assert.equal(gameDataRegion("cn"), "cn");
    for (const value of ["EN", "jp", "en/..", ...malicious]) assert.throws(() => gameDataRegion(value), /Invalid region/);
  });

  it("accepts only the pinned tables", () => {
    assert.deepEqual(gameDataTables, ["battle_equip_table", "building_data", "character_table", "favor_table", "gacha_table", "gamedata_const", "handbook_info_table", "range_table", "roguelike_topic_table", "skill_table", "uniequip_table"]);
    for (const value of ["character_table.json", "other_table", "../character_table", "character_table/..", ...malicious]) assert.throws(() => gameDataTable(value), /Unknown GameData table/);
  });

  it("accepts only the repositories of the project", () => {
    assert.deepEqual(repositorySegments(gameDataRepository), gameDataRepository.split("/"));
    assert.equal(repositorySegments(imageRepository).join("/"), imageRepository);
    for (const value of ["fexli/ArknightsResource", "ArknightsAssets/Other", "ArknightsAssets/ArknightsGamedata/..", "evil/ArknightsGamedata", `${gameDataRepository}/`, ...malicious]) assert.throws(() => repositorySegments(value), /Repository not allowed/);
  });

  it("accepts only the tables directories", () => {
    assert.deepEqual(gameDataDirectorySegments(gameDataDirectory("cn")), ["cn", "gamedata", "excel"]);
    for (const value of ["en/gamedata", "en/gamedata/excel/", "en/gamedata/excel/..", "../en/gamedata/excel", "en//gamedata/excel", ...malicious]) assert.throws(() => gameDataDirectorySegments(value), /Directory not allowed/);
  });
});

describe("built URLs", () => {
  it("builds the API and raw URLs on their hosts", () => {
    assert.equal(latestCommitUrl(gameDataRepository, "en/gamedata/excel").href, "https://api.github.com/repos/ArknightsAssets/ArknightsGamedata/commits?per_page=1&path=en%2Fgamedata%2Fexcel");
    assert.equal(latestCommitUrl(imageRepository).href, `https://api.github.com/repos/${imageRepository}/commits?per_page=1`);
    assert.equal(compareUrl(imageRepository, commit, other, 2).href, `https://api.github.com/repos/${imageRepository}/compare/${commit}...${other}?per_page=100&page=2`);
    assert.equal(treeUrl(gameDataRepository, commit).href, `https://api.github.com/repos/${gameDataRepository}/git/trees/${commit}`);
    assert.equal(treeUrl(imageRepository, commit, true).href, `https://api.github.com/repos/${imageRepository}/git/trees/${commit}?recursive=1`);
    assert.equal(contentsUrl(gameDataRepository, commit, "cn/gamedata/excel").href, `https://api.github.com/repos/${gameDataRepository}/contents/cn/gamedata/excel?ref=${commit}`);
    assert.equal(rawGameDataUrl(commit, "en", "skill_table").href, `https://raw.githubusercontent.com/${gameDataRepository}/${commit}/en/gamedata/excel/skill_table.json`);
  });

  it("rejects malicious values before building any URL", () => {
    for (const value of malicious) {
      assert.throws(() => compareUrl(imageRepository, value, other, 1));
      assert.throws(() => treeUrl(gameDataRepository, value));
      assert.throws(() => contentsUrl(gameDataRepository, value));
      assert.throws(() => contentsUrl(imageRepository, "main"), /Invalid git object id/);
      assert.throws(() => latestCommitUrl(gameDataRepository, value));
      assert.throws(() => rawGameDataUrl(commit, value as "en", "skill_table"));
      assert.throws(() => rawGameDataUrl(commit, "en", value));
      assert.throws(() => rawGameDataUrl(value, "en", "skill_table"));
    }
    for (const page of [0, -1, 1.5, Number.NaN]) assert.throws(() => compareUrl(imageRepository, commit, other, page), /Invalid page/);
  });

  it("checks protocol, host and credentials", () => {
    assert.equal(assertGitHubUrl("https://api.github.com/repos", "api.github.com").host, "api.github.com");
    for (const value of ["http://api.github.com/repos", "https://api.github.com.evil.example/repos", "https://evil.example/api.github.com", "https://user:pass@api.github.com/repos", "https://raw.githubusercontent.com/x"]) {
      assert.throws(() => assertGitHubUrl(value, "api.github.com"), /Unexpected URL host/, value);
    }
  });
});

describe("GitHub requests", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  const respond = (handler: (url: URL) => unknown) => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: URL | string) => {
      const url = new URL(input);
      requested.push(url.href);
      const body = handler(url);
      return typeof body === "string" ? new Response(body) : Response.json(body);
    }) as typeof fetch;
    return requested;
  };

  it("refuses a URL on another host without requesting it", async () => {
    const requested = respond(() => ({}));
    await assert.rejects(github(new URL("https://evil.example/repos")), /Unexpected URL host/);
    await assert.rejects(github(new URL("https://raw.githubusercontent.com/x")), /Unexpected URL host/);
    await assert.rejects(fetchBytes(new URL("https://api.github.com/repos")), /Unexpected URL host/);
    assert.deepEqual(requested, []);
  });

  it("follows the tree of a tables directory and checks every tree id it receives", async () => {
    const trees: Record<string, unknown> = {
      [commit]: { truncated: false, tree: [{ path: "en", type: "tree", sha: "1".repeat(40) }] },
      ["1".repeat(40)]: { truncated: false, tree: [{ path: "gamedata", type: "tree", sha: "2".repeat(40) }] },
      ["2".repeat(40)]: { truncated: false, tree: [{ path: "excel", type: "tree", sha: "3".repeat(40) }] },
      ["3".repeat(40)]: { truncated: false, tree: [{ path: "skill_table.json", type: "blob", sha: "4".repeat(40) }, { path: "notes.txt", type: "blob", sha: "5".repeat(40) }] },
    };
    const requested = respond((url) => trees[url.pathname.split("/").at(-1)!]);
    assert.deepEqual(await directoryBlobs(gameDataRepository, commit, "en/gamedata/excel"), { skill_table: "4".repeat(40) });
    assert.ok(requested.every((href) => href.startsWith(`https://api.github.com/repos/${gameDataRepository}/git/trees/`)));

    respond((url) => url.pathname.endsWith(commit) ? { truncated: false, tree: [{ path: "en", type: "tree", sha: "../../../evil" }] } : {});
    await assert.rejects(directoryBlobs(gameDataRepository, commit, "en/gamedata/excel"), /Invalid git object id/);
    await assert.rejects(directoryBlobs(gameDataRepository, commit, "en/gamedata/../.."), /Directory not allowed/);
    await assert.rejects(directoryBlobs("evil/repo", commit, "en/gamedata/excel"), /Repository not allowed/);
  });

  it("reports HTTP errors, truncated trees and missing directories", async () => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await assert.rejects(github(treeUrl(gameDataRepository, commit)), /GitHub API 404 for \/repos\/ArknightsAssets\/ArknightsGamedata\/git\/trees\//);
    await assert.rejects(fetchBytes(rawGameDataUrl(commit, "en", "skill_table")), /Download failed with HTTP 404 for skill_table\.json/);
    respond(() => ({ truncated: true, tree: [] }));
    await assert.rejects(directoryBlobs(gameDataRepository, commit, "en/gamedata/excel"), /Git tree truncated/);
    respond(() => ({ truncated: false, tree: [{ path: "cn", type: "tree", sha: "1".repeat(40) }] }));
    await assert.rejects(directoryBlobs(gameDataRepository, commit, "en/gamedata/excel"), /en\/gamedata\/excel is not in 0123456/);
  });

  it("downloads raw files and checks them against the blob hash", async () => {
    const data = Buffer.from("{}\n");
    respond(() => data.toString());
    assert.deepEqual(await fetchBytes(rawGameDataUrl(commit, "en", "skill_table"), gitBlobSha(data)), data);
    assert.deepEqual(await fetchBytes(rawGameDataUrl(commit, "en", "skill_table")), data);
    await assert.rejects(fetchBytes(rawGameDataUrl(commit, "en", "skill_table"), "0".repeat(40)), /does not match the git blob hash/);
  });
});
