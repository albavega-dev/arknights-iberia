import type { GameDataRegion } from "./gamedata-revisions";

// Per-operator datasets (stats and skills): one JSON file per operator plus an index, and optionally shared files (for example a glossary).
// Each dataset declares its contract in its index; this is the default and the one stats uses.
export const datasetContractVersion = "2";
// Version 3 adds base skills (`baseSkills`) to every skills file; version 4 adds talents (`talents`).
export const skillsDatasetContractVersion = "4";
export type DatasetLimits = Readonly<{ fileBytes: number; totalBytes: number }>;
// Each dataset declares its own limits (written into its index); this is the default and the one stats uses.
export const datasetLimits: DatasetLimits = { fileBytes: 32_768, totalBytes: 6_000_000 };
export const skillsDatasetLimits: DatasetLimits = { fileBytes: 65_536, totalBytes: 8_000_000 };
export const datasetWarningRatio = 0.9;

export type DatasetSource = Readonly<{ repository: string; revision: string; path: string; sha256: string }>;
export type DatasetIndexEntry = Readonly<{ region: GameDataRegion; file: string; bytes: number; sha256: string }>;
export type DatasetSharedEntry = Readonly<{ file: string; bytes: number; sha256: string }>;
export type DatasetIndex = Readonly<{
  contractVersion: string;
  dataset: string;
  sources: Readonly<Record<GameDataRegion, DatasetSource>>;
  /** Every pinned table the dataset reads, when it reads more than the main source. */
  tables?: Readonly<Record<GameDataRegion, Readonly<Record<string, DatasetSource>>>>;
  /** Files shared by all operators (not tied to one operator id). */
  shared?: Readonly<Record<string, DatasetSharedEntry>>;
  limits: DatasetLimits;
  operators: Readonly<Record<string, DatasetIndexEntry>>;
}>;
export type DatasetFile = Readonly<{ operatorId: string; region: GameDataRegion; text: string; bytes: number; sha256: string }>;
export type DatasetSharedFile = Readonly<{ name: string; text: string; bytes: number; sha256: string }>;
export type DatasetExtras = Readonly<{ tables?: DatasetIndex["tables"]; shared?: readonly DatasetSharedFile[]; limits?: DatasetLimits; contractVersion?: string }>;

const operatorIdPattern = /^char_[a-z0-9_]+$/;
const sharedNamePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const sha256Pattern = /^[0-9A-F]{64}$/;

export function isOperatorId(value: unknown): value is string { return typeof value === "string" && operatorIdPattern.test(value); }
export function datasetFileName(operatorId: string): string { if (!isOperatorId(operatorId)) throw new Error(`Invalid operator id: ${String(operatorId)}`); return `${operatorId}.json`; }
export function sharedFileName(name: string): string { if (!sharedNamePattern.test(name) || name === "index") throw new Error(`Invalid shared file name: ${String(name)}`); return `${name}.json`; }
export function serializeDatasetJson(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

export function buildDatasetIndex(dataset: string, sources: Record<GameDataRegion, DatasetSource>, files: readonly DatasetFile[], extras: DatasetExtras = {}): DatasetIndex {
  const operators: Record<string, DatasetIndexEntry> = {};
  for (const file of [...files].sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en"))) {
    if (operators[file.operatorId]) throw new Error(`Duplicate dataset operator: ${file.operatorId}`);
    operators[file.operatorId] = { region: file.region, file: datasetFileName(file.operatorId), bytes: file.bytes, sha256: file.sha256 };
  }
  const index: DatasetIndex = { contractVersion: extras.contractVersion ?? datasetContractVersion, dataset, sources, ...(extras.tables ? { tables: extras.tables } : {}), limits: { ...(extras.limits ?? datasetLimits) }, operators };
  if (!extras.shared?.length) return index;
  const shared: Record<string, DatasetSharedEntry> = {};
  for (const file of [...extras.shared].sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (shared[file.name]) throw new Error(`Duplicate shared file: ${file.name}`);
    shared[file.name] = { file: sharedFileName(file.name), bytes: file.bytes, sha256: file.sha256 };
  }
  return { ...index, shared };
}

export function validateDatasetIndex(value: unknown, contractVersion: string = datasetContractVersion): string[] {
  const errors: string[] = [];
  const index = value as Partial<DatasetIndex> | null;
  if (!index || typeof index !== "object") return ["Index is not an object"];
  if (index.contractVersion !== contractVersion) errors.push(`Unsupported contract: ${String(index.contractVersion)}`);
  if (typeof index.dataset !== "string" || !index.dataset) errors.push("Missing dataset name");
  for (const region of ["en", "cn"] as const) if (!index.sources?.[region]?.revision) errors.push(`Missing ${region} source`);
  const limits = index.limits;
  if (!limits || !Number.isInteger(limits.fileBytes) || limits.fileBytes <= 0 || !Number.isInteger(limits.totalBytes) || limits.totalBytes < limits.fileBytes) errors.push("Invalid limits");
  if (!index.operators || typeof index.operators !== "object") return [...errors, "Missing operators"];
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    if (!isOperatorId(operatorId)) errors.push(`Invalid operator id: ${operatorId}`);
    else if (entry?.file !== datasetFileName(operatorId)) errors.push(`Unexpected file for ${operatorId}`);
    if (entry?.region !== "en" && entry?.region !== "cn") errors.push(`Invalid region for ${operatorId}`);
    if (!Number.isInteger(entry?.bytes) || entry.bytes <= 0) errors.push(`Invalid size for ${operatorId}`);
    if (typeof entry?.sha256 !== "string" || !sha256Pattern.test(entry.sha256)) errors.push(`Invalid hash for ${operatorId}`);
  }
  for (const [name, entry] of Object.entries(index.shared ?? {})) {
    if (!sharedNamePattern.test(name) || name === "index") errors.push(`Invalid shared file name: ${name}`);
    else if (entry?.file !== `${name}.json`) errors.push(`Unexpected file for shared ${name}`);
    if (!Number.isInteger(entry?.bytes) || entry.bytes <= 0) errors.push(`Invalid size for shared ${name}`);
    if (typeof entry?.sha256 !== "string" || !sha256Pattern.test(entry.sha256)) errors.push(`Invalid hash for shared ${name}`);
  }
  return errors;
}

export function checkDatasetLimits(index: DatasetIndex, indexBytes: number, limits: DatasetLimits = index.limits): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const check = (label: string, bytes: number, limit: number) => {
    if (bytes > limit) errors.push(`${label} is ${bytes} bytes, above the ${limit}-byte limit`);
    else if (bytes >= limit * datasetWarningRatio) warnings.push(`${label} is ${bytes} bytes, at least 90% of the ${limit}-byte limit`);
  };
  const entries = [...Object.values(index.operators), ...Object.values(index.shared ?? {})];
  for (const entry of entries) check(entry.file, entry.bytes, limits.fileBytes);
  check(`Dataset ${index.dataset}`, indexBytes + entries.reduce((sum, entry) => sum + entry.bytes, 0), limits.totalBytes);
  return { errors, warnings };
}
