import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { checkDatasetLimits, skillsDatasetLimits, validateDatasetIndex, type DatasetIndex } from "../src/game-data/operator-dataset";
import { gameDataRevisions, gameDataSkillTableHashes, gameDataTableHashes } from "../src/game-data/gamedata-revisions";
import { expandSkillLevel, type OperatorSkillsProfile } from "../src/game-data/operator-skills";
import { findSkillDataGap } from "../src/game-data/skill-data-gaps";
import { parseSkillDescription, type SkillDescriptionNode } from "../src/game-data/skill-description";

const directory = path.resolve("data/operator-skills");
const statsDirectory = path.resolve("data/operator-stats");
const expectedOperators = 432;

async function readIndex(dir: string): Promise<{ index: DatasetIndex; indexBytes: number }> {
  const text = await readFile(path.join(dir, "index.json"));
  return { index: JSON.parse(text.toString("utf8")) as DatasetIndex, indexBytes: text.byteLength };
}
const hash = (content: Buffer) => createHash("sha256").update(content).digest("hex").toUpperCase();
async function readProfiles(index: DatasetIndex): Promise<OperatorSkillsProfile[]> {
  return Promise.all(Object.values(index.operators).map(async (entry) => JSON.parse(await readFile(path.join(directory, entry.file), "utf8")) as OperatorSkillsProfile));
}
const unknownMarkers = (nodes: readonly SkillDescriptionNode[]): string[] => nodes.flatMap((node) => node.type === "unknownMarker" ? [node.text] : node.type === "style" ? unknownMarkers(node.children) : []);

test("skills dataset index is valid and lists the same operators and regions as the stats dataset", async () => {
  const { index } = await readIndex(directory);
  assert.deepEqual(validateDatasetIndex(index), []);
  assert.equal(Object.keys(index.operators).length, expectedOperators);
  const stats = (await readIndex(statsDirectory)).index;
  assert.deepEqual(Object.fromEntries(Object.entries(index.operators).map(([id, entry]) => [id, entry.region])), Object.fromEntries(Object.entries(stats.operators).map(([id, entry]) => [id, entry.region])));
});

test("skills dataset directory has exactly the indexed files, the glossaries and the index", async () => {
  const { index } = await readIndex(directory);
  const expected = [...Object.values(index.operators).map((entry) => entry.file), ...Object.values(index.shared ?? {}).map((entry) => entry.file), "index.json"].sort();
  assert.deepEqual((await readdir(directory)).sort(), expected);
  assert.deepEqual(Object.keys(index.shared ?? {}), ["glossary-cn", "glossary-en"]);
});

test("skills dataset files match the bytes, hash, id and region in the index", async () => {
  const { index } = await readIndex(directory);
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const content = await readFile(path.join(directory, entry.file));
    assert.equal(content.byteLength, entry.bytes, `${operatorId} bytes`);
    assert.equal(hash(content), entry.sha256.toUpperCase(), `${operatorId} sha256`);
    const profile = JSON.parse(content.toString("utf8")) as OperatorSkillsProfile;
    assert.equal(profile.operatorId, operatorId);
    assert.equal(profile.region, entry.region);
  }
  for (const [name, entry] of Object.entries(index.shared ?? {})) {
    const content = await readFile(path.join(directory, entry.file));
    assert.equal(content.byteLength, entry.bytes, `${name} bytes`);
    assert.equal(hash(content), entry.sha256.toUpperCase(), `${name} sha256`);
  }
});

test("skills dataset levels are ordered, ranges resolve and every description marker has a value", async () => {
  const { index } = await readIndex(directory);
  const labels = ["1", "2", "3", "4", "5", "6", "7", "M1", "M2", "M3"];
  let skills = 0;
  for (const profile of await readProfiles(index)) {
    profile.skills.forEach((skill, position) => {
      skills += 1;
      assert.equal(skill.slot, position + 1, `${profile.operatorId} slot`);
      assert.ok(skill.levels.length === 7 || skill.levels.length === 10, `${skill.skillId} has ${skill.levels.length} levels`);
      assert.deepEqual(skill.levels.map((level) => level.level), labels.slice(0, skill.levels.length), `${skill.skillId} level labels`);
      for (const level of skill.levels) {
        if (level.rangeId) assert.ok(profile.ranges[level.rangeId], `${skill.skillId} range ${level.rangeId}`);
        const absent = level.absentKeys ?? [];
        for (const key of [...absent, ...(level.correctedKeys ?? [])]) assert.ok(findSkillDataGap(skill.skillId, key), `${skill.skillId} ${key} is not a declared gap`);
        const { description, blackboard } = expandSkillLevel(skill, level);
        const markers = unknownMarkers(parseSkillDescription(description, blackboard));
        assert.deepEqual(markers.filter((marker) => !absent.some((key) => marker.startsWith(`{${key}`))), [], `${skill.skillId} level ${level.level} has an unresolved marker`);
      }
    });
  }
  assert.ok(skills > 900);
});

test("the 17 catalog operators without skills (1 and 2 star) still have a file with an empty skill list", async () => {
  const { index } = await readIndex(directory);
  const empty = (await readProfiles(index)).filter((profile) => profile.skills.length === 0).map((profile) => profile.operatorId);
  assert.equal(empty.length, 17);
});

test("skills dataset pins the source revisions and tables and stays within its own limits", async () => {
  const { index, indexBytes } = await readIndex(directory);
  assert.deepEqual(index.limits, skillsDatasetLimits);
  for (const region of ["en", "cn"] as const) {
    assert.equal(index.sources[region].revision, gameDataRevisions[region]);
    assert.match(index.sources[region].revision, /^[0-9a-f]{40}$/);
    const expectedHashes = { character_table: gameDataTableHashes[region].character_table, ...gameDataSkillTableHashes[region] };
    assert.deepEqual(Object.keys(index.tables?.[region] ?? {}).sort(), Object.keys(expectedHashes).sort());
    for (const [table, source] of Object.entries(index.tables?.[region] ?? {})) {
      assert.equal(source.revision, gameDataRevisions[region]);
      assert.equal(source.sha256, expectedHashes[table as keyof typeof expectedHashes], `${region} ${table} hash`);
    }
  }
  assert.deepEqual(checkDatasetLimits(index, indexBytes, skillsDatasetLimits).errors, []);
});
