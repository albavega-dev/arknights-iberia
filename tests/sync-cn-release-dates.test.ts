import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, buildProposal, classifyRows, localConfig, main, parseArguments, planChanges, synchronize } from "../scripts/sync-cn-release-dates";

function scriptedClient(responses: Array<{ rows: Array<{ id: string; current: string | null; proposed: string | null }>; rowCount: number }>) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  return {
    queries,
    client: {
      async query<T = unknown>(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (["BEGIN", "ROLLBACK", "COMMIT"].includes(text)) return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
        const response = responses.shift();
        if (!response) throw new Error("Unexpected query in synchronization test");
        return response as { rows: T[]; rowCount: number };
      },
    },
  };
}

function synchronizationPlan() {
  return buildPlan(
    { operators: [{ id: "char_a", cnReleaseDate: "2026-01-01" }] },
    { operators: [{ id: "char_4231_clemnt", cnReleaseDate: null }] },
  );
}

test("CN sync is dry-run by default and requires explicit confirmation", () => {
  assert.deepEqual(parseArguments(["node", "script"]), { apply: false });
  assert.throws(() => parseArguments(["node", "script", "--apply"]), /confirm-local-cn-sync/);
  assert.deepEqual(parseArguments(["node", "script", "--apply", "--confirm-local-cn-sync"]), { apply: true });
  assert.deepEqual(parseArguments(["node", "script", "--connected-dry-run"]), { apply: false });
});

test("CN sync accepts only explicit local connection configuration", () => {
  assert.deepEqual(
    localConfig({ CN_SYNC_DB_HOST: "127.0.0.1", CN_SYNC_DB_NAME: "local", CN_SYNC_DB_USER: "writer", CN_SYNC_DB_PASSWORD: "secret" }),
    { host: "127.0.0.1", port: 5432, database: "local", user: "writer", password: "secret" },
  );
  for (const host of ["db.example", "", undefined]) {
    assert.throws(
      () => localConfig({ CN_SYNC_DB_HOST: host, CN_SYNC_DB_NAME: "local", CN_SYNC_DB_USER: "writer", CN_SYNC_DB_PASSWORD: "secret" }),
      /explicit local/,
    );
  }
  assert.throws(() => localConfig({ CN_SYNC_DB_HOST: "localhost", CN_SYNC_DB_NAME: "local", CN_SYNC_DB_USER: "writer" }), /explicit local/);
  assert.throws(() => localConfig({ CN_SYNC_DB_HOST: "localhost", CN_SYNC_DB_PORT: "not-a-port", CN_SYNC_DB_NAME: "local", CN_SYNC_DB_USER: "writer", CN_SYNC_DB_PASSWORD: "secret" }), /explicit local/);
});

test("offline main reports the fixed manifests without connecting", async () => {
  const originalArgv = process.argv;
  const originalLog = console.log;
  const output: string[] = [];
  process.argv = ["node", "sync-cn-release-dates.ts"];
  console.log = (...args: unknown[]) => output.push(String(args[0]));
  try {
    await main();
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
  }
  const report = JSON.parse(output[0] ?? "{}") as { mode?: string; databaseWrites?: number; unknownIds?: string[] };
  assert.equal(report.mode, "offline-dry-run");
  assert.equal(report.databaseWrites, 0);
  assert.deepEqual(report.unknownIds, ["char_4231_clemnt"]);
});

test("proposal excludes unknown dates without inventing them", () => {
  const proposal = buildProposal(
    { operators: [{ id: "char_global", cnReleaseDate: "2026-01-01" }] },
    { operators: [{ id: "char_unknown", cnReleaseDate: null }] },
  );
  assert.deepEqual([...proposal.keys()], ["char_global"]);
});

test("CN sync plans only date changes", () => {
  const proposal = buildProposal({ operators: [{ id: "char_a", cnReleaseDate: "2026-01-01" }] }, {});
  assert.deepEqual(planChanges([{ id: "char_a", current: null, proposed: null }], proposal), [
    { id: "char_a", current: null, proposed: "2026-01-01" },
  ]);
});

