import { Pool } from "pg";
import type { DatabaseConfig } from "./config";
import type { LocalBiographyPool, LocalBiographyPoolClient } from "./operator-biography-local-factory";

export class LocalBiographyPoolError extends Error {
  constructor(readonly phase: "configuration" | "construction") {
    super(`Local biography pool failed during ${phase}`);
    this.name = "LocalBiographyPoolError";
  }
}

export type LocalBiographyPoolOptions = {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl: false;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
};

export type LocalBiographyPoolConstructor = new (options: LocalBiographyPoolOptions) => {
  readonly connect: () => Promise<LocalBiographyPgClient>;
  readonly end: () => Promise<void>;
  readonly on: (event: "error", listener: () => void) => unknown;
};

type LocalBiographyPgClient = {
  readonly query: <Row = Record<string, unknown>>(text: string, values?: readonly unknown[]) => Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>;
  readonly release: () => void;
};

const allowedKeys = new Set([
  "host", "port", "database", "user", "password", "ssl", "max", "connectionTimeoutMillis", "idleTimeoutMillis",
]);

function assertConfiguration(config: DatabaseConfig): asserts config is DatabaseConfig & { host: "127.0.0.1"; ssl: false } {
  if (Object.keys(config).some((key) => !allowedKeys.has(key))) throw new LocalBiographyPoolError("configuration");
  if (config.host !== "127.0.0.1" || config.ssl !== false) throw new LocalBiographyPoolError("configuration");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new LocalBiographyPoolError("configuration");
  if (!config.database.trim() || !config.user.trim() || !config.password) throw new LocalBiographyPoolError("configuration");
  if (!Number.isInteger(config.max) || config.max < 1 || config.max > 100) throw new LocalBiographyPoolError("configuration");
  if (!Number.isInteger(config.connectionTimeoutMillis) || config.connectionTimeoutMillis < 1 || config.connectionTimeoutMillis > 120000) throw new LocalBiographyPoolError("configuration");
  if (!Number.isInteger(config.idleTimeoutMillis) || config.idleTimeoutMillis < 1 || config.idleTimeoutMillis > 600000) throw new LocalBiographyPoolError("configuration");
}

function adaptClient(client: LocalBiographyPgClient): LocalBiographyPoolClient {
  return {
    query: (text, values) => client.query(text, values),
    release: () => client.release(),
  };
}

export function createLocalBiographyPool(
  config: DatabaseConfig,
  PoolConstructor: LocalBiographyPoolConstructor = Pool,
): LocalBiographyPool {
  try {
    assertConfiguration(config);
    const pool = new PoolConstructor({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: false,
      max: config.max,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      idleTimeoutMillis: config.idleTimeoutMillis,
    });
    pool.on("error", () => undefined);
    return {
      connect: async () => adaptClient(await pool.connect()),
      end: () => pool.end(),
    };
  } catch (error) {
    if (error instanceof LocalBiographyPoolError) throw error;
    throw new LocalBiographyPoolError("construction");
  }
}
