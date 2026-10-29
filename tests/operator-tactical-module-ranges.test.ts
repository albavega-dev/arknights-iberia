import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getConfirmedModuleRanges, getOperatorTacticalEntry } from "../src/game-data/operator-tactical";
import type { OperatorModulesProfile } from "../src/game-data/operator-modules";

type Grid = { row: number; col: number };
type ModuleRangeEntry = { operatorId: string; uniEquipId: string; moduleType: string; mechanism: string; baseRangeId: string; modifiedRangeId: string; rangeKey: string; grids: Grid[]; iconUrl: string };

const manifest = JSON.parse(await readFile(path.resolve("data/operator-tactical-manifest.json"), "utf8")) as { moduleRanges: ModuleRangeEntry[] };
const profile = async (operatorId: string) => JSON.parse(await readFile(path.resolve("data/operator-modules", `${operatorId}.json`), "utf8")) as OperatorModulesProfile;
const sorted = (grids: readonly Grid[]) => grids.map((grid) => `${grid.row},${grid.col}`).sort();
const moved = ["char_2015_dusk", "char_109_fmout", "char_1011_lava2", "char_373_lionhd", "char_213_mostma", "char_128_plosis", "char_179_cgbird", "char_275_breeze", "char_4164_tecno"];

test("every module range of the tactical manifest matches the range, type and icon of its module in the modules dataset", async () => {
  for (const entry of manifest.moduleRanges.filter((item) => item.mechanism === "rangeId")) {
    const data = await profile(entry.operatorId);
    const equip = data.modules.find((item) => item.id === entry.uniEquipId);
    assert.ok(equip, `${entry.uniEquipId} is missing from the modules dataset`);
    assert.equal(entry.moduleType, equip.type, entry.uniEquipId);
    assert.equal(entry.iconUrl, `/assets/operator-modules/${equip.icon}.png`, entry.uniEquipId);
    await access(path.resolve("public", entry.iconUrl.slice(1)));
    assert.ok(equip.levels.some((level) => level.rangeId === entry.modifiedRangeId), `${entry.uniEquipId} does not change the range to ${entry.modifiedRangeId}`);
    assert.deepEqual(sorted(entry.grids), sorted(data.ranges[entry.modifiedRangeId]!.grids), entry.uniEquipId);
    assert.equal(entry.baseRangeId, getOperatorTacticalEntry(entry.operatorId)?.phases.at(-1)?.rangeId, `${entry.uniEquipId} base range`);
  }
});

test("the nine module ranges that were written in code now come from the manifest, once each", () => {
  for (const operatorId of moved) {
    const ranges = getConfirmedModuleRanges(operatorId);
    assert.equal(ranges.length, 1, operatorId);
    assert.equal(ranges[0]!.mechanism, "rangeId", operatorId);
  }
  // Splash Caster SPC-X shape.
  assert.deepEqual(sorted(getConfirmedModuleRanges("char_1011_lava2")[0]!.grids), sorted([
    { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 },
    { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 },
    { row: -1, col: 0 }, { row: -1, col: 1 }, { row: -1, col: 2 },
  ]));
});

test("module ranges computed from the base range stay in code", () => {
  assert.equal(getConfirmedModuleRanges("char_1034_jesca2").length, 1);
  assert.equal(getConfirmedModuleRanges("char_4194_rmixer").length, 1);
});
