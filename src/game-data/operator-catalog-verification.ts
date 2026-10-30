import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { OperatorBiography } from "./operator-biography";
import type { OperatorBundle } from "./operator-bundle";
import { catalogOperator, legacyRegionalMetadataSource, type CatalogOperator, type ReleaseDateProvenance, type ReleaseDateStatus } from "./operator-catalog";
import { operatorImportSlug } from "./operator-import";
import { getOperatorPublicSlugs } from "./operator-slugs";
import type { OperatorRecord } from "./operators";
import { compareCodeUnits } from "./string-order";

type Region = "en" | "cn";

export type GlobalManifestEntry = Readonly<{ id: string; name: string; cnReleaseDate: string | null; source: string }>;
export type RegionalManifestEntry = Readonly<{ id: string; nameEnglish: string | null; cnReleaseDate: string | null; globalReleaseDate: string | null; cnReleaseDateProvenance?: ReleaseDateProvenance }>;

export type CatalogManifests = Readonly<{
  global: readonly GlobalManifestEntry[];
  globalReleaseStatus: ReleaseDateStatus;
  regional: readonly RegionalManifestEntry[];
  regionalReleaseSource: string;
}>;

export type CatalogSources = Readonly<{
  repository: string;
  revisions: Readonly<Record<Region, string>>;
  handbookHashes: Readonly<Record<Region, string>>;
}>;

export type DbOperatorRow = Readonly<{
  id: string;
  name: string;
  cn_name: string | null;
  global_name: string | null;
  class_name: string;
  sub_class_id: string | null;
  rarity: number;
  slug: string;
  source_locale: string;
  source_repository: string;
  source_revision: string;
  source_data_version: string;
  cn_only: boolean;
  availability_status: string;
  cn_release_date: string | null;
  global_release_date: string | null;
  main_power_nation_id: string | null;
  main_power_group_id: string | null;
  main_power_team_id: string | null;
  main_faction_id: string | null;
  cn_source_revision: string | null;
  regional_metadata_source: string | null;
}>;

export type DbBiographyRow = Readonly<{
  operator_id: string;
  region: string;
  source_repository: string;
  source_revision: string;
  source_path: string;
  source_sha256: string;
  story_title?: string;
  original_text?: string;
  fields?: unknown;
  unrecognized_lines?: unknown;
  profile_story_title?: string | null;
  profile_text?: string | null;
}>;

export type DatasetIndexes = Readonly<Record<"stats" | "skills" | "modules", Readonly<Record<string, Readonly<{ region: string }>>>>>;

export type AppliedMigration = Readonly<{ hash: string; createdAt: string }>;
export type MigrationState = Readonly<{ journal: readonly Readonly<{ when: number; hash: string }>[]; applied: readonly AppliedMigration[] | { unavailable: string } }>;

export type SchemaColumns = Readonly<{ expected: Readonly<Record<string, readonly string[]>>; actual: Readonly<Record<string, readonly string[]>> }>;

export type VerificationInput = Readonly<{
  manifests: CatalogManifests;
  sources: CatalogSources;
  operators: readonly DbOperatorRow[];
  biographies: readonly DbBiographyRow[];
  indexes: DatasetIndexes;
  privileges: Readonly<Record<string, boolean>>;
  migrations: MigrationState;
  schema: SchemaColumns;
}>;

export type CheckStatus = "ok" | "fail" | "unavailable";
export type CheckResult = Readonly<{
  code: string;
  status: CheckStatus;
  checked: number;
  failed: number;
  detail?: Readonly<Record<string, number | string>>;
  failedIds?: readonly string[];
  declared?: readonly Readonly<{ column: string; operators: string; differences: number; reason: string }>[];
  undeclared?: readonly string[];
}>;

const writePrivileges = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;
export const fingerprintColumns = ["id", "name", "cn_name", "global_name", "cn_release_date", "global_release_date", "regional_metadata_source"] as const;

type ExpectedOperator = Readonly<{
  id: string;
  region: Region;
  cnOnly: boolean;
  name: string | null;
  cnReleaseDate: string | null;
  globalReleaseDate: string | null;
  metadataSource: string;
}>;

