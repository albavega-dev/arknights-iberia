import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { gameDataRepository, gameDataRevisions } from "../src/game-data/gamedata-revisions.ts";

function compareCodeUnits(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

const DEFAULT_FACTION_MANIFEST = "data/operator-faction-manifest.json";
const DEFAULT_AFFILIATION_MANIFEST = "data/operator-affiliation-manifest.json";

export const documentedNationAliases = Object.freeze({ rim: "rim-billiton", egir: "aegir", rhodes: "rhodes-island" });
export const documentedGroupAliases = Object.freeze({ karlan: "karlan-trade", glasgow: "glasgow", penguin: "penguin-logistics", tara: "tara", babel: "babel" });
export const documentedTeamAliases = Object.freeze({ followers: "followers" });

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveNation(nationId, validFactionIds) {
  if (typeof nationId !== "string" || nationId.length === 0) return null;
  const normalized = documentedNationAliases[nationId] ?? nationId;
  return validFactionIds.has(`faction:${normalized}`) ? normalized : null;
}

function resolveGroup(groupId, validFactionIds) {
  if (typeof groupId !== "string" || groupId.length === 0) return null;
  const normalized = documentedGroupAliases[groupId] ?? null;
  return normalized && validFactionIds.has(`faction:${normalized}`) ? normalized : null;
}

function resolveTeam(teamId, validFactionIds) {
  if (typeof teamId !== "string" || teamId.length === 0) return null;
  const normalized = documentedTeamAliases[teamId] ?? null;
  return normalized && validFactionIds.has(`faction:${normalized}`) ? normalized : null;
}

function relationKey(operatorId, field, value) {
  return `${operatorId}|${field}|${value ?? ""}`;
}

export function extractSubPowerCandidates({ characterTable, catalog, affiliationManifest, source }) {
  const catalogIds = new Set(catalog.operators.map((operator) => operator.id));
  const mainFactionByOperator = new Map(catalog.operators.map((operator) => [operator.id, operator.mainFactionId ?? null]));
  const validFactionIds = new Set(catalog.factions.map((faction) => faction.id));
  const active = affiliationManifest.associations.filter((entry) => entry.status === "verified" && entry.relation === "sub-power");
  const activeByOperator = new Map();
  for (const entry of active) {
    const list = activeByOperator.get(entry.operatorId) ?? [];
    list.push(entry);
    activeByOperator.set(entry.operatorId, list);
  }
  const rows = [];
  const duplicateKeys = [];
  const seenOriginal = new Set();
  const snapshotIds = new Set(Object.keys(characterTable));
  for (const operatorId of [...catalogIds].sort(compareCodeUnits)) {
    const operator = characterTable[operatorId];
    if (!operator) continue;
    const subPower = Array.isArray(operator.subPower) ? operator.subPower : [];
    subPower.forEach((entry, index) => {
      for (const field of ["nationId", "groupId", "teamId"]) {
        const originalValue = entry?.[field] ?? null;
        if (originalValue === null) continue;
        const originalKey = relationKey(operatorId, field, originalValue);
        if (seenOriginal.has(originalKey)) duplicateKeys.push(originalKey);
        seenOriginal.add(originalKey);
        const destination = field === "nationId" ? resolveNation(originalValue, validFactionIds) : field === "groupId" ? resolveGroup(originalValue, validFactionIds) : resolveTeam(originalValue, validFactionIds);
        const matching = (activeByOperator.get(operatorId) ?? []).filter((relation) => destination !== null && relation.affiliationId === `faction:${destination}` && (!relation.sourceField || relation.sourceField.endsWith(`subPower[].${field}`)) && (relation.sourceValue === undefined || relation.sourceValue === originalValue));
        const redundant = !matching.length && destination !== null && mainFactionByOperator.get(operatorId) === `faction:${destination}`;
        rows.push({ operatorId, name: operator.name, index, field, originalValue, destination, status: matching.length ? "verified" : redundant ? "redundant" : destination ? "candidate" : "unresolved", source });
      }
    });
  }
  const sourceRelationKeys = new Set(rows.filter((row) => row.destination).map((row) => relationKey(row.operatorId, row.field, row.destination)));
  const obsolete = active.filter((entry) => {
    const field = entry.sourceField?.includes("groupId") ? "groupId" : entry.sourceField?.includes("teamId") ? "teamId" : "nationId";
    return !sourceRelationKeys.has(relationKey(entry.operatorId, field, entry.affiliationId.replace(/^faction:/, "")));
  });
  const missingCatalogSnapshotIds = [...catalogIds].filter((id) => !snapshotIds.has(id)).sort(compareCodeUnits);
  const summary = {
    catalogOperators: catalogIds.size,
    snapshotOperatorsInCatalog: [...catalogIds].filter((id) => snapshotIds.has(id)).length,
    catalogOperatorsMissingFromSnapshot: missingCatalogSnapshotIds.length,
    originalSubPowerOperators: new Set(rows.map((row) => row.operatorId)).size,
    originalSubPowerEntries: new Set(rows.map((row) => `${row.operatorId}|${row.index}`)).size,
    uniqueOriginalRelations: new Set(rows.map((row) => relationKey(row.operatorId, row.field, row.originalValue))).size,
    verifiedRelations: rows.filter((row) => row.status === "verified").length,
    redundantRelations: rows.filter((row) => row.status === "redundant").length,
    candidateRelations: rows.filter((row) => row.status === "candidate").length,
    unresolvedRelations: rows.filter((row) => row.status === "unresolved").length,
    duplicateOriginalRelations: duplicateKeys.length,
    obsoleteManifestRelations: obsolete.length,
  };
  return { summary, rows, redundantRelations: rows.filter((row) => row.status === "redundant"), obsolete, duplicateKeys, missingCatalogSnapshotIds };
}

function parseArgs(argv) {
  const args = { json: false, snapshot: null, revision: null, catalog: DEFAULT_FACTION_MANIFEST, affiliations: DEFAULT_AFFILIATION_MANIFEST };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg.startsWith("--snapshot=")) args.snapshot = arg.slice(11);
    else if (arg.startsWith("--revision=")) args.revision = arg.slice(11);
    else if (arg.startsWith("--catalog=")) args.catalog = arg.slice(10);
    else if (arg.startsWith("--affiliations=")) args.affiliations = arg.slice(15);
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return args;
}

