import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import type { GameDataRegion } from "../src/game-data/gamedata-revisions";
import { modulesDatasetContractVersion, modulesDatasetLimits } from "../src/game-data/operator-dataset";
import { buildOperatorModules, buildOperatorTrait, isOriginalModule, operatorModuleSources, type SourceModuleTables } from "../src/game-data/operator-modules";
import { buildModulesDataset, checkModuleIcons, glossaryFileName, main, modulesDatasetFiles, readModulesDataset, type ModulesGeneratorOptions } from "../scripts/generate-operator-modules";
import { tableFlag } from "../scripts/operator-dataset-io";

const tables = ["character_table", "uniequip_table", "battle_equip_table", "range_table", "gamedata_const"] as const;
const unlock = (phase: string, level = 1) => ({ phase, level });
const talentCandidate = (name: string, rank = 0) => ({ unlockCondition: unlock("PHASE_0"), requiredPotentialRank: rank, name, description: `${name} text`, rangeId: null, blackboard: [], isHideTalent: false });
const character = (name: string, extra: Record<string, unknown> = {}) => ({ name, description: "Attacks <@ba.kw>{cnt}</> enemies", trait: { candidates: [{ unlockCondition: unlock("PHASE_0"), requiredPotentialRank: 0, blackboard: [{ key: "cnt", value: 2 }], overrideDescripton: null }] }, talents: [{ candidates: [talentCandidate("First"), talentCandidate("First+", 4)] }, { candidates: [{ ...talentCandidate("Hidden"), isHideTalent: true }] }], ...extra });
const equip = (id: string, charId: string, overrides: Record<string, unknown> = {}) => ({ uniEquipId: id, uniEquipName: `Module ${id}`, typeIcon: "PHY-X", typeName1: "PHY", typeName2: "X", type: "ADVANCED", charId, unlockEvolvePhase: "PHASE_2", unlockLevel: 60, unlockFavors: { 1: 0, 2: 2732, 3: 10070 }, missionList: [`${id}_1`], isSpecialEquip: false, ...overrides });
const traitPart = (target: string, candidate: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ target, isToken: false, validInGameTag: null, validInMapTag: null, addOrOverrideTalentDataBundle: { candidates: null }, overrideTraitDataBundle: { candidates: [{ unlockCondition: unlock("PHASE_2", 60), requiredPotentialRank: 0, blackboard: [], ...candidate }] }, ...extra });
const talentPart = (target: string, candidates: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ target, isToken: false, validInGameTag: null, validInMapTag: null, addOrOverrideTalentDataBundle: { candidates: candidates.map((candidate) => ({ talentIndex: 0, displayRangeId: false, unlockCondition: unlock("PHASE_2", 60), requiredPotentialRank: 0, rangeId: null, blackboard: {}, isHideTalent: false, ...candidate })) }, overrideTraitDataBundle: { candidates: null }, ...extra });
const phase = (equipLevel: number, parts: unknown[], extra: Record<string, unknown> = {}) => ({ equipLevel, parts, attributeBlackboard: [{ key: "atk", value: 10 * equipLevel }], tokenAttributeBlackboard: {}, ...extra });
const battle = () => ({
  phases: [
    phase(1, [traitPart("TRAIT", { additionalDescription: "Gains <@ba.kw>{scale:0%}</>", blackboard: [{ key: "scale", value: 0.2 }] })]),
    phase(2, [
      traitPart("DISPLAY", { overrideDescripton: "New trait", blackboard: {} }),
      traitPart("TRAIT_DATA_ONLY", { rangeId: "r-2", overrideDescripton: "Data only" }),
      talentPart("TALENT", [{ name: "First", upgradeDescription: "Upgraded <$ba.stun>stun</>" }, { name: "First", upgradeDescription: "Upgraded <$ba.stun>stun</> <@ba.talpu>(+1)</>", requiredPotentialRank: 4 }]),
      talentPart("TALENT_DATA_ONLY", [{ name: "First", upgradeDescription: "Upgraded <$ba.stun>stun</>" }, { talentIndex: -1, name: "Added", upgradeDescription: "New talent" }, { talentIndex: -2, isHideTalent: true }, { name: null, upgradeDescription: "" }]),
      talentPart("TALENT", [{ name: "Mode", upgradeDescription: "Only in a mode" }, { name: null, upgradeDescription: "" }], { validInGameTag: "roguelike" }),
      traitPart("DISPLAY", { additionalDescription: "In one theme <$ba.stun>x</>" }, { validInMapTag: "rogue_yan" }),
      talentPart("TALENT", [{ isHideTalent: true }], { validInGameTag: "sandbox" }),
      talentPart("TALENT", [{ talentIndex: -1, isHideTalent: true, displayRangeId: true, rangeId: "r-2" }]),
    ], { tokenAttributeBlackboard: { token_a_summon: [{ key: "atk", value: 5 }] } }),
  ],
});
const fixtures: Record<GameDataRegion, Record<(typeof tables)[number], unknown>> = {
  en: {
    character_table: { char_a: character("A"), char_b: { ...character("B"), trait: null, description: "Plain trait" }, token_a_summon: { name: "Summon" } },
    uniequip_table: { equipDict: { uniequip_001_a: equip("uniequip_001_a", "char_a", { type: "INITIAL", typeName1: "ORIGINAL", typeName2: null }), uniequip_002_a: equip("uniequip_002_a", "char_a") }, charEquip: { char_a: ["uniequip_001_a", "uniequip_002_a"] }, missionList: { uniequip_002_a_1: { desc: "Clear a stage" } } },
    battle_equip_table: { uniequip_002_a: battle() },
    range_table: { "r-2": { direction: 1, grids: [{ row: 0, col: 1 }] } },
    gamedata_const: { termDescriptionDict: { "ba.stun": { termName: "Stun", description: "Stops" } } },
  },
  cn: {
    character_table: { char_a: character("A"), char_cn: character("C"), token_a_summon: { name: "召唤物" } },
    uniequip_table: {
      equipDict: { uniequip_002_a: equip("uniequip_002_a", "char_a"), uniequip_003_a: equip("uniequip_003_a", "char_a", { uniEquipName: "模组", typeIcon: "PHY-Y", typeName2: "Y", isSpecialEquip: true, missionList: {} }), uniequip_002_cn: equip("uniequip_002_cn", "char_cn") },
      charEquip: { char_a: ["uniequip_002_a", "uniequip_003_a"], char_cn: ["uniequip_002_cn"] },
      missionList: { uniequip_002_cn_1: { desc: "通关" } },
    },
    battle_equip_table: { uniequip_003_a: { phases: [phase(1, [talentPart("TALENT", [{ name: "First", upgradeDescription: "加强 <$ba.root>x</>" }])])] }, uniequip_002_cn: { phases: [phase(1, [])] } },
    range_table: { "r-2": { direction: 1, grids: [{ row: 0, col: 1 }] } },
    gamedata_const: { termDescriptionDict: { "ba.root": { termName: "束缚", description: "无法移动" } } },
  },
};
const sourceTables = fixtures as unknown as Record<GameDataRegion, SourceModuleTables>;
const sha = (text: string) => createHash("sha256").update(text).digest("hex").toUpperCase();
const catalog = new Map<string, GameDataRegion>([["char_a", "en"], ["char_b", "en"], ["char_cn", "cn"]]);
const hashes = Object.fromEntries(["en", "cn"].map((region) => [region, Object.fromEntries(tables.map((table) => [table, "A".repeat(64)]))])) as never;

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "operator-modules-generator-"));
  const argv = ["node", "generate-operator-modules.ts"];
  const expectedHashes = { en: {}, cn: {} } as Record<GameDataRegion, Record<(typeof tables)[number], string>>;
  for (const region of ["en", "cn"] as const) for (const table of tables) {
    const path = join(directory, `${region}-${table}.json`); const text = JSON.stringify(fixtures[region][table]);
    await writeFile(path, text, "utf8"); expectedHashes[region][table] = sha(text); argv.push(tableFlag(region, table), path);
  }
  await writeFile(join(directory, "release.json"), JSON.stringify({ operators: [{ id: "char_a" }, { id: "char_b" }] }), "utf8");
  await writeFile(join(directory, "regional.json"), JSON.stringify({ operators: [{ id: "char_cn" }] }), "utf8");
  const icons = join(directory, "icons");
  await mkdir(icons);
  for (const icon of ["phy-x", "phy-y"]) await writeFile(join(icons, `${icon}.png`), "", "utf8");
  const output = join(directory, "operator-modules");
  const options: ModulesGeneratorOptions = { expectedHashes, releaseManifest: join(directory, "release.json"), regionalManifest: join(directory, "regional.json"), catalogSize: 3, iconDirectory: icons };
  return { directory, icons, output, argv: [...argv, "--out-dir", output], options, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
const quiet = () => [mock.method(console, "log", () => undefined), mock.method(console, "warn", () => undefined)];
const snapshot = async (directory: string) => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async (name) => [name, await readFile(join(directory, name), "utf8")])));

