import { readFile } from "node:fs/promises";
import { Client } from "pg";

type Entry = { id: string; cnReleaseDate: string | null; source?: string };
type Manifest = { operators?: Entry[] };
export type CnSyncRow = { id: string; current: string | null; proposed: string | null };
export type CnSyncPlan = Readonly<{
  expectedIds: readonly string[];
  knownDates: ReadonlyMap<string, Entry>;
  unknownIds: readonly string[];
}>;

const isoDate = /^\d{4}-\d{2}-\d{2}$/u;

export function parseArguments(argv: readonly string[]): { apply: boolean } {
  const args = argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && arg !== "--confirm-local-cn-sync" && arg !== "--connected-dry-run"))
    throw new Error("Unknown CN synchronization argument");
  const apply = args.includes("--apply");
  if (apply && !args.includes("--confirm-local-cn-sync")) throw new Error("CN writes require --confirm-local-cn-sync");
  return { apply };
}

export function buildProposal(release: Manifest, regional: Manifest): Map<string, Entry> {
  const entries = [...(release.operators ?? []), ...(regional.operators ?? [])];
  const result = new Map<string, Entry>();
  for (const entry of entries) {
    if (result.has(entry.id)) throw new Error(`Duplicate CN manifest operator: ${entry.id}`);
    if (entry.cnReleaseDate !== null && !isoDate.test(entry.cnReleaseDate))
      throw new Error(`Invalid CN release date for ${entry.id}`);
    if (entry.cnReleaseDate !== null) result.set(entry.id, entry);
  }
  return result;
}

