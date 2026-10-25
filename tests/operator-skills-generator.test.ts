import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import type { GameDataRegion } from "../src/game-data/gamedata-revisions";
import { skillsDatasetLimits } from "../src/game-data/operator-dataset";
import { buildSkillsDataset, glossaryFileName, main, readSkillsDataset, skillsDatasetFiles, type SkillsGeneratorOptions } from "../scripts/generate-operator-skills";
import { arg, tableFlag } from "../scripts/operator-dataset-io";

const tables = ["character_table", "skill_table", "range_table", "gamedata_const"] as const;
const level = (description: string) => ({ name: "Skill", rangeId: "r-1", description, skillType: "MANUAL", durationType: "NONE", duration: 5, spData: { spType: 8, spCost: 20, initSp: 5 }, blackboard: [{ key: "atk_scale", value: 2, valueStr: null }] });
const character = (skillIds: readonly string[]) => ({ phases: [{}, {}], allSkillLvlup: Array.from({ length: 6 }, (_, index) => ({ unlockCond: { phase: index < 3 ? "PHASE_0" : "PHASE_1" } })), skills: skillIds.map((skillId) => ({ skillId })) });
const fixtures: Record<GameDataRegion, Record<(typeof tables)[number], unknown>> = {
  en: {
    character_table: { char_a: character(["sk_a"]), char_b: character(["sk_b1", "sk_b2"]), char_extra: character(["sk_a"]), token_a: character(["sk_a"]) },
    skill_table: { sk_a: { levels: Array.from({ length: 7 }, () => level("Deals {atk_scale:0%} and <$ba.stun>stun</>")) }, sk_b1: { levels: [level("One")] }, sk_b2: { levels: [level("Two <$ba.camou>x</>")] } },
    range_table: { "r-1": { direction: 1, grids: [{ row: 0, col: 0 }] } },
    gamedata_const: { termDescriptionDict: { "ba.stun": { termName: "Stun", description: "Stops" }, "ba.camou": { termName: "Camouflage", description: "Hides, <$ba.stun>x</>" } } },
  },
  cn: {
    character_table: { char_cn: character(["sk_c"]) },
    skill_table: { sk_c: { levels: [level("Cn <$ba.root>x</>")] } },
    range_table: { "r-1": { direction: 1, grids: [{ row: 0, col: 0 }] } },
    gamedata_const: { termDescriptionDict: { "ba.root": { termName: "Root", description: "Cannot move" } } },
  },
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex").toUpperCase();
const catalog = new Map<string, GameDataRegion>([["char_a", "en"], ["char_b", "en"], ["char_cn", "cn"]]);
const hashes = Object.fromEntries(["en", "cn"].map((region) => [region, Object.fromEntries(tables.map((table) => [table, "A".repeat(64)]))])) as never;

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "operator-skills-generator-"));
  const argv = ["node", "generate-operator-skills.ts"];
  const expectedHashes = { en: {}, cn: {} } as Record<GameDataRegion, Record<(typeof tables)[number], string>>;
  for (const region of ["en", "cn"] as const) for (const table of tables) {
    const path = join(directory, `${region}-${table}.json`); const text = JSON.stringify(fixtures[region][table]);
    await writeFile(path, text, "utf8"); expectedHashes[region][table] = sha(text); argv.push(tableFlag(region, table), path);
  }
  await writeFile(join(directory, "release.json"), JSON.stringify({ operators: [{ id: "char_a" }, { id: "char_b" }] }), "utf8");
  await writeFile(join(directory, "regional.json"), JSON.stringify({ operators: [{ id: "char_cn" }] }), "utf8");
  const output = join(directory, "operator-skills");
  const options: SkillsGeneratorOptions = { expectedHashes, releaseManifest: join(directory, "release.json"), regionalManifest: join(directory, "regional.json"), catalogSize: 3 };
  return { directory, output, argv: [...argv, "--out-dir", output], options, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
const quiet = () => [mock.method(console, "log", () => undefined), mock.method(console, "warn", () => undefined)];
const snapshot = async (directory: string) => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async (name) => [name, await readFile(join(directory, name), "utf8")])));

test("skills dataset keeps catalog operators only and builds a glossary per region", () => {
  const dataset = buildSkillsDataset(fixtures, catalog, hashes);
  assert.deepEqual(dataset.profiles.map((profile) => [profile.operatorId, profile.region, profile.skills.length]), [["char_a", "en", 1], ["char_b", "en", 2], ["char_cn", "cn", 1]]);
  assert.deepEqual(Object.keys(dataset.glossaries.find((glossary) => glossary.region === "en")!.terms), ["ba.camou", "ba.stun"]);
  assert.deepEqual(Object.keys(dataset.glossaries.find((glossary) => glossary.region === "cn")!.terms), ["ba.root"]);
  assert.equal(dataset.sources.en.path, "en/gamedata/excel/skill_table.json");
  assert.deepEqual(Object.keys(dataset.tables.cn), [...tables]);
  assert.deepEqual(skillsDatasetFiles(dataset).shared.map((file) => file.name), [glossaryFileName("en"), glossaryFileName("cn")]);
});

