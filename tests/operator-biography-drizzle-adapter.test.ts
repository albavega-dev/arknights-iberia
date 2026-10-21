import assert from "node:assert/strict";
import test from "node:test";
import { BIOGRAPHY_IMPORT_LOCK_KEY, BiographyPostgresAdapterError, createBiographyPostgresAdapter, type BiographyPostgresClient } from "../src/server/db/operator-biography-drizzle-adapter";
import type { BiographyQueryResult } from "../src/server/db/operator-biography-drizzle-adapter";
import type { BiographyRegion, OperatorBiography } from "../src/game-data/operator-biography";
import type { BiographyStorageKey } from "../src/server/db/operator-biography-repository";

function record(id = "char_fixture", region: BiographyRegion = "en"): OperatorBiography {
  return {
    operatorId: id, region, storyTitle: "Basic Info",
    source: { repository: "fixture", revision: "a".repeat(40), path: "fixture.json", sha256: "b".repeat(64) },
    fields: [{ key: "name", label: "Name", value: "Fixture", state: "value" }], originalText: "[Name] Fixture", unrecognizedLines: [],
  };
}

type Call = { text: string; values?: readonly unknown[] };

class FakeClient implements BiographyPostgresClient {
  readonly calls: Call[] = [];
  readonly rows: Record<string, unknown>[] = [];
  failOn: string | undefined;
  commitError = false;
  rollbackError = false;
  released = false;
  async query<Row = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<BiographyQueryResult<Row>> {
    this.calls.push({ text, values });
    if (this.failOn && text.startsWith(this.failOn)) throw Object.assign(new Error("secret postgres://bad"), { code: "XX999" });
    if (text === "COMMIT" && this.commitError) throw Object.assign(new Error("commit secret"), { code: "40001" });
    if (text === "ROLLBACK" && this.rollbackError) throw Object.assign(new Error("rollback secret"), { code: "XX999" });
    if (text.startsWith("SELECT id FROM operators")) return { rows: values[0] as Row[], rowCount: 0 };
    if (text.startsWith("SELECT operator_id")) return { rows: this.rows as Row[], rowCount: this.rows.length };
    if (text.startsWith("INSERT")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  release(): void { this.released = true; }
}

function adapterFor(client: FakeClient) { return createBiographyPostgresAdapter({ acquire: async () => client }); }

test("uses one injected client, READ COMMITTED and advisory transaction lock", async () => {
  const client = new FakeClient();
  const adapter = adapterFor(client);
  const result = await adapter.transaction(async (transaction) => { await transaction.acquireImportLock(); return "ok"; });
  assert.equal(result, "ok");
  assert.deepEqual(client.calls.map((call) => call.text), ["BEGIN", "SET TRANSACTION ISOLATION LEVEL READ COMMITTED", "SELECT pg_advisory_xact_lock($1)", "COMMIT"]);
  assert.deepEqual(client.calls[2]?.values, [BIOGRAPHY_IMPORT_LOCK_KEY]);
  assert.equal(client.released, true);
});

test("checks operators with a parameterized query and returns absent IDs", async () => {
  const client = new FakeClient();
  const adapter = adapterFor(client);
  const missing = await adapter.transaction((transaction) => transaction.missingOperatorIds(["char_one", "char_two"]));
  assert.deepEqual(missing, ["char_one", "char_two"]);
  assert.deepEqual(client.calls[2]?.values, [["char_one", "char_two"]]);
});

test("maps JSONB and text fields and uses atomic conflict-safe insertion", async () => {
  const client = new FakeClient();
  const adapter = adapterFor(client);
  const value = record();
  const result = await adapter.transaction((transaction) => transaction.insertIfAbsent(value));
  assert.equal(result, "inserted");
  const insert = client.calls.find((call) => call.text.startsWith("INSERT"));
  assert.ok(insert);
  assert.match(insert.text, /ON CONFLICT \(operator_id, region, source_revision\) DO NOTHING/u);
  assert.equal(insert.values?.[7], value.originalText);
  assert.equal(insert.values?.[8], JSON.stringify(value.fields));
  assert.equal(insert.values?.[9], JSON.stringify(value.unrecognizedLines));
});

test("rolls back and releases on query failure without exposing driver details", async () => {
  const client = new FakeClient(); client.failOn = "SELECT pg_advisory";
  await assert.rejects(() => adapterFor(client).transaction((transaction) => transaction.acquireImportLock()), (error: unknown) => {
    assert.ok(error instanceof BiographyPostgresAdapterError);
    assert.equal(error.message.includes("postgres://"), false);
    return true;
  });
  assert.ok(client.calls.some((call) => call.text === "ROLLBACK"));
  assert.equal(client.released, true);
});

test("does not report success when COMMIT fails", async () => {
  const client = new FakeClient(); client.commitError = true;
  await assert.rejects(() => adapterFor(client).transaction(async () => "not committed"), (error: unknown) => error instanceof BiographyPostgresAdapterError && error.code === "commit-failed");
  assert.ok(client.calls.some((call) => call.text === "ROLLBACK"));
  assert.equal(client.released, true);
});

test("propagates rollback failure as a sanitized administrative error", async () => {
  const client = new FakeClient(); client.failOn = "BEGIN"; client.rollbackError = true;
  await assert.rejects(() => adapterFor(client).transaction(async () => "never"), (error: unknown) => error instanceof BiographyPostgresAdapterError && error.code === "rollback-failed");
  assert.equal(client.released, true);
});

test("finds rows by parameterized composite-key components", async () => {
  const client = new FakeClient();
  const adapter = adapterFor(client);
  const keys: BiographyStorageKey[] = [{ operatorId: "char_fixture", region: "en", sourceRevision: "a".repeat(40) }];
  await adapter.transaction((transaction) => transaction.findBiographies(keys));
  const read = client.calls.find((call) => call.text.startsWith("SELECT operator_id"));
  assert.ok(read);
  assert.deepEqual(read.values, [["char_fixture"], ["en"], ["a".repeat(40)]]);
});
