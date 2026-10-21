import { assertAdministrativeTarget } from "./admin-runtime";
import { readMigrationDatabaseConfig, type DatabaseConfig } from "./config";
import type { BiographyPostgresClient, BiographyPostgresClientSource } from "./operator-biography-drizzle-adapter";

export type LocalBiographyFactoryErrorCode = "invalid-configuration" | "identity-check-failed" | "pool-failed" | "closed";

export class LocalBiographyFactoryError extends Error {
  constructor(readonly code: LocalBiographyFactoryErrorCode, readonly phase: string) {
    super(`Local biography database factory failed during ${phase}`);
    this.name = "LocalBiographyFactoryError";
  }
}

export type LocalBiographyPoolClient = {
  readonly query: BiographyPostgresClient["query"];
  readonly release: () => void;
};

export type LocalBiographyPool = {
  readonly connect: () => Promise<LocalBiographyPoolClient>;
  readonly end: () => Promise<void>;
};

export type LocalBiographyIdentity = {
  readonly current_database: unknown;
  readonly current_user: unknown;
  readonly inet_server_addr?: unknown;
  readonly inet_server_port?: unknown;
};

export type LocalBiographyFactoryOptions = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly expectedDatabase: string;
  readonly expectedUser: string;
  readonly expectedPort: number;
  /** Exact PostgreSQL-reported address verified by the administrative caller. */
  readonly expectedServerAddress?: string;
  readonly readConfig?: (env: Readonly<Record<string, string | undefined>>) => DatabaseConfig;
  readonly assertTarget?: (env: Readonly<Record<string, string | undefined>>) => void;
  readonly createPool: (config: DatabaseConfig) => LocalBiographyPool;
};

export type LocalBiographyFactory = {
  readonly source: BiographyPostgresClientSource;
  readonly close: () => Promise<void>;
};

const forbiddenRedirectVariables = [
  "DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS",
] as const;

function rejectUnsafeConfiguration(env: Readonly<Record<string, string | undefined>>, expectedDatabase: string, expectedUser: string, expectedPort: number): void {
  if (!expectedDatabase || !expectedUser || !Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
  if (env.DB_CONNECTION_MODE !== "local" || env.DB_HOST !== "127.0.0.1" || env.DB_TLS_MODE !== "disable") throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
  if (env.DB_PORT === undefined || Number(env.DB_PORT) !== expectedPort || !/^\d+$/u.test(env.DB_PORT)) throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
  if (env.POSTGRES_DB !== expectedDatabase || env.MIGRATION_DB_EXPECTED_USER !== expectedUser || env.MIGRATION_DB_USER !== expectedUser) throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
  if (env.DB_CONNECTION_STRING || env.PGSSLMODE || env.DB_TLS_REJECT_UNAUTHORIZED || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
  if (forbiddenRedirectVariables.some((name) => env[name] !== undefined)) throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
}

function identityMatches(identity: LocalBiographyIdentity, expectedDatabase: string, expectedUser: string, expectedPort: number, expectedServerAddress: string): boolean {
  // Session identity confirms the PostgreSQL-reported target; it does not cryptographically authenticate the server or rule out proxies/tunnels.
  if (identity.current_database !== expectedDatabase || identity.current_user !== expectedUser) return false;
  if (identity.inet_server_addr !== expectedServerAddress || Number(identity.inet_server_port) !== expectedPort) return false;
  return true;
}

export function createLocalBiographyFactory(options: LocalBiographyFactoryOptions): LocalBiographyFactory {
  rejectUnsafeConfiguration(options.env, options.expectedDatabase, options.expectedUser, options.expectedPort);
  const assertTarget = options.assertTarget ?? ((env) => assertAdministrativeTarget(env, "migration"));
  const readConfig = options.readConfig ?? readMigrationDatabaseConfig;
  try {
    assertTarget(options.env);
    const config = readConfig(options.env);
    if (config.host !== "127.0.0.1" || config.ssl !== false || config.port !== options.expectedPort || config.database !== options.expectedDatabase || config.user !== options.expectedUser) {
      throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
    }
    const expectedServerAddress = options.expectedServerAddress ?? "127.0.0.1";
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(expectedServerAddress)) throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
    const pool = options.createPool(config);
    let lifecycle: "open" | "closing" | "closed" = "open";
    let pendingAcquires = 0;
    let pendingWaiter: (() => void) | undefined;
    let closePromise: Promise<void> | undefined;
    const waitForPending = (): Promise<void> => pendingAcquires === 0 ? Promise.resolve() : new Promise((resolve) => { pendingWaiter = resolve; });
    const finishAcquire = (): void => {
      pendingAcquires -= 1;
      if (pendingAcquires === 0 && pendingWaiter) {
        const resolve = pendingWaiter;
        pendingWaiter = undefined;
        resolve();
      }
    };
    return {
      source: {
        acquire: async () => {
          if (lifecycle !== "open") throw new LocalBiographyFactoryError("closed", "acquire");
          pendingAcquires += 1;
          let client: LocalBiographyPoolClient;
          let released = false;
          try {
            try { client = await pool.connect(); } catch { throw new LocalBiographyFactoryError("pool-failed", "connect"); }
            try {
              const result = await client.query<LocalBiographyIdentity>("SELECT current_database(), current_user, inet_server_addr(), inet_server_port()");
              const identity = result.rows[0];
              if (!identity || !identityMatches(identity, options.expectedDatabase, options.expectedUser, options.expectedPort, expectedServerAddress)) throw new LocalBiographyFactoryError("identity-check-failed", "identity-check");
              if (lifecycle !== "open") {
                client.release();
                released = true;
                throw new LocalBiographyFactoryError("closed", "acquire");
              }
              return client;
            } catch (error) {
              if (!released) {
                try { client.release(); } catch { /* preserve sanitized identity failure */ }
              }
              if (error instanceof LocalBiographyFactoryError) throw error;
              throw new LocalBiographyFactoryError("identity-check-failed", "identity-check");
            }
          } finally {
            finishAcquire();
          }
        },
      },
      close: async () => {
        if (!closePromise) {
          lifecycle = "closing";
          closePromise = (async () => {
            await waitForPending();
            try { await pool.end(); } catch { throw new LocalBiographyFactoryError("pool-failed", "close"); }
            lifecycle = "closed";
          })();
        }
        return closePromise;
      },
    };
  } catch (error) {
    if (error instanceof LocalBiographyFactoryError) throw error;
    throw new LocalBiographyFactoryError("invalid-configuration", "configuration");
  }
}
