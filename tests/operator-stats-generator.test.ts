import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { gameDataRepository, gameDataRevisions, type GameDataRegion, type GameDataTable } from "../src/game-data/gamedata-revisions";
import type { DatasetIndex } from "../src/game-data/operator-dataset";
import { arg, compareStatsManifests, main, readCatalog, readStatsDataset, tableFlag, type StatsDataset, type StatsGeneratorOptions } from "../scripts/generate-operator-stats";
import { compareCodeUnits } from "../src/game-data/string-order";

const buff = { attributes: { attributeModifiers: [{ attributeType: "COST", formulaItem: "ADDITION", value: -1 }] } };
const traitStages = { candidates: [{ unlockCondition: { phase: "PHASE_0", level: 1 }, requiredPotentialRank: 0, blackboard: [{ key: "value", value: 1 }], overrideDescripton: null }, { unlockCondition: { phase: "PHASE_2", level: 1 }, requiredPotentialRank: 0, blackboard: [{ key: "value", value: 2 }], overrideDescripton: null }] };
const character = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, { description: id === "char_a" ? "Hits <@ba.kw>{value}</> enemies" : "Plain trait", trait: id === "char_a" ? traitStages : null, phases: [{ maxLevel: 1, attributesKeyFrames: [{ level: 1, data: { maxHp: 100, atk: 10 } }] }], favorKeyFrames: [], potentialRanks: [{ buff }] }]));
const fixtures: Record<GameDataRegion, Record<GameDataTable, unknown>> = {
  en: {
    character_table: character(["char_b", "char_a", "char_extra"]),
    uniequip_table: { charEquip: { char_a: ["uniequip_a"] }, equipDict: { uniequip_a: { charId: "char_a", uniEquipName: "Module A", typeName1: "PHY", typeName2: "X", typeIcon: "phy-x" } } },
    battle_equip_table: { uniequip_a: { phases: [{ equipLevel: 1, attributeBlackboard: [{ key: "atk", value: 5 }], parts: [] }] } },
  },
  cn: {
    character_table: character(["char_a", "char_b", "char_cn"]),
    uniequip_table: { charEquip: {}, equipDict: {} },
    battle_equip_table: {},
  },
};
const tables: readonly GameDataTable[] = ["character_table", "uniequip_table", "battle_equip_table"];
const sha = (text: string) => createHash("sha256").update(text).digest("hex").toUpperCase();

