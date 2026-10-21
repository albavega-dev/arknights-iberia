import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeCharacterTable, normalizeOperator } from "../src/game-data/operator-import";
import { filterOperators, getOperatorDisplayName, sortOperators } from "../src/game-data/operators";
import { getOperatorPortraitAsset, getOperatorSubclassIconUrl } from "../src/game-data/operator-assets";
import { mergeCnReleaseDate } from "../src/game-data/release-date";
import { buildNameDryRun } from "../scripts/dry-run-operator-names";
import { applyRegionalDisplayNames } from "../src/game-data/operator-regional-names";
import { buildNameProposals, validateKnownLegacyCnNames, validateNameBackfill } from "../scripts/backfill-operator-names";

const record = (overrides: Record<string, unknown> = {}) => ({
  name: "Irene",
  profession: "WARRIOR",
  subProfessionId: "swordmaster",
  rarity: "TIER_6",
  isNotObtainable: false,
  phases: [{}],
  ...overrides,
});

test("normalizes English source fields without translating game terminology", () => {
  assert.deepEqual(normalizeOperator("char_1023_ghost2", record()), {
    sourceId: "char_1023_ghost2",
    id: "char_1023_ghost2",
    name: "Irene",
    cnName: null,
    globalName: null,
    class: "Guard",
    subClassId: "swordmaster",
    rarity: 6,
    slug: "operator-char-1023-ghost2",
    cnOnly: false,
    availabilityStatus: "global-snapshot",
    cnReleaseDate: null,
    globalReleaseDate: null,
    mainPowerNationId: null,
    mainPowerGroupId: null,
    mainPowerTeamId: null,
    mainFactionId: null,
    hasSubPower: false,
  });
});

test("excludes auxiliary, unavailable and malformed records", () => {
  const result = normalizeCharacterTable({
    char_good: record(),
    token_bad: record(),
    char_unavailable: record({ isNotObtainable: true }),
    char_malformed: record({ profession: "UNKNOWN" }),
  });
  assert.equal(result.operators.length, 1);
  assert.equal(result.skipped, 3);
});

