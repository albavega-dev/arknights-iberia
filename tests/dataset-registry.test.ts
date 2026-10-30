import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { assetRegistry, changeChecks, curatedDataFiles, datasetRegistry, datasetTableFlag, registryChangeChecks, registryCoverage, registryImageDirectories, registryTables, type AssetEntry, type DatasetEntry } from "../src/game-data/dataset-registry";
import { imageRepository } from "../src/game-data/asset-revisions";
import { pinnedGameDataTableHashes } from "../src/game-data/gamedata-revisions";

const datasets = Object.entries(datasetRegistry) as [string, DatasetEntry][];
const assets = Object.entries(assetRegistry) as [string, AssetEntry][];
const exists = (path: string) => stat(path).then(() => true, () => false);
const packageScripts = async () => (JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
const runnable = async (command: string) => (command.startsWith("scripts/") ? exists(command) : command in await packageScripts());

test("every table a dataset reads is pinned in both regions, and every comparison reads registered tables", () => {
  for (const table of registryTables()) for (const region of ["en", "cn"] as const) assert.ok(table in pinnedGameDataTableHashes(region), `${region} ${table} is pinned`);
  for (const [check, { tables }] of Object.entries(changeChecks)) for (const table of tables) assert.ok(registryTables().includes(table), `${check} reads ${table}`);
  assert.deepEqual(registryChangeChecks(), Object.keys(changeChecks), "every comparison is used by some dataset");
});

test("the registry keeps the image directories and coverage checks of the update check", () => {
  assert.deepEqual(registryImageDirectories(imageRepository), ["characters", "skills", "equip", "ui"]);
  assert.deepEqual(registryImageDirectories("nobody/nothing"), []);
  assert.deepEqual(registryCoverage().map((coverage) => [coverage.reportKey, coverage.need, coverage.path("x")]), [
    ["missingIllustrations", "catalogOperators", "characters/x_1.png"],
    ["missingSkillIcons", "catalogSkillIcons", "skills/skill_icon_x.png"],
    ["missingModuleArt", "catalogModules", "equip/icon/x.png"],
  ]);
});

test("every dataset declares outputs, sources, tests and commands that exist", async () => {
  const unitTests = (await packageScripts())["test:unit"]!;
  for (const [id, entry] of datasets) {
    for (const path of [...entry.outputs, ...entry.sources, ...entry.tests]) assert.ok(await exists(path), `${id}: ${path} exists`);
    for (const path of entry.tests) assert.ok(unitTests.includes(path), `${id}: ${path} runs in test:unit`);
    assert.ok(await runnable(entry.generator.script), `${id}: ${entry.generator.script} can run`);
    if (entry.generator.kind === "update") assert.ok(entry.generator.outDir && entry.generator.verifyAgainst && entry.tables.length, `${id}: update mode needs an output, a reference and tables`);
    for (const asset of entry.assets) assert.ok(asset in assetRegistry, `${id}: ${asset} is a registered resource`);
  }
});

test("every resource type declares a source, a manifest and local directories that exist", async () => {
  for (const [id, asset] of assets) {
    if (asset.manifest) assert.ok(await exists(asset.manifest), `${id}: ${asset.manifest} exists`);
    for (const directory of asset.localDirectories) assert.ok(await exists(directory), `${id}: ${directory} exists`);
    if (asset.sync.startsWith("data:") || asset.sync.startsWith("assets:") || asset.sync.startsWith("scripts/")) assert.ok(await runnable(asset.sync), `${id}: ${asset.sync} can run`);
    assert.ok(datasets.some(([, entry]) => (entry.assets as readonly string[]).includes(id)), `${id} is used by a dataset`);
  }
});

test("every file of data/ is a registered dataset, a resource manifest or a curated input", async () => {
  const known = new Set<string>([...datasets.flatMap(([, entry]) => entry.outputs), ...assets.flatMap(([, asset]) => (asset.manifest ? [asset.manifest] : [])), ...curatedDataFiles]);
  for (const name of await readdir("data")) assert.ok(known.has(`data/${name}`), `data/${name} must be added to src/game-data/dataset-registry.ts`);
  for (const path of curatedDataFiles) assert.ok(await exists(path), `${path} exists`);
});

test("every operator resource directory of public/assets belongs to a registered resource type", async () => {
  const local = new Set(assets.flatMap(([, asset]) => asset.localDirectories));
  for (const name of (await readdir("public/assets")).filter((item) => item.startsWith("operator-"))) assert.ok(local.has(join("public/assets", name).replaceAll("\\", "/")), `public/assets/${name} must be added to the asset registry`);
});

test("table flags follow the generator convention unless the registry overrides them", () => {
  assert.equal(datasetTableFlag(datasetRegistry["operator-stats"], "en", "battle_equip_table"), "--en-battle-equip");
  assert.equal(datasetTableFlag(datasetRegistry["operator-skills"], "cn", "gamedata_const"), "--cn-gamedata-const");
  assert.equal(datasetTableFlag(datasetRegistry["operator-catalog"], "en", "handbook_info_table"), "--en-handbook");
  assert.equal(datasetTableFlag(datasetRegistry["operator-catalog"], "cn", "character_table"), "--cn-character");
});