async function workspace(release: unknown = { operators: [{ id: "char_a" }, { id: "char_b" }] }, regional: unknown = { operators: [{ id: "char_cn" }] }) {
  const directory = await mkdtemp(join(tmpdir(), "operator-stats-generator-"));
  const argv = ["node", "generate-operator-stats.ts"];
  const expectedHashes = { en: {}, cn: {} } as Record<GameDataRegion, Record<GameDataTable, string>>;
  for (const region of ["en", "cn"] as const) for (const table of tables) {
    const path = join(directory, `${region}-${table}.json`); const text = JSON.stringify(fixtures[region][table]);
    await writeFile(path, text, "utf8"); expectedHashes[region][table] = sha(text); argv.push(tableFlag(region, table), path);
  }
  await writeFile(join(directory, "release.json"), JSON.stringify(release), "utf8");
  await writeFile(join(directory, "regional.json"), JSON.stringify(regional), "utf8");
  const output = join(directory, "operator-stats");
  const options: StatsGeneratorOptions = { expectedHashes, releaseManifest: join(directory, "release.json"), regionalManifest: join(directory, "regional.json"), catalogSize: 3 };
  return { directory, output, argv: [...argv, "--out-dir", output], options, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
const quiet = () => [mock.method(console, "log", () => undefined), mock.method(console, "warn", () => undefined)];
const snapshot = async (directory: string) => Object.fromEntries(await Promise.all((await readdir(directory)).sort(compareCodeUnits).map(async (name) => [name, await readFile(join(directory, name), "utf8")])));

test("stats generator parses table flags and rejects missing arguments", async () => {
  assert.equal(tableFlag("en", "battle_equip_table"), "--en-battle-equip");
  assert.equal(arg("--out-dir", ["node", "script", "--out-dir", "operator-stats"]), "operator-stats");
  assert.throws(() => arg("--out-dir", ["node", "script", "--out-dir", "--force"]), /Missing --out-dir/);
  await assert.rejects(main(["node", "generate-operator-stats.ts"]), /Missing --en-character/);
});

test("stats generator refuses to overwrite without force and rejects unpinned snapshots", async () => {
  const { output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await main(argv, options);
    await assert.rejects(main(argv, options), /Output exists; pass --force/);
    await assert.rejects(main([...argv, "--force"], { ...options, expectedHashes: undefined }), /Snapshot SHA-256 mismatch: --en-character/);
    assert.ok((await stat(output)).isDirectory());
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});

test("stats generator writes one indented file per catalog operator and a deterministic index", async () => {
  const { directory, output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await main(argv, options);
    const first = await snapshot(output);
    await main([...argv, "--force"], options);
    assert.deepEqual(await snapshot(output), first);
    assert.deepEqual(Object.keys(first), ["char_a.json", "char_b.json", "char_cn.json", "index.json"]);
    assert.deepEqual((await readdir(directory)).filter((name) => name.includes(".partial") || name.includes(".previous")), []);
    const index = JSON.parse(first["index.json"]) as DatasetIndex;
    assert.equal(index.dataset, "operator-stats");
    assert.deepEqual(Object.entries(index.operators).map(([id, entry]) => [id, entry.region, entry.file]), [["char_a", "en", "char_a.json"], ["char_b", "en", "char_b.json"], ["char_cn", "cn", "char_cn.json"]]);
    assert.deepEqual(index.sources.cn, { repository: gameDataRepository, revision: gameDataRevisions.cn, path: "cn/gamedata/excel/character_table.json", sha256: options.expectedHashes?.cn.character_table });
    assert.equal(index.operators.char_a.sha256, sha(first["char_a.json"]));
    assert.equal(index.operators.char_a.bytes, Buffer.byteLength(first["char_a.json"]));
    const profile = JSON.parse(first["char_a.json"]);
    assert.equal("source" in profile, false);
    assert.ok(first["char_a.json"].startsWith("{\n  \"operatorId\": \"char_a\""));
    assert.deepEqual(profile.potentialRanks, [{ rank: 0, effects: [buff] }]);
    assert.equal(index.contractVersion, "3");
    assert.deepEqual(profile.trait, [
      { unlock: { elite: 0, level: 1 }, potential: 1, description: "Hits <@ba.kw>{value}</> enemies", blackboard: [{ key: "value", value: 1 }] },
      { unlock: { elite: 2, level: 1 }, potential: 1, description: "Hits <@ba.kw>{value}</> enemies", blackboard: [{ key: "value", value: 2 }] },
    ]);
    assert.deepEqual(JSON.parse(first["char_b.json"]).trait, [{ unlock: { elite: 0, level: 1 }, potential: 1, description: "Plain trait" }], "without candidates the trait is the plain description");
    assert.deepEqual(profile.modules.map((module: { uniEquipId: string; moduleSourceRegion: string; moduleType: string }) => [module.uniEquipId, module.moduleSourceRegion, module.moduleType]), [["uniequip_a", "en", "PHY-X"]]);
    const dataset = await readStatsDataset(output);
    assert.deepEqual(dataset.profiles.map((item) => item.operatorId), ["char_a", "char_b", "char_cn"]);
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});

test("stats generator rejects corrupted datasets when reading them back", async () => {
  const { output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await main(argv, options);
    const indexPath = join(output, "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    await writeFile(join(output, "char_b.json"), "{}\n", "utf8");
    await assert.rejects(readStatsDataset(output), /Dataset file hash mismatch: char_b.json/);
    await writeFile(join(output, "char_b.json"), "{\"operatorId\":\"char_a\",\"region\":\"en\"}\n", "utf8");
    index.operators.char_b.sha256 = sha("{\"operatorId\":\"char_a\",\"region\":\"en\"}\n");
    await writeFile(indexPath, JSON.stringify(index), "utf8");
    await assert.rejects(readStatsDataset(output), /Dataset file identity mismatch: char_b.json/);
    await writeFile(indexPath, JSON.stringify({ ...index, contractVersion: "1" }), "utf8");
    await assert.rejects(readStatsDataset(output), /Invalid dataset index: Unsupported contract: 1/);
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});

test("stats generator validates the catalog", async () => {
  const { directory, cleanup } = await workspace();
  try {
    const write = async (name: string, value: unknown) => { const path = join(directory, name); await writeFile(path, JSON.stringify(value), "utf8"); return path; };
    const regional = await write("cn.json", { operators: [{ id: "char_cn" }] });
    await assert.rejects(readCatalog(await write("dup.json", { operators: [{ id: "char_a" }, { id: "char_a" }] }), regional, 2), /Duplicate catalog operator: char_a/);
    await assert.rejects(readCatalog(await write("overlap.json", { operators: [{ id: "char_cn" }] }), regional, 1), /Duplicate catalog operator: char_cn/);
    await assert.rejects(readCatalog(await write("size.json", { operators: [{ id: "char_a" }] }), regional, 3), /Catalog has 2 operators; expected 3/);
    await assert.rejects(readCatalog(await write("empty.json", {}), regional, 1), /Release manifest has no operators/);
    await assert.rejects(readCatalog(await write("noid.json", { operators: [{}] }), regional, 2), /Release manifest has an operator without id/);
  } finally { await cleanup(); }
  const missing = await workspace({ operators: [{ id: "char_a" }, { id: "char_missing" }] });
  try { await assert.rejects(main(missing.argv, missing.options), /missing from the en character table: char_missing/); } finally { await missing.cleanup(); }
});

test("stats generator verifies against contract 1 and 2 manifests without the trait, and a contract 3 directory with it", async () => {
  const { directory, output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await main(argv, options);
    const generated: StatsDataset = await readStatsDataset(output);
    const withoutTrait = generated.profiles.map(({ trait, ...profile }) => { void trait; return profile; });
    const legacy = { contractVersion: "1", profiles: [...withoutTrait.map((profile) => ({ ...profile, source: generated.sources[profile.region as GameDataRegion], modules: profile.modules.map((module) => ({ ...module, moduleSourceRegion: "preferred" })) })), { operatorId: "char_a", region: "cn", profiles: [] }] };
    assert.deepEqual(compareStatsManifests(legacy, generated), { identical: 3, differences: [], missing: [], ignored: 1, removed: ["char_a/cn"], sources: [], shared: [] });
    assert.equal(compareStatsManifests(generated, generated).identical, 3);
    assert.equal(compareStatsManifests({ contractVersion: "2", sources: generated.sources, profiles: withoutTrait }, generated).identical, 3, "contract 2 has no trait: the rest of each profile must match");
    const otherTrait = { ...generated, profiles: generated.profiles.map((profile) => ({ ...profile, trait: [] })) };
    assert.deepEqual(compareStatsManifests(otherTrait, generated).differences.map((item) => item.keys), [["trait"], ["trait"], ["trait"]]);
    const changed = JSON.parse(JSON.stringify(legacy)); changed.profiles[0].phases[0].maxLevel = 90; changed.profiles[1].source = { ...changed.profiles[1].source, revision: "other" };
    assert.deepEqual(compareStatsManifests(changed, generated).differences, [{ operatorId: "char_a", keys: ["phases"], fields: ["phases[0].maxLevel"] }, { operatorId: "char_b", keys: ["source"], fields: ["source"] }]);
    assert.deepEqual(compareStatsManifests({ contractVersion: "1", profiles: [] }, generated).missing, ["char_a/en", "char_b/en", "char_cn/cn"]);
    assert.throws(() => compareStatsManifests({ contractVersion: "4", profiles: [] }, generated), /unknown contract/);
    const reference = join(directory, "reference.json");
    await writeFile(reference, JSON.stringify(legacy), "utf8");
    await main([...argv, "--force", "--verify-against", reference], options);
    await main([...argv, "--force", "--verify-against", output], options);
    const before = await snapshot(output);
    await writeFile(reference, JSON.stringify(changed), "utf8");
    await assert.rejects(main([...argv, "--force", "--verify-against", reference], options), /Verification failed; output not written/);
    assert.deepEqual(await snapshot(output), before);
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});

test("stats generator in update mode reports the source change once and the changed fields for approval", async () => {
  const { directory, output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await main(argv, options);
    const generated = await readStatsDataset(output);
    const older = JSON.parse(JSON.stringify(generated)); older.sources.en = { ...older.sources.en, revision: "old" }; older.profiles[0].phases[0].maxLevel = 99;
    const verification = compareStatsManifests(older, generated, { revisionChange: true });
    assert.deepEqual([verification.sources, verification.differences], [["sources"], [{ operatorId: "char_a", keys: ["phases"], fields: ["phases[0].maxLevel"] }]]);
    const unsourced = compareStatsManifests({ contractVersion: "3", profiles: generated.profiles }, generated, { revisionChange: true });
    assert.deepEqual([unsourced.sources, unsourced.identical], [["sources"], 3], "a reference without sources still counts as a revision change");
    const reference = join(directory, "older.json");
    await writeFile(reference, JSON.stringify(older), "utf8");
    const report = join(directory, "report.json");
    const update = [...argv, "--force", "--verify-against", reference, "--update"];
    const before = await snapshot(output);
    await assert.rejects(main([...update, "--report", report], options), /Changes pending approval; output not written/);
    assert.deepEqual(await snapshot(output), before);
    await main([...update, "--approve", report], options);
    assert.ok(mocks[0].mock.calls.some((call) => String(call.arguments[0]) === "Changes match the approved report"));
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});

test("stats generator enforces dataset limits and warns from ninety percent", async () => {
  const { output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await assert.rejects(main(argv, { ...options, limits: { fileBytes: 100, totalBytes: 6_000_000 } }), (error: Error) => /^char_a\.json is \d+ bytes, above the 100-byte limit; .*; output not written$/.test(error.message));
    await assert.rejects(main(argv, { ...options, limits: { fileBytes: 32_768, totalBytes: 500 } }), /Dataset operator-stats is \d+ bytes, above the 500-byte limit; output not written/);
    assert.equal(await stat(output).then(() => true, () => false), false);
    await main(argv, options);
    const total = (await Promise.all((await readdir(output)).map(async (name) => (await stat(join(output, name))).size))).reduce((sum, size) => sum + size, 0);
    await main([...argv, "--force"], { ...options, limits: { fileBytes: 32_768, totalBytes: Math.ceil(total / 0.95) } });
    assert.match(String(mocks[1].mock.calls[0].arguments[0]), /^Warning: Dataset operator-stats is \d+ bytes, at least 90% of the \d+-byte limit$/);
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});
