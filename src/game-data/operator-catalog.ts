import type { GameDataRegion } from "./gamedata-revisions";
import { validOperator, type BundleIssue } from "./operator-bundle";
import type { DatasetSource } from "./operator-dataset";
import type { OperatorRecord } from "./operators";

// Operator catalog: one file with every operator, ordered by id, and the provenance of each record.
export const catalogContractVersion = "1";
export const catalogDatasetName = "operator-catalog";
export const catalogLimits = { fileBytes: 786_432 } as const;
/** Regional metadata of an operator whose CN release date has no source. */
export const legacyRegionalMetadataSource = "bundle-v1";

export type ReleaseDateStatus = "verified" | "community-listed";
/** Provenance of one CN release date in the regional manifest; without it, the manifest's common source applies. */
export type ReleaseDateProvenance = Readonly<{ status: ReleaseDateStatus; source: string }>;

export type CatalogOperator = Readonly<{
  id: string;
  name: string;
  cnName: string | null;
  globalName: string | null;
  class: OperatorRecord["class"];
  subClassId: string | null;
  rarity: OperatorRecord["rarity"];
  slug: string;
  cnOnly: boolean;
  availabilityStatus: OperatorRecord["availabilityStatus"];
  cnReleaseDate: string | null;
  cnReleaseDateStatus: ReleaseDateStatus | null;
  cnReleaseDateSource: string | null;
  globalReleaseDate: string | null;
  mainPowerNationId: string | null;
  mainPowerGroupId: string | null;
  mainPowerTeamId: string | null;
  mainFactionId: string | null;
  sourceLocale: GameDataRegion;
  sourceRepository: string;
  sourceRevision: string;
  sourceDataVersion: string;
  cnSourceRevision: string | null;
  regionalMetadataSource: string;
}>;

export type OperatorCatalog = Readonly<{
  contractVersion: string;
  dataset: string;
  sources: Readonly<Record<GameDataRegion, DatasetSource>>;
  limits: Readonly<{ fileBytes: number }>;
  operators: readonly CatalogOperator[];
}>;

const catalogKeys = ["id", "name", "cnName", "globalName", "class", "subClassId", "rarity", "slug", "cnOnly", "availabilityStatus", "cnReleaseDate", "cnReleaseDateStatus", "cnReleaseDateSource", "globalReleaseDate", "mainPowerNationId", "mainPowerGroupId", "mainPowerTeamId", "mainFactionId", "sourceLocale", "sourceRepository", "sourceRevision", "sourceDataVersion", "cnSourceRevision", "regionalMetadataSource"].sort();
const sha256Pattern = /^[0-9a-f]{64}$/iu;

export function isReleaseDateProvenance(value: unknown): value is ReleaseDateProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { status, source, ...rest } = value as Record<string, unknown>;
  return Object.keys(rest).length === 0 && (status === "verified" || status === "community-listed") && typeof source === "string" && /^https:\/\/\S+$/u.test(source);
}

export function regionalMetadataSource(record: Pick<OperatorRecord, "cnReleaseDateStatus" | "cnReleaseDateSource">): string {
  return record.cnReleaseDateSource ? JSON.stringify({ kind: "cn-release", status: record.cnReleaseDateStatus ?? "unclassified", source: record.cnReleaseDateSource }) : legacyRegionalMetadataSource;
}

/** Catalog record of an operator: the record itself plus the snapshot it comes from. */
export function catalogOperator(record: OperatorRecord, sources: Readonly<Record<GameDataRegion, Pick<DatasetSource, "repository" | "revision">>>): CatalogOperator {
  const region: GameDataRegion = record.cnOnly ? "cn" : "en";
  const source = sources[region];
  return {
    id: record.id,
    name: record.name,
    cnName: record.cnName ?? null,
    globalName: record.globalName ?? null,
    class: record.class,
    subClassId: record.subClassId,
    rarity: record.rarity,
    slug: record.slug,
    cnOnly: record.cnOnly,
    availabilityStatus: record.availabilityStatus,
    cnReleaseDate: record.cnReleaseDate,
    cnReleaseDateStatus: record.cnReleaseDateStatus ?? null,
    cnReleaseDateSource: record.cnReleaseDateSource ?? null,
    globalReleaseDate: record.globalReleaseDate,
    mainPowerNationId: record.mainPowerNationId,
    mainPowerGroupId: record.mainPowerGroupId,
    mainPowerTeamId: record.mainPowerTeamId,
    mainFactionId: record.mainFactionId,
    sourceLocale: region,
    sourceRepository: source.repository,
    sourceRevision: source.revision,
    sourceDataVersion: source.revision,
    cnSourceRevision: record.cnOnly ? source.revision : null,
    regionalMetadataSource: regionalMetadataSource(record),
  };
}