test("classification distinguishes absent, equivalent, conflict and Clementia", () => {
  const plan = buildPlan(
    { operators: [{ id: "char_a", cnReleaseDate: "2026-01-01" }] },
    { operators: [{ id: "char_4231_clemnt", cnReleaseDate: null }] },
  );
  const result = classifyRows(
    [
      { id: "char_4231_clemnt", current: null, proposed: null },
      { id: "char_a", current: null, proposed: null },
    ],
    plan,
  );
  assert.equal(result.absent.length, 1);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(planChanges(result.absent, plan.knownDates).length, 1);
  const conflict = classifyRows(
    [
      { id: "char_4231_clemnt", current: null, proposed: null },
      { id: "char_a", current: "2026-02-01", proposed: null },
    ],
    plan,
  );
  assert.equal(conflict.conflicts.length, 1);
});

test("classification rejects missing, unexpected and duplicate IDs", () => {
  const plan = buildPlan(
    { operators: [{ id: "char_a", cnReleaseDate: "2026-01-01" }] },
    { operators: [{ id: "char_4231_clemnt", cnReleaseDate: null }] },
  );
  assert.throws(() => classifyRows([{ id: "char_a", current: null, proposed: null }], plan), /target mismatch/);
  assert.throws(
    () =>
      classifyRows(
        [
          { id: "char_a", current: null, proposed: null },
          { id: "char_4231_clemnt", current: null, proposed: null },
          { id: "char_extra", current: null, proposed: null },
        ],
        plan,
      ),
    /target mismatch/,
  );
  assert.throws(
    () =>
      classifyRows(
        [
          { id: "char_a", current: null, proposed: null },
          { id: "char_a", current: null, proposed: null },
        ],
        plan,
      ),
    /target mismatch/,
  );
});

test("synchronization dry-run rolls back without issuing updates", async () => {
  const scripted = scriptedClient([
    { rows: [{ id: "char_4231_clemnt", current: null, proposed: null }, { id: "char_a", current: null, proposed: null }], rowCount: 2 },
    { rows: [], rowCount: 0 },
  ]);
  const changed = await synchronize(scripted.client, synchronizationPlan(), false);
  assert.equal(changed, 1);
  assert.deepEqual(scripted.queries.map(({ text }) => text), [
    "BEGIN",
    "SELECT id, cn_release_date::text AS current FROM public.operators ORDER BY id FOR UPDATE",
    "ROLLBACK",
  ]);
});

test("synchronization applies missing dates and commits after verification", async () => {
  const scripted = scriptedClient([
    { rows: [{ id: "char_4231_clemnt", current: null, proposed: null }, { id: "char_a", current: null, proposed: null }], rowCount: 2 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: "char_4231_clemnt", current: null, proposed: null }, { id: "char_a", current: "2026-01-01", proposed: null }], rowCount: 2 },
    { rows: [], rowCount: 0 },
  ]);
  const changed = await synchronize(scripted.client, synchronizationPlan(), true);
  assert.equal(changed, 1);
  assert.deepEqual(scripted.queries.map(({ text }) => text), [
    "BEGIN",
    "SELECT id, cn_release_date::text AS current FROM public.operators ORDER BY id FOR UPDATE",
    "UPDATE public.operators SET cn_release_date = $1 WHERE id = $2",
    "SELECT id, cn_release_date::text AS current FROM public.operators ORDER BY id FOR UPDATE",
    "COMMIT",
  ]);
  assert.deepEqual(scripted.queries[2].values, ["2026-01-01", "char_a"]);
});

test("synchronization rolls back on a pre-existing date conflict", async () => {
  const scripted = scriptedClient([
    { rows: [{ id: "char_4231_clemnt", current: null, proposed: null }, { id: "char_a", current: "2026-02-01", proposed: null }], rowCount: 2 },
    { rows: [], rowCount: 0 },
  ]);
  await assert.rejects(synchronize(scripted.client, synchronizationPlan(), true), /existing date conflicts/);
  assert.deepEqual(scripted.queries.map(({ text }) => text), [
    "BEGIN",
    "SELECT id, cn_release_date::text AS current FROM public.operators ORDER BY id FOR UPDATE",
    "ROLLBACK",
  ]);
});

test("synchronization rolls back when post-update verification fails", async () => {
  const scripted = scriptedClient([
    { rows: [{ id: "char_4231_clemnt", current: null, proposed: null }, { id: "char_a", current: null, proposed: null }], rowCount: 2 },
    { rows: [], rowCount: 1 },
    { rows: [{ id: "char_4231_clemnt", current: null, proposed: null }, { id: "char_a", current: null, proposed: null }], rowCount: 2 },
    { rows: [], rowCount: 0 },
  ]);
  await assert.rejects(synchronize(scripted.client, synchronizationPlan(), true), /verification failed/);
  assert.equal(scripted.queries.at(-1)?.text, "ROLLBACK");
});