function result(code: string, checked: number, failedIds: readonly string[], detail?: CheckResult["detail"]): CheckResult {
  return { code, status: failedIds.length === 0 ? "ok" : "fail", checked, failed: failedIds.length, ...(detail ? { detail } : {}), ...(failedIds.length ? { failedIds: [...failedIds].sort(compareCodeUnits) } : {}) };
}

function releaseMetadataSource(status: string, source: string): string {
  return JSON.stringify({ kind: "cn-release", status, source });
}

/** Expected catalog: the global manifest lists the Global operators and the regional manifest the CN-only ones. */
export function buildExpectedCatalog(manifests: CatalogManifests): { operators: Map<string, ExpectedOperator>; duplicates: string[] } {
  const operators = new Map<string, ExpectedOperator>();
  const duplicates: string[] = [];
  const add = (operator: ExpectedOperator) => {
    if (operators.has(operator.id)) duplicates.push(operator.id);
    else operators.set(operator.id, operator);
  };
  for (const entry of manifests.global) {
    add({ id: entry.id, region: "en", cnOnly: false, name: entry.name, cnReleaseDate: entry.cnReleaseDate, globalReleaseDate: null, metadataSource: releaseMetadataSource(manifests.globalReleaseStatus, entry.source) });
  }
  for (const entry of manifests.regional) {
    add({
      id: entry.id,
      region: "cn",
      cnOnly: true,
      name: entry.nameEnglish,
      cnReleaseDate: entry.cnReleaseDate,
      globalReleaseDate: entry.globalReleaseDate,
      metadataSource: entry.cnReleaseDate === null ? legacyRegionalMetadataSource : releaseMetadataSource(entry.cnReleaseDateProvenance?.status ?? "community-listed", entry.cnReleaseDateProvenance?.source ?? manifests.regionalReleaseSource),
    });
  }
  return { operators, duplicates };
}

function checkIds(expected: Map<string, ExpectedOperator>, duplicates: readonly string[], rows: Map<string, DbOperatorRow>): CheckResult {
  const missing = [...expected.keys()].filter((id) => !rows.has(id));
  const extra = [...rows.keys()].filter((id) => !expected.has(id));
  return result("ids", expected.size, [...missing, ...extra, ...duplicates], { missing: missing.length, extra: extra.length, duplicatedInManifests: duplicates.length, database: rows.size });
}

function checkCounts(expected: Map<string, ExpectedOperator>, rows: readonly DbOperatorRow[]): CheckResult {
  const expectedCnOnly = [...expected.values()].filter((item) => item.cnOnly).length;
  const cnOnly = rows.filter((row) => row.cn_only).length;
  const mismatches = [rows.length !== expected.size, cnOnly !== expectedCnOnly, rows.length - cnOnly !== expected.size - expectedCnOnly].filter(Boolean).length;
  return { code: "counts", status: mismatches === 0 ? "ok" : "fail", checked: 3, failed: mismatches, detail: { operators: rows.length, cnOnly, global: rows.length - cnOnly } };
}

function checkRegion(expected: Map<string, ExpectedOperator>, rows: readonly DbOperatorRow[]): CheckResult {
  const failed: string[] = [];
  let checked = 0;
  for (const row of rows) {
    const item = expected.get(row.id);
    if (!item) continue;
    checked += 1;
    if (row.cn_only !== item.cnOnly || row.availability_status !== (item.cnOnly ? "cn-snapshot-candidate" : "global-snapshot") || row.source_locale !== item.region) failed.push(row.id);
  }
  return result("region", checked, failed);
}

function nameForm(row: DbOperatorRow, item: ExpectedOperator): "legacy" | "current" | "invalid" {
  if (row.name !== item.name || !row.name) return "invalid";
  if (row.cn_name === null && row.global_name === null) return "legacy";
  if (item.cnOnly) return row.cn_name && row.global_name === null ? "current" : "invalid";
  return row.cn_name && row.global_name === row.name ? "current" : "invalid";
}

