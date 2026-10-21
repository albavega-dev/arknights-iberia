import { validateOperatorBundle, type OperatorBundle } from "../../game-data/operator-bundle";
import { Pool } from "pg";

export type LocalImportConfig = Readonly<{ host: string; port: number; database: string; user: string; password: string }>;
export type ImportCounts = Readonly<{ inserted: number; updated: number; unchanged: number; skipped: number }>;
export type ImportPlan = Readonly<{ operators: number; biographies: number; counts: ImportCounts }>;
export type ImportTransaction = Readonly<{ upsertOperators: (records: readonly OperatorBundle["operators"][number][]) => Promise<ImportCounts>; upsertBiographies: (records: readonly OperatorBundle["biographies"][number][]) => Promise<ImportCounts>; commit: () => Promise<void>; rollback: () => Promise<void> }>;
export type ImportAdapter = Readonly<{ begin: () => Promise<ImportTransaction> }>;

export type LocalImportEnvironment = Readonly<Record<string, string | undefined>>;

export function readLocalImportConfig(env: LocalImportEnvironment): LocalImportConfig {
  const forbidden = ["DATABASE_URL", "POSTGRES_URL", "DB_CONNECTION_MODE", "DB_HOST", "DB_PORT", "APP_DB_USER", "APP_DB_PASSWORD", "MIGRATION_DB_USER", "MIGRATION_DB_PASSWORD"];
  if (forbidden.some((key) => env[key])) throw new Error("Import configuration must use IMPORT_DB_* variables only");
  const host = env.IMPORT_DB_HOST; const port = Number(env.IMPORT_DB_PORT ?? "5432"); const database = env.IMPORT_DB_NAME; const user = env.IMPORT_DB_USER; const password = env.IMPORT_DB_PASSWORD;
  assertLocalImportTarget({ host, port, database, user, password });
  if (!host || !database || !user || !password) throw new Error("Local import requires explicit configuration");
  return { host, port, database, user, password };
}

export function assertLocalImportTarget(config: Partial<LocalImportConfig>): asserts config is LocalImportConfig {
  if (!config.host || !["localhost", "127.0.0.1", "::1"].includes(config.host)) throw new Error("Import target must be localhost, 127.0.0.1 or ::1");
  const port = config.port; if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Import target port is invalid");
  if (!config.database || !config.user || !config.password) throw new Error("Local import requires explicit database, user and password");
}

