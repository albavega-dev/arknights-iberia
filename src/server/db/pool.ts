import "server-only";

import { Pool } from "pg";
import { readDatabaseConfig } from "./config";

const developmentGlobal = globalThis as typeof globalThis & {
  __arknightsIberiaPgPool?: Pool;
};

let productionPool: Pool | undefined;

export function getPool(): Pool {
  if (process.env.NODE_ENV === "development" && developmentGlobal.__arknightsIberiaPgPool) {
    return developmentGlobal.__arknightsIberiaPgPool;
  }
  if (productionPool) return productionPool;

  const pool = new Pool(readDatabaseConfig(process.env));
  pool.on("error", () => {
    // pg emits idle-client errors outside queries. Handle them without
    // logging connection strings, credentials, or database internals.
    console.error("Database pool idle-client error");
  });

  if (process.env.NODE_ENV === "development") {
    developmentGlobal.__arknightsIberiaPgPool = pool;
  } else {
    productionPool = pool;
  }
  return pool;
}
