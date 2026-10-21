import assert from "node:assert/strict";
import test from "node:test";
import { createLocalBiographyFactory, LocalBiographyFactoryError, type LocalBiographyPool, type LocalBiographyPoolClient } from "../src/server/db/operator-biography-local-factory";
import type { DatabaseConfig } from "../src/server/db/config";

const env = {
  DB_CONNECTION_MODE: "local", DB_HOST: "127.0.0.1", DB_TLS_MODE: "disable", DB_PORT: "5432",
  POSTGRES_DB: "local_test", MIGRATION_DB_USER: "arknights_migrator", MIGRATION_DB_EXPECTED_USER: "arknights_migrator",
};
const config = { host: "127.0.0.1", ssl: false, port: 5432, database: "local_test", user: "arknights_migrator", password: "hidden", max: 1, connectionTimeoutMillis: 1000, idleTimeoutMillis: 1000 } satisfies DatabaseConfig;

class FakePool implements LocalBiographyPool {
  connects = 0;
  ends = 0;
  released = 0;
  identity: Record<string, unknown> | undefined = { current_database: "local_test", current_user: "arknights_migrator", inet_server_addr: "127.0.0.1", inet_server_port: 5432 };
  async connect() {
    this.connects += 1;
    return { query: async <Row>() => ({ rows: (this.identity ? [this.identity] : []) as readonly Row[], rowCount: this.identity ? 1 : 0 }), release: () => { this.released += 1; } };
  }
  async end() { this.ends += 1; }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function factory(overrides: Record<string, string | undefined> = {}, pool = new FakePool(), expectedServerAddress?: string) {
  return { factory: createLocalBiographyFactory({ env: { ...env, ...overrides }, expectedDatabase: "local_test", expectedUser: "arknights_migrator", expectedPort: 5432, expectedServerAddress, readConfig: () => config, createPool: () => pool }), pool };
}

test("accepts explicit local configuration and verifies every acquired client", async () => {
  const { factory: value, pool } = factory();
  const first = await value.source.acquire();
  first.release();
  const second = await value.source.acquire();
  second.release();
  assert.equal(pool.connects, 2);
  assert.equal(pool.released, 2);
  await value.close();
  assert.equal(pool.ends, 1);
});

for (const [name, overrides] of [
  ["remote mode", { DB_CONNECTION_MODE: "remote" }],
  ["unexpected host", { DB_HOST: "localhost" }],
  ["TLS", { DB_TLS_MODE: "verify-full" }],
  ["invalid port", { DB_PORT: "not-a-port" }],
  ["connection URL", { DB_CONNECTION_STRING: "postgres://secret" }],
  ["redirect variable", { PGHOST: "remote.example" }],
] as const) {
  test(`rejects ${name}`, () => assert.throws(() => factory(overrides), (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "invalid-configuration"));
}

test("rejects missing expected database or user", () => {
  assert.throws(() => createLocalBiographyFactory({ env, expectedDatabase: "", expectedUser: "arknights_migrator", expectedPort: 5432, readConfig: () => config, assertTarget: () => undefined, createPool: () => new FakePool() }), /configuration/u);
  assert.throws(() => createLocalBiographyFactory({ env, expectedDatabase: "local_test", expectedUser: "", expectedPort: 5432, readConfig: () => config, assertTarget: () => undefined, createPool: () => new FakePool() }), /configuration/u);
});

test("rejects incorrect and incomplete identity before returning a client", async () => {
  const wrong = new FakePool(); wrong.identity = { current_database: "other", current_user: "other" };
  const { factory: value, pool } = factory({}, wrong);
  await assert.rejects(() => value.source.acquire(), (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "identity-check-failed");
  assert.equal(pool.released, 1);
});

test("accepts only the exact independently verified Docker server address", async () => {
  const docker = new FakePool();
  docker.identity = { current_database: "local_test", current_user: "arknights_migrator", inet_server_addr: "172.18.0.2", inet_server_port: 5432 };
  const rejected = factory({}, docker);
  await assert.rejects(() => rejected.factory.source.acquire(), (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "identity-check-failed");
  assert.equal(docker.released, 1);
  const accepted = factory({}, docker, "172.18.0.2");
  const client = await accepted.factory.source.acquire();
  client.release();
  await accepted.factory.close();
});

test("sanitizes pool and identity errors and never creates a real pool", async () => {
  let called = false;
  const value = createLocalBiographyFactory({ env, expectedDatabase: "local_test", expectedUser: "arknights_migrator", expectedPort: 5432, readConfig: () => config, assertTarget: () => undefined, createPool: () => { called = true; return { connect: async () => { throw new Error("postgres://secret"); }, end: async () => undefined }; } });
  assert.equal(called, true);
  await assert.rejects(() => value.source.acquire(), (error: unknown) => error instanceof LocalBiographyFactoryError && !error.message.includes("secret"));
});

test("coordinates close with a pending connection and calls end once", async () => {
  const connected = deferred<LocalBiographyPoolClient>();
  let ended = 0;
  const client = { query: async <Row>() => ({ rows: [{ current_database: "local_test", current_user: "arknights_migrator", inet_server_addr: "127.0.0.1", inet_server_port: 5432 }] as unknown as readonly Row[], rowCount: 1 }), release: () => undefined };
  const value = createLocalBiographyFactory({ env, expectedDatabase: "local_test", expectedUser: "arknights_migrator", expectedPort: 5432, readConfig: () => config, createPool: () => ({ connect: () => connected.promise, end: async () => { ended += 1; } }) });
  const acquiring = value.source.acquire();
  const closing = value.close();
  assert.equal(ended, 0);
  await assert.rejects(() => value.source.acquire(), (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "closed");
  connected.resolve(client);
  await assert.rejects(acquiring, (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "closed");
  await closing;
  await value.close();
  assert.equal(ended, 1);
});

test("shares close failure and does not retry pool.end", async () => {
  let ended = 0;
  const value = createLocalBiographyFactory({ env, expectedDatabase: "local_test", expectedUser: "arknights_migrator", expectedPort: 5432, readConfig: () => config, createPool: () => ({ connect: async () => new FakePool().connect(), end: async () => { ended += 1; throw new Error("driver secret"); } }) });
  const first = value.close();
  const second = value.close();
  await assert.rejects(first, (error: unknown) => error instanceof LocalBiographyFactoryError && !error.message.includes("secret"));
  await assert.rejects(second, (error: unknown) => error instanceof LocalBiographyFactoryError && !error.message.includes("secret"));
  assert.equal(ended, 1);
  await assert.rejects(() => value.source.acquire(), (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "closed");
});

test("two acquisitions can be pending independently", async () => {
  const first = deferred<LocalBiographyPoolClient>();
  const second = deferred<LocalBiographyPoolClient>();
  let calls = 0;
  const makeClient = () => ({ query: async <Row>() => ({ rows: [{ current_database: "local_test", current_user: "arknights_migrator", inet_server_addr: "127.0.0.1", inet_server_port: 5432 }] as unknown as readonly Row[], rowCount: 1 }), release: () => undefined });
  const value = createLocalBiographyFactory({ env, expectedDatabase: "local_test", expectedUser: "arknights_migrator", expectedPort: 5432, readConfig: () => config, createPool: () => ({ connect: () => (++calls === 1 ? first.promise : second.promise), end: async () => undefined }) });
  const a = value.source.acquire();
  const b = value.source.acquire();
  const closing = value.close();
  first.resolve(makeClient());
  second.resolve(makeClient());
  await assert.rejects(a, (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "closed");
  await assert.rejects(b, (error: unknown) => error instanceof LocalBiographyFactoryError && error.code === "closed");
  await closing;
  assert.equal(calls, 2);
});