test("skills dataset rejects catalog operators missing from the character table and tables without terms", () => {
  assert.throws(() => buildSkillsDataset(fixtures, new Map([["char_zz", "en"]]), hashes), /char_zz is missing from the en character table/);
  const broken = { ...fixtures, en: { ...fixtures.en, gamedata_const: {} } };
  assert.throws(() => buildSkillsDataset(broken, catalog, hashes), /no term dictionary/);
});

test("skills generator writes the files, the index and the glossaries, and reads them back", async () => {
  const work = await workspace(); const [log] = quiet();
  try {
    await main(work.argv, work.options);
    assert.deepEqual((await readdir(work.output)).sort(), ["char_a.json", "char_b.json", "char_cn.json", "glossary-cn.json", "glossary-en.json", "index.json"]);
    assert.match(String(log.mock.calls[0].arguments[0]), /Generated 3 skills files and 2 glossaries/);
    const read = await readSkillsDataset(work.output);
    assert.equal(read.profiles.length, 3);
    assert.deepEqual(read.index.limits, skillsDatasetLimits, "the skills index declares its own limits");
    assert.deepEqual(Object.keys(read.index.shared ?? {}), ["glossary-cn", "glossary-en"]);
    assert.equal(read.glossaries["glossary-cn"].terms["ba.root"].name, "Root");
    assert.equal(read.index.tables?.en.range_table.sha256, work.options.expectedHashes!.en.range_table);
    const first = await snapshot(work.output);
    await main([...work.argv, "--force"], work.options);
    assert.deepEqual(await snapshot(work.output), first, "regenerating is deterministic");
  } finally { mock.restoreAll(); await work.cleanup(); }
});

test("skills generator refuses to overwrite without --force and rejects hash mismatches", async () => {
  const work = await workspace(); quiet();
  try {
    await main(work.argv, work.options);
    await assert.rejects(main(work.argv, work.options), /pass --force/);
    await assert.rejects(main([...work.argv, "--force"], { ...work.options, expectedHashes: { ...work.options.expectedHashes!, cn: { ...work.options.expectedHashes!.cn, range_table: "0".repeat(64) } } }), /SHA-256 mismatch: --cn-range/);
    await assert.rejects(main(["node", "generate-operator-skills.ts"]), /Missing --en-character/);
    assert.equal(arg("--out-dir", work.argv), work.output);
  } finally { mock.restoreAll(); await work.cleanup(); }
});

test("skills generator enforces limits without writing and leaves an existing directory intact", async () => {
  const work = await workspace(); quiet();
  try {
    const tight = { ...work.options, limits: { fileBytes: 100, totalBytes: 6_000_000 } };
    await assert.rejects(main(work.argv, tight), /above the 100-byte limit.*output not written/);
    await assert.rejects(stat(work.output), /ENOENT/);
    await main(work.argv, work.options);
    const before = await snapshot(work.output);
    await assert.rejects(main([...work.argv, "--force"], tight), /output not written/);
    assert.deepEqual(await snapshot(work.output), before);
    assert.deepEqual((await readdir(work.directory)).filter((name) => name.includes(".partial") || name.includes(".previous")), []);
  } finally { mock.restoreAll(); await work.cleanup(); }
});

test("skills generator warns from ninety percent of a limit", async () => {
  const work = await workspace(); const [, warn] = quiet();
  try {
    await main(work.argv, work.options);
    const largest = Math.max(...Object.values((await readSkillsDataset(work.output)).index.operators).map((entry) => entry.bytes));
    await main([...work.argv, "--force"], { ...work.options, limits: { fileBytes: Math.ceil(largest / 0.95), totalBytes: 6_000_000 } });
    assert.ok(warn.mock.calls.some((call) => /at least 90%/.test(String(call.arguments[0]))));
  } finally { mock.restoreAll(); await work.cleanup(); }
});

test("skills generator rejects corrupted datasets when reading them back", async () => {
  const work = await workspace(); quiet();
  try {
    await main(work.argv, work.options);
    const file = join(work.output, "char_a.json");
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace("char_a", "char_b"), "utf8");
    await assert.rejects(readSkillsDataset(work.output), /hash mismatch: char_a.json/);
    await writeFile(file, original, "utf8");
    await writeFile(join(work.output, "glossary-en.json"), "{}\n", "utf8");
    await assert.rejects(readSkillsDataset(work.output), /hash mismatch: glossary-en.json/);
  } finally { mock.restoreAll(); await work.cleanup(); }
});
