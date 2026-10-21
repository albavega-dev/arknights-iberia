import assert from "node:assert/strict";
import test from "node:test";

import affiliationManifest from "../data/operator-affiliation-manifest.json";
import { filterOperators, type OperatorRecord } from "../src/game-data/operators";
import { normalizeCharacterTable } from "../src/game-data/operator-import";
import { getOperatorAdditionalFactionIds } from "../src/game-data/operator-factions";

const record = (id: string, mainFactionId: string | null, additionalFactionIds?: readonly string[]): OperatorRecord => ({
  id, name: id, class: "Specialist", subClassId: null, rarity: 6, slug: id, cnOnly: false,
  availabilityStatus: "global-snapshot", cnReleaseDate: null, globalReleaseDate: null,
  mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId, additionalFactionIds,
});

const expectedSourceField = (entry: { affiliationId: string }) => ["faction:karlan-trade", "faction:glasgow", "faction:penguin-logistics", "faction:tara", "faction:babel"].includes(entry.affiliationId)
  ? "character_table.json → subPower[].groupId"
  : entry.affiliationId === "faction:followers"
    ? "character_table.json → subPower[].teamId"
    : "character_table.json → subPower[].nationId";

test("verified Iberia sub-power associations are loaded", () => {
  assert.deepEqual(getOperatorAdditionalFactionIds("char_400_weedy"), ["faction:iberia"]);
  assert.deepEqual(getOperatorAdditionalFactionIds("char_401_elysm"), ["faction:iberia"]);
});

test("Mizuki conserva Higashi y añade Aegir por subPower egir", () => {
  assert.deepEqual(getOperatorAdditionalFactionIds("char_437_mizuki"), ["faction:aegir"]);
  const mizuki = record("char_437_mizuki", "faction:higashi", getOperatorAdditionalFactionIds("char_437_mizuki"));
  const aegir = { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "faction:aegir" };
  assert.equal(filterOperators([mizuki], aegir).length, 1);
  assert.equal(mizuki.mainFactionId, "faction:higashi");
});

test("Karlan Trade añade afiliación sin sustituir Kjerag", () => {
  for (const id of ["char_173_slchan", "char_174_slbell", "char_4013_kjera", "char_422_aurora"]) {
    assert.deepEqual(getOperatorAdditionalFactionIds(id), ["faction:karlan-trade"]);
    const operator = record(id, "faction:kjerag", getOperatorAdditionalFactionIds(id));
    assert.equal(filterOperators([operator], { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "faction:karlan-trade" }).length, 1);
    assert.equal(operator.mainFactionId, "faction:kjerag");
  }
});

test("las cinco afiliaciones organizativas conservan sus facciones principales", () => {
  const expected = new Map([
    ["char_1014_nearl2", ["faction:kazimierz", "faction:followers"]],
    ["char_1019_siege2", ["faction:victoria", "faction:glasgow"]],
    ["char_213_mostma", ["faction:laterano", "faction:lungmen", "faction:penguin-logistics"]],
    ["char_261_sddrag", ["faction:victoria", "faction:tara"]],
    ["char_4204_mantra", ["faction:elite-op", "faction:sargon", "faction:babel"]],
  ]);
  const main = new Map([
    ["char_1014_nearl2", "faction:kazimierz"], ["char_1019_siege2", "faction:victoria"], ["char_213_mostma", "faction:laterano"],
    ["char_261_sddrag", "faction:victoria"], ["char_4204_mantra", "faction:elite-op"],
  ]);
  for (const [id, factions] of expected) {
    const additional = getOperatorAdditionalFactionIds(id);
    assert.deepEqual(new Set([main.get(id), ...additional]), new Set(factions));
    for (const factionId of factions) assert.equal(filterOperators([record(id, main.get(id)!, additional)], { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: factionId }).length, 1);
  }
});

test("the first EN nationId batch covers the seven unambiguous regions", () => {
  const expected = new Map([
    ["faction:bolivar", 6], ["faction:higashi", 7], ["faction:laterano", 4], ["faction:yan", 3], ["faction:victoria", 10],
    ["faction:leithanien", 3], ["faction:minos", 3], ["faction:rim-billiton", 6], ["faction:sargon", 7], ["faction:siracusa", 5], ["faction:kazimierz", 6], ["faction:kjerag", 1], ["faction:lungmen", 1],
    ["faction:columbia", 8], ["faction:ursus", 2], ["faction:aegir", 1], ["faction:rhodes-island", 4], ["faction:karlan-trade", 4],
    ["faction:followers", 1], ["faction:glasgow", 1], ["faction:penguin-logistics", 1], ["faction:tara", 1], ["faction:babel", 1],
  ]);
  const batch = affiliationManifest.associations.filter((entry) => entry.relation === "sub-power" && entry.affiliationId !== "faction:iberia");
  assert.equal(batch.length, 86);
  for (const [affiliationId, count] of expected) assert.equal(batch.filter((entry) => entry.affiliationId === affiliationId).length, count);
  assert.equal(new Set(batch.map((entry) => entry.operatorId)).size, 81);
  for (const entry of batch) {
    assert.equal(entry.relation, "sub-power");
    assert.equal(entry.sourceField, expectedSourceField(entry));
    assert.equal(entry.source.region, "en");
    assert.equal(entry.status, "verified");
  }
});

