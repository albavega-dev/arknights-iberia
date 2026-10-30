import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GameDataRegion } from "../src/game-data/gamedata-revisions";
import type { DatasetIndex } from "../src/game-data/operator-dataset";
import { moduleArtResolver } from "../src/game-data/operator-module-art";
import { buildOperatorModulesView, highlightChangedNumbers, loadOperatorModulesView, modulePotentials, talentChangesAt, visibleModules, type ModulesDatasetReaders, type OperatorModulesView, type StoredModulesProfile } from "../src/game-data/operator-modules-view";
import type { TraitStage } from "../src/game-data/operator-modules";
import type { StoredSkillsGlossary } from "../src/game-data/operator-skills-view";
import type { SkillDescriptionNode } from "../src/game-data/skill-description";

// The real dataset, read the way operator-modules-data.ts does but without the server-only import.
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(new URL(`../data/${file}`, import.meta.url), "utf8")) as T;
const index = await readJson<DatasetIndex>("operator-modules/index.json");
const glossaryReads: GameDataRegion[] = [];
const readers: ModulesDatasetReaders = {
  index,
  readProfile: (operatorId) => readJson<StoredModulesProfile>(`operator-modules/${operatorId}.json`),
  readGlossary: (region) => { glossaryReads.push(region); return readJson<StoredSkillsGlossary>(`operator-modules/glossary-${region}.json`); },
};
// The trait comes from the stats file, as the page passes it.
const traitOf = async (operatorId: string) => (await readJson<{ trait: TraitStage[] }>(`operator-stats/${operatorId}.json`)).trait;
const load = async (operatorId: string, region: GameDataRegion = "en"): Promise<OperatorModulesView> => {
  const view = await loadOperatorModulesView(readers, operatorId, region, await traitOf(operatorId));
  assert.ok(view, `${operatorId} should have a view`);
  return view;
};
const textOf = (nodes: readonly SkillDescriptionNode[]): string => nodes.map((node) => node.type === "text" ? node.text : node.type === "value" ? node.display + (node.percent ? " %" : "") : node.type === "lineBreak" ? "\n" : node.type === "style" ? textOf(node.children) : node.text).join("");
const tones = (nodes: readonly SkillDescriptionNode[]): string[] => nodes.flatMap((node) => node.type === "style" ? [node.tone, ...tones(node.children)] : []);

test("Kal'tsit (EN): X, Y and Limited Modality modules, Mon3tr changes and the largest file", async () => {
  const view = await load("char_003_kalts");
  assert.deepEqual(view.modules.map((module) => [module.type, module.region, module.limitedModality]), [["PHY-X", "en", false], ["PHY-Y", "en", false], ["ISW-A", "en", true]]);
  assert.equal(view.hasCnModules, false);
  assert.deepEqual(view.tokens, { token_10002_kalts_mon3tr: "Mon3tr" });
  const [x] = view.modules;
  assert.equal(x.icon, "/assets/operator-modules/phy-x.png");
  assert.deepEqual(x.unlock, { elite: 2, level: 60 });
  assert.equal(x.missions.length, 2);
  assert.deepEqual(x.levels.map((level) => level.trust), [0, 50, 100]);
  assert.deepEqual(x.levels[1].attributes, { atk: 50, def: 20 });
  assert.match(textOf(x.levels[1].traits[0].addition!), /increases heal amount by 15%/);
  assert.deepEqual(x.levels[1].talents.map((change) => [change.index, change.potential, change.token]), [[1, 1, false], [1, 5, false], [1, 1, true], [1, 5, true]], "the summon's own copy is marked as a summon change");
  assert.ok(tones(x.levels[1].talents[1].description).includes("potential"), "the P5 values use the potential tone");
  assert.equal(x.terms["ba.stun"].name, "Stun");
  assert.equal(textOf(view.trait[0].description), "Restores the HP of allies");
  const largest = Object.entries(index.operators).sort(([, a], [, b]) => b.bytes - a.bytes)[0];
  assert.equal(largest[0], "char_003_kalts");
  assert.ok(largest[1].bytes <= index.limits.fileBytes);
});

