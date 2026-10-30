import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { checkDatasetLimits, modulesDatasetContractVersion, modulesDatasetLimits, validateDatasetIndex, type DatasetIndex } from "../src/game-data/operator-dataset";
import { imageRevision } from "../src/game-data/asset-revisions";
import { gameDataFavorTableHashes, gameDataRevisions, gameDataSkillTableHashes, gameDataTableHashes } from "../src/game-data/gamedata-revisions";
import { moduleDescriptions, type OperatorModulesProfile } from "../src/game-data/operator-modules";
import type { ModuleArtManifest } from "../src/game-data/operator-module-art";
import { termIdsOf, type OperatorSkillsProfile } from "../src/game-data/operator-skills";
import { parseSkillDescription, type SkillBlackboardEntry, type SkillDescriptionNode } from "../src/game-data/skill-description";

const directory = path.resolve("data/operator-modules");
const skillsDirectory = path.resolve("data/operator-skills");
const expectedOperators = 432;

async function readIndex(dir: string): Promise<{ index: DatasetIndex; indexBytes: number }> {
  const text = await readFile(path.join(dir, "index.json"));
  return { index: JSON.parse(text.toString("utf8")) as DatasetIndex, indexBytes: text.byteLength };
}
const hash = (content: Buffer) => createHash("sha256").update(content).digest("hex").toUpperCase();
const readProfiles = async (index: DatasetIndex) => Promise.all(Object.values(index.operators).map(async (entry) => JSON.parse(await readFile(path.join(directory, entry.file), "utf8")) as OperatorModulesProfile));
const unknownMarkers = (nodes: readonly SkillDescriptionNode[]): string[] => nodes.flatMap((node) => node.type === "unknownMarker" ? [node.text] : node.type === "style" ? unknownMarkers(node.children) : []);
const assertReadable = (label: string, text: string, blackboard: readonly SkillBlackboardEntry[] = []) => assert.deepEqual(unknownMarkers(parseSkillDescription(text, blackboard)), [], label);

test("modules dataset index is valid, pinned and lists the same operators and regions as the skills dataset", async () => {
  const { index, indexBytes } = await readIndex(directory);
  assert.deepEqual(validateDatasetIndex(index, modulesDatasetContractVersion), []);
  assert.equal(index.dataset, "operator-modules");
  assert.equal(Object.keys(index.operators).length, expectedOperators);
  assert.deepEqual(index.limits, modulesDatasetLimits);
  assert.deepEqual(checkDatasetLimits(index, indexBytes).errors, []);
  const skills = (await readIndex(skillsDirectory)).index;
  assert.deepEqual(Object.fromEntries(Object.entries(index.operators).map(([id, entry]) => [id, entry.region])), Object.fromEntries(Object.entries(skills.operators).map(([id, entry]) => [id, entry.region])));
  for (const region of ["en", "cn"] as const) {
    const tables = index.tables![region];
    assert.equal(tables.character_table.sha256, gameDataTableHashes[region].character_table);
    assert.equal(tables.uniequip_table.sha256, gameDataTableHashes[region].uniequip_table);
    assert.equal(tables.battle_equip_table.sha256, gameDataTableHashes[region].battle_equip_table);
    assert.equal(tables.range_table.sha256, gameDataSkillTableHashes[region].range_table);
    assert.equal(tables.gamedata_const.sha256, gameDataSkillTableHashes[region].gamedata_const);
    assert.equal(tables.favor_table.sha256, gameDataFavorTableHashes[region].favor_table);
    assert.equal(index.sources[region].revision, gameDataRevisions[region]);
  }
});

test("modules dataset directory has exactly the indexed files, whose bytes, hash, id and region match", async () => {
  const { index } = await readIndex(directory);
  const expected = [...Object.values(index.operators).map((entry) => entry.file), ...Object.values(index.shared ?? {}).map((entry) => entry.file), "index.json"].sort();
  assert.deepEqual((await readdir(directory)).sort(), expected);
  assert.deepEqual(Object.keys(index.shared ?? {}), ["glossary-cn", "glossary-en"]);
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const content = await readFile(path.join(directory, entry.file));
    assert.equal(content.byteLength, entry.bytes, `${operatorId} bytes`);
    assert.equal(hash(content), entry.sha256, `${operatorId} sha256`);
    const profile = JSON.parse(content.toString("utf8")) as OperatorModulesProfile;
    assert.equal(profile.operatorId, operatorId);
    assert.equal(profile.region, entry.region);
  }
  for (const [name, entry] of Object.entries(index.shared ?? {})) {
    const content = await readFile(path.join(directory, entry.file));
    assert.equal(content.byteLength, entry.bytes, `${name} bytes`);
    assert.equal(hash(content), entry.sha256, `${name} sha256`);
  }
});

test("every module talent change points to a talent of the skills dataset", async () => {
  const { index } = await readIndex(directory);
  let checked = 0;
  for (const profile of await readProfiles(index)) {
    const skills = JSON.parse(await readFile(path.join(skillsDirectory, `${profile.operatorId}.json`), "utf8")) as OperatorSkillsProfile;
    const talents = new Set(skills.talents.map((talent) => talent.index));
    for (const item of profile.modules) for (const level of item.levels) for (const change of [...level.talents, ...(level.modes ?? []).flatMap((mode) => mode.talents)]) {
      if (change.index === null) continue;
      assert.ok(talents.has(change.index), `${item.id} level ${level.level} changes talent ${change.index}, which ${profile.operatorId} does not show`);
      checked += 1;
    }
  }
  assert.ok(checked > 1_500, `only ${checked} talent changes were checked`);
});

