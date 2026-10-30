import assert from "node:assert/strict";
import test from "node:test";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions.ts";
import { extractSubPowerCandidates, getSourceMetadata } from "../scripts/extract-subpower-candidates.mjs";

const source = { repository: "test", region: "en", revision: "test", path: "character_table.json" };
const catalog = { factions: [{ id: "faction:iberia" }, { id: "faction:rim-billiton" }, { id: "faction:kazimierz" }, { id: "faction:leithanien" }, { id: "faction:rhodes-island" }], operators: [{ id: "char_jess" }, { id: "char_deg" }, { id: "char_mantra" }, { id: "char_missing" }] };

test("extrae nationId, groupId, teamId y aliases regionales documentados", () => {
  const result = extractSubPowerCandidates({ characterTable: {
    char_jess: { name: "Jessica", subPower: [{ nationId: "rim" }, { groupId: "babel" }, { teamId: "followers" }] },
    char_deg: { name: "Degenbrecher", subPower: [{ nationId: "kazimierz" }, { nationId: "leithanien" }] },
    char_mantra: { name: "Mantra", subPower: [{ groupId: "babel" }] },
  }, catalog, affiliationManifest: { associations: [{ operatorId: "char_jess", affiliationId: "faction:rim-billiton", relation: "sub-power", status: "verified" }, { operatorId: "char_deg", affiliationId: "faction:leithanien", relation: "sub-power", status: "verified" }] }, source });
  assert.deepEqual(result.summary, { catalogOperators: 4, snapshotOperatorsInCatalog: 3, catalogOperatorsMissingFromSnapshot: 1, originalSubPowerOperators: 3, originalSubPowerEntries: 6, uniqueOriginalRelations: 6, verifiedRelations: 2, redundantRelations: 0, candidateRelations: 1, unresolvedRelations: 3, duplicateOriginalRelations: 0, obsoleteManifestRelations: 0 });
  assert.equal(result.rows.find((row) => row.originalValue === "rim").destination, "rim-billiton");
  assert.equal(result.rows.find((row) => row.field === "groupId").status, "unresolved");
});

test("resuelve rhodes como rhodes-island únicamente para nationId", () => {
  const result = extractSubPowerCandidates({ characterTable: {
    char_rhodes: { name: "Rhodes operator", subPower: [{ nationId: "rhodes" }, { groupId: "babel" }, { teamId: "followers" }] },
  }, catalog: { factions: [{ id: "faction:rhodes-island" }], operators: [{ id: "char_rhodes" }] }, affiliationManifest: { associations: [
    { operatorId: "char_rhodes", affiliationId: "faction:rhodes-island", relation: "sub-power", status: "verified" },
  ] }, source });
  assert.equal(result.rows.find((row) => row.originalValue === "rhodes")?.status, "verified");
  assert.equal(result.rows.find((row) => row.originalValue === "babel")?.status, "unresolved");
  assert.equal(result.rows.find((row) => row.originalValue === "followers")?.status, "unresolved");
});

test("resuelve groupId karlan sin compartir el mapping con nationId o teamId", () => {
  const result = extractSubPowerCandidates({ characterTable: {
    char_karlan: { name: "Karlan operator", subPower: [{ groupId: "karlan" }, { nationId: "karlan" }, { teamId: "karlan" }, { groupId: "penguin" }, { groupId: "babel" }, { groupId: "glasgow" }, { groupId: "tara" }] },
  }, catalog: { factions: [{ id: "faction:karlan-trade" }], operators: [{ id: "char_karlan" }] }, affiliationManifest: { associations: [
    { operatorId: "char_karlan", affiliationId: "faction:karlan-trade", relation: "sub-power", sourceField: "character_table.json → subPower[].groupId", status: "verified" },
  ] }, source });
  assert.equal(result.rows.find((row) => row.field === "groupId" && row.originalValue === "karlan")?.status, "verified");
  assert.equal(result.rows.find((row) => row.field === "nationId")?.status, "unresolved");
  assert.equal(result.rows.find((row) => row.field === "teamId")?.status, "unresolved");
  for (const value of ["penguin", "babel", "glasgow", "tara"]) assert.equal(result.rows.find((row) => row.originalValue === value)?.status, "unresolved");
  assert.equal(result.summary.duplicateOriginalRelations, 0);
  assert.equal(result.summary.obsoleteManifestRelations, 0);
});

