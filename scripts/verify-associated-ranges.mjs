import { readFile } from "node:fs/promises";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = (name, fallback) => args.get(name) ?? fallback;
const enRoot = root("--en-root", "C:/Users/albav/Documents/arknights-iberia-research/operator-range-snapshots/en/3aaa25b649fed5dedad9527602826dc487ea07d8");
const cnRoot = root("--cn-root", "C:/Users/albav/Documents/arknights-iberia-research/operator-range-snapshots/cn/e4888c5b4d9b57aa3bfd4d109ae70f74cf3b7842");
const sourcePath = root("--source", "src/game-data/operator-tactical.ts");
const manifestPath = root("--manifest", "data/operator-tactical-manifest.json");
const catalogBase = root("--catalog-base", "http://localhost:3000").replace(/\/$/, "");

const entities = [
  ["char_113_cqbw", "token_10008_cqbw_box", "0-1", null],
  ["char_391_rosmon", "token_10012_rosmon_shield", "0-1", null],
  ["char_1035_wisdel", "token_10035_wisdel_wward", "0-1", null],
  ["char_4117_ray", "token_10034_ray_sndbst", "x-4", null],
  ["char_427_vigil", "token_10028_vigil_wolf", "0-1", null],
  ["char_249_mlyss", "token_10030_mlyss_wtrman", "0-1", null],
  ["char_4228_closur", "token_10066_closur_ourbase", "0-1", null],
  ["char_1046_sbell2", "token_10058_sbell2_icetgt", "0-1", null],
  ["char_4046_ebnhlz", "token_10024_ebnhlz_rcube", "0-1", null],
  ["char_1012_skadi2", "token_10017_skadi2_dedant", "x-4", null],
  ["char_1031_slent2", "token_10029_slent2_protrb", "x-4", null],
  ["char_1033_swire2", "token_10031_swire2_gdtrap", "0-1", null],
  ["char_400_weedy", "token_10009_weedy_cannon", "3-2", null],
  ["char_1041_angel2", "token_10056_angel2_target", "0-1", null],
  ["char_4048_doroth", "token_10025_doroth_recttp", "0-1", null],
  ["char_452_bstalk", "token_10014_bstalk_crab", "0-1", null],
  ["char_110_deepcl", "token_10001_deepcl_tentac", "0-1", null],
  ["char_484_robrta", "token_10018_robrta_mach", "1-1", null],
  ["char_4147_mitm", "token_10037_mitm_trshrb", "0-1", null],
  ["char_344_beewax", "token_10011_beewax_oblisk", "0-1", null],
  ["char_4164_tecno", "token_10042_tecno_puppet", "0-1", null],
  ["char_242_otter", "token_10004_otter_motter", "0-1", null],
  ["char_336_folivo", "token_10010_folivo_car", "1-1", null],
  ["char_4140_lasher", "token_10036_lasher_mcbird", "3-6", null],
  ["char_108_silent", "token_10000_silent_healrb", "x-4", null],
  ["char_433_windft", "token_10023_windft_wrench", "1-1", null],
  ["char_4162_cathy", "token_10041_cathy_catsld", "1-1", null],
  ["char_4178_alanna", "token_10045_alanna_crane", "1-1", null],
  ["char_451_robin", "token_10013_robin_mine", "0-1", null],
  ["char_458_rfrost", "token_10016_rfrost_mine", "0-1", null],
  ["char_476_blkngt", "token_10021_blkngt_hypnos", "x-5", null],
  ["char_4055_bgsnow", "token_10026_bgsnow_subbow", "3-2", null],
  ["char_4072_ironmn", "token_10027_ironmn_pile1", "1-1", "skchr_ironmn_1"],
  ["char_4072_ironmn", "token_10027_ironmn_pile2", "1-1", "skchr_ironmn_2"],
  ["char_4072_ironmn", "token_10027_ironmn_pile3", "3-13", "skchr_ironmn_3"],
  ["char_003_kalts", "token_10002_kalts_mon3tr", "1-1", null],
  ["char_2015_dusk", "token_10015_dusk_drgn", "x-5", null],
  ["char_250_phatom", "token_10007_phatom_twin", "1-1", null],
  ["char_2023_ling", "token_10020_ling_soul1", "1-1", "skchr_ling_1"],
  ["char_2023_ling", "token_10020_ling_soul2", "3-1", "skchr_ling_2"],
  ["char_2023_ling", "token_10020_ling_soul3", "1-1", "skchr_ling_3"],
  ["char_248_mgllan", "token_10005_mgllan_drone1", "x-4", "skchr_mgllan_1"],
  ["char_248_mgllan", "token_10005_mgllan_drone2", "0-1", "skchr_mgllan_2"],
  ["char_248_mgllan", "token_10005_mgllan_drone3", "3-6", "skchr_mgllan_3"],
  ["char_254_vodfox", "token_10006_vodfox_doll", "x-4", "skchr_vodfox_2"],
  ["char_4171_wulfen", "token_10044_wulfen_mine", "0-1", null],
  ["char_1045_svash2", "token_10057_svash2_eagle1", "0-1", "skchr_svash2_1"],
  ["char_1045_svash2", "token_10057_svash2_eagle2", "0-1", "skchr_svash2_2"],
  ["char_1045_svash2", "token_10057_svash2_eagle3", "3-1", "skchr_svash2_3"],
  ["char_450_necras", "token_10043_necras_skeltn", "x-5", null],
  ["char_4195_radian", "token_10051_radian_tower1", "0-1", "skchr_radian_1"],
  ["char_4195_radian", "token_10052_radian_tower2", "3-2", "skchr_radian_2"],
  ["char_4195_radian", "token_10053_radian_tower3", "3-1", "skchr_radian_3"],
  ["char_4212_nasti", "token_10059_nasti_nstdef", "1-1", "skchr_nasti_1"],
  ["char_4212_nasti", "token_10060_nasti_nstchr", "1-1", "skchr_nasti_2"],
  ["char_4212_nasti", "token_10061_nasti_nstbld", "1-1", "skchr_nasti_3"],
  ["char_1042_phatm2", "token_10054_phatm2_encdool", "x-1", "skchr_phatm2_2"],
  ["char_1042_phatm2", "token_10055_phatm2_mndclv", "0-1", "skchr_phatm2_3"],
  ["char_4123_ela", "token_10033_ela_grzmot", "0-1", null],
  ["char_2027_wang", "token_10064_wang_stone1", "0-1", null],
  ["char_179_cgbird", "token_10003_cgbird_bird", "0-1", null],
  ["char_4179_monstr", "token_10050_monstr_prosts", "x-4", null],
  ["char_1034_jesca2", "token_10032_jesca2_jckshd", "0-1", null],
  ["char_1019_siege2", "token_10040_siege2_vlion", "0-1", "skchr_siege2_3"],
  ["char_1014_nearl2", "token_10019_nearl2_sword", "0-1", "skchr_nearl2_3"],
  ["char_4145_ulpia", "token_10039_ulpia_block", "0-1", "skchr_ulpia_3"],
  ["char_4037_demetr", "token_10065_demetr_dmtpos", "0-1", "skchr_demetr_3"],
  ["char_1052_kalts2", "token_10068_kalts2_mtship", "y-2", null],
];
const associatedStateVariants = [["char_1052_kalts2", "token_10068_kalts2_mtship", "y-6"]];
const dollkeepers = [
  ["char_1023_ghost2", "x-4"], ["char_369_bena", "x-4"], ["char_4016_kazema", "x-4"],
  ["char_4107_vrdant", "x-4"], ["char_4124_iana", "x-1"], ["char_4183_mortis", "1-1"],
];
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const coordinateKey = (cell) => `${cell.row},${cell.col}`;
const coordinates = (value) => (Array.isArray(value?.grids) ? value.grids.map(coordinateKey).sort() : null);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const source = await readFile(sourcePath, "utf8");
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

