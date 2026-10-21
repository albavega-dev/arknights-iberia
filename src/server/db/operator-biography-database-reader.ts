import { and, eq } from "drizzle-orm";
import { fixedBiographyRevisions, type BiographyRegion } from "../../game-data/operator-biography";
import { getDatabase } from "./client";
import { operatorBiographies } from "./schema";
import { mapDrizzleBiographyRow, readBiographyByOperatorId, type BiographyReadResult } from "./operator-biography-reader";

export async function readBiographyByOperatorIdFromDatabase(operatorId: string, region: BiographyRegion): Promise<BiographyReadResult> {
  const rows = await getDatabase().select().from(operatorBiographies).where(and(
    eq(operatorBiographies.operatorId, operatorId),
    eq(operatorBiographies.region, region),
    eq(operatorBiographies.sourceRevision, fixedBiographyRevisions[region]),
  )).limit(1);
  return readBiographyByOperatorId({ query: async () => ({ rows: rows.map(mapDrizzleBiographyRow) }) }, operatorId, region);
}