export function buildPlan(release: Manifest, regional: Manifest): CnSyncPlan {
  const entries = [...(release.operators ?? []), ...(regional.operators ?? [])];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate CN manifest operator: ${entry.id}`);
    ids.add(entry.id);
  }
  const knownDates = buildProposal(release, regional);
  const unknownIds = [...ids].filter((id) => !knownDates.has(id));
  if (unknownIds.length !== 1 || unknownIds[0] !== "char_4231_clemnt")
    throw new Error("CN manifest must contain only Clementia without a known date");
  return { expectedIds: [...ids].sort((a, b) => a.localeCompare(b, "en")), knownDates, unknownIds };
}

export function classifyRows(rows: readonly CnSyncRow[], plan: CnSyncPlan) {
  const expected = new Set(plan.expectedIds);
  const actual = new Set(rows.map((row) => row.id));
  const missingIds = plan.expectedIds.filter((id) => !actual.has(id));
  const unexpectedIds = rows.map((row) => row.id).filter((id) => !expected.has(id));
  const duplicateIds = rows.map((row) => row.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (missingIds.length || unexpectedIds.length || duplicateIds.length || rows.length !== plan.expectedIds.length)
    throw new Error(
      `CN synchronization target mismatch: missing=${missingIds.length}, unexpected=${unexpectedIds.length}, duplicates=${duplicateIds.length}`,
    );
  const conflicts = rows.filter(
    (row) => row.current !== null && plan.knownDates.get(row.id)?.cnReleaseDate !== row.current,
  );
  const equivalent = rows.filter(
    (row) => row.current !== null && plan.knownDates.get(row.id)?.cnReleaseDate === row.current,
  );
  const absent = rows.filter((row) => row.current === null && plan.knownDates.has(row.id));
  const unknown = rows.filter((row) => row.id === "char_4231_clemnt");
  return { absent, equivalent, conflicts, unknown, missingIds, unexpectedIds, duplicateIds };
}

export function planChanges(rows: readonly CnSyncRow[], proposal: ReadonlyMap<string, Entry>): CnSyncRow[] {
  return rows
    .filter((row) => row.current === null && proposal.has(row.id))
    .map((row) => ({ ...row, proposed: proposal.get(row.id)?.cnReleaseDate ?? null }));
}

type SyncClient = {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  end(): Promise<void>;
};
export function localConfig(env: Readonly<Record<string, string | undefined>>) {
  const host = env.CN_SYNC_DB_HOST;
  const port = Number(env.CN_SYNC_DB_PORT ?? "5432");
  const database = env.CN_SYNC_DB_NAME;
  const user = env.CN_SYNC_DB_USER;
  const password = env.CN_SYNC_DB_PASSWORD;
  if (
    !host ||
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    !Number.isInteger(port) ||
    !database ||
    !user ||
    !password
  )
    throw new Error("CN synchronization requires explicit local CN_SYNC_DB_* variables");
  return { host, port, database, user, password };
}

export async function synchronize(
  client: Pick<SyncClient, "query">,
  plan: CnSyncPlan,
  apply: boolean,
): Promise<number> {
  await client.query("BEGIN");
  try {
    const result = await client.query<CnSyncRow>(
      "SELECT id, cn_release_date::text AS current FROM public.operators ORDER BY id FOR UPDATE",
    );
    const classified = classifyRows(result.rows, plan);
    if (classified.conflicts.length)
      throw new Error(`CN synchronization found ${classified.conflicts.length} existing date conflicts`);
    const changes = planChanges(classified.absent, plan.knownDates);
    if (!apply) {
      await client.query("ROLLBACK");
      return changes.length;
    }
    for (const row of changes)
      await client.query("UPDATE public.operators SET cn_release_date = $1 WHERE id = $2", [row.proposed, row.id]);
    const after = await client.query<CnSyncRow>(
      "SELECT id, cn_release_date::text AS current FROM public.operators ORDER BY id FOR UPDATE",
    );
    const afterClassified = classifyRows(after.rows, plan);
    if (afterClassified.conflicts.length || planChanges(afterClassified.absent, plan.knownDates).length !== 0)
      throw new Error("CN synchronization verification failed");
    await client.query("COMMIT");
    return changes.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function main(): Promise<void> {
  const { apply } = parseArguments(process.argv);
  const release = JSON.parse(await readFile("data/operator-cn-release-manifest.json", "utf8")) as Manifest;
  const regional = JSON.parse(await readFile("data/operator-regional-manifest.json", "utf8")) as Manifest;
  const plan = buildPlan(release, regional);
  const connected = process.argv.includes("--connected-dry-run");
  if (!apply && !connected) {
    console.log(
      JSON.stringify(
        {
          mode: "offline-dry-run",
          operatorsExamined: plan.expectedIds.length,
          operatorsWithKnownDates: plan.knownDates.size,
          unknownIds: plan.unknownIds,
          databaseWrites: 0,
        },
        null,
        2,
      ),
    );
    return;
  }
  const client = new Client(localConfig(process.env));
  try {
    await client.connect();
    const result = await client.query<CnSyncRow>(
      "SELECT id, cn_release_date::text AS current FROM public.operators ORDER BY id",
    );
    const classified = classifyRows(result.rows, plan);
    if (!apply) {
      console.log(
        JSON.stringify(
          {
            mode: "connected-dry-run",
            operatorsExamined: result.rows.length,
            absent: classified.absent.length,
            equivalent: classified.equivalent.length,
            conflicts: classified.conflicts.length,
            unknown: classified.unknown.map((row) => row.id),
            missingIds: classified.missingIds,
            unexpectedIds: classified.unexpectedIds,
            duplicateIds: classified.duplicateIds,
            wouldUpdate: planChanges(classified.absent, plan.knownDates).length,
            databaseWrites: 0,
          },
          null,
          2,
        ),
      );
      return;
    }
  } finally {
    await client.end();
  }
  const writeClient = new Client(localConfig(process.env));
  try {
    await writeClient.connect();
    console.log(JSON.stringify({ mode: "apply", updated: await synchronize(writeClient, plan, true) }, null, 2));
  } finally {
    await writeClient.end();
  }
}

if (process.argv[1]?.endsWith("sync-cn-release-dates.ts"))
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "CN synchronization failed");
    process.exitCode = 1;
  });