test("a Global operator keeps its modules and adds the CN-only ones; ORIGINAL modules are left out", () => {
  assert.deepEqual(operatorModuleSources("char_a", "en", sourceTables).map((source) => [source.id, source.region]), [["uniequip_001_a", "en"], ["uniequip_002_a", "en"], ["uniequip_003_a", "cn"]]);
  assert.deepEqual(operatorModuleSources("char_cn", "cn", sourceTables).map((source) => [source.id, source.region]), [["uniequip_002_cn", "cn"]]);
  assert.equal(isOriginalModule({ type: "INITIAL", typeName1: "ORIGINAL" }), true);
  const profile = buildOperatorModules("char_a", "en", sourceTables);
  assert.deepEqual(profile.modules.map((module) => [module.id, module.region, module.type, module.icon, module.limitedModality ?? false, module.missions]), [["uniequip_002_a", "en", "PHY-X", "phy-x", false, ["Clear a stage"]], ["uniequip_003_a", "cn", "PHY-Y", "phy-y", true, []]]);
  assert.equal(profile.modules[1].name, "模组");
  assert.deepEqual(profile.modules[0].unlock, { elite: 2, level: 60 });
});

test("module levels keep attributes, trait changes, talent changes and the range change shown in the game", () => {
  const [level1, level2] = buildOperatorModules("char_a", "en", sourceTables).modules[0].levels;
  assert.deepEqual(level1, { level: 1, favorPoints: 0, attributes: { atk: 10 }, traits: [{ token: false, addition: "Gains <@ba.kw>{scale:0%}</>", blackboard: [{ key: "scale", value: 0.2 }] }], talents: [] });
  assert.equal(level2.favorPoints, 2732);
  assert.equal(level2.rangeId, "r-2", "data-only trait parts and hidden talents with a displayed range change the range");
  assert.deepEqual(level2.traits, [{ token: false, override: "New trait" }], "data-only trait texts are not shown");
  assert.deepEqual(level2.tokenAttributes, { token_a_summon: { atk: 5 } });
  assert.deepEqual(level2.talents.map((change) => [change.index, change.potential, change.name]), [[0, 1, "First"], [0, 5, "First"], [null, 1, "Added"]], "repeats, hidden and empty candidates are dropped, and mode effects are not mixed in");
  assert.deepEqual(level2.modes, [
    { mapTag: "rogue_yan", traits: [{ token: false, addition: "In one theme <$ba.stun>x</>" }], talents: [] },
    { gameTag: "roguelike", traits: [], talents: [{ index: 0, potential: 1, token: false, name: "Mode", description: "Only in a mode" }] },
  ], "one group per mode tag; a mode with only hidden data adds no group");
  assert.ok(!("modes" in level1), "a level without mode effects has no modes");
});