test("resuelve aliases organizativos solo en su campo", () => {
  const result = extractSubPowerCandidates({ characterTable: {
    char_org: { name: "Organization operator", subPower: [
      { groupId: "glasgow" }, { groupId: "penguin" }, { groupId: "tara" }, { groupId: "babel" }, { teamId: "followers" },
      { nationId: "penguin" }, { teamId: "babel" }, { groupId: "followers" },
    ] },
  }, catalog: { factions: ["glasgow", "penguin-logistics", "tara", "babel", "followers"].map((id) => ({ id: `faction:${id}` })), operators: [{ id: "char_org" }] }, affiliationManifest: { associations: [] }, source });
  for (const value of ["glasgow", "penguin", "tara", "babel"]) assert.equal(result.rows.find((row) => row.field === "groupId" && row.originalValue === value)?.status, "candidate");
  assert.equal(result.rows.find((row) => row.field === "teamId" && row.originalValue === "followers")?.status, "candidate");
  assert.equal(result.rows.find((row) => row.field === "nationId")?.status, "unresolved");
  assert.equal(result.rows.find((row) => row.field === "teamId" && row.originalValue === "babel")?.status, "unresolved");
  assert.equal(result.rows.find((row) => row.field === "groupId" && row.originalValue === "followers")?.status, "unresolved");
});

test("exige procedencia de campo y valor para verificar una relación", () => {
  const result = extractSubPowerCandidates({ characterTable: { char_org: { name: "Organization operator", subPower: [{ groupId: "babel" }] } }, catalog: { factions: [{ id: "faction:babel" }], operators: [{ id: "char_org" }] }, affiliationManifest: { associations: [{ operatorId: "char_org", affiliationId: "faction:babel", relation: "sub-power", sourceField: "character_table.json → subPower[].teamId", sourceValue: "babel", status: "verified" }] }, source });
  assert.equal(result.rows[0].status, "candidate");
  assert.equal(result.summary.obsoleteManifestRelations, 1);
});

test("resuelve egir como aegir sin resolver identificadores organizativos", () => {
  const result = extractSubPowerCandidates({ characterTable: {
    char_mizuki: { name: "Mizuki", subPower: [{ nationId: "egir" }, { groupId: "penguin" }] },
  }, catalog: { factions: [{ id: "faction:aegir" }], operators: [{ id: "char_mizuki" }] }, affiliationManifest: { associations: [
    { operatorId: "char_mizuki", affiliationId: "faction:aegir", relation: "sub-power", status: "verified" },
  ] }, source });
  assert.equal(result.rows.find((row) => row.originalValue === "egir")?.destination, "aegir");
  assert.equal(result.rows.find((row) => row.originalValue === "egir")?.status, "verified");
  assert.equal(result.rows.find((row) => row.originalValue === "penguin")?.status, "unresolved");
});

test("detecta duplicados y relaciones obsoletas por IDs", () => {
  const result = extractSubPowerCandidates({ characterTable: { char_jess: { name: "Jessica", subPower: [{ nationId: "iberia" }, { nationId: "iberia" }] } }, catalog: { factions: [{ id: "faction:iberia" }], operators: [{ id: "char_jess" }] }, affiliationManifest: { associations: [{ operatorId: "char_jess", affiliationId: "faction:iberia", relation: "sub-power", status: "verified" }, { operatorId: "char_jess", affiliationId: "faction:sargon", relation: "sub-power", status: "verified" }, { operatorId: "char_unknown", affiliationId: "faction:iberia", relation: "sub-power", status: "verified" }] }, source });
  assert.equal(result.summary.duplicateOriginalRelations, 1);
  assert.equal(result.summary.obsoleteManifestRelations, 2);
  assert.equal(result.rows.filter((row) => row.status === "verified").length, 2);
});

test("ignora placeOfBirth porque solo lee subPower", () => {
  const result = extractSubPowerCandidates({ characterTable: { char_jess: { name: "Jessica", placeOfBirth: "Columbia", subPower: [] } }, catalog: { factions: [{ id: "faction:columbia" }], operators: [{ id: "char_jess" }] }, affiliationManifest: { associations: [{ operatorId: "char_jess", affiliationId: "faction:columbia", relation: "place-of-birth", status: "verified" }] }, source });
  assert.equal(result.rows.length, 0);
  assert.equal(result.summary.originalSubPowerOperators, 0);
});

