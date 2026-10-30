import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getTableColumns } from "drizzle-orm";
import { Client } from "pg";

import { gameDataHandbookTableHashes, gameDataRepository, gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { validateOperatorBundle, type OperatorBundle } from "../src/game-data/operator-bundle";
import {
  buildReport,
  compareBundle,
  compareFiles,
  operatorFingerprint,
  pickFingerprintColumns,
  verifyCatalog,
  fingerprintColumns,
  type AppliedMigration,
  type CheckResult,
  type DatasetIndexes,
  type DbBiographyRow,
  type DbOperatorRow,
  type ExpectedDifference,
  type GlobalManifestEntry,
  type MigrationState,
} from "../src/game-data/operator-catalog-verification";
import type { ReleaseDateProvenance } from "../src/game-data/operator-catalog";
import { readDatabaseConfig } from "../src/server/db/config";
import { operatorBiographies, operators } from "../src/server/db/schema";
import { readCatalogDataset } from "./generate-operator-catalog";

// Read-only check of an operator catalog database (Development or Neon) against the repository data.
// Output holds only counts, codes and the fingerprint; no host, user or credential is ever printed.
const statementTimeoutMs = 15_000;
const tables = { operators, operator_biographies: operatorBiographies } as const;
const writePrivileges = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"] as const;

type Options = { bundle?: string; details: boolean; files: boolean; fingerprint?: string };

// Known differences between the catalog files and a database loaded with the earlier importer, which stored provenance
// with other conventions, and the CN dates corrected from the official announcement. Anything else must match.
const officialAnnouncement = "The official announcement (ak.hypergryph.com/news/5101) sets 2026-10-09";
const filesExpectedDifferences: readonly ExpectedDifference[] = [
  { column: "cn_release_date", operators: { char_393_toledo: "2026-10-08", char_4231_clemnt: null, char_4232_hbound: "2026-10-08" }, reason: `${officialAnnouncement}; the database keeps the earlier community-listed date or none` },
  { column: "source_repository", operators: "all", reason: "The earlier importer stored the repository as a full URL" },
  { column: "source_data_version", operators: "all", reason: "The earlier importer stored the game data version instead of the snapshot revision" },
  { column: "cn_source_revision", operators: "global", reason: "The earlier importer also stored the CN revision on Global operators" },
  { column: "regional_metadata_source", operators: "all", reason: "The earlier importer stored the metadata source as plain text" },
];

function parseArguments(argv: readonly string[]): Options | undefined {
  const options: Options = { details: false, files: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--details") options.details = true;
    else if (flag === "--files") options.files = true;
    else if ((flag === "--bundle" || flag === "--fingerprint") && value && !value.startsWith("--")) {
      options[flag === "--bundle" ? "bundle" : "fingerprint"] = value;
      index += 1;
    } else return undefined;
  }
  if (options.fingerprint !== undefined && !/^[0-9a-f]{64}$/iu.test(options.fingerprint)) return undefined;
  return options;
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readIndexes(): Promise<DatasetIndexes> {
  const read = async (name: string) => (await json<{ operators: DatasetIndexes["stats"] }>(`data/operator-${name}/index.json`)).operators;
  return { stats: await read("stats"), skills: await read("skills"), modules: await read("modules") };
}

async function readJournal(): Promise<MigrationState["journal"]> {
  const journal = await json<{ entries: { tag: string; when: number }[] }>("db/migrations/meta/_journal.json");
  return Promise.all(journal.entries.map(async (entry) => ({
    when: entry.when,
    hash: createHash("sha256").update(await readFile(`db/migrations/${entry.tag}.sql`, "utf8")).digest("hex"),
  })));
}

async function readApplied(client: Client): Promise<AppliedMigration[] | { unavailable: string }> {
  await client.query("SAVEPOINT migrations");
  try {
    const { rows } = await client.query("SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id");
    return rows.map((row) => ({ hash: row.hash, createdAt: row.created_at }));
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT migrations");
    return { unavailable: (error as { code?: string }).code ?? "unknown" };
  }
}

async function readPrivileges(client: Client): Promise<Record<string, boolean>> {
  const privileges: Record<string, boolean> = {};
  for (const table of Object.keys(tables)) {
    for (const privilege of writePrivileges) {
      const { rows } = await client.query("SELECT has_table_privilege(current_user, $1, $2) AS granted", [`public.${table}`, privilege]);
      privileges[`${table}.${privilege}`] = rows[0].granted === true;
    }
  }
  return privileges;
}

async function readSchemaColumns(client: Client): Promise<Record<string, string[]>> {
  const { rows } = await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1)", [Object.keys(tables)]);
  const actual: Record<string, string[]> = {};
  for (const row of rows) (actual[row.table_name] ??= []).push(row.column_name);
  return actual;
}

const operatorColumns = "id, name, cn_name, global_name, class_name, sub_class_id, rarity, slug, source_locale, source_repository, source_revision, source_data_version, cn_only, availability_status, cn_release_date::text AS cn_release_date, global_release_date::text AS global_release_date, main_power_nation_id, main_power_group_id, main_power_team_id, main_faction_id, cn_source_revision, regional_metadata_source";
const biographyColumns = "operator_id, region, source_repository, source_revision, source_path, source_sha256";
const biographyBundleColumns = `${biographyColumns}, story_title, original_text, fields, unrecognized_lines, profile_story_title, profile_text`;

async function run(options: Options): Promise<number> {
  const bundle = options.bundle ? (JSON.parse(await readFile(options.bundle, "utf8")) as OperatorBundle) : undefined;
  if (bundle && !validateOperatorBundle(bundle).ok) {
    console.error(JSON.stringify({ status: "error", code: "bundle-invalid" }));
    return 2;
  }
  const releaseManifest = await json<{ operators: GlobalManifestEntry[] }>("data/operator-cn-release-manifest.json");
  const regionalManifest = await json<{ sources: { releaseTable: string }; operators: { id: string; nameEnglish?: string | null; cnReleaseDate: string | null; globalReleaseDate?: string | null; cnReleaseDateProvenance?: ReleaseDateProvenance }[] }>("data/operator-regional-manifest.json");
  const manifests = {
    global: releaseManifest.operators,
    regional: regionalManifest.operators.map((entry) => ({ ...entry, nameEnglish: entry.nameEnglish ?? null, globalReleaseDate: entry.globalReleaseDate ?? null })),
    regionalReleaseSource: regionalManifest.sources.releaseTable,
  };
  const [indexes, journal] = await Promise.all([readIndexes(), readJournal()]);
  const files = options.files ? await readCatalogDataset("data") : undefined;

  const client = new Client({ ...readDatabaseConfig(process.env), connectionTimeoutMillis: 10_000 });
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
    const operatorRows = (await client.query(`SELECT ${operatorColumns} FROM operators ORDER BY id ASC`)).rows as DbOperatorRow[];
    const biographyRows = (await client.query(`SELECT ${bundle || files ? biographyBundleColumns : biographyColumns} FROM operator_biographies ORDER BY operator_id, region, source_revision`)).rows as DbBiographyRow[];
    const fingerprintRows = (await client.query(`SELECT ${fingerprintColumns.join(", ")} FROM operators ORDER BY id ASC`)).rows;
    const state: MigrationState = { journal, applied: await readApplied(client) };
    const privileges = await readPrivileges(client);
    const actualColumns = await readSchemaColumns(client);
    await client.query("ROLLBACK");

    const expectedColumns = Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, Object.values(getTableColumns(table)).map((column) => column.name)]));
    const checks: CheckResult[] = verifyCatalog({
      manifests,
      sources: { repository: gameDataRepository, revisions: gameDataRevisions, handbookHashes: { en: gameDataHandbookTableHashes.en.handbook_info_table, cn: gameDataHandbookTableHashes.cn.handbook_info_table } },
      operators: operatorRows,
      biographies: biographyRows,
      indexes,
      privileges,
      migrations: state,
      schema: { expected: expectedColumns, actual: actualColumns },
    });
    if (bundle) checks.push(compareBundle(bundle, operatorRows, biographyRows));
    if (files) checks.push(compareFiles({ operators: files.catalog.operators, biographies: files.biographies.records }, operatorRows, biographyRows, filesExpectedDifferences));
    const report = buildReport(checks, operatorRows, biographyRows.length, {
      value: operatorFingerprint(fingerprintRows),
      dateTextValue: operatorFingerprint(operatorRows.map(pickFingerprintColumns)),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(options.fingerprint ? { expected: options.fingerprint } : {}),
    }, options.details);
    console.log(JSON.stringify(report, null, 2));
    return report.status === "ok" ? 0 : 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const options = parseArguments(process.argv.slice(2));
if (!options) {
  console.error(JSON.stringify({ status: "error", code: "invalid-arguments" }));
  process.exitCode = 2;
} else {
  run(options).then((code) => { process.exitCode = code; }, (error: { code?: string; message?: string }) => {
    // Configuration errors name only the variable; for driver errors only the short code is reported, since messages can contain the host name.
    const configuration = typeof error.message === "string" && /^(Invalid|Missing) database/.test(error.message);
    console.error(JSON.stringify({ status: "error", code: configuration ? error.message : typeof error.code === "string" ? error.code : "verification-failed" }));
    process.exitCode = 2;
  });
}
