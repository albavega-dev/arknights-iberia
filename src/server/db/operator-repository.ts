import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";

import type { OperatorRecord } from "../../game-data/operators";
import { getDatabase } from "./client";
import { operators } from "./schema";

function toRecord(row: typeof operators.$inferSelect): OperatorRecord {
  return {
    id: row.id,
    name: row.name,
    cnName: row.cnName,
    globalName: row.globalName,
    class: row.className as OperatorRecord["class"],
    subClassId: row.subClassId,
    rarity: row.rarity as OperatorRecord["rarity"],
    slug: row.slug,
    cnOnly: row.cnOnly,
    availabilityStatus: row.availabilityStatus as OperatorRecord["availabilityStatus"],
    cnReleaseDate: row.cnReleaseDate,
    globalReleaseDate: row.globalReleaseDate,
    mainPowerNationId: row.mainPowerNationId,
    mainPowerGroupId: row.mainPowerGroupId,
    mainPowerTeamId: row.mainPowerTeamId,
    mainFactionId: row.mainFactionId,
  };
}

export async function listOperators(): Promise<OperatorRecord[]> {
  const rows = await getDatabase()
    .select()
    .from(operators)
    .orderBy(
      sql`${operators.cnReleaseDate} DESC NULLS FIRST`,
      desc(operators.rarity),
      asc(operators.name),
      asc(operators.id),
    );
  return rows.map(toRecord);
}

export async function findOperatorBySlug(slug: string): Promise<OperatorRecord | undefined> {
  const rows = await getDatabase().select().from(operators).where(eq(operators.slug, slug)).limit(1);
  return rows[0] ? toRecord(rows[0]) : undefined;
}