test("clasifica nationId desconocido como no resoluble", () => {
  const result = extractSubPowerCandidates({ characterTable: { char_jess: { name: "Jessica", subPower: [{ nationId: "unknown-region" }, { nationId: "" }, { nationId: null }] } }, catalog: { factions: [{ id: "faction:iberia" }], operators: [{ id: "char_jess" }] }, affiliationManifest: { associations: [] }, source });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].originalValue, "unknown-region");
  assert.equal(result.rows[0].destination, null);
  assert.equal(result.rows[0].status, "unresolved");
  assert.equal(result.rows[1].originalValue, "");
  assert.equal(result.rows[1].destination, null);
  assert.equal(result.rows[1].status, "unresolved");
});

test("la revisión EN fijada se verifica solo si se indica expresamente", () => {
  const pinned = getSourceMetadata("C:/tmp/character_table.json", gameDataRevisions.en);
  assert.equal(pinned.revision, gameDataRevisions.en);
  assert.equal(pinned.revisionVerified, true);
  assert.equal(getSourceMetadata("C:/tmp/character_table.json", "0".repeat(40)).revisionVerified, false);
});

test("la procedencia alternativa no hereda la revisión EN", () => {
  const alternate = getSourceMetadata("C:/tmp/other-character-table.json");
  assert.equal(alternate.revision, null);
  assert.equal(alternate.revisionVerified, false);
  assert.equal(alternate.path, "C:/tmp/other-character-table.json");
});

test("la extracción es determinista", () => {
  const input = { characterTable: { char_jess: { name: "Jessica", subPower: [{ nationId: "rim" }, { groupId: "babel" }] } }, catalog: { factions: [{ id: "faction:rim-billiton" }], operators: [{ id: "char_jess" }] }, affiliationManifest: { associations: [] }, source };
  assert.deepEqual(extractSubPowerCandidates(input), extractSubPowerCandidates(input));
});

test("clasifica las seis coincidencias regionales exactas como redundantes", () => {
  const ids = [
    ["char_vina", "victoria"], ["char_reed", "victoria"], ["char_cliff", "kjerag"],
    ["char_pram", "kjerag"], ["char_kjera", "kjerag"], ["char_aurora", "kjerag"],
  ];
  const result = extractSubPowerCandidates({
    characterTable: Object.fromEntries(ids.map(([id, nationId]) => [id, { name: id, subPower: [{ nationId }] }])),
    catalog: { factions: ["victoria", "kjerag"].map((id) => ({ id: `faction:${id}` })), operators: ids.map(([id, nationId]) => ({ id, mainFactionId: `faction:${nationId}` })) },
    affiliationManifest: { associations: [] }, source,
  });
  assert.equal(result.summary.redundantRelations, 6);
  assert.equal(result.summary.candidateRelations, 0);
  assert.deepEqual(result.redundantRelations.map((row) => [row.operatorId, row.originalValue, row.destination]), ids.map(([id, nationId]) => [id, nationId, nationId]).sort(([a], [b]) => a.localeCompare(b)));
});

test("solo una coincidencia exacta de mainFactionId es redundante", () => {
  const result = extractSubPowerCandidates({
    characterTable: { same: { name: "Same", subPower: [{ nationId: "victoria" }] }, different: { name: "Different", subPower: [{ nationId: "victoria" }] }, unknown: { name: "Unknown", subPower: [{ nationId: "victoria" }] } },
    catalog: { factions: [{ id: "faction:victoria" }], operators: [{ id: "same", mainFactionId: "faction:victoria" }, { id: "different", mainFactionId: "faction:kjerag" }, { id: "unknown" }] },
    affiliationManifest: { associations: [] }, source,
  });
  assert.equal(result.rows.find((row) => row.operatorId === "same")?.status, "redundant");
  assert.equal(result.rows.find((row) => row.operatorId === "different")?.status, "candidate");
  assert.equal(result.rows.find((row) => row.operatorId === "unknown")?.status, "candidate");
});