function checkNames(expected: Map<string, ExpectedOperator>, rows: readonly DbOperatorRow[]): CheckResult {
  const failed: string[] = [];
  const forms = { legacy: 0, current: 0, invalid: 0 };
  for (const row of rows) {
    const item = expected.get(row.id);
    if (!item) continue;
    const form = nameForm(row, item);
    forms[form] += 1;
    if (form === "invalid") failed.push(row.id);
  }
  if (forms.legacy > 0 && forms.current > 0) failed.push("mixed-name-forms");
  return result("names", forms.legacy + forms.current + forms.invalid, failed, forms);
}

function checkSlugs(rows: readonly DbOperatorRow[]): CheckResult {
  const failed = rows.filter((row) => row.slug !== operatorImportSlug(row.id)).map((row) => row.id);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.slug)) failed.push(row.id);
    seen.add(row.slug);
  }
  const records = rows.map((row) => ({ id: row.id, name: row.name, cnName: row.cn_name, globalName: row.global_name }) as OperatorRecord);
  const publicSlugs = getOperatorPublicSlugs(records);
  const publicSet = new Set(publicSlugs.values());
  if (publicSet.size !== rows.length) failed.push("public-slugs");
  return result("slug", rows.length, [...new Set(failed)], { publicSlugs: publicSet.size });
}

function checkDates(expected: Map<string, ExpectedOperator>, rows: readonly DbOperatorRow[]): CheckResult {
  const failed: string[] = [];
  let checked = 0;
  for (const row of rows) {
    const item = expected.get(row.id);
    if (!item) continue;
    checked += 1;
    if (row.cn_release_date !== item.cnReleaseDate || row.global_release_date !== item.globalReleaseDate) failed.push(row.id);
  }
  return result("dates", checked, failed);
}

function checkMetadataSource(expected: Map<string, ExpectedOperator>, rows: readonly DbOperatorRow[]): CheckResult {
  const failed: string[] = [];
  const forms = { legacy: 0, detailed: 0 };
  for (const row of rows) {
    const item = expected.get(row.id);
    if (!item) continue;
    if (row.regional_metadata_source === legacyRegionalMetadataSource) forms.legacy += 1;
    else if (row.regional_metadata_source === item.metadataSource) forms.detailed += 1;
    else failed.push(row.id);
  }
  return result("regional-metadata", forms.legacy + forms.detailed + failed.length, failed, forms);
}

function checkRevisions(expected: Map<string, ExpectedOperator>, rows: readonly DbOperatorRow[], sources: CatalogSources): CheckResult {
  const failed: string[] = [];
  let checked = 0;
  for (const row of rows) {
    const item = expected.get(row.id);
    if (!item) continue;
    checked += 1;
    const revision = sources.revisions[item.region];
    const cnRevision = item.cnOnly ? sources.revisions.cn : null;
    if (row.source_revision !== revision || row.source_data_version !== revision || row.cn_source_revision !== cnRevision || row.source_repository !== sources.repository) failed.push(row.id);
  }
  return result("revisions", checked, failed);
}

function checkBiographies(expected: Map<string, ExpectedOperator>, rows: readonly DbBiographyRow[], sources: CatalogSources): CheckResult {
  const failed: string[] = [];
  const keys = new Set<string>();
  const perOperator = new Map<string, number>();
  for (const row of rows) {
    const item = expected.get(row.operator_id);
    const key = `${row.operator_id}\u0000${row.region}`;
    if (!item) failed.push(row.operator_id);
    else if (row.region !== item.region || row.source_revision !== sources.revisions[item.region] || row.source_sha256.toLowerCase() !== sources.handbookHashes[item.region].toLowerCase() || row.source_repository !== sources.repository) failed.push(row.operator_id);
    if (keys.has(key)) failed.push(row.operator_id);
    keys.add(key);
    perOperator.set(row.operator_id, (perOperator.get(row.operator_id) ?? 0) + 1);
  }
  const missing = [...expected.keys()].filter((id) => !perOperator.has(id));
  const multiple = [...perOperator].filter(([, count]) => count > 1).map(([id]) => id);
  return result("biographies", rows.length, [...new Set([...failed, ...missing, ...multiple])], {
    rows: rows.length,
    en: rows.filter((row) => row.region === "en").length,
    cn: rows.filter((row) => row.region === "cn").length,
    missing: missing.length,
  });
}

