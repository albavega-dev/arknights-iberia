import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import type { GameDataRegion, GameDataTable } from "../src/game-data/gamedata-revisions";
import { arg, compareStatsManifests, main, readCatalog, serializeStatsManifest, tableFlag, type StatsGeneratorOptions, type StatsManifestV2 } from "../scripts/generate-operator-stats-manifest";

const buff = { attributes: { attributeModifiers: [{ attributeType: "COST", formulaItem: "ADDITION", value: -1 }] } };
const character = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, { phases: [{ maxLevel: 1, attributesKeyFrames: [{ level: 1, data: { maxHp: 100, atk: 10 } }] }], favorKeyFrames: [], potentialRanks: [{ buff }] }]));
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
  const argv = ["node", "generate-operator-stats-manifest.ts"];
  const expectedHashes = { en: {}, cn: {} } as Record<GameDataRegion, Record<GameDataTable, string>>;
  for (const region of ["en", "cn"] as const) for (const table of tables) {
    const path = join(directory, `${region}-${table}.json`); const text = JSON.stringify(fixtures[region][table]);
    await writeFile(path, text, "utf8"); expectedHashes[region][table] = sha(text); argv.push(tableFlag(region, table), path);
  }
  await writeFile(join(directory, "release.json"), JSON.stringify(release), "utf8");
  await writeFile(join(directory, "regional.json"), JSON.stringify(regional), "utf8");
  const output = join(directory, "stats.json");
  const options: StatsGeneratorOptions = { expectedHashes, releaseManifest: join(directory, "release.json"), regionalManifest: join(directory, "regional.json"), catalogSize: 3 };
  return { directory, output, argv: [...argv, "--out", output], options, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
const quiet = () => [mock.method(console, "log", () => undefined), mock.method(console, "warn", () => undefined)];

test("stats generator parses table flags and rejects missing arguments", async () => {
  assert.equal(tableFlag("en", "battle_equip_table"), "--en-battle-equip");
  assert.equal(arg("--out", ["node", "script", "--out", "stats.json"]), "stats.json");
  assert.throws(() => arg("--out", ["node", "script", "--out", "--force"]), /Missing --out/);
  await assert.rejects(main(["node", "generate-operator-stats-manifest.ts"]), /Missing --en-character/);
});

test("stats generator refuses to overwrite without force and rejects unpinned snapshots", async () => {
  const { output, argv, options, cleanup } = await workspace();
  try {
    await writeFile(output, "existing", "utf8");
    await assert.rejects(main(argv, options), /Output exists; pass --force/);
    await assert.rejects(main([...argv, "--force"], { ...options, expectedHashes: undefined }), /Snapshot SHA-256 mismatch: --en-character/);
  } finally { await cleanup(); }
});

test("stats generator writes a deterministic contract 2 manifest for the catalog only", async () => {
  const { output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await main(argv, options);
    const first = await readFile(output, "utf8");
    await main([...argv, "--force"], options);
    assert.equal(await readFile(output, "utf8"), first);
    const manifest = JSON.parse(first) as StatsManifestV2;
    assert.equal(manifest.contractVersion, "2");
    assert.deepEqual(manifest.profiles.map((profile) => `${profile.operatorId}/${profile.region}`), ["char_a/en", "char_b/en", "char_cn/cn"]);
    assert.ok(manifest.profiles.every((profile) => !("source" in profile)));
    assert.deepEqual(manifest.sources.cn, { repository: "ArknightsAssets/ArknightsGamedata", revision: "e4888c5b4d9b57aa3bfd4d109ae70f74cf3b7842", path: "cn/gamedata/excel/character_table.json", sha256: options.expectedHashes?.cn.character_table });
    assert.deepEqual(manifest.profiles[0].potentialRanks, [{ rank: 0, effects: [buff] }]);
    assert.deepEqual(manifest.profiles[0].modules.map((module) => [module.uniEquipId, module.moduleSourceRegion, module.moduleType]), [["uniequip_a", "en", "PHY-X"]]);
    assert.equal(first.split("\n").length, manifest.profiles.length + 3);
    assert.equal(first, serializeStatsManifest(manifest));
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

test("stats generator verifies against contract 1 and 2 manifests with declared normalisations", async () => {
  const { directory, output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await main(argv, options);
    const generated = JSON.parse(await readFile(output, "utf8")) as StatsManifestV2;
    const legacy = { contractVersion: "1", profiles: [...generated.profiles.map((profile) => ({ ...profile, source: generated.sources[profile.region as GameDataRegion], modules: profile.modules.map((module) => ({ ...module, moduleSourceRegion: "preferred" })) })), { operatorId: "char_a", region: "cn", profiles: [] }] };
    assert.deepEqual(compareStatsManifests(legacy, generated), { identical: 3, differences: [], missing: [], ignored: 1 });
    assert.equal(compareStatsManifests(generated, generated).identical, 3);
    const changed = JSON.parse(JSON.stringify(legacy)); changed.profiles[0].phases[0].maxLevel = 90; changed.profiles[1].source = { ...changed.profiles[1].source, revision: "other" };
    assert.deepEqual(compareStatsManifests(changed, generated).differences, [{ operatorId: "char_a", keys: ["phases"] }, { operatorId: "char_b", keys: ["source"] }]);
    assert.deepEqual(compareStatsManifests({ contractVersion: "1", profiles: [] }, generated).missing, ["char_a/en", "char_b/en", "char_cn/cn"]);
    assert.throws(() => compareStatsManifests({ contractVersion: "3", profiles: [] }, generated), /unknown contract/);
    const reference = join(directory, "reference.json");
    await writeFile(reference, JSON.stringify(legacy), "utf8");
    await main([...argv, "--force", "--verify-against", reference], options);
    await writeFile(reference, JSON.stringify(changed), "utf8");
    await writeFile(output, "previous", "utf8");
    await assert.rejects(main([...argv, "--force", "--verify-against", reference], options), /Verification failed; output not written/);
    assert.equal(await readFile(output, "utf8"), "previous");
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});

test("stats generator enforces the byte limit and warns from ninety percent", async () => {
  const { output, argv, options, cleanup } = await workspace(); const mocks = quiet();
  try {
    await assert.rejects(main(argv, { ...options, byteLimit: 100 }), /above the 100-byte limit; split it per operator/);
    assert.equal(await stat(output).then(() => true, () => false), false);
    await main(argv, { ...options, warningBytes: 1 });
    assert.match(String(mocks[1].mock.calls[0].arguments[0]), /at least 90% of the 2000000-byte limit/);
  } finally { mocks.forEach((item) => item.mock.restore()); await cleanup(); }
});