export function run(options) {
  if (!options.snapshot) throw new Error("Falta --snapshot=<character_table.json> (añade --revision=<commit> si es el snapshot fijado)");
  const source = getSourceMetadata(options.snapshot, options.revision);
  return extractSubPowerCandidates({ characterTable: readJson(options.snapshot), catalog: readJson(options.catalog), affiliationManifest: readJson(options.affiliations), source });
}

/**
 * @param {string} snapshotPath
 * @param {string | null} [revision] Commit the snapshot comes from; only the pinned EN revision is recorded as verified.
 */
export function getSourceMetadata(snapshotPath, revision = null) {
  const isPinned = revision === gameDataRevisions.en;
  return { repository: isPinned ? gameDataRepository : null, region: isPinned ? "en" : null, revision: isPinned ? revision : null, path: isPinned ? "en/gamedata/excel/character_table.json" : snapshotPath, revisionVerified: isPinned };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const result = run(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log("subPower[] EN — candidatos de afiliación");
    for (const [key, value] of Object.entries(result.summary)) console.log(`${key}: ${value}`);
    console.log(`relaciones redundantes: ${result.rows.filter((row) => row.status === "redundant").length}`);
    console.log(`candidatos pendientes: ${result.rows.filter((row) => row.status === "candidate").length}`);
    console.log(`relaciones no resolubles: ${result.rows.filter((row) => row.status === "unresolved").length}`);
  }
}