test("module extraction rejects unknown talents, conflicting repeats, unknown targets and missing data", () => {
  const withPhase = (parts: unknown[]) => ({ ...sourceTables, en: { ...sourceTables.en, battle_equip_table: { uniequip_002_a: { phases: [phase(1, parts)] } } } }) as Record<GameDataRegion, SourceModuleTables>;
  assert.throws(() => buildOperatorModules("char_a", "en", withPhase([talentPart("TALENT", [{ talentIndex: 1, name: "Hidden", upgradeDescription: "x" }])])), /changes a talent the operator does not show/);
  assert.throws(() => buildOperatorModules("char_a", "en", withPhase([talentPart("TALENT", [{ name: "First", upgradeDescription: "a" }, { name: "First", upgradeDescription: "b" }])])), /two different texts/);
  assert.throws(() => buildOperatorModules("char_a", "en", withPhase([{ ...traitPart("TRAIT", {}), target: "NEW" }])), /unknown part target NEW/);
  assert.throws(() => buildOperatorModules("char_a", "en", withPhase([traitPart("TRAIT", { additionalDescription: "{missing}" })])), /unresolved marker \{missing\}/);
  assert.throws(() => buildOperatorModules("char_a", "en", withPhase([traitPart("TRAIT", { rangeId: "r-9" })])), /unknown range r-9/);
  assert.throws(() => buildOperatorModules("char_a", "en", withPhase([talentPart("TALENT", [{ name: "First", upgradeDescription: "{v}" }])])), /unresolved marker \{v\}/, "talent values must come written in");
  const noBattle = { ...sourceTables, en: { ...sourceTables.en, battle_equip_table: {} } } as Record<GameDataRegion, SourceModuleTables>;
  assert.throws(() => buildOperatorModules("char_a", "en", noBattle), /missing from the en battle table/);
  assert.throws(() => buildOperatorModules("char_zz", "en", sourceTables), /char_zz is missing from the en character table/);
});