function checkIndex(name: string, index: Readonly<Record<string, Readonly<{ region: string }>>>, expected: Map<string, ExpectedOperator>): CheckResult {
  const failed = Object.entries(index).filter(([id, entry]) => expected.get(id)?.region !== entry.region).map(([id]) => id);
  return result(`index-${name}`, Object.keys(index).length, failed, { withoutFile: [...expected.keys()].filter((id) => !(id in index)).length });
}

export function checkMigrations(state: MigrationState): CheckResult {
  if ("unavailable" in state.applied) return { code: "migrations", status: "unavailable", checked: state.journal.length, failed: 0, detail: { reason: state.applied.unavailable } };
  const applied = state.applied;
  const failed = state.journal.filter((entry, position) => applied[position]?.hash !== entry.hash || Number(applied[position]?.createdAt) !== entry.when).length + Math.abs(applied.length - state.journal.length);
  return { code: "migrations", status: failed === 0 ? "ok" : "fail", checked: state.journal.length, failed, detail: { journal: state.journal.length, applied: applied.length } };
}

function checkPrivileges(privileges: Readonly<Record<string, boolean>>): CheckResult {
  const granted = Object.entries(privileges).filter(([, value]) => value).map(([key]) => key);
  const checked = ["operators", "operator_biographies"].length * writePrivileges.length;
  return { code: "read-only-role", status: granted.length === 0 ? "ok" : "fail", checked, failed: granted.length, detail: { writePrivileges: granted.length } };
}

function checkSchema(schema: SchemaColumns): CheckResult {
  const tables = Object.keys(schema.expected);
  const failed = tables.filter((table) => !isDeepStrictEqual([...(schema.actual[table] ?? [])].sort(compareCodeUnits), [...schema.expected[table]].sort(compareCodeUnits)));
  return result("schema-columns", tables.length, failed, { tables: tables.length });
}

export function verifyCatalog(input: VerificationInput): CheckResult[] {
  const { operators: expected, duplicates } = buildExpectedCatalog(input.manifests);
  const rows = new Map(input.operators.map((row) => [row.id, row]));
  return [
    checkIds(expected, duplicates, rows),
    checkCounts(expected, input.operators),
    checkRegion(expected, input.operators),
    checkNames(expected, input.operators),
    checkSlugs(input.operators),
    checkDates(expected, input.operators),
    checkMetadataSource(expected, input.operators),
    checkRevisions(expected, input.operators, input.sources),
    checkBiographies(expected, input.biographies, input.sources),
    checkIndex("stats", input.indexes.stats, expected),
    checkIndex("skills", input.indexes.skills, expected),
    checkIndex("modules", input.indexes.modules, expected),
    checkMigrations(input.migrations),
    checkSchema(input.schema),
    checkPrivileges(input.privileges),
  ];
}

