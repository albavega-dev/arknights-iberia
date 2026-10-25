import type { GameDataRegion } from "./gamedata-revisions";

// Per-operator datasets (stats, and later skills): one JSON file per operator plus an index.
export const datasetContractVersion = "2";
export const datasetLimits = { fileBytes: 32_768, totalBytes: 6_000_000 } as const;
export const datasetWarningRatio = 0.9;

export type DatasetSource = Readonly<{ repository: string; revision: string; path: string; sha256: string }>;
export type DatasetIndexEntry = Readonly<{ region: GameDataRegion; file: string; bytes: number; sha256: string }>;
export type DatasetIndex = Readonly<{
  contractVersion: typeof datasetContractVersion;
  dataset: string;
  sources: Readonly<Record<GameDataRegion, DatasetSource>>;
  limits: Readonly<{ fileBytes: number; totalBytes: number }>;
  operators: Readonly<Record<string, DatasetIndexEntry>>;
}>;
export type DatasetFile = Readonly<{ operatorId: string; region: GameDataRegion; text: string; bytes: number; sha256: string }>;

const operatorIdPattern = /^char_[a-z0-9_]+$/;
const sha256Pattern = /^[0-9A-F]{64}$/;

export function isOperatorId(value: unknown): value is string { return typeof value === "string" && operatorIdPattern.test(value); }
export function datasetFileName(operatorId: string): string { if (!isOperatorId(operatorId)) throw new Error(`Invalid operator id: ${String(operatorId)}`); return `${operatorId}.json`; }
export function serializeDatasetJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

export function buildDatasetIndex(dataset: string, sources: Record<GameDataRegion, DatasetSource>, files: readonly DatasetFile[]): DatasetIndex {
  const operators: Record<string, DatasetIndexEntry> = {};
  for (const file of [...files].sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en"))) {
    if (operators[file.operatorId]) throw new Error(`Duplicate dataset operator: ${file.operatorId}`);
    operators[file.operatorId] = { region: file.region, file: datasetFileName(file.operatorId), bytes: file.bytes, sha256: file.sha256 };
  }
  return { contractVersion: datasetContractVersion, dataset, sources, limits: { ...datasetLimits }, operators };
}

export function validateDatasetIndex(value: unknown): string[] {
  const errors: string[] = [];
  const index = value as Partial<DatasetIndex> | null;
  if (!index || typeof index !== "object") return ["Index is not an object"];
  if (index.contractVersion !== datasetContractVersion) errors.push(`Unsupported contract: ${String(index.contractVersion)}`);
  if (typeof index.dataset !== "string" || !index.dataset) errors.push("Missing dataset name");
  for (const region of ["en", "cn"] as const) if (!index.sources?.[region]?.revision) errors.push(`Missing ${region} source`);
  if (!index.operators || typeof index.operators !== "object") return [...errors, "Missing operators"];
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    if (!isOperatorId(operatorId)) errors.push(`Invalid operator id: ${operatorId}`);
    else if (entry?.file !== datasetFileName(operatorId)) errors.push(`Unexpected file for ${operatorId}`);
    if (entry?.region !== "en" && entry?.region !== "cn") errors.push(`Invalid region for ${operatorId}`);
    if (!Number.isInteger(entry?.bytes) || entry.bytes <= 0) errors.push(`Invalid size for ${operatorId}`);
    if (typeof entry?.sha256 !== "string" || !sha256Pattern.test(entry.sha256)) errors.push(`Invalid hash for ${operatorId}`);
  }
  return errors;
}

export function checkDatasetLimits(index: DatasetIndex, indexBytes: number, limits: Readonly<{ fileBytes: number; totalBytes: number }> = datasetLimits): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const check = (label: string, bytes: number, limit: number) => {
    if (bytes > limit) errors.push(`${label} is ${bytes} bytes, above the ${limit}-byte limit`);
    else if (bytes >= limit * datasetWarningRatio) warnings.push(`${label} is ${bytes} bytes, at least 90% of the ${limit}-byte limit`);
  };
  for (const entry of Object.values(index.operators)) check(entry.file, entry.bytes, limits.fileBytes);
  check(`Dataset ${index.dataset}`, indexBytes + Object.values(index.operators).reduce((sum, entry) => sum + entry.bytes, 0), limits.totalBytes);
  return { errors, warnings };
}
