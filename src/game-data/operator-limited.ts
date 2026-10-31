// Limited operators: the limitedCharId of every LIMITED banner in the CN gacha table (gachaPoolClient[].limitParam).
// Collaboration banners do not name their operators there, so they are not covered.
export type LimitedOperator = Readonly<{ id: string; pool: string }>;
export type LimitedManifest = Readonly<{
  purpose: string;
  source: Readonly<{ region: "cn"; repository: string; revision: string; path: string; field: string }>;
  operators: readonly LimitedOperator[];
}>;

export const limitedSourcePath = "cn/gamedata/excel/gacha_table.json";
export const limitedSourceField = "gachaPoolClient[gachaRuleType=LIMITED].limitParam.limitedCharId";

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Limited operator of each LIMITED banner, first banner per operator, ordered by operator id. */
export function limitedOperatorsFrom(gachaTable: unknown): LimitedOperator[] {
  const pools = record(gachaTable).gachaPoolClient;
  if (!Array.isArray(pools)) throw new Error("The gacha table has no gachaPoolClient list");
  const found = new Map<string, string>();
  for (const pool of pools.map(record)) {
    if (pool.gachaRuleType !== "LIMITED") continue;
    const id = record(pool.limitParam).limitedCharId;
    if (typeof id !== "string" || typeof pool.gachaPoolId !== "string") throw new Error(`LIMITED banner without limitedCharId: ${JSON.stringify(pool.gachaPoolId)}`);
    if (!found.has(id)) found.set(id, pool.gachaPoolId);
  }
  return [...found].map(([id, pool]) => ({ id, pool })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Problems of a limited manifest checked against the catalog operator ids. */
export function limitedManifestErrors(manifest: LimitedManifest, catalogIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(manifest.source.revision)) errors.push("source.revision is not a full commit");
  const ids = manifest.operators.map((operator) => operator.id);
  if (new Set(ids).size !== ids.length) errors.push("duplicate operator ids");
  if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) errors.push("operators are not ordered by id");
  for (const id of ids) if (!catalogIds.has(id)) errors.push(`${id} is not a catalog operator`);
  return errors;
}