test("the base trait keeps its stages, or the plain description without candidates", () => {
  assert.deepEqual(buildOperatorTrait("char_a", character("A") as never), [{ unlock: { elite: 0, level: 1 }, potential: 1, description: "Attacks <@ba.kw>{cnt}</> enemies", blackboard: [{ key: "cnt", value: 2 }] }]);
  assert.deepEqual(buildOperatorTrait("char_b", { description: "Plain trait" } as never), [{ unlock: { elite: 0, level: 1 }, potential: 1, description: "Plain trait" }]);
  assert.throws(() => buildOperatorTrait("char_c", {} as never), /trait has no description/);
});

test("modules dataset builds one profile per catalog operator and a glossary per region", () => {
  const dataset = buildModulesDataset(fixtures, catalog, hashes);
  assert.deepEqual(dataset.profiles.map((profile) => [profile.operatorId, profile.region, profile.modules.length]), [["char_a", "en", 2], ["char_b", "en", 0], ["char_cn", "cn", 1]]);
  assert.deepEqual(Object.keys(dataset.glossaries.find((glossary) => glossary.region === "en")!.terms), ["ba.stun"]);
  assert.deepEqual(Object.keys(dataset.glossaries.find((glossary) => glossary.region === "cn")!.terms), ["ba.root"], "a CN-only module of a Global operator uses the CN glossary");
  assert.deepEqual(dataset.profiles[0].tokens, { token_a_summon: "Summon" });
  assert.deepEqual(Object.keys(dataset.tables.en), [...tables]);
  assert.equal(dataset.sources.cn.path, "cn/gamedata/excel/battle_equip_table.json");
  assert.deepEqual(modulesDatasetFiles(dataset).shared.map((file) => file.name), [glossaryFileName("en"), glossaryFileName("cn")]);
});

test("modules generator writes, reads back, checks icons and is deterministic", async () => {
  const work = await workspace(); const [log] = quiet();
  try {
    await main(work.argv, work.options);
    assert.deepEqual((await readdir(work.output)).sort(), ["char_a.json", "char_b.json", "char_cn.json", "glossary-cn.json", "glossary-en.json", "index.json"]);
    assert.match(String(log.mock.calls[0].arguments[0]), /Generated 3 modules files with 3 modules and 2 glossaries/);
    const read = await readModulesDataset(work.output);
    assert.deepEqual(read.index.limits, modulesDatasetLimits, "the modules index declares its own limits");
    assert.equal(read.index.contractVersion, modulesDatasetContractVersion);
    assert.equal(read.index.tables?.en.uniequip_table.sha256, work.options.expectedHashes!.en.uniequip_table);
    const first = await snapshot(work.output);
    await main([...work.argv, "--force"], work.options);
    assert.deepEqual(await snapshot(work.output), first, "regenerating is deterministic");
    await rm(join(work.icons, "phy-y.png"));
    await assert.rejects(checkModuleIcons(buildModulesDataset(fixtures, catalog, hashes), work.icons), /icons missing from .*: phy-y/);
  } finally { mock.restoreAll(); await work.cleanup(); }
});

test("modules generator refuses to overwrite, rejects hash mismatches and enforces limits without writing", async () => {
  const work = await workspace(); quiet();
  try {
    await assert.rejects(main(work.argv, { ...work.options, limits: { fileBytes: 100, totalBytes: 4_000_000 } }), /above the 100-byte limit.*output not written/);
    await assert.rejects(stat(work.output), /ENOENT/);
    await main(work.argv, work.options);
    await assert.rejects(main(work.argv, work.options), /pass --force/);
    await assert.rejects(main([...work.argv, "--force"], { ...work.options, expectedHashes: { ...work.options.expectedHashes!, cn: { ...work.options.expectedHashes!.cn, battle_equip_table: "0".repeat(64) } } }), /SHA-256 mismatch: --cn-battle-equip/);
    const file = join(work.output, "char_a.json");
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace("char_a", "char_b"), "utf8");
    await assert.rejects(readModulesDataset(work.output), /hash mismatch: char_a.json/);
    await writeFile(file, original, "utf8");
    await writeFile(join(work.output, "glossary-cn.json"), "{}\n", "utf8");
    await assert.rejects(readModulesDataset(work.output), /hash mismatch: glossary-cn.json/);
    await writeFile(join(work.output, "index.json"), "{}\n", "utf8");
    await assert.rejects(readModulesDataset(work.output), /Invalid dataset index/);
  } finally { mock.restoreAll(); await work.cleanup(); }
});

test("modules dataset rejects tables without a term dictionary", () => {
  assert.throws(() => buildModulesDataset({ ...fixtures, cn: { ...fixtures.cn, gamedata_const: {} } }, catalog, hashes), /The cn game data constants have no term dictionary/);
});