/** Fingerprint over the rows exactly as the production fingerprint report serializes them: SHA-256 of JSON.stringify of the rows ordered by id. */
export function operatorFingerprint(rows: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

export function pickFingerprintColumns(row: DbOperatorRow): Record<(typeof fingerprintColumns)[number], unknown> {
  return Object.fromEntries(fingerprintColumns.map((column) => [column, row[column]])) as Record<(typeof fingerprintColumns)[number], unknown>;
}

/** Database row of a catalog operator, without the import timestamp. */
export function catalogOperatorRow(entry: CatalogOperator): DbOperatorRow {
  return {
    id: entry.id,
    name: entry.name,
    cn_name: entry.cnName,
    global_name: entry.globalName,
    class_name: entry.class,
    sub_class_id: entry.subClassId,
    rarity: entry.rarity,
    slug: entry.slug,
    source_locale: entry.sourceLocale,
    source_repository: entry.sourceRepository,
    source_revision: entry.sourceRevision,
    source_data_version: entry.sourceDataVersion,
    cn_only: entry.cnOnly,
    availability_status: entry.availabilityStatus,
    cn_release_date: entry.cnReleaseDate,
    global_release_date: entry.globalReleaseDate,
    main_power_nation_id: entry.mainPowerNationId,
    main_power_group_id: entry.mainPowerGroupId,
    main_power_team_id: entry.mainPowerTeamId,
    main_faction_id: entry.mainFactionId,
    cn_source_revision: entry.cnSourceRevision,
    regional_metadata_source: entry.regionalMetadataSource,
  };
}

/** Expected database row of a bundle operator, without the import timestamp. */
export function bundleOperatorRow(record: OperatorRecord, bundle: Pick<OperatorBundle, "sources">): DbOperatorRow {
  return catalogOperatorRow(catalogOperator(record, bundle.sources));
}

function bundleBiographyRow(record: OperatorBiography): DbBiographyRow {
  return {
    operator_id: record.operatorId,
    region: record.region,
    source_repository: record.source.repository,
    source_revision: record.source.revision,
    source_path: record.source.path,
    source_sha256: record.source.sha256,
    story_title: record.storyTitle,
    original_text: record.originalText,
    fields: record.fields,
    unrecognized_lines: record.unrecognizedLines,
    profile_story_title: record.profile?.storyTitle ?? null,
    profile_text: record.profile?.text ?? null,
  };
}

function differingColumns(expected: object, actual: object): string[] {
  const left = expected as Record<string, unknown>;
  const right = actual as Record<string, unknown>;
  return Object.keys(left).filter((key) => !isDeepStrictEqual(JSON.parse(JSON.stringify(left[key] ?? null)), JSON.parse(JSON.stringify(right[key] ?? null))));
}

/** A differing column of one row; `actual` is the stored value, used only to match declarations and never printed. */
type RowDifference = Readonly<{ id: string; column: string; cnOnly: boolean | null; actual: unknown }>;

function rowDifferences(expectedOperators: readonly DbOperatorRow[], expectedBiographies: readonly DbBiographyRow[], operators: readonly DbOperatorRow[], biographies: readonly DbBiographyRow[]): RowDifference[] {
  const differences: RowDifference[] = [];
  const rows = new Map(operators.map((row) => [row.id, row]));
  for (const expected of expectedOperators) {
    const row = rows.get(expected.id);
    if (!row) differences.push({ id: expected.id, column: "missing-operator", cnOnly: expected.cn_only, actual: null });
    else for (const column of differingColumns(expected, row)) differences.push({ id: expected.id, column, cnOnly: expected.cn_only, actual: (row as Record<string, unknown>)[column] ?? null });
  }
  const ids = new Set(expectedOperators.map((row) => row.id));
  for (const row of operators) if (!ids.has(row.id)) differences.push({ id: row.id, column: "extra-operator", cnOnly: null, actual: null });

  const key = (row: DbBiographyRow) => `${row.operator_id}\u0000${row.region}\u0000${row.source_revision}`;
  const stored = new Map(biographies.map((row) => [key(row), row]));
  for (const expected of expectedBiographies) {
    const row = stored.get(key(expected));
    if (!row) differences.push({ id: expected.operator_id, column: "missing-biography", cnOnly: null, actual: null });
    else for (const column of differingColumns(expected, row)) differences.push({ id: expected.operator_id, column: `biography.${column}`, cnOnly: null, actual: null });
  }
  const expectedKeys = new Set(expectedBiographies.map(key));
  for (const [rowKey, row] of stored) if (!expectedKeys.has(rowKey)) differences.push({ id: row.operator_id, column: "extra-biography", cnOnly: null, actual: null });
  return differences;
}

function columnCounts(differences: readonly RowDifference[]): Record<string, number> {
  const columns: Record<string, number> = {};
  for (const difference of differences) columns[difference.column] = (columns[difference.column] ?? 0) + 1;
  return Object.fromEntries(Object.entries(columns).sort(([a], [b]) => a.localeCompare(b, "en")));
}

/** Field-by-field comparison with the bundle that was imported: differing columns are counted, never printed. */
export function compareBundle(bundle: Pick<OperatorBundle, "sources" | "operators" | "biographies">, operators: readonly DbOperatorRow[], biographies: readonly DbBiographyRow[]): CheckResult {
  const differences = rowDifferences(bundle.operators.map((record) => bundleOperatorRow(record, bundle)), bundle.biographies.map(bundleBiographyRow), operators, biographies);
  const failed = new Set(differences.map((difference) => difference.id));
  return { code: "bundle", status: failed.size === 0 ? "ok" : "fail", checked: bundle.operators.length + bundle.biographies.length, failed: failed.size, detail: { operators: bundle.operators.length, biographies: bundle.biographies.length, ...columnCounts(differences) }, ...(failed.size ? { failedIds: [...failed].sort(compareCodeUnits) } : {}) };
}

/**
 * A difference between the files and the database that is known and accepted, with its reason. It covers one operator
 * column for every operator, for the Global operators, or for listed operators whose stored value must be the one given.
 */
export type ExpectedDifference = Readonly<{ column: keyof DbOperatorRow; reason: string; operators: "all" | "global" | Readonly<Record<string, unknown>> }>;

const undeclaredLimit = 50;

function declares(expected: ExpectedDifference, difference: RowDifference): boolean {
  if (expected.column !== difference.column) return false;
  if (expected.operators === "all") return true;
  if (expected.operators === "global") return difference.cnOnly === false;
  return Object.hasOwn(expected.operators, difference.id) && isDeepStrictEqual(expected.operators[difference.id], difference.actual);
}

/**
 * Column-by-column comparison of the catalog and biography files with the database, including complete biographies and
 * missing or extra rows. Every difference must be declared; the report lists the count per column and each undeclared
 * difference as "id column", never a value.
 */
export function compareFiles(files: Readonly<{ operators: readonly CatalogOperator[]; biographies: readonly OperatorBiography[] }>, operators: readonly DbOperatorRow[], biographies: readonly DbBiographyRow[], expected: readonly ExpectedDifference[]): CheckResult {
  const differences = rowDifferences(files.operators.map(catalogOperatorRow), files.biographies.map(bundleBiographyRow), operators, biographies);
  const declared = expected.map(() => 0);
  const undeclared: string[] = [];
  for (const difference of differences) {
    const match = expected.findIndex((item) => declares(item, difference));
    if (match >= 0) declared[match]! += 1;
    else undeclared.push(`${difference.id} ${difference.column}`);
  }
  undeclared.sort((a, b) => a.localeCompare(b, "en"));
  return {
    code: "files",
    status: undeclared.length === 0 ? "ok" : "fail",
    checked: files.operators.length + files.biographies.length,
    failed: undeclared.length,
    detail: { operators: files.operators.length, biographies: files.biographies.length, ...columnCounts(differences) },
    declared: expected.map((item, position) => ({ column: item.column, operators: typeof item.operators === "string" ? item.operators : Object.keys(item.operators).sort(compareCodeUnits).join(", "), differences: declared[position]!, reason: item.reason })),
    undeclared: undeclared.slice(0, undeclaredLimit),
  };
}

export type VerificationReport = Readonly<{
  status: "ok" | "fail";
  counts: Readonly<{ operators: number; cnOnly: number; biographies: number }>;
  checks: readonly CheckResult[];
  fingerprint: Readonly<{ algorithm: "sha256"; columns: readonly string[]; order: "id ASC"; operatorCount: number; value: string; dateTextValue: string; timeZone: string; comparison: "match" | "mismatch" | "not-compared" }>;
}>;

export function buildReport(checks: readonly CheckResult[], operators: readonly DbOperatorRow[], biographies: number, fingerprint: { value: string; dateTextValue: string; timeZone: string; expected?: string }, details: boolean): VerificationReport {
  return {
    status: checks.some((check) => check.status === "fail") ? "fail" : "ok",
    counts: { operators: operators.length, cnOnly: operators.filter((row) => row.cn_only).length, biographies },
    checks: checks.map((check) => {
      if (details) return check;
      const copy: { -readonly [K in keyof CheckResult]: CheckResult[K] } = { ...check };
      delete copy.failedIds;
      return copy;
    }),
    fingerprint: {
      algorithm: "sha256",
      columns: fingerprintColumns,
      order: "id ASC",
      operatorCount: operators.length,
      value: fingerprint.value,
      dateTextValue: fingerprint.dateTextValue,
      timeZone: fingerprint.timeZone,
      comparison: fingerprint.expected === undefined ? "not-compared" : fingerprint.expected.toLowerCase() === fingerprint.value ? "match" : "mismatch",
    },
  };
}