test("Passenger (EN): talent changes by potential and a Limited Modality module", async () => {
  const view = await load("char_472_pasngr");
  assert.deepEqual(view.modules.map((module) => [module.type, module.limitedModality]), [["CHA-X", false], ["CHA-Y", false], ["RA-A", true]]);
  const [x, y] = view.modules;
  assert.deepEqual(x.levels[0].talents, [], "level 1 changes no talent");
  assert.deepEqual(x.levels[2].talents.map((change) => [change.index, change.potential]), [[1, 1], [1, 3]]);
  assert.deepEqual(y.levels[2].talents.map((change) => [change.index, change.potential]), [[0, 1], [0, 6]]);
  assert.equal(y.levels[2].talents[0].name, y.levels[2].talents[1].name);
  assert.ok(index.operators.char_472_pasngr.bytes < index.operators.char_003_kalts.bytes);
});

test("Shu (EN) adds her CN-only module with its CN texts and CN glossary, and offers the CN switch", async () => {
  glossaryReads.length = 0;
  const view = await load("char_2025_shu");
  assert.deepEqual(glossaryReads.sort(), ["cn", "en"]);
  assert.equal(view.hasCnModules, true);
  assert.deepEqual(view.modules.map((module) => [module.type, module.region, module.name]), [["GUA-X", "en", "On Architecture of Time"], ["GUA-Y", "cn", "好时节"]]);
  assert.equal(view.modules[1].levels[1].talents[0].name, "天有四时");
  assert.equal(view.modules[1].levels[1].talents[0].index, 1);
});

test("Makoto (CN-only) has CN modules without the CN switch; Hibiscus has none", async () => {
  glossaryReads.length = 0;
  const makoto = await load("char_4217_makoto", "cn");
  assert.deepEqual(glossaryReads, ["cn"]);
  assert.equal(makoto.region, "cn");
  assert.deepEqual(makoto.modules.map((module) => [module.type, module.region, module.name]), [["PUM-Y", "cn", "彼此的声音"]]);
  assert.equal(makoto.hasCnModules, false, "every module of a CN-only operator is CN");
  const hibiscus = await load("char_120_hibisc");
  assert.deepEqual(hibiscus.modules, []);
  assert.equal(hibiscus.hasCnModules, false);
  assert.ok(hibiscus.trait.length > 0, "the base trait, from the stats file, is there without modules");
});

test("Rosesa changes her range with the module and Sophia's module adds a talent", async () => {
  const rosesa = await load("char_4163_rosesa");
  assert.deepEqual(rosesa.modules[0].levels.map((level) => level.rangeId), ["y-3", "y-3", "y-3"]);
  assert.ok(rosesa.ranges["y-3"].grids.length > 0);
  const sophia = await load("char_265_sophia");
  assert.deepEqual(sophia.modules[0].levels[1].talents.map((change) => [change.index, change.name]), [[null, "Vision of Unity"]]);
});