export function prepareBundleImport(value: unknown): { bundle: OperatorBundle; plan: ImportPlan } {
  const result = validateOperatorBundle(value);
  if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.path || "bundle"}: ${entry.message}`).join("; "));
  const bundle = value as OperatorBundle;
  return { bundle, plan: { operators: bundle.operators.length, biographies: bundle.biographies.length, counts: { inserted: 0, updated: 0, unchanged: 0, skipped: 0 } } };
}

export async function importBundle(value: unknown, adapter: ImportAdapter, confirmed: boolean): Promise<ImportPlan> {
  if (!confirmed) throw new Error("Import requires explicit confirmation");
  const prepared = prepareBundleImport(value); const transaction = await adapter.begin();
  try {
    const operators = await transaction.upsertOperators(prepared.bundle.operators);
    const biographies = await transaction.upsertBiographies(prepared.bundle.biographies);
    await transaction.commit();
    return { ...prepared.plan, counts: { inserted: operators.inserted + biographies.inserted, updated: operators.updated + biographies.updated, unchanged: operators.unchanged + biographies.unchanged, skipped: operators.skipped + biographies.skipped } };
  } catch (error) { await transaction.rollback(); throw error; }
}

export function operatorValues(record: OperatorBundle["operators"][number], bundle: OperatorBundle) {
  const source = record.cnOnly ? bundle.sources.cn : bundle.sources.en;
  const regionalMetadataSource = record.cnReleaseDateSource
    ? JSON.stringify({ kind: "cn-release", status: record.cnReleaseDateStatus ?? "unclassified", source: record.cnReleaseDateSource })
    : "bundle-v1";
  return [record.id, record.name, record.cnName ?? null, record.globalName ?? null, record.class, record.subClassId, record.rarity, record.slug, record.cnOnly ? "cn" : "en", source.repository, source.revision, source.revision, record.cnOnly, record.availabilityStatus, record.cnReleaseDate, record.globalReleaseDate, record.mainPowerNationId, record.mainPowerGroupId, record.mainPowerTeamId, record.mainFactionId, record.cnOnly ? source.revision : null, regionalMetadataSource, new Date()];
}

function biographyValues(record: OperatorBundle["biographies"][number]) {
  return [record.operatorId, record.region, record.source.repository, record.source.revision, record.source.path, record.source.sha256, record.storyTitle, record.originalText, JSON.stringify(record.fields), JSON.stringify(record.unrecognizedLines), record.profile?.storyTitle ?? null, record.profile?.text ?? null, new Date()];
}

export function assertRegionalMetadataCompatible(existing: string | null | undefined, incoming: string): void {
  if (existing && existing !== incoming) throw new Error("Existing regional metadata conflicts with the CN release metadata");
}

export function createPostgresLocalImportAdapter(config: LocalImportConfig, bundle: OperatorBundle): ImportAdapter {
  assertLocalImportTarget(config);
  const pool = new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, max: 1, connectionTimeoutMillis: 3000 });
  return { begin: async () => {
    const client = await pool.connect(); await client.query("BEGIN");
    const finish = async (commit: boolean) => { try { await client.query(commit ? "COMMIT" : "ROLLBACK"); } finally { client.release(); await pool.end(); } };
    return {
      upsertOperators: async (records) => { let inserted = 0; let updated = 0; const unchanged = 0; for (const record of records) { const values = operatorValues(record, bundle); const before = await client.query("SELECT id, regional_metadata_source FROM operators WHERE id = $1", [record.id]); if (before.rowCount) assertRegionalMetadataCompatible(before.rows[0].regional_metadata_source, values[21] as string); await client.query("INSERT INTO operators (id,name,cn_name,global_name,class_name,sub_class_id,rarity,slug,source_locale,source_repository,source_revision,source_data_version,cn_only,availability_status,cn_release_date,global_release_date,main_power_nation_id,main_power_group_id,main_power_team_id,main_faction_id,cn_source_revision,regional_metadata_source,imported_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,cn_name=EXCLUDED.cn_name,global_name=EXCLUDED.global_name,class_name=EXCLUDED.class_name,sub_class_id=EXCLUDED.sub_class_id,rarity=EXCLUDED.rarity,slug=EXCLUDED.slug,source_locale=EXCLUDED.source_locale,source_repository=EXCLUDED.source_repository,source_revision=EXCLUDED.source_revision,source_data_version=EXCLUDED.source_data_version,cn_only=EXCLUDED.cn_only,availability_status=EXCLUDED.availability_status,cn_release_date=EXCLUDED.cn_release_date,global_release_date=EXCLUDED.global_release_date,main_power_nation_id=EXCLUDED.main_power_nation_id,main_power_group_id=EXCLUDED.main_power_group_id,main_power_team_id=EXCLUDED.main_power_team_id,main_faction_id=EXCLUDED.main_faction_id,cn_source_revision=EXCLUDED.cn_source_revision,regional_metadata_source=EXCLUDED.regional_metadata_source,imported_at=EXCLUDED.imported_at", values); if (before.rowCount) updated++; else inserted++; } return { inserted, updated, unchanged, skipped: 0 }; },
      upsertBiographies: async (records) => { let inserted = 0; let updated = 0; const unchanged = 0; for (const record of records) { const before = await client.query("SELECT operator_id FROM operator_biographies WHERE operator_id=$1 AND region=$2 AND source_revision=$3", [record.operatorId, record.region, record.source.revision]); await client.query("INSERT INTO operator_biographies (operator_id,region,source_repository,source_revision,source_path,source_sha256,story_title,original_text,fields,unrecognized_lines,profile_story_title,profile_text,imported_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13) ON CONFLICT (operator_id,region,source_revision) DO UPDATE SET source_repository=EXCLUDED.source_repository,source_path=EXCLUDED.source_path,source_sha256=EXCLUDED.source_sha256,story_title=EXCLUDED.story_title,original_text=EXCLUDED.original_text,fields=EXCLUDED.fields,unrecognized_lines=EXCLUDED.unrecognized_lines,profile_story_title=EXCLUDED.profile_story_title,profile_text=EXCLUDED.profile_text,imported_at=EXCLUDED.imported_at", biographyValues(record)); if (before.rowCount) updated++; else inserted++; } return { inserted, updated, unchanged, skipped: 0 }; },
      commit: () => finish(true), rollback: () => finish(false),
    } as ImportTransaction;
  } };
}
