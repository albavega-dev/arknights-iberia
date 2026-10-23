import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { createBiographyPostgresAdapter, type BiographyPostgresClient, type BiographyQueryResult } from "../src/server/db/operator-biography-drizzle-adapter";
import { BiographyRepositoryError, persistBiographyEnvelope, type BiographyStorageAdapter } from "../src/server/db/operator-biography-repository";
import { fixedBiographyRevisions, type OperatorBiography } from "../src/game-data/operator-biography";
import { preflightBiographies, type BiographyImportEnvelope } from "../src/game-data/operator-biography-import";

type BiographyIntegrationConfig = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}>;

const enRevision = fixedBiographyRevisions.en;
const cnRevision = fixedBiographyRevisions.cn;
const enSource = { repository: "synthetic/biography-fixture", revision: enRevision, path: "synthetic/en-handbook.json", sha256: "a".repeat(64) } as const;
const cnSource = { repository: "synthetic/biography-fixture", revision: cnRevision, path: "synthetic/cn-handbook.json", sha256: "b".repeat(64) } as const;
const enIds = Array.from({ length: 415 }, (_, index) => `char_9000_test_${index + 1}`);
const cnIds = Array.from({ length: 17 }, (_, index) => `char_9900_test_${index + 1}`);
const allIds = [...enIds, ...cnIds];

function readEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function readIntegrationConfig(): BiographyIntegrationConfig {
  const env = readEnv();
  const required = ["BIOGRAPHY_TEST_DB_HOST", "BIOGRAPHY_TEST_DB_PORT", "BIOGRAPHY_TEST_DB_NAME", "BIOGRAPHY_TEST_DB_USER", "BIOGRAPHY_TEST_DB_PASSWORD"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing biography integration test variables: ${missing.join(", ")}`);

  const port = Number(env.BIOGRAPHY_TEST_DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("BIOGRAPHY_TEST_DB_PORT must be a valid TCP port");
  if (port === 55432) throw new Error("Biography integration tests cannot use the Development port");
  if (env.BIOGRAPHY_TEST_DB_HOST !== "127.0.0.1" && env.BIOGRAPHY_TEST_DB_HOST !== "::1") throw new Error("Biography integration tests require a loopback database host");
  if (!/^arknights_biography_integration_[a-z0-9][a-z0-9_-]*$/u.test(env.BIOGRAPHY_TEST_DB_NAME)) {
    throw new Error("BIOGRAPHY_TEST_DB_NAME must identify an exclusive integration database");
  }
  if (!/^arknights_biography_integration_[a-z0-9][a-z0-9_-]*$/u.test(env.BIOGRAPHY_TEST_DB_USER)) throw new Error("Biography integration tests require a dedicated integration role");

  return { host: env.BIOGRAPHY_TEST_DB_HOST, port, database: env.BIOGRAPHY_TEST_DB_NAME, user: env.BIOGRAPHY_TEST_DB_USER, password: env.BIOGRAPHY_TEST_DB_PASSWORD };
}

function makeRecord(operatorId: string, region: "en" | "cn"): OperatorBiography {
  const source = region === "en" ? enSource : cnSource;
  return {
    operatorId,
    region,
    storyTitle: region === "en" ? "Synthetic profile" : "Synthetic regional profile",
    source,
    fields: [{ key: "fixture", label: "Fixture", value: operatorId, state: "value" }],
    originalText: `[synthetic] ${operatorId}`,
    unrecognizedLines: [],
  };
}

function makeEnvelope(records = allIds.map((id) => makeRecord(id, enIds.includes(id) ? "en" : "cn"))): BiographyImportEnvelope {
  const result = preflightBiographies({ records, expected: { en: enIds, cn: cnIds }, revisions: fixedBiographyRevisions, coverage: "complete" });
  assert.equal(result.report.ok, true);
  assert.ok("envelope" in result);
  return result.envelope;
}

function makePool(): Pool {
  const config = readIntegrationConfig();
  return new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, ssl: false, max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000 });
}

function makeAdapter(pool: Pool): BiographyStorageAdapter {
  return createBiographyPostgresAdapter({
    acquire: async () => {
      const client = await pool.connect();
      const wrapped: BiographyPostgresClient = {
        query: async <Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<BiographyQueryResult<Row>> => await client.query(text, values as unknown[] | undefined) as unknown as BiographyQueryResult<Row>,
        release: () => client.release(),
      };
      return wrapped;
    },
  });
}

async function countRows(pool: Pool): Promise<number> {
  const result = await pool.query("SELECT count(*)::int AS count FROM operator_biographies WHERE operator_id = ANY($1::text[])", [allIds]);
  return result.rows[0].count;
}

test("persists synthetic biographies transactionally against isolated PostgreSQL", async () => {
  const config = readIntegrationConfig();
  const pool = makePool();
  const adapter = makeAdapter(pool);
  const envelope = makeEnvelope();
  try {
    const identity = await pool.query("SELECT current_database() AS database, current_user AS user, inet_server_addr()::text AS address, inet_server_port() AS port, COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl");
    assert.equal(identity.rows[0].database, config.database);
    assert.equal(identity.rows[0].user, config.user);
    assert.match(identity.rows[0].address, /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d+)?$/u);
    assert.equal(identity.rows[0].port, 5432);
    assert.equal(identity.rows[0].ssl, false);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM operators")).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM operator_biographies")).rows[0].count, 0);

    await pool.query("INSERT INTO operators (id, name, class_name, rarity, slug, source_locale, source_repository, source_revision, source_data_version, imported_at) SELECT id, id, 'synthetic', 1, id, 'en', 'synthetic/fixture', 'synthetic-revision', 'synthetic-version', now() FROM unnest($1::text[]) AS id", [allIds]);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM operators WHERE id = ANY($1::text[])", [allIds])).rows[0].count, 432);

    let insertCalls = 0;
    const failingAdapter: BiographyStorageAdapter = {
      transaction: (work) => adapter.transaction((transaction) => work({ ...transaction, insertIfAbsent: async (record) => {
        insertCalls += 1;
        if (insertCalls === 2) throw new Error("synthetic mid-batch failure");
        return transaction.insertIfAbsent(record);
      }, updateMissingProfile: async (record) => transaction.updateMissingProfile(record) })),
    };
    await assert.rejects(() => persistBiographyEnvelope(failingAdapter, envelope), /synthetic mid-batch failure/);
    assert.equal(await countRows(pool), 0);

    const first = await persistBiographyEnvelope(adapter, envelope);
    assert.equal(first.inserted, 432);
    assert.equal(first.alreadyPresent, 0);
    assert.equal(first.operatorsVerified, 432);
    assert.equal(await countRows(pool), 432);

    const second = await persistBiographyEnvelope(adapter, envelope);
    assert.equal(second.inserted, 0);
    assert.equal(second.alreadyPresent, 432);

    const changedRecord = makeRecord(enIds[0], "en");
    const conflictingRecords = envelope.plan.records.map((record) => record.operatorId === enIds[0] ? { ...record, originalText: "[synthetic] conflicting" } : record);
    const conflictEnvelope = makeEnvelope(conflictingRecords);
    await assert.rejects(() => persistBiographyEnvelope(adapter, conflictEnvelope), (error: unknown) => error instanceof BiographyRepositoryError && error.code === "content-conflict");
    assert.equal(await countRows(pool), 432);
    assert.equal(changedRecord.operatorId, enIds[0]);

    const concurrent = await Promise.all([persistBiographyEnvelope(adapter, envelope), persistBiographyEnvelope(adapter, envelope)]);
    assert.deepEqual(concurrent.map((result) => result.inserted), [0, 0]);
    assert.deepEqual(concurrent.map((result) => result.alreadyPresent), [432, 432]);

    const badRegion = allIds[0];
    await assert.rejects(() => pool.query("INSERT INTO operator_biographies (operator_id, region, source_repository, source_revision, source_path, source_sha256, story_title, original_text, fields, unrecognized_lines, imported_at) VALUES ($1, 'xx', 'synthetic', $2, 'synthetic', $3, 'synthetic', 'synthetic', '{}'::jsonb, '[]'::jsonb, now())", [badRegion, "c".repeat(40), "d".repeat(64)]), (error: unknown) => (error as { code?: string }).code === "23514");
    await assert.rejects(() => pool.query("INSERT INTO operator_biographies (operator_id, region, source_repository, source_revision, source_path, source_sha256, story_title, original_text, fields, unrecognized_lines, imported_at) VALUES ($1, 'en', 'synthetic', $2, 'synthetic', 'invalid', 'synthetic', 'synthetic', '{}'::jsonb, '[]'::jsonb, now())", [badRegion, "d".repeat(40)]), (error: unknown) => (error as { code?: string }).code === "23514");
    assert.equal(pool.waitingCount, 0);
  } finally {
    await pool.query("DELETE FROM operator_biographies WHERE operator_id = ANY($1::text[])", [allIds]);
    await pool.query("DELETE FROM operators WHERE id = ANY($1::text[])", [allIds]);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM operators WHERE id = ANY($1::text[])", [allIds])).rows[0].count, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM operator_biographies WHERE operator_id = ANY($1::text[])", [allIds])).rows[0].count, 0);
    await pool.end();
  }
});