test("Raidian keeps her Integrated Strategies effects apart from the normal ones, tagged with their mode", async () => {
  const view = await load("char_4195_radian");
  const level = view.modules.find((item) => item.id === "uniequip_003_radian")!.levels[1];
  assert.deepEqual(level.modes.map((mode) => [mode.gameTag, mode.mapTag, mode.traits.length, mode.talents.length]), [[null, "rogue_yan", 1, 0], ["roguelike", "rogue_yan", 0, 1]]);
  assert.match(textOf(level.modes[0].traits[0].addition!), /Sui's Garden of Grotesqueries/);
  assert.doesNotMatch(level.talents.map((change) => textOf(change.description)).join(" "), /Sui's Garden/, "the normal effects do not mention the mode");
  assert.deepEqual((await load("char_003_kalts")).modules[0].levels[1].modes, []);
});

test("the loader rejects unknown ids, wrong regions and mismatched files", async () => {
  assert.equal(await loadOperatorModulesView(readers, "../index", "en", []), null);
  assert.equal(await loadOperatorModulesView(readers, "char_003_kalts", "cn", []), null);
  assert.equal(await loadOperatorModulesView(readers, "char_9999_none", "en", []), null);
  const mismatched: ModulesDatasetReaders = { ...readers, readProfile: async () => ({ ...(await readers.readProfile("char_003_kalts")), operatorId: "char_010_chen" }) };
  assert.equal(await loadOperatorModulesView(mismatched, "char_003_kalts", "en", []), null);
  const profile = await readers.readProfile("char_2025_shu");
  const en = await readers.readGlossary("en");
  assert.throws(() => buildOperatorModulesView(profile, [], "en", index.sources.en, { en }), /the cn glossary was not loaded/);
});

test("visible modules, module potentials and talent changes at a potential", async () => {
  const shu = await load("char_2025_shu");
  assert.deepEqual(visibleModules(shu, false).map((module) => module.id), ["uniequip_002_shu"]);
  assert.deepEqual(visibleModules(shu, true).map((module) => module.id), ["uniequip_002_shu", "uniequip_003_shu"]);
  const makoto = await load("char_4217_makoto", "cn");
  assert.deepEqual(visibleModules(makoto, false).map((module) => module.region), ["cn"], "a CN operator shows its own modules without the switch");
  const [x] = (await load("char_003_kalts")).modules;
  assert.deepEqual(modulePotentials(x), [5]);
  const level = x.levels[2];
  assert.deepEqual(talentChangesAt(level.talents, 1).map((change) => [change.index, change.potential, change.token]), [[1, 1, false], [1, 1, true]]);
  assert.deepEqual(talentChangesAt(level.talents, 6).map((change) => [change.index, change.potential, change.token]), [[1, 5, false], [1, 5, true]], "operator and summon changes stay apart");
  const sophia = (await load("char_265_sophia")).modules[0];
  assert.deepEqual(modulePotentials(sophia), []);
  assert.deepEqual(talentChangesAt(sophia.levels[2].talents, 1).map((change) => [change.index, change.name]), [[null, "Vision of Unity"]], "a talent the module adds is kept by name");
});

test("numbers that change between module levels are marked in reading order", async () => {
  const changed = (nodes: readonly SkillDescriptionNode[]): string[] => nodes.flatMap((node) => node.type === "value" && node.changed ? [node.display] : node.type === "style" ? changed(node.children) : []);
  const [x] = (await load("char_003_kalts")).modules;
  const level2 = talentChangesAt(x.levels[1].talents.filter((change) => !change.token), 5)[0];
  const level3 = talentChangesAt(x.levels[2].talents.filter((change) => !change.token), 5)[0];
  const marked = highlightChangedNumbers(level3.description, level2.description);
  assert.equal(textOf(marked), textOf(level3.description), "the text itself does not change");
  assert.ok(changed(marked).length > 0);
  assert.ok(changed(marked).every((number) => /^\d/.test(number)));
  assert.deepEqual(changed(highlightChangedNumbers(level3.description, level3.description)), [], "identical texts mark nothing");
  const parse = (text: string): SkillDescriptionNode[] => [{ type: "text", text }];
  assert.deepEqual(changed(highlightChangedNumbers(parse("ATK +10% for 5 s"), parse("ATK +8% for 5 s"))), ["10%"]);
  assert.deepEqual(changed(highlightChangedNumbers(parse("Deals 2 hits of 30%"), parse("Deals 30%"))), [], "a different count of numbers marks nothing");
  assert.deepEqual(changed(highlightChangedNumbers([{ type: "value", key: "atk", display: "20%", percent: true }, { type: "lineBreak" }], [{ type: "value", key: "atk", display: "15%", percent: true }, { type: "lineBreak" }])), ["20%"]);
});

test("module illustrations come from the art manifest", () => {
  const resolve = moduleArtResolver({ art: { "uniequip_002_kalts.webp": { source: "equip/icon/uniequip_002_kalts.png", url: "", original: { bytes: 1, sha256: "", width: 511, height: 511 }, converted: { bytes: 1, sha256: "", width: 480, height: 480 } } } });
  assert.deepEqual(resolve("uniequip_002_kalts"), { src: "/assets/operator-modules-art/uniequip_002_kalts.webp", width: 480, height: 480 });
  assert.equal(resolve("uniequip_003_kalts"), null);
});