test("active affiliations contain only verified subPower relations", () => {
  assert.equal(affiliationManifest.associations.length, 88);
  assert.equal(affiliationManifest.associations.filter((entry) => entry.relation === "place-of-birth").length, 0);
  assert.equal(affiliationManifest.associations.every((entry) => entry.relation === "sub-power" && entry.status === "verified"), true);
  assert.equal(new Set(affiliationManifest.associations.map((entry) => entry.operatorId)).size, 83);
  assert.equal(new Set(affiliationManifest.associations.map((entry) => `${entry.operatorId}:${entry.affiliationId}:${entry.relation}`)).size, 88);
});

test("faction filtering matches main or verified additional affiliations without duplicates", () => {
  const records = [record("weedy", "faction:rhodes-island", ["faction:iberia"]), record("elysium", "faction:iberia", ["faction:iberia"]), record("other", "faction:rhodes-island")];
  const iberia = filterOperators(records, { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "faction:iberia" });
  assert.deepEqual(iberia.map((operator) => operator.id), ["weedy", "elysium"]);
  assert.equal(filterOperators(records, { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "faction:rhodes-island" }).length, 2);
});

test("official mainPower nation mappings are independent from birthplace", () => {
  const gnosis = record("char_206_gnosis", "faction:karlan-trade", getOperatorAdditionalFactionIds("char_206_gnosis"));
  const texas = record("char_102_texas", "faction:penguin-logistics", getOperatorAdditionalFactionIds("char_102_texas"));
  const columbia = (mainFactionId: string) => ({ query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId, });
  assert.deepEqual(getOperatorAdditionalFactionIds("char_206_gnosis"), ["faction:kjerag"]);
  assert.equal(filterOperators([gnosis], columbia("faction:kjerag")).length, 1);
  assert.equal(filterOperators([gnosis], columbia("faction:columbia")).length, 0);
  assert.equal(filterOperators([texas], columbia("faction:lungmen")).length, 0);
  assert.equal(filterOperators([texas], columbia("faction:siracusa")).length, 1);
  assert.equal(filterOperators([texas], columbia("faction:columbia")).length, 0);
});

test("subPower takes priority over mainPower nation fallback", () => {
  assert.deepEqual(getOperatorAdditionalFactionIds("char_102_texas"), ["faction:siracusa"]);
  assert.deepEqual(getOperatorAdditionalFactionIds("char_1028_texas2"), ["faction:siracusa"]);
  assert.equal(getOperatorAdditionalFactionIds("char_4116_blkkgt").includes("faction:kjerag"), false);
  assert.deepEqual(getOperatorAdditionalFactionIds("char_206_gnosis"), ["faction:kjerag"]);
  assert.deepEqual(getOperatorAdditionalFactionIds("char_400_weedy"), ["faction:iberia"]);
  for (const id of ["char_1034_jesca2", "char_128_plosis", "char_173_slchan", "char_174_slbell", "char_235_jesica", "char_4013_kjera", "char_422_aurora"]) {
    assert.equal(getOperatorAdditionalFactionIds(id).some((factionId) => ["faction:columbia", "faction:kjerag"].includes(factionId)), false);
  }
});

test("normalization preserves whether the original subPower array is populated", () => {
  const normalized = normalizeCharacterTable({
    char_with_sub: { name: "With subPower", profession: "SPECIAL", subProfessionId: "executor", rarity: "TIER_4", isNotObtainable: false, phases: [{}], subPower: [{ nationId: "iberia" }] },
    char_without_sub: { name: "Without subPower", profession: "SPECIAL", subProfessionId: "executor", rarity: "TIER_4", isNotObtainable: false, phases: [{}], subPower: [] },
  }).operators;
  assert.equal(normalized.find((operator) => operator.id === "char_with_sub")?.hasSubPower, true);
  assert.equal(normalized.find((operator) => operator.id === "char_without_sub")?.hasSubPower, false);
});

test("Columbia mainPower fallback is available without birthplace affiliations", () => {
  const columbia = (id: string, mainFactionId: string, additionalFactionIds?: readonly string[]) => record(id, mainFactionId, additionalFactionIds ?? getOperatorAdditionalFactionIds(id));
  const dorothy = columbia("char_4048_doroth", "faction:rhine-lab");
  const saria = columbia("char_202_demkni", "faction:rhine-lab");
  const filters = (mainFactionId: string) => ({ query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId });
  assert.equal(getOperatorAdditionalFactionIds("char_4048_doroth").includes("faction:columbia"), true);
  assert.equal(getOperatorAdditionalFactionIds("char_202_demkni").includes("faction:columbia"), true);
  assert.equal(filterOperators([dorothy], filters("faction:rhine-lab")).length, 1);
  assert.equal(filterOperators([dorothy], filters("faction:columbia")).length, 1);
  assert.equal(filterOperators([saria], filters("faction:rhine-lab")).length, 1);
  assert.equal(filterOperators([saria], filters("faction:columbia")).length, 1);
});

test("unverified or invalid affiliations do not affect filtering", () => {
  const records = [record("operator", "faction:rhodes-island", ["faction:pending"])];
  assert.equal(filterOperators(records, { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "faction:iberia" }).length, 0);
  assert.equal(filterOperators(records, { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "invalid" }).length, 0);
});
