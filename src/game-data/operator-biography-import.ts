import { createHash } from "node:crypto";

import {
  selectCurrentBiographies,
  validateBiography,
  type BiographyRegion,
  type BiographyRevisionConfig,
  type MissingBiographyRevision,
  type OperatorBiography,
} from "./operator-biography";

export type BiographyCoveragePolicy = "complete";

export type BiographyPreflightDiagnostic = {
  readonly code: string;
  readonly message: string;
  readonly operatorId?: string;
  readonly region?: BiographyRegion;
  readonly revision?: string;
  readonly path?: string;
};

export type BiographyRegionCounts = {
  readonly en: number;
  readonly cn: number;
  readonly total: number;
};

export type BiographyProfileCounts = BiographyRegionCounts;

export type BiographyFieldCoverage = {
  readonly present: number;
  readonly empty: number;
  readonly unknown: number;
  readonly unrecognized: number;
};

export type BiographyPreflightReport = {
  readonly ok: boolean;
  readonly policy: BiographyCoveragePolicy;
  readonly expected: BiographyRegionCounts;
  readonly received: BiographyRegionCounts;
  readonly selected: BiographyRegionCounts;
  readonly missing: readonly MissingBiographyRevision[];
  readonly unexpected: readonly string[];
  readonly duplicates: readonly BiographyPreflightDiagnostic[];
  readonly errors: readonly BiographyPreflightDiagnostic[];
  readonly warnings: readonly BiographyPreflightDiagnostic[];
  readonly fieldCoverage: Readonly<Record<string, BiographyFieldCoverage>>;
  readonly profileCoverage: BiographyProfileCounts;
};

export type BiographyImportPlan = {
  readonly records: readonly OperatorBiography[];
};

export const biographyImportContractVersion = "2" as const;

export type BiographyImportEnvelope = {
  readonly contractVersion: typeof biographyImportContractVersion;
  readonly plan: BiographyImportPlan;
  readonly expected: Readonly<{ en: readonly string[]; cn: readonly string[] }>;
  readonly revisions: BiographyRevisionConfig;
  readonly expectedCounts: BiographyRegionCounts;
  readonly sha256: string;
};

export type BiographyPreflightInput = {
  readonly records: readonly OperatorBiography[];
  readonly expected: Readonly<{ en: readonly string[]; cn: readonly string[] }>;
  readonly revisions: BiographyRevisionConfig;
  readonly coverage: BiographyCoveragePolicy;
};

export type BiographyPreflightResult =
  | { readonly report: BiographyPreflightReport & { readonly ok: true }; readonly plan: BiographyImportPlan; readonly envelope: BiographyImportEnvelope }
  | { readonly report: BiographyPreflightReport & { readonly ok: false }; readonly plan?: never };

const unknownValues = new Set(["unknown", "undisclosed", "未公开", "未录入"]);

function counts(en: number, cn: number): BiographyRegionCounts {
  return { en, cn, total: en + cn };
}

function diagnostic(code: string, message: string, details: Omit<BiographyPreflightDiagnostic, "code" | "message"> = {}): BiographyPreflightDiagnostic {
  return { code, message, ...details };
}