const entitySource = source.slice(source.indexOf("const entityRanges"));
const sourceRecord = (operatorId, ownerId) => {
  const start = entitySource.indexOf(`${operatorId}:`);
  const end = entitySource.indexOf("],", start);
  const chunk = start >= 0 ? entitySource.slice(start, end >= 0 ? end : start + 4000) : "";
  const ownerStart = chunk.indexOf(`ownerId: "${ownerId}"`);
  return ownerStart >= 0 ? chunk.slice(Math.max(0, ownerStart - 100), ownerStart + 1000) : "";
};
for (const [operatorId, ownerId, rangeId, skillId] of entities) {
  const record = sourceRecord(operatorId, ownerId);
  check(record, `missing entity association ${operatorId} -> ${ownerId}`);
  check(record.includes(`rangeId: "${rangeId}"`), `wrong rangeId for ${ownerId}`);
  check(record.includes(`rangeKey: "en:${rangeId}"`), `wrong rangeKey for ${ownerId}`);
  if (skillId) check(record.includes(`skillId: "${skillId}"`), `wrong skillId for ${ownerId}`);
  const expected = coordinates(snapshots.en.range[rangeId]);
  check(expected, `missing EN range definition ${rangeId}`);
  check(coordinates(rangeDefinitions[`en:${rangeId}`]), `missing local range definition en:${rangeId}`);
  check(equal(expected, coordinates(rangeDefinitions[`en:${rangeId}`])), `local geometry mismatch for en:${rangeId}`);
  check(coordinates(snapshots.cn.range[rangeId]), `missing CN range definition ${rangeId}`);
  check(equal(expected, coordinates(snapshots.cn.range[rangeId])), `EN/CN geometry mismatch for ${rangeId}`);
  for (const region of Object.values(snapshots)) check(region.character[ownerId], `missing token ${ownerId} in character_table`);
}
for (const [operatorId, ownerId, rangeId] of associatedStateVariants) {
  const record = sourceRecord(operatorId, ownerId);
  check(record.includes(`rangeId: "${rangeId}"`), `wrong associated state rangeId for ${ownerId}`);
  const expected = coordinates(snapshots.en.range[rangeId]);
  check(expected, `missing EN range definition ${rangeId}`);
  check(coordinates(rangeDefinitions[`en:${rangeId}`]), `missing local range definition en:${rangeId}`);
  check(equal(expected, coordinates(rangeDefinitions[`en:${rangeId}`])), `local geometry mismatch for en:${rangeId}`);
  check(coordinates(snapshots.cn.range[rangeId]), `missing CN range definition ${rangeId}`);
  check(equal(expected, coordinates(snapshots.cn.range[rangeId])), `EN/CN geometry mismatch for ${rangeId}`);
}
for (const [operatorId, rangeId] of dollkeepers) {
  const start = source.indexOf(`${operatorId}:`);
  const chunk = start >= 0 ? source.slice(start, start + 1800) : "";
  check(chunk, `missing Dollkeeper ${operatorId}`);
  check(chunk.includes(`rangeId: "${rangeId}"`), `wrong Dollkeeper range for ${operatorId}`);
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