test("filters imported records without mutating them", () => {
  const records = [
    { ...normalizeOperator("char_one", record())!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
    { ...normalizeOperator("char_two", record({ name: "Lumen", profession: "MEDIC", rarity: "TIER_6" }))!, cnOnly: true, availabilityStatus: "cn-snapshot-candidate" as const, cnReleaseDate: "2026-07-01", globalReleaseDate: null },
  ];
  assert.deepEqual(filterOperators(records, { query: "lumen", className: "Medic", subClassIds: ["swordmaster"], rarities: [6], includeCnOnly: true, mainFactionId: "all" }).map((item) => item.id), ["char_two"]);
  assert.equal(filterOperators(records, { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: false, mainFactionId: "all" }).length, 1);
  assert.equal(records.length, 2);
});

test("preserves regional names and searches both names without changing identity", () => {
  const operator = { ...normalizeOperator("char_regional", record({ name: "Global Name" }))!, cnName: "CN Name", globalName: "Global Name", name: "Global Name" };
  assert.equal(getOperatorDisplayName(operator), "Global Name");
  assert.deepEqual(filterOperators([operator], { query: "cn name", className: null, subClassIds: [], rarities: [], includeCnOnly: true, mainFactionId: "all" }).map((item) => item.id), ["char_regional"]);
  assert.equal(operator.id, "char_regional");
  assert.equal(operator.slug, "operator-char-regional");
});

test("keeps the primary English name visible while retaining Chinese search", () => {
  const operator = { ...normalizeOperator("char_cn", record({ name: "English Name" }))!, cnName: "中文名称", globalName: null };
  assert.equal(getOperatorDisplayName(operator), "English Name");
  assert.deepEqual(filterOperators([operator], { query: "中文", className: null, subClassIds: [], rarities: [], includeCnOnly: true, mainFactionId: "all" }).map((item) => item.id), ["char_cn"]);
  assert.doesNotThrow(() => validateKnownLegacyCnNames([{ id: "char_cn", name: "English Name", slug: "char-cn", cn_only: true, availability_status: "cn-snapshot-candidate", cn_name: "Legacy English", global_name: null }], { operators: [{ id: "char_cn", nameEnglish: "Legacy English" }] }));
  assert.throws(() => validateKnownLegacyCnNames([{ id: "char_cn", name: "English Name", slug: "char-cn", cn_only: true, availability_status: "cn-snapshot-candidate", cn_name: "Unexpected", global_name: null }], { operators: [{ id: "char_cn", nameEnglish: "Legacy English" }] }));
});

test("name dry-run reports regional proposals, missing IDs and visible changes", () => {
  const report = buildNameDryRun(
    [
      { id: "char_global", name: "Old Name", cn_name: "CN Name", global_name: null },
      { id: "char_cn", name: "CN Only", cn_name: null, global_name: null },
      { id: "char_missing", name: "Unclassified", cn_name: null, global_name: null },
    ],
    {
      char_global: record({ name: "Global Name" }),
      char_cn: record({ name: "CN Source Name" }),
    },
    { char_global: record({ name: "Nombre CN" }), char_cn: record({ name: "Nombre CN-only" }) },
    { comparison: { cn: { revision: "cn-test" } }, operators: [{ id: "char_cn", nameEnglish: "CN Manifest Name" }] },
    { repository: "https://example.test", enRevision: "en-test", cnRevision: "cn-test", enSnapshot: "en.json", cnSnapshot: "cn.json", regionalManifest: "regional.json" },
  );
  assert.equal(report.totals.current, 3);
  assert.equal(report.totals.changes, 1);
  assert.equal(report.totals.missing, 1);
  assert.equal(report.totals.conflicts, 1);
  assert.equal(report.rows.find((row) => row.id === "char_global")?.visibleAfter, "Global Name");
  assert.equal(report.rows.find((row) => row.id === "char_cn")?.proposedCnName, "Nombre CN-only");
  assert.equal(report.rows.find((row) => row.id === "char_cn")?.status, "change");
});

test("name backfill validates complete, non-conflicting proposals and rejects conflicts", () => {
  const en = Object.fromEntries(Array.from({ length: 415 }, (_, index) => [`char_${index}`, record({ name: `Global ${index}` })]));
  const regional = { operators: Array.from({ length: 17 }, (_, index) => ({ id: `cn_${index}`, nameEnglish: `CN ${index}` })) };
  const cn = Object.fromEntries(Array.from({ length: 432 }, (_, index) => [`char_${index}`, record({ name: `CN ${index}` })]));
  const proposals = buildNameProposals(en, cn, regional);
  assert.equal(proposals.length, 432);
  validateNameBackfill(proposals.map((proposal) => ({ id: proposal.id, name: proposal.globalName ?? proposal.cnName!, slug: proposal.id, cn_only: Boolean(proposal.cnName), availability_status: "global-snapshot", cn_name: null, global_name: null })), proposals);
  assert.throws(() => validateNameBackfill([{ id: proposals[0].id, name: "x", slug: "x", cn_only: false, availability_status: "global-snapshot", cn_name: "wrong", global_name: null }], proposals), /Expected 432/);
});

test("uses OR within multi-select archetype and rarity groups", () => {
  const records = [
    { ...normalizeOperator("char_lord", record({ name: "Lord", subProfessionId: "lord", rarity: "TIER_5" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
    { ...normalizeOperator("char_dreadnought", record({ name: "Dreadnought", subProfessionId: "dreadnought", rarity: "TIER_6" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
  ];
  assert.deepEqual(filterOperators(records, { query: "", className: "Guard", subClassIds: ["lord", "dreadnought"], rarities: [5, 6], includeCnOnly: false, mainFactionId: "all" }).map((item) => item.id), ["char_lord", "char_dreadnought"]);
});

test("filters only by an explicitly assigned main faction", () => {
  const records = [
    { ...normalizeOperator("char_rhodes", record())!, mainFactionId: "rhodes-island", cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
    { ...normalizeOperator("char_laterano", record({ name: "Exusiai" }))!, mainFactionId: "laterano", cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
  ];
  assert.deepEqual(filterOperators(records, { query: "", className: null, subClassIds: [], rarities: [], includeCnOnly: true, mainFactionId: "rhodes-island" }).map((item) => item.id), ["char_rhodes"]);
});

test("Terra Wiki faction manifest has stable unique assignments", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/operator-faction-manifest.json", import.meta.url), "utf8")) as { operators: Array<{ id: string; mainFactionId: string | null }>; factions: Array<{ id: string; name: string }>; policy: { pendingManualReview: string[] } };
  assert.equal(manifest.operators.length, 432);
  assert.equal(manifest.operators.filter((operator) => operator.mainFactionId !== null).length, 430);
  assert.equal(new Set(manifest.operators.map((operator) => operator.id)).size, 432);
  assert.equal(new Set(manifest.factions.map((faction) => faction.id)).size, 45);
  assert.deepEqual(manifest.policy.pendingManualReview.sort(), ["char_4000_jnight", "char_4218_aigis"]);
});

test("filters by subclass and resolves its verified icon path", () => {
  const records = [
    { ...normalizeOperator("char_guard", record({ subProfessionId: "swordmaster" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
    { ...normalizeOperator("char_medic", record({ profession: "MEDIC", subProfessionId: "physician" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
  ];
  assert.deepEqual(filterOperators(records, { query: "", className: "Guard", subClassIds: ["swordmaster"], rarities: [], includeCnOnly: true, mainFactionId: "all" }).map((item) => item.id), ["char_guard"]);
  assert.equal(getOperatorSubclassIconUrl("swordmaster"), "https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/main/ui/subclass/sub_swordmaster_icon.png");
  assert.equal(getOperatorSubclassIconUrl(null), null);
});

test("sorts by date with unknown values last in either direction", () => {
  const records = [
    { ...normalizeOperator("char_late", record({ name: "Late" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2026-09-01", globalReleaseDate: null },
    { ...normalizeOperator("char_unknown", record({ name: "Unknown" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: "2026-01-01" },
    { ...normalizeOperator("char_early", record({ name: "Early" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2026-01-01", globalReleaseDate: null },
  ];
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc").map((item) => item.id), ["char_late", "char_early", "char_unknown"]);
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "asc").map((item) => item.id), ["char_early", "char_late", "char_unknown"]);
});

test("uses the documented community-listed English names for all CN-only operators", async () => {
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile("data/operator-regional-manifest.json", "utf8")) as { operators: { id: string; nameEnglish: string }[] };
  const records = manifest.operators.map((entry) => ({
    ...normalizeOperator(entry.id, record({ name: `中文 ${entry.id}` }))!,
    name: `中文 ${entry.id}`,
    cnName: `中文 ${entry.id}`,
    cnOnly: true,
    availabilityStatus: "cn-snapshot-candidate" as const,
  }));
  const named = applyRegionalDisplayNames(records, manifest.operators);
  assert.equal(named.length, 17);
  assert.deepEqual(named.map((operator) => operator.name), manifest.operators.map((entry) => entry.nameEnglish));
  assert.equal(named.find((operator) => operator.id === "char_4231_clemnt")?.name, "Clementia");
  assert.equal(named.find((operator) => operator.id === "char_4231_clemnt")?.cnName, "中文 char_4231_clemnt");
});

test("places unknown CN dates first only for the default catalog order", () => {
  const records = [
    { ...normalizeOperator("char_dated", record({ name: "Dated" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2026-01-01", globalReleaseDate: null },
    { ...normalizeOperator("char_clementia", record({ name: "Clementia" }))!, cnOnly: true, availabilityStatus: "cn-snapshot-candidate" as const, cnReleaseDate: null, globalReleaseDate: null },
  ];
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc", false, true).map((item) => item.id), ["char_clementia", "char_dated"]);
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc").map((item) => item.id), ["char_dated", "char_clementia"]);
});

test("keeps descending CN dates after placing unknown values first", () => {
  const records = [
    { ...normalizeOperator("char_unknown_first", record({ name: "Zulu", rarity: "TIER_5" }))!, cnOnly: true, availabilityStatus: "cn-snapshot-candidate" as const, cnReleaseDate: null, globalReleaseDate: null },
    { ...normalizeOperator("char_new", record({ name: "Newest", rarity: "TIER_4" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2026-09-01", globalReleaseDate: null },
    { ...normalizeOperator("char_same_b", record({ name: "Beta", rarity: "TIER_6" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2026-01-01", globalReleaseDate: null },
    { ...normalizeOperator("char_same_a", record({ name: "Alpha", rarity: "TIER_6" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2026-01-01", globalReleaseDate: null },
    { ...normalizeOperator("char_old", record({ name: "Old", rarity: "TIER_6" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2025-01-01", globalReleaseDate: null },
  ];
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc", false, true).map((item) => item.id), [
    "char_unknown_first",
    "char_new",
    "char_same_a",
    "char_same_b",
    "char_old",
  ]);
});

test("keeps rarity descending for equal release dates in both directions", () => {
  const records = [
    { ...normalizeOperator("char_low", record({ name: "Alpha", rarity: "TIER_4" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2024-01-01", globalReleaseDate: null },
    { ...normalizeOperator("char_high", record({ name: "Zulu", rarity: "TIER_6" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2024-01-01", globalReleaseDate: null },
    { ...normalizeOperator("char_same", record({ name: "Beta", rarity: "TIER_6" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2024-01-01", globalReleaseDate: null },
  ];
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc").map((item) => item.id), ["char_same", "char_high", "char_low"]);
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "asc").map((item) => item.id), ["char_same", "char_high", "char_low"]);
});

test("uses name and id as stable tie-breakers for CN release sorting", () => {
  const records = [
    { ...normalizeOperator("char_zeta", record({ name: "Same", rarity: "TIER_5" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2024-01-01", globalReleaseDate: null },
    { ...normalizeOperator("char_alpha", record({ name: "Same", rarity: "TIER_5" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2024-01-01", globalReleaseDate: null },
    { ...normalizeOperator("char_rare", record({ name: "Earlier name", rarity: "TIER_6" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2024-01-01", globalReleaseDate: null },
  ];
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc").map((item) => item.id), ["char_rare", "char_alpha", "char_zeta"]);
});

test("preserves a verified date when ordinary input is null or missing", () => {
  assert.equal(mergeCnReleaseDate("2024-01-01", null), "2024-01-01");
  assert.equal(mergeCnReleaseDate("2024-01-01", undefined), "2024-01-01");
  assert.equal(mergeCnReleaseDate(null, "2025-01-01"), "2025-01-01");
  assert.equal(mergeCnReleaseDate("2024-01-01", null, true), null);
});

test("places dated global records before undated global records", () => {
  const records = [
    { ...normalizeOperator("char_unknown_global", record({ name: "Unknown Global" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null },
    { ...normalizeOperator("char_dated_global", record({ name: "Dated Global" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: "2020-01-01" },
  ];
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc").map((item) => item.id), ["char_dated_global", "char_unknown_global"]);
});

test("prioritizes CN-only records before Global records only for date sorting", () => {
  const records = [
    { ...normalizeOperator("char_global", record({ name: "Global" }))!, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: "2026-01-01", globalReleaseDate: "2026-01-01" },
    { ...normalizeOperator("char_cn", record({ name: "CN" }))!, cnOnly: true, availabilityStatus: "cn-snapshot-candidate" as const, cnReleaseDate: "2025-01-01", globalReleaseDate: null },
  ];
  assert.deepEqual(sortOperators(records, "cnReleaseDate", "desc", true).map((item) => item.id), ["char_cn", "char_global"]);
  assert.deepEqual(sortOperators(records, "rarity", "desc", true).map((item) => item.id), ["char_global", "char_cn"]);
});

test("resolves verified portraits by original operator ID and preserves fallback", () => {
  const irene = getOperatorPortraitAsset("char_4009_irene");
  assert.ok(irene);
  assert.equal(irene.url, "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_4009_irene.png");
  assert.equal(getOperatorPortraitAsset("operator-char-4009-irene"), null);
  assert.equal(getOperatorPortraitAsset("char_4231_clemnt")?.url, "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_4231_clemnt.png");
  assert.equal(getOperatorPortraitAsset("char_4217_makoto")?.url, "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_4217_makoto.png");
  assert.equal(getOperatorPortraitAsset("char_4235_thumpy")?.url, "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_4235_thumpy.png");
  assert.equal(getOperatorPortraitAsset("char_4051_akkord")?.url, "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_4051_akkord.png");
  assert.equal(getOperatorPortraitAsset("char_1015_aglna2")?.url, "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_1015_aglna2.png");
  assert.equal(getOperatorPortraitAsset("char_2027_wang")?.url, "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_2027_wang.png");
});