function cloneBiography(record: OperatorBiography): OperatorBiography {
  return {
    ...record,
    source: { ...record.source },
    fields: record.fields.map((field) => ({ ...field })),
    unrecognizedLines: [...record.unrecognizedLines],
    profile: record.profile ? { ...record.profile } : record.profile ?? null,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function envelopePayload(envelope: Omit<BiographyImportEnvelope, "sha256">): string {
  return JSON.stringify(canonicalize(envelope));
}

function fingerprint(envelope: Omit<BiographyImportEnvelope, "sha256">): string {
  return createHash("sha256").update(envelopePayload(envelope), "utf8").digest("hex");
}

function buildEnvelope(plan: BiographyImportPlan, expected: BiographyPreflightInput["expected"], revisions: BiographyRevisionConfig, expectedCounts: BiographyRegionCounts): BiographyImportEnvelope {
  const payload = {
    contractVersion: biographyImportContractVersion,
    plan: { records: [...plan.records].sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en") || a.region.localeCompare(b.region, "en")).map(cloneBiography) },
    expected: { en: [...expected.en].sort(), cn: [...expected.cn].sort() },
    revisions: { en: revisions.en, cn: revisions.cn },
    expectedCounts,
  } satisfies Omit<BiographyImportEnvelope, "sha256">;
  return { ...payload, sha256: fingerprint(payload) };
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function verifyBiographyImportEnvelope(envelope: BiographyImportEnvelope): boolean {
  if (!envelope || envelope.contractVersion !== biographyImportContractVersion || !/^[a-f0-9]{64}$/u.test(envelope.sha256)) return false;
  if (!envelope.plan || !Array.isArray(envelope.plan.records)) return false;
  if (!envelope.expected || !Array.isArray(envelope.expected.en) || !Array.isArray(envelope.expected.cn)) return false;
  if (envelope.revisions?.en !== undefined && envelope.revisions?.cn !== undefined) {
    const result = preflightBiographies({ records: envelope.plan.records, expected: envelope.expected, revisions: envelope.revisions, coverage: "complete" });
    if (!result.report.ok || !("envelope" in result)) return false;
    const expected = { en: [...envelope.expected.en].sort(), cn: [...envelope.expected.cn].sort() };
    if (!sameStringArray(result.envelope.expected.en, expected.en) || !sameStringArray(result.envelope.expected.cn, expected.cn)) return false;
    if (JSON.stringify(result.envelope.expectedCounts) !== JSON.stringify(envelope.expectedCounts)) return false;
    const payload = { ...envelope, sha256: undefined };
    delete (payload as { sha256?: undefined }).sha256;
    return fingerprint(payload as Omit<BiographyImportEnvelope, "sha256">) === envelope.sha256;
  }
  return false;
}

function uniqueIds(ids: readonly string[], region: BiographyRegion, errors: BiographyPreflightDiagnostic[]): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    if (result.has(id)) errors.push(diagnostic("duplicate-expected-id", `Duplicate expected ${region} operator ID`, { operatorId: id, region }));
    result.add(id);
  }
  return result;
}

function validateRevisionConfig(revisions: BiographyRevisionConfig, errors: BiographyPreflightDiagnostic[]): void {
  for (const region of ["en", "cn"] as const) {
    if (typeof revisions[region] !== "string" || !/^[0-9a-f]{40}$/iu.test(revisions[region])) {
      errors.push(diagnostic("invalid-revision-config", `Invalid configured ${region} revision`, { region }));
    }
  }
}

export function preflightBiographies(input: BiographyPreflightInput): BiographyPreflightResult {
  const errors: BiographyPreflightDiagnostic[] = [];
  const warnings: BiographyPreflightDiagnostic[] = [];
  const duplicates: BiographyPreflightDiagnostic[] = [];
  validateRevisionConfig(input.revisions, errors);
  if (input.coverage !== "complete") errors.push(diagnostic("invalid-coverage-policy", "Unsupported biography coverage policy"));

  const expectedEn = uniqueIds(input.expected.en, "en", errors);
  const expectedCn = uniqueIds(input.expected.cn, "cn", errors);
  for (const id of expectedEn) if (expectedCn.has(id)) errors.push(diagnostic("regional-overlap", "Operator is expected in both regions", { operatorId: id }));

  const receivedKeys = new Set<string>();
  const validRecords: OperatorBiography[] = [];
  const unexpected = new Set<string>();
  const invalidRecordIndexes = new Set<number>();

  input.records.forEach((record, index) => {
    const validation = validateBiography(record);
    if (!validation.ok) {
      invalidRecordIndexes.add(index);
      for (const issue of validation.issues) errors.push(diagnostic("invalid-record", issue.message, { path: `records[${index}].${issue.path}` }));
      return;
    }
    const key = `${record.operatorId}\u0000${record.region}\u0000${record.source.revision}`;
    if (receivedKeys.has(key)) {
      duplicates.push(diagnostic("duplicate-record", "Duplicate operator, region and revision", { operatorId: record.operatorId, region: record.region, revision: record.source.revision }));
      return;
    }
    receivedKeys.add(key);
    validRecords.push(record);
    const expected = record.region === "en" ? expectedEn : expectedCn;
    if (!expected.has(record.operatorId)) {
      unexpected.add(record.operatorId);
      errors.push(diagnostic("unexpected-operator", "Operator is not expected for its region", { operatorId: record.operatorId, region: record.region, revision: record.source.revision }));
    }
  });

  let selected: readonly OperatorBiography[] = [];
  let missing: readonly MissingBiographyRevision[] = [];
  try {
    const selection = selectCurrentBiographies(validRecords, input.revisions);
    selected = selection.records;
    missing = selection.missing;
  } catch (error) {
    errors.push(diagnostic("selection-failed", error instanceof Error ? error.message : "Biography revision selection failed"));
  }
  const selectedKeys = new Set(selected.map((record) => `${record.operatorId}\u0000${record.region}`));
  const missingExpected: MissingBiographyRevision[] = [];
  for (const [region, ids] of [["en", expectedEn], ["cn", expectedCn]] as const) {
    for (const operatorId of ids) {
      if (!selectedKeys.has(`${operatorId}\u0000${region}`)) {
        missingExpected.push({ operatorId, region, revision: input.revisions[region] });
      }
    }
  }
  missing = [...missing, ...missingExpected];
  for (const item of missing) errors.push(diagnostic("missing-current-biography", "Configured current biography is missing", item));

  const selectedByRegion = selected.reduce((result, record) => {
    result[record.region] += 1;
    return result;
  }, { en: 0, cn: 0 });
  const receivedByRegion = input.records.reduce((result, record) => {
    if (record.region === "en" || record.region === "cn") result[record.region] += 1;
    return result;
  }, { en: 0, cn: 0 });
  const expected = counts(expectedEn.size, expectedCn.size);
  const received = counts(receivedByRegion.en, receivedByRegion.cn);
  const selectedCounts = counts(selectedByRegion.en, selectedByRegion.cn);
  const profileByRegion = selected.reduce((result, record) => {
    if (record.profile) result[record.region] += 1;
    return result;
  }, { en: 0, cn: 0 });

  const fieldAccumulator = new Map<string, BiographyFieldCoverage>();
  for (const record of selected) for (const field of record.fields) {
    const current = fieldAccumulator.get(field.key) ?? { present: 0, empty: 0, unknown: 0, unrecognized: 0 };
    const isUnknown = unknownValues.has(field.value.trim().toLowerCase());
    fieldAccumulator.set(field.key, {
      present: current.present + (field.state === "value" ? 1 : 0),
      empty: current.empty + (field.state === "empty" ? 1 : 0),
      unknown: current.unknown + (isUnknown ? 1 : 0),
      unrecognized: current.unrecognized + (field.key.startsWith("unrecognized:") ? 1 : 0),
    });
  }
  selected.forEach((record, recordIndex) => {
    record.unrecognizedLines.forEach((_, lineIndex) => {
      warnings.push(diagnostic("unrecognized-line", "Unrecognized biography line retained", {
        operatorId: record.operatorId,
        region: record.region,
        path: `records[${recordIndex}].unrecognizedLines[${lineIndex}]`,
      }));
    });
  });

  const report: BiographyPreflightReport = {
    ok: errors.length === 0 && duplicates.length === 0 && invalidRecordIndexes.size === 0 && selected.length === expected.total,
    policy: input.coverage,
    expected,
    received,
    selected: selectedCounts,
    missing,
    unexpected: [...unexpected].sort(),
    duplicates,
    errors,
    warnings,
    fieldCoverage: Object.fromEntries([...fieldAccumulator.entries()].sort(([a], [b]) => a.localeCompare(b))),
    profileCoverage: counts(profileByRegion.en, profileByRegion.cn),
  };
  if (!report.ok) return { report: report as BiographyPreflightReport & { readonly ok: false } };
  const plan: BiographyImportPlan = { records: selected.map(cloneBiography) };
  const envelope = buildEnvelope(plan, input.expected, input.revisions, expected);
  return { report: report as BiographyPreflightReport & { readonly ok: true }, plan, envelope };
}
