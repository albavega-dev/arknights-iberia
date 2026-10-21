import { verifyBiographyImportEnvelope, type BiographyImportEnvelope } from "../../game-data/operator-biography-import";
import type { BiographyRegion, OperatorBiography } from "../../game-data/operator-biography";

export type BiographyStorageKey = {
  readonly operatorId: string;
  readonly region: BiographyRegion;
  readonly sourceRevision: string;
};

export type StoredBiography = OperatorBiography & {
  readonly importedAt: string;
};

export type BiographyRepositoryTransaction = {
  readonly acquireImportLock: () => Promise<void>;
  readonly missingOperatorIds: (operatorIds: readonly string[]) => Promise<readonly string[]>;
  readonly findBiographies: (keys: readonly BiographyStorageKey[]) => Promise<readonly StoredBiography[]>;
  readonly insertIfAbsent: (record: OperatorBiography) => Promise<"inserted" | "already-present">;
  readonly updateMissingProfile: (record: OperatorBiography) => Promise<"updated" | "not-needed">;
};

export type BiographyStorageAdapter = {
  readonly transaction: <T>(work: (transaction: BiographyRepositoryTransaction) => Promise<T>) => Promise<T>;
};

export type BiographyRepositoryConflict = BiographyStorageKey & {
  readonly reason: "content-mismatch";
};

export type BiographyRepositoryReport = {
  readonly status: "committed";
  readonly inserted: number;
  readonly alreadyPresent: number;
  readonly updatedProfiles: number;
  readonly operatorsVerified: number;
  readonly conflicts: readonly BiographyRepositoryConflict[];
};

export class BiographyRepositoryError extends Error {
  constructor(
    readonly code: "invalid-envelope" | "missing-operators" | "content-conflict",
    message: string,
    readonly conflicts: readonly BiographyRepositoryConflict[] = [],
    readonly missingOperatorIds: readonly string[] = [],
  ) {
    super(message);
    this.name = "BiographyRepositoryError";
  }
}

function key(record: Pick<OperatorBiography, "operatorId" | "region"> & { readonly sourceRevision?: string }): string {
  return `${record.operatorId}\u0000${record.region}\u0000${record.sourceRevision ?? ""}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => [name, canonical(entry)]));
  }
  return value;
}

function contentOf(record: unknown): string {
  return JSON.stringify(canonical(record));
}

function sameContent(left: OperatorBiography, right: StoredBiography): boolean {
  const rightContent = Object.fromEntries(Object.entries(right).filter(([name]) => name !== "importedAt"));
  return contentOf(left) === contentOf(rightContent);
}

function sameBasicInfo(left: OperatorBiography, right: StoredBiography): boolean {
  const withoutProfile = (value: OperatorBiography | StoredBiography) => {
    const copy = Object.fromEntries(Object.entries(value).filter(([name]) => name !== "profile" && name !== "importedAt"));
    return contentOf(copy);
  };
  return withoutProfile(left) === withoutProfile(right);
}

function cloneBiography(record: OperatorBiography): OperatorBiography {
  return { ...record, source: { ...record.source }, fields: record.fields.map((field) => ({ ...field })), unrecognizedLines: [...record.unrecognizedLines], profile: record.profile ? { ...record.profile } : null };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function isolateEnvelope(envelope: BiographyImportEnvelope): BiographyImportEnvelope {
  return {
    contractVersion: envelope.contractVersion,
    plan: { records: envelope.plan.records.map(cloneBiography) },
    expected: { en: [...envelope.expected.en], cn: [...envelope.expected.cn] },
    revisions: { en: envelope.revisions.en, cn: envelope.revisions.cn },
    expectedCounts: { ...envelope.expectedCounts },
    sha256: envelope.sha256,
  };
}

function uniqueExpectedIds(envelope: BiographyImportEnvelope): string[] {
  return [...envelope.expected.en, ...envelope.expected.cn];
}

function invalidEnvelopeError(): Error {
  return new BiographyRepositoryError("invalid-envelope", "Biography import envelope failed integrity validation");
}

export async function persistBiographyEnvelope(
  adapter: BiographyStorageAdapter,
  envelope: BiographyImportEnvelope,
): Promise<BiographyRepositoryReport> {
  const isolatedEnvelope = isolateEnvelope(envelope);
  if (!verifyBiographyImportEnvelope(isolatedEnvelope)) throw invalidEnvelopeError();
  const verifiedEnvelope = deepFreeze(isolatedEnvelope);
  if (verifiedEnvelope.expectedCounts.en !== 415 || verifiedEnvelope.expectedCounts.cn !== 17 || verifiedEnvelope.expectedCounts.total !== 432) {
    throw invalidEnvelopeError();
  }

  return adapter.transaction(async (transaction) => {
    await transaction.acquireImportLock();
    const expectedIds = uniqueExpectedIds(verifiedEnvelope);
    const missingOperators = await transaction.missingOperatorIds(expectedIds);
    if (missingOperators.length) throw new BiographyRepositoryError("missing-operators", "Biography import references missing operators", [], missingOperators);

    const records = verifiedEnvelope.plan.records;
    const existing = new Map((await transaction.findBiographies(records.map((record) => ({
      operatorId: record.operatorId,
      region: record.region,
      sourceRevision: record.source.revision,
    })))).map((record) => [key({ operatorId: record.operatorId, region: record.region, sourceRevision: record.source.revision }), record]));
    let inserted = 0;
    let alreadyPresent = 0;
    let updatedProfiles = 0;
    const conflicts: BiographyRepositoryConflict[] = [];

    for (const record of records) {
      const storageKey = { operatorId: record.operatorId, region: record.region, sourceRevision: record.source.revision } as const;
      const existingRecord = existing.get(key(storageKey));
      if (existingRecord) {
        if (sameContent(record, existingRecord)) alreadyPresent += 1;
        else if (record.profile && !existingRecord.profile && sameBasicInfo(record, existingRecord)) {
          const result = await transaction.updateMissingProfile(deepFreeze(cloneBiography(record)));
          if (result === "updated") updatedProfiles += 1;
          else {
            const raced = (await transaction.findBiographies([storageKey])).find((candidate) => key({ operatorId: candidate.operatorId, region: candidate.region, sourceRevision: candidate.source.revision }) === key(storageKey));
            if (!raced || !sameContent(record, raced)) conflicts.push({ ...storageKey, reason: "content-mismatch" });
            else alreadyPresent += 1;
          }
        } else conflicts.push({ ...storageKey, reason: "content-mismatch" });
        continue;
      }
      const result = await transaction.insertIfAbsent(deepFreeze(cloneBiography(record)));
      if (result === "inserted") {
        inserted += 1;
        continue;
      }

      // Another writer may have inserted after findBiographies(). Re-read the key;
      // correctness does not depend on both writers acquiring the cooperative lock.
      const raced = (await transaction.findBiographies([storageKey])).find((candidate) => key({
        operatorId: candidate.operatorId,
        region: candidate.region,
        sourceRevision: candidate.source.revision,
      }) === key(storageKey));
      if (!raced || !sameContent(record, raced)) conflicts.push({ ...storageKey, reason: "content-mismatch" });
      else alreadyPresent += 1;
    }

    if (conflicts.length) throw new BiographyRepositoryError("content-conflict", "Biography import content conflict", conflicts);
    return { status: "committed", inserted, alreadyPresent, updatedProfiles, operatorsVerified: expectedIds.length, conflicts };
  });
}