/** Operator record shown by the pages: the catalog record without its provenance. */
export function catalogOperatorRecord(operator: CatalogOperator): OperatorRecord {
  return {
    id: operator.id,
    name: operator.name,
    cnName: operator.cnName,
    globalName: operator.globalName,
    class: operator.class,
    subClassId: operator.subClassId,
    rarity: operator.rarity,
    slug: operator.slug,
    cnOnly: operator.cnOnly,
    availabilityStatus: operator.availabilityStatus,
    cnReleaseDate: operator.cnReleaseDate,
    globalReleaseDate: operator.globalReleaseDate,
    mainPowerNationId: operator.mainPowerNationId,
    mainPowerGroupId: operator.mainPowerGroupId,
    mainPowerTeamId: operator.mainPowerTeamId,
    mainFactionId: operator.mainFactionId,
  };
}

function sourceErrors(source: unknown, region: GameDataRegion): string[] {
  const value = source as Partial<DatasetSource> | undefined;
  if (!value || typeof value !== "object") return [`Missing ${region} source`];
  const errors = (["repository", "revision", "path"] as const).filter((key) => typeof value[key] !== "string" || !value[key]).map((key) => `Missing ${region} source ${key}`);
  if (typeof value.sha256 !== "string" || !sha256Pattern.test(value.sha256)) errors.push(`Invalid ${region} source hash`);
  return errors;
}

export function validateOperatorCatalog(value: unknown): string[] {
  const catalog = value as Partial<OperatorCatalog> | null;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return ["Catalog is not an object"];
  const errors: string[] = [];
  if (catalog.contractVersion !== catalogContractVersion) errors.push(`Unsupported contract: ${String(catalog.contractVersion)}`);
  if (catalog.dataset !== catalogDatasetName) errors.push(`Unexpected dataset: ${String(catalog.dataset)}`);
  for (const region of ["en", "cn"] as const) errors.push(...sourceErrors(catalog.sources?.[region], region));
  if (!Number.isInteger(catalog.limits?.fileBytes) || Number(catalog.limits?.fileBytes) <= 0) errors.push("Invalid limits");
  if (!Array.isArray(catalog.operators)) return [...errors, "Missing operators"];
  const slugs = new Set<string>();
  catalog.operators.forEach((entry, position) => {
    const issues: BundleIssue[] = [];
    if (!validOperator(entry as unknown, `operators[${position}]`, issues)) { errors.push(...issues.map((item) => `${item.path}: ${item.message}`)); return; }
    errors.push(...issues.map((item) => `${item.path}: ${item.message}`));
    const id = String(entry.id);
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(catalogKeys)) errors.push(`Unexpected fields for ${id}`);
    if (position > 0 && catalog.operators![position - 1]!.id.localeCompare(id, "en") >= 0) errors.push(`Operators are not sorted by id at ${id}`);
    if (slugs.has(entry.slug)) errors.push(`Duplicate slug for ${id}`);
    slugs.add(entry.slug);
    const source = catalog.sources?.[entry.cnOnly ? "cn" : "en"];
    if (!source) return;
    const expected = catalogOperator(entry, catalog.sources!);
    const provenance = (["sourceLocale", "sourceRepository", "sourceRevision", "sourceDataVersion", "cnSourceRevision", "regionalMetadataSource"] as const).filter((key) => entry[key] !== expected[key]);
    if (provenance.length) errors.push(`Provenance of ${id} does not match its source: ${provenance.join(", ")}`);
  });
  return errors;
}
