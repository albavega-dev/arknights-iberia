import "server-only";

import { sql } from "drizzle-orm";
import { getDatabase } from "./client";

export async function checkDatabaseConnectivity(): Promise<void> {
  await getDatabase().execute(sql`select 1`);
}
