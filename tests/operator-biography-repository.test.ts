import assert from "node:assert/strict";
import test from "node:test";
import { persistBiographyEnvelope, type BiographyRepositoryTransaction, type BiographyStorageAdapter, type StoredBiography } from "../src/server/db/operator-biography-repository";
import { preflightBiographies, type BiographyPreflightInput } from "../src/game-data/operator-biography-import";
import type { BiographyRegion, OperatorBiography } from "../src/game-data/operator-biography";

const revisions = { en: "3aaa25b649fed5dedad9527602826dc487ea07d8", cn: "e4888c5b4d9b57aa3bfd4d109ae70f74cf3b7842" } as const;
const expectedEn = Array.from({ length: 415 }, (_, index) => `char_en_${index}`);
const expectedCn = Array.from({ length: 17 }, (_, index) => `char_cn_${index}`);

function record(operatorId: string, region: BiographyRegion, value = "fixture"): OperatorBiography {
  return {
    operatorId, region, storyTitle: region === "en" ? "Basic Info" : "基础档案",
    source: { repository: "fixture", revision: revisions[region], path: `${region}.json`, sha256: "a".repeat(64) },
    fields: [{ key: "name", label: "Name", value, state: "value" }], originalText: `[Name] ${value}`, unrecognizedLines: [],
  };
}

function envelope(records = [...expectedEn.map((id) => record(id, "en")), ...expectedCn.map((id) => record(id, "cn"))]) {
  const input: BiographyPreflightInput = { records, expected: { en: expectedEn, cn: expectedCn }, revisions, coverage: "complete" };
  const result = preflightBiographies(input);
  assert.equal(result.report.ok, true);
  if (!result.report.ok) throw new Error("fixture envelope failed");
  assert.ok("envelope" in result);
  return result.envelope;
}

class FakeAdapter implements BiographyStorageAdapter {
  readonly rows = new Map<string, StoredBiography>();
  missing = new Set<string>();
  failLock = false;
  failInsertAt: number | undefined;
  insertCalls = 0;
  private queue: Promise<void> = Promise.resolve();

