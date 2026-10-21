import assert from "node:assert/strict";
import test from "node:test";
import { createLocalBiographyFactory } from "../src/server/db/operator-biography-local-factory";
import { createLocalBiographyPool, LocalBiographyPoolError, type LocalBiographyPoolConstructor, type LocalBiographyPoolOptions } from "../src/server/db/operator-biography-local-pool";
import type { DatabaseConfig } from "../src/server/db/config";

const config = {
  host: "127.0.0.1", port: 5432, database: "local_test", user: "arknights_migrator", password: "hidden", ssl: false,
  max: 2, connectionTimeoutMillis: 1000, idleTimeoutMillis: 2000,
} satisfies DatabaseConfig;

class FakePool {
  static options: LocalBiographyPoolOptions | undefined;
  static instance: FakePool | undefined;
  ended = 0;
  listeners = 0;
  idleErrorHandler: (() => void) | undefined;
  readonly client = { query: async <Row>() => ({ rows: [] as readonly Row[], rowCount: 0 }), release: () => undefined };
  constructor(options: LocalBiographyPoolOptions) { FakePool.options = options; FakePool.instance = this; }
  on(_event: "error", listener: () => void) { this.listeners += 1; this.idleErrorHandler = listener; }
  async connect() { return this.client; }
  async end() { this.ended += 1; }
}

function makeConfig(overrides: Record<string, unknown> = {}): DatabaseConfig {
  return { ...config, ...overrides } as DatabaseConfig;
}

test("passes only the closed local pool options and adapts lifecycle methods", async () => {
  const pool = createLocalBiographyPool(config, FakePool as unknown as LocalBiographyPoolConstructor);
  assert.deepEqual(FakePool.options, config);
  assert.equal(FakePool.instance?.listeners, 1);
  const client = await pool.connect();
  assert.equal(typeof client.query, "function");
  assert.equal(typeof client.release, "function");
  await pool.end();
  assert.equal(FakePool.instance?.ended, 1);
  assert.equal(Object.hasOwn(FakePool.options ?? {}, "connectionString"), false);
});

for (const [name, overrides] of [
  ["remote host", { host: "remote.example" }],
  ["TLS", { ssl: true }],
  ["port", { port: 0 }],
  ["database", { database: " " }],
  ["user", { user: "" }],
  ["password", { password: "" }],
  ["max", { max: 0 }],
  ["timeout", { connectionTimeoutMillis: 0 }],
] as const) {
  test(`rejects invalid ${name}`, () => assert.throws(() => createLocalBiographyPool(makeConfig(overrides), FakePool as never), (error: unknown) => error instanceof LocalBiographyPoolError && error.phase === "configuration"));
}

test("rejects unexpected runtime properties", () => {
  const unsafe = { ...config, connectionString: "postgres://secret" } as DatabaseConfig & { connectionString: string };
  assert.throws(() => createLocalBiographyPool(unsafe, FakePool as never), LocalBiographyPoolError);
});

test("does not create a pool while importing the module", () => {
  assert.ok(FakePool.instance);
});

test("sanitizes constructor and idle-client errors", () => {
  createLocalBiographyPool(config, FakePool as never);
  assert.doesNotThrow(() => FakePool.instance?.idleErrorHandler?.());
  class BrokenPool {
    constructor() { throw new Error("postgres://secret"); }
    on() { throw new Error("unused"); }
  }
  assert.throws(() => createLocalBiographyPool(config, BrokenPool as unknown as typeof FakePool), (error: unknown) => error instanceof LocalBiographyPoolError && !error.message.includes("secret"));
});

test("is accepted by the local biography factory without opening a connection", () => {
  const env = { DB_CONNECTION_MODE: "local", DB_HOST: "127.0.0.1", DB_TLS_MODE: "disable", DB_PORT: "5432", POSTGRES_DB: "local_test", MIGRATION_DB_USER: "arknights_migrator", MIGRATION_DB_EXPECTED_USER: "arknights_migrator" };
  const value = createLocalBiographyFactory({ env, expectedDatabase: "local_test", expectedUser: "arknights_migrator", expectedPort: 5432, readConfig: () => config, createPool: () => createLocalBiographyPool(config, FakePool as never) });
  assert.equal(typeof value.source.acquire, "function");
});
