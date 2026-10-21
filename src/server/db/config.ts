type DatabaseConnection =
  | { host: "127.0.0.1"; ssl: false }
  | { host: string; ssl: { rejectUnauthorized: true; servername: string; ca?: string } };

export type DatabaseConfig = DatabaseConnection & {
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
};

type Environment = Readonly<Record<string, string | undefined>>;
import { readFileSync } from "node:fs";
import { assertAbsoluteCertificatePath } from "./admin-runtime";

function connection(env: Environment): DatabaseConnection {
  const mode = env.DB_CONNECTION_MODE ?? "local";
  const tlsMode = env.DB_TLS_MODE;

  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("Invalid database configuration: NODE_TLS_REJECT_UNAUTHORIZED");
  }
  if (env.DB_TLS_REJECT_UNAUTHORIZED !== undefined || env.PGSSLMODE !== undefined) {
    throw new Error("Invalid database TLS override");
  }

  if (mode === "local") {
    if (env.DB_HOST && env.DB_HOST !== "127.0.0.1") {
      throw new Error("Invalid database configuration: DB_HOST");
    }
    if (tlsMode && tlsMode !== "disable") {
      throw new Error("Invalid database configuration: DB_TLS_MODE");
    }
    return { host: "127.0.0.1", ssl: false };
  }

  if (mode !== "remote") {
    throw new Error("Invalid database configuration: DB_CONNECTION_MODE");
  }
  if (tlsMode !== "verify-full") {
    throw new Error("Invalid database configuration: DB_TLS_MODE");
  }
  const host = required(env, "DB_HOST");
  // Require a DNS name, not an IP address, loopback alias, URL, or socket path.
  const labels = host.split(".");
  const lastLabel = labels.at(-1)?.toLowerCase();
  if (
    host.length > 253 || labels.length < 2 ||
    labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) ||
    lastLabel === "local" || lastLabel === "localhost" ||
    /^\d+$/.test(lastLabel ?? "")
  ) {
    throw new Error("Invalid database configuration: DB_HOST");
  }
  const certificatePath = env.DB_SSL_ROOT_CERT;
  let ca: string | undefined;
  if (certificatePath) {
    try {
      ca = readFileSync(assertAbsoluteCertificatePath(certificatePath), "utf8");
    } catch {
      throw new Error("Invalid database TLS root certificate");
    }
  }
  const ssl = { rejectUnauthorized: true as const, servername: host, ...(ca ? { ca } : {}) };
  return { host, ssl };
}

function required(env: Environment, name: string): string {
  const value = env[name];
  if (!value?.trim()) {
    throw new Error(`Missing database configuration: ${name}`);
  }
  return value;
}

function boundedInteger(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid database configuration: ${name}`);

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid database configuration: ${name}`);
  }
  return value;
}

export function readDatabaseConfig(env: Environment): DatabaseConfig {
  return {
    ...connection(env),
    port: boundedInteger(env, "DB_PORT", 5432, 1, 65535),
    user: required(env, "APP_DB_USER"),
    password: required(env, "APP_DB_PASSWORD"),
    database: required(env, "POSTGRES_DB"),
    max: boundedInteger(env, "DB_POOL_MAX", 5, 1, 10),
    connectionTimeoutMillis: boundedInteger(
      env,
      "DB_CONNECT_TIMEOUT_MS",
      3000,
      100,
      30000,
    ),
    idleTimeoutMillis: boundedInteger(
      env,
      "DB_IDLE_TIMEOUT_MS",
      10000,
      1000,
      60000,
    ),
  };
}

export function readMigrationDatabaseConfig(env: Environment): DatabaseConfig {
  const config = readDatabaseConfig({
    ...env,
    APP_DB_USER: required(env, "MIGRATION_DB_USER"),
    APP_DB_PASSWORD: required(env, "MIGRATION_DB_PASSWORD"),
  });
  return config;
}