  async transaction<T>(work: (transaction: BiographyRepositoryTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = new Map(this.rows);
    try {
      return await work({
        acquireImportLock: async () => { if (this.failLock) throw new Error("lock failure"); },
        missingOperatorIds: async (ids) => ids.filter((id) => this.missing.has(id)),
        findBiographies: async (keys) => keys.flatMap((entry) => {
          const found = this.rows.get(`${entry.operatorId}\u0000${entry.region}\u0000${entry.sourceRevision}`);
          return found ? [found] : [];
        }),
        insertIfAbsent: async (value) => {
          this.insertCalls += 1;
          if (this.failInsertAt === this.insertCalls) throw new Error("insert failure");
          const storageKey = `${value.operatorId}\u0000${value.region}\u0000${value.source.revision}`;
          if (this.rows.has(storageKey)) return "already-present";
          this.rows.set(storageKey, { ...value, importedAt: "fixture" });
          return "inserted";
        },
        updateMissingProfile: async (value) => {
          const storageKey = `${value.operatorId}\u0000${value.region}\u0000${value.source.revision}`;
          const existing = this.rows.get(storageKey);
          if (!existing || existing.profile || !value.profile) return "not-needed";
          this.rows.set(storageKey, { ...existing, profile: { ...value.profile } });
          return "updated";
        },
      });
    } catch (error) {
      this.rows.clear();
      for (const [key, value] of before) this.rows.set(key, value);
      throw error;
    } finally { release(); }
  }
}

test("imports 432 records and is idempotent", async () => {
  const adapter = new FakeAdapter();
  const first = await persistBiographyEnvelope(adapter, envelope());
  const second = await persistBiographyEnvelope(adapter, envelope());
  assert.equal(first.inserted, 432);
  assert.equal(second.inserted, 0);
  assert.equal(second.alreadyPresent, 432);
  assert.equal(adapter.rows.size, 432);
});

test("backfills Profile without overwriting existing Basic Info", async () => {
  const adapter = new FakeAdapter();
  const basicRecords = [...expectedEn.map((id) => record(id, "en")), ...expectedCn.map((id) => record(id, "cn"))];
  const profileRecords = basicRecords.map((value) => ({ ...value, profile: { storyTitle: value.region === "en" ? "Profile" : "客观履历", text: `Profile for ${value.operatorId}` } }));
  const first = await persistBiographyEnvelope(adapter, envelope(basicRecords));
  const second = await persistBiographyEnvelope(adapter, envelope(profileRecords));
  assert.equal(first.inserted, 432);
  assert.equal(second.updatedProfiles, 432);
  assert.equal(second.alreadyPresent, 0);
  assert.equal([...adapter.rows.values()].filter((value) => value.profile).length, 432);
});

test("rejects same-key content conflicts and rolls back", async () => {
  const adapter = new FakeAdapter();
  const base = envelope();
  await persistBiographyEnvelope(adapter, base);
  const changed = envelope(base.plan.records.map((item: OperatorBiography, index: number) => index === 0 ? { ...item, originalText: "different" } : item));
  await assert.rejects(() => persistBiographyEnvelope(adapter, changed), /content conflict/u);
  assert.equal(adapter.rows.size, 432);
});

test("rolls back inserts after a later insertion failure", async () => {
  const adapter = new FakeAdapter();
  adapter.failInsertAt = 200;
  await assert.rejects(() => persistBiographyEnvelope(adapter, envelope()), /insert failure/u);
  assert.equal(adapter.rows.size, 0);
});

test("rejects missing operators and lock failures before commit", async () => {
  const missing = new FakeAdapter(); missing.missing.add(expectedEn[0]);
  await assert.rejects(() => persistBiographyEnvelope(missing, envelope()), /missing operators/u);
  assert.equal(missing.rows.size, 0);
  const locked = new FakeAdapter(); locked.failLock = true;
  await assert.rejects(() => persistBiographyEnvelope(locked, envelope()), /lock failure/u);
  assert.equal(locked.rows.size, 0);
});

test("rejects manipulated envelopes before opening storage", async () => {
  const adapter = new FakeAdapter();
  const valid = envelope();
  const manipulated = { ...valid, expectedCounts: { ...valid.expectedCounts, total: 431 } };
  await assert.rejects(() => persistBiographyEnvelope(adapter, manipulated), /integrity validation/u);
  assert.equal(adapter.insertCalls, 0);
});

test("serializes concurrent identical imports and keeps the result idempotent", async () => {
  const adapter = new FakeAdapter();
  const [first, second] = await Promise.all([persistBiographyEnvelope(adapter, envelope()), persistBiographyEnvelope(adapter, envelope())]);
  assert.equal(first.inserted + second.inserted, 432);
  assert.equal(adapter.rows.size, 432);
  assert.equal(first.alreadyPresent + second.alreadyPresent, 432);
});

test("does not expose original content in repository errors", async () => {
  const adapter = new FakeAdapter();
  const base = envelope();
  await persistBiographyEnvelope(adapter, base);
  const changed = envelope(base.plan.records.map((item: OperatorBiography, index: number) => index === 0 ? { ...item, originalText: "SECRET_BIOGRAPHY_MARKER" } : item));
  await assert.rejects(() => persistBiographyEnvelope(adapter, changed), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message.includes("SECRET_BIOGRAPHY_MARKER") : false, false);
    return true;
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("isolates the envelope from mutations while a transaction is in progress", async () => {
  const adapter = new FakeAdapter();
  const source = envelope();
  const firstRecord = source.plan.records[0]!;
  const entered = deferred<void>();
  const release = deferred<void>();
  const gated: BiographyStorageAdapter = {
    transaction: async (work) => adapter.transaction(async (transaction) => {
      entered.resolve();
      await release.promise;
      return work(transaction);
    }),
  };
  const operation = persistBiographyEnvelope(gated, source);
  await entered.promise;
  (firstRecord.fields as unknown as Array<{ value: string }>)[0]!.value = "mutated";
  (firstRecord.unrecognizedLines as string[]).push("mutated");
  (source.plan.records as Array<OperatorBiography>)[0] = { ...firstRecord, originalText: "mutated" };
  release.resolve();
  await operation;
  const stored = adapter.rows.get(`${firstRecord.operatorId}\u0000${firstRecord.region}\u0000${firstRecord.source.revision}`);
  assert.equal(stored?.originalText, "[Name] fixture");
  assert.equal(stored?.fields[0]?.value, "fixture");
  assert.deepEqual(stored?.unrecognizedLines, []);
});

test("rejects an adapter mutation attempt and rolls back", async () => {
  const adapter = new FakeAdapter();
  const mutating: BiographyStorageAdapter = {
    transaction: (work) => adapter.transaction((transaction) => work({
      ...transaction,
      insertIfAbsent: async (record) => {
        (record.fields as unknown as Array<{ value: string }>)[0]!.value = "adapter mutation";
        return transaction.insertIfAbsent(record);
      },
      updateMissingProfile: async () => "not-needed",
    })),
  };
  await assert.rejects(() => persistBiographyEnvelope(mutating, envelope()), /Cannot assign|read only|frozen/u);
  assert.equal(adapter.rows.size, 0);
});
