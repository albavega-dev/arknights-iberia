import type {
  BiographyRepositoryTransaction,
  BiographyStorageAdapter,
  BiographyStorageKey,
  StoredBiography,
} from "./operator-biography-repository";
import type { BiographyRegion, OperatorBiography } from "../../game-data/operator-biography";

export const BIOGRAPHY_IMPORT_LOCK_KEY = 7_182_041_003;

export type BiographyQueryResult<Row> = {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
};

export type BiographyPostgresClient = {
  readonly query: <Row = Record<string, unknown>>(text: string, values?: readonly unknown[]) => Promise<BiographyQueryResult<Row>>;
  readonly release: () => void;
};

export type BiographyPostgresClientSource = {
  readonly acquire: () => Promise<BiographyPostgresClient>;
};

export class BiographyPostgresAdapterError extends Error {
  constructor(readonly code: "query-failed" | "commit-failed" | "rollback-failed", readonly phase: string, readonly sqlState?: string) {
    super(`Biography PostgreSQL adapter failed during ${phase}`);
    this.name = "BiographyPostgresAdapterError";
  }
}

const allowedSqlStates = new Set(["23503", "23505", "40001", "40P01", "42501", "57014"]);

function safeSqlState(error: unknown): string | undefined {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && allowedSqlStates.has(code) ? code : undefined;
}

function mapStored(row: Record<string, unknown>): StoredBiography {
  return {
    operatorId: String(row.operator_id),
    region: row.region as BiographyRegion,
    storyTitle: String(row.story_title),
    source: {
      repository: String(row.source_repository),
      revision: String(row.source_revision),
      path: String(row.source_path),
      sha256: String(row.source_sha256),
    },
    fields: row.fields as StoredBiography["fields"],
    originalText: String(row.original_text),
    unrecognizedLines: row.unrecognized_lines as readonly string[],
    profile: row.profile_text === null || row.profile_text === undefined ? null : { storyTitle: String(row.profile_story_title), text: String(row.profile_text) },
    importedAt: String(row.imported_at),
  };
}

function insertValues(record: OperatorBiography): readonly unknown[] {
  return [
    record.operatorId,
    record.region,
    record.source.repository,
    record.source.revision,
    record.source.path,
    record.source.sha256,
    record.storyTitle,
    record.originalText,
    JSON.stringify(record.fields),
    JSON.stringify(record.unrecognizedLines),
    record.profile?.storyTitle ?? null,
    record.profile?.text ?? null,
  ];
}

function keyOf(value: BiographyStorageKey): string {
  return `${value.operatorId}\u0000${value.region}\u0000${value.sourceRevision}`;
}

export function createBiographyPostgresAdapter(source: BiographyPostgresClientSource): BiographyStorageAdapter {
  return {
    transaction: async <T>(work: (transaction: BiographyRepositoryTransaction) => Promise<T>): Promise<T> => {
      const client = await source.acquire();
      let committed = false;
      let rollbackAttempted = false;
      try {
        try {
          await client.query("BEGIN");
          await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
        } catch (error) {
          throw new BiographyPostgresAdapterError("query-failed", "begin", safeSqlState(error));
        }
        const transaction: BiographyRepositoryTransaction = {
          acquireImportLock: async () => {
            try {
              await client.query("SELECT pg_advisory_xact_lock($1)", [BIOGRAPHY_IMPORT_LOCK_KEY]);
            } catch (error) {
              throw new BiographyPostgresAdapterError("query-failed", "advisory-lock", safeSqlState(error));
            }
          },
          missingOperatorIds: async (operatorIds) => {
            try {
              const result = await client.query<{ id: string }>(
                "SELECT id FROM operators WHERE id = ANY($1::text[])",
                [operatorIds],
              );
              const found = new Set(result.rows.map((row) => row.id));
              return operatorIds.filter((id) => !found.has(id));
            } catch (error) {
              throw new BiographyPostgresAdapterError("query-failed", "operator-existence", safeSqlState(error));
            }
          },
          findBiographies: async (keys) => {
            if (!keys.length) return [];
            try {
              const result = await client.query<Record<string, unknown>>(
                "SELECT operator_id, region, source_repository, source_revision, source_path, source_sha256, story_title, original_text, fields, unrecognized_lines, profile_story_title, profile_text, imported_at FROM operator_biographies WHERE operator_id = ANY($1::text[]) AND region = ANY($2::text[]) AND source_revision = ANY($3::text[])",
                [keys.map((entry) => entry.operatorId), keys.map((entry) => entry.region), keys.map((entry) => entry.sourceRevision)],
              );
              const wanted = new Set(keys.map(keyOf));
              return result.rows.map(mapStored).filter((row) => wanted.has(keyOf({ operatorId: row.operatorId, region: row.region, sourceRevision: row.source.revision })));
            } catch (error) {
              throw new BiographyPostgresAdapterError("query-failed", "biography-read", safeSqlState(error));
            }
          },
          insertIfAbsent: async (record) => {
            try {
              const result = await client.query(
                "INSERT INTO operator_biographies (operator_id, region, source_repository, source_revision, source_path, source_sha256, story_title, original_text, fields, unrecognized_lines, profile_story_title, profile_text, imported_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, now()) ON CONFLICT (operator_id, region, source_revision) DO NOTHING",
                insertValues(record),
              );
              return result.rowCount === 1 ? "inserted" : "already-present";
            } catch (error) {
              throw new BiographyPostgresAdapterError("query-failed", "biography-insert", safeSqlState(error));
            }
          },
          updateMissingProfile: async (record) => {
            try {
              const result = await client.query(
                "UPDATE operator_biographies SET profile_story_title = $4, profile_text = $5 WHERE operator_id = $1 AND region = $2 AND source_revision = $3 AND profile_text IS NULL AND source_repository = $6 AND source_path = $7 AND source_sha256 = $8 AND story_title = $9 AND original_text = $10 AND fields = $11::jsonb AND unrecognized_lines = $12::jsonb",
                [record.operatorId, record.region, record.source.revision, record.profile?.storyTitle ?? null, record.profile?.text ?? null, record.source.repository, record.source.path, record.source.sha256, record.storyTitle, record.originalText, JSON.stringify(record.fields), JSON.stringify(record.unrecognizedLines)],
              );
              return result.rowCount === 1 ? "updated" : "not-needed";
            } catch (error) {
              throw new BiographyPostgresAdapterError("query-failed", "biography-profile-update", safeSqlState(error));
            }
          },
        };
        const result = await work(transaction);
        try {
          await client.query("COMMIT");
          committed = true;
          return result;
        } catch (error) {
          throw new BiographyPostgresAdapterError("commit-failed", "commit", safeSqlState(error));
        }
      } catch (error) {
        if (!committed) {
          rollbackAttempted = true;
          try { await client.query("ROLLBACK"); } catch (rollbackError) {
            throw new BiographyPostgresAdapterError("rollback-failed", "rollback", safeSqlState(rollbackError));
          }
        }
        throw error;
      } finally {
        if (rollbackAttempted) { /* rollback was attempted before release */ }
        client.release();
      }
    },
  };
}