test("only Pepe, Raidian and Mcnist show effects limited to a game mode, tagged with their mode", async () => {
  const { index } = await readIndex(directory);
  const found: string[] = [];
  for (const profile of await readProfiles(index)) for (const item of profile.modules) for (const level of item.levels) for (const mode of level.modes ?? []) found.push(`${item.id} ${level.level} ${mode.gameTag ?? "-"} ${mode.mapTag ?? "-"}`);
  assert.deepEqual(found.sort(), [
    "uniequip_002_mcnist 1 - rogue_6", "uniequip_002_mcnist 2 - rogue_6", "uniequip_002_mcnist 3 - rogue_6",
    "uniequip_003_pepe 2 sandbox -", "uniequip_003_pepe 3 sandbox -",
    "uniequip_003_radian 1 - rogue_yan", "uniequip_003_radian 2 - rogue_yan", "uniequip_003_radian 2 roguelike rogue_yan", "uniequip_003_radian 3 - rogue_yan", "uniequip_003_radian 3 roguelike rogue_yan",
  ]);
});

test("modules are E2 modules with three ordered levels, readable texts, known ranges, icons and glossary terms, and no trait", async () => {
  const { index } = await readIndex(directory);
  const glossaries = { en: JSON.parse(await readFile(path.join(directory, "glossary-en.json"), "utf8")), cn: JSON.parse(await readFile(path.join(directory, "glossary-cn.json"), "utf8")) } as Record<"en" | "cn", { terms: Record<string, unknown> }>;
  const icons = new Set<string>();
  for (const profile of await readProfiles(index)) {
    assert.equal("trait" in profile, false, `${profile.operatorId}: the trait lives in the stats file`);
    if (profile.region === "cn") assert.ok(profile.modules.every((item) => item.region === "cn"), `${profile.operatorId} is CN-only`);
    for (const item of profile.modules) {
      assert.doesNotMatch(item.type, /^ORIGINAL/);
      assert.equal(item.unlock.elite, 2);
      assert.deepEqual(item.levels.map((level) => level.level), [1, 2, 3]);
      icons.add(item.icon);
      for (const level of item.levels) {
        for (const mode of level.modes ?? []) {
          assert.ok(mode.gameTag || mode.mapTag, `${item.id} mode effects carry their mode`);
          assert.ok(mode.rangeId || mode.traits.length || mode.talents.length, `${item.id} mode effects are not empty`);
        }
        for (const effects of [level, ...(level.modes ?? [])]) {
          for (const change of effects.traits) for (const text of [change.override, change.addition]) if (text) assertReadable(`${item.id} trait`, text, change.blackboard);
          for (const change of effects.talents) assertReadable(`${item.id} talent`, change.description);
          for (const rangeId of [effects.rangeId, ...effects.talents.map((change) => change.rangeId)]) if (rangeId) assert.ok(profile.ranges[rangeId], `${item.id} range ${rangeId}`);
        }
        assert.ok(level.trust === null || (Number.isInteger(level.trust) && level.trust >= 0 && level.trust <= 200), `${item.id} level ${level.level} trust`);
        for (const token of Object.keys(level.tokenAttributes ?? {})) assert.ok(profile.tokens[token], `${item.id} summon ${token} has a name`);
      }
      for (const id of moduleDescriptions(item).flatMap(termIdsOf)) assert.ok(glossaries[item.region].terms[id], `${id} in the ${item.region} glossary`);
    }
  }
  for (const icon of icons) await access(path.resolve("public/assets/operator-modules", `${icon}.png`));
});

test("every module has its illustration, and the art and level icons match the manifest", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("data/operator-module-art-manifest.json"), "utf8")) as ModuleArtManifest;
  assert.equal(manifest.source.revision, imageRevision);
  const { index } = await readIndex(directory);
  const ids = (await readProfiles(index)).flatMap((profile) => profile.modules.map((module) => module.id)).sort();
  assert.deepEqual(Object.keys(manifest.art).sort(), ids.map((id) => `${id}.webp`), "one illustration per module, no extra files");
  const artDirectory = path.resolve("public/assets/operator-modules-art");
  assert.deepEqual((await readdir(artDirectory)).sort(), Object.keys(manifest.art).sort());
  for (const [file, entry] of Object.entries(manifest.art)) {
    const content = await readFile(path.join(artDirectory, file));
    assert.equal(content.subarray(8, 12).toString("ascii"), "WEBP", file);
    assert.deepEqual([content.byteLength, hash(content)], [entry.converted.bytes, entry.converted.sha256], file);
    assert.ok(Math.max(entry.converted.width, entry.converted.height) <= manifest.conversion.maxSize, file);
    assert.equal(entry.url, `https://raw.githubusercontent.com/${manifest.source.repository}/${manifest.source.revision}/${entry.source}`);
  }
  assert.deepEqual(Object.keys(manifest.stages), ["stage-1.png", "stage-2.png", "stage-3.png"]);
  for (const [file, entry] of Object.entries(manifest.stages)) {
    const content = await readFile(path.resolve("public/assets/operator-module-stages", file));
    assert.deepEqual([content.byteLength, hash(content)], [entry.bytes, entry.sha256], file);
  }
});
