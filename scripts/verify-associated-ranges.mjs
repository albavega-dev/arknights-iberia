import { readFile } from "node:fs/promises";

function compareCodeUnits(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = (name, fallback) => args.get(name) ?? fallback;
const enRoot = root("--en-root");
const cnRoot = root("--cn-root");
if (!enRoot || !cnRoot) {
  console.error("Usage: node scripts/verify-associated-ranges.mjs --en-root DIR --cn-root DIR [--curation FILE] [--manifest FILE] [--catalog-base URL]\nEach root holds range_table.json and character_table.json of one region.");
  process.exit(2);
}
const curationPath = root("--curation", "data/operator-associated-ranges.json");
const manifestPath = root("--manifest", "data/operator-tactical-manifest.json");
const catalogBase = root("--catalog-base", "http://localhost:3000").replace(/\/$/, "");

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const curation = await json(curationPath);
const entities = [];
const associatedStateVariants = [];
const configuredOwners = new Set();
for (const [operatorId, records] of Object.entries(curation.entities)) {
  for (const record of records) {
    // A second record for the same entity is a state variant of its range.
    if (configuredOwners.has(record.ownerId)) associatedStateVariants.push([operatorId, record.ownerId, record.rangeId]);
    else { configuredOwners.add(record.ownerId); entities.push([operatorId, record.ownerId, record.rangeId, record.skillId ?? null]); }
  }
}
const dollkeepers = Object.entries(curation.substitutes).flatMap(([operatorId, records]) => records.map((record) => [operatorId, record.rangeId]));
const coordinateKey = (cell) => `${cell.row},${cell.col}`;
const coordinates = (value) => (Array.isArray(value?.grids) ? value.grids.map(coordinateKey).sort(compareCodeUnits) : null);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const manifest = await json(manifestPath);
const rangeDefinitions = manifest.rangeDefinitions ?? {};
const snapshots = { en: { root: enRoot, range: await json(`${enRoot}/range_table.json`), character: await json(`${enRoot}/character_table.json`) }, cn: { root: cnRoot, range: await json(`${cnRoot}/range_table.json`), character: await json(`${cnRoot}/character_table.json`) } };

const collectEntityInventory = (character) => {
  const inventory = new Map();
  const add = (operatorId, entityId, relation) => {
    const entity = character[entityId];
    if (!entity || !Array.isArray(entity.phases) || !entity.phases.some((phase) => phase.rangeId)) return;
    inventory.set(entityId, { operatorId, relation, rangeIds: [...new Set(entity.phases.map((phase) => phase.rangeId).filter(Boolean))] });
  };
  for (const [operatorId, operator] of Object.entries(character)) {
    for (const skill of Array.isArray(operator.skills) ? operator.skills : []) if (skill.overrideTokenKey) add(operatorId, skill.overrideTokenKey, "overrideTokenKey");
    for (const talent of Array.isArray(operator.talents) ? operator.talents : []) for (const candidate of Array.isArray(talent.candidates) ? talent.candidates : []) if (candidate.tokenKey) add(operatorId, candidate.tokenKey, "tokenKey");
    for (const entityId of Object.keys(operator.displayTokenDict ?? {})) add(operatorId, entityId, "displayTokenDict");
  }
  return inventory;
};

const enInventory = collectEntityInventory(snapshots.en.character);
const entityIds = new Set(entities.map(([, entityId]) => entityId));
const dollkeeperEntityIds = new Set(["token_10022_kazema_shadow"]);
const justifiedExclusions = new Set();
const coveredIds = new Set([...entityIds, ...dollkeeperEntityIds]);
const pendingIds = [...enInventory.keys()].filter((entityId) => !coveredIds.has(entityId));
check(enInventory.size === 69, `unexpected EN associated inventory size: ${enInventory.size}`);
check(entityIds.size === entities.length, "duplicate entity identifiers in configured entries");
check([...entityIds].every((entityId) => enInventory.has(entityId)), "configured entity is absent from EN inventory");
check([...dollkeeperEntityIds].every((entityId) => enInventory.has(entityId)), "Dollkeeper entity is absent from EN inventory");
check(pendingIds.every((entityId) => justifiedExclusions.has(entityId)), `unjustified EN entity exclusions: ${pendingIds.join(", ") || "none"}`);
check([...justifiedExclusions].every((entityId) => pendingIds.includes(entityId)), "justified exclusion is no longer pending");
const catalogStatus = async (slugs) => {
  const statuses = [];
  for (const slug of slugs) {
    try {
      const response = await fetch(`${catalogBase}/operators/${slug}`, { redirect: "manual" });
      const body = await response.text();
      const pageFound = response.status === 200 && /<title>Operador - /i.test(body);
      statuses.push({ slug, status: response.status, pageFound });
    } catch (error) {
      failures.push(`catalog availability check failed for ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return statuses;
};
const kazemaruCatalog = await catalogStatus(["kazemaru"]);
const kaltsitCatalog = await catalogStatus(["kaltsit-esperanta", "kal-tsit-esperanta"]);
check(kazemaruCatalog.some(({ pageFound }) => pageFound), "Kazemaru is not available in the local public catalogue");
check(kaltsitCatalog.some(({ pageFound }) => pageFound), "Kal'tsit Esperanta is not available in the local public catalogue");

const entityRecords = (operatorId, ownerId) => (curation.entities[operatorId] ?? []).filter((record) => record.ownerId === ownerId);
for (const [operatorId, ownerId, rangeId, skillId] of entities) {
  const record = entityRecords(operatorId, ownerId).find((candidate) => candidate.rangeId === rangeId);
  check(record, `missing entity association ${operatorId} -> ${ownerId}`);
  check(record?.rangeKey === `en:${rangeId}`, `wrong rangeKey for ${ownerId}`);
  if (skillId) check(record?.skillId === skillId, `wrong skillId for ${ownerId}`);
  const expected = coordinates(snapshots.en.range[rangeId]);
  check(expected, `missing EN range definition ${rangeId}`);
  check(coordinates(rangeDefinitions[`en:${rangeId}`]), `missing local range definition en:${rangeId}`);
  check(equal(expected, coordinates(rangeDefinitions[`en:${rangeId}`])), `local geometry mismatch for en:${rangeId}`);
  check(coordinates(snapshots.cn.range[rangeId]), `missing CN range definition ${rangeId}`);
  check(equal(expected, coordinates(snapshots.cn.range[rangeId])), `EN/CN geometry mismatch for ${rangeId}`);
  for (const region of Object.values(snapshots)) check(region.character[ownerId], `missing token ${ownerId} in character_table`);
}
for (const [operatorId, ownerId, rangeId] of associatedStateVariants) {
  const record = entityRecords(operatorId, ownerId).find((candidate) => candidate.rangeId === rangeId);
  check(record?.rangeKey === `en:${rangeId}`, `wrong associated state rangeKey for ${ownerId}`);
  const expected = coordinates(snapshots.en.range[rangeId]);
  check(expected, `missing EN range definition ${rangeId}`);
  check(coordinates(rangeDefinitions[`en:${rangeId}`]), `missing local range definition en:${rangeId}`);
  check(equal(expected, coordinates(rangeDefinitions[`en:${rangeId}`])), `local geometry mismatch for en:${rangeId}`);
  check(coordinates(snapshots.cn.range[rangeId]), `missing CN range definition ${rangeId}`);
  check(equal(expected, coordinates(snapshots.cn.range[rangeId])), `EN/CN geometry mismatch for ${rangeId}`);
}
for (const [operatorId, rangeId] of dollkeepers) {
  const records = curation.substitutes[operatorId] ?? [];
  check(records.length > 0, `missing Dollkeeper ${operatorId}`);
  check(records.every((record) => record.rangeKey === `en:${rangeId}`), `wrong Dollkeeper range key for ${operatorId}`);
  check(coordinates(rangeDefinitions[`en:${rangeId}`]), `missing Dollkeeper local range en:${rangeId}`);
  check(coordinates(snapshots.en.range[rangeId]), `missing Dollkeeper EN range ${rangeId}`);
  check(equal(coordinates(rangeDefinitions[`en:${rangeId}`]), coordinates(snapshots.en.range[rangeId])), `Dollkeeper geometry mismatch ${rangeId}`);
}
check(new Set(entities.map(([, id]) => id)).size === entities.length, "duplicate entity identifiers");
check(new Set(dollkeepers.map(([id]) => id)).size === dollkeepers.length, "duplicate Dollkeeper identifiers");
check(!entities.some(([, id]) => dollkeepers.some(([owner]) => owner === id)), "entity/Dollkeeper identifier collision");
console.log(`Associated range verification: ${entities.length} entities, ${dollkeepers.length} Dollkeepers`);
console.log(`EN inventory: ${enInventory.size}; implemented entities: ${entityIds.size}; Dollkeeper-covered: ${dollkeeperEntityIds.size}; justified exclusions: ${pendingIds.filter((entityId) => justifiedExclusions.has(entityId)).length}; unjustified pending: ${pendingIds.filter((entityId) => !justifiedExclusions.has(entityId)).length}`);
if (failures.length) { for (const failure of failures) console.error(`FAIL: ${failure}`); process.exitCode = 1; } else console.log("PASS: identifiers, range IDs, EN/CN coordinates, local definitions, token presence, selectors and collision checks");
