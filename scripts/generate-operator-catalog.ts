import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GameDataRegion } from "../src/game-data/gamedata-revisions";
import { validateBiography, type OperatorBiography } from "../src/game-data/operator-biography";
import { catalogContractVersion, catalogDatasetName, catalogLimits, catalogOperator, validateOperatorCatalog, type OperatorCatalog } from "../src/game-data/operator-catalog";
import { biographiesDatasetContractVersion, biographiesDatasetLimits, datasetWarningRatio, serializeDatasetJson, validateDatasetIndex, type DatasetIndex, type DatasetLimits, type DatasetSource } from "../src/game-data/operator-dataset";
import { arg, buildCatalogRecords, readCatalogTables, type CatalogRecords, type CatalogTableHashes, type RegionalManifest, type ReleaseManifest } from "./generate-operator-bundle";
import { compareDatasets, exists, operatorDatasetFile, readJson, replaceDirectory, reportVerification, sha256, writeDatasetDirectory, type ComparableDataset } from "./operator-dataset-io";

// Generates the operator catalog (data/operator-catalog/index.json) and the biographies (data/operator-biographies/)
// from the pinned character and handbook tables and the release manifests.
export const biographiesDatasetName = "operator-biographies";
export const catalogDirectory = (root: string) => join(root, catalogDatasetName);
export const biographiesDirectory = (root: string) => join(root, biographiesDatasetName);

export type BiographiesDataset = { sources: Record<GameDataRegion, DatasetSource>; records: OperatorBiography[] };
export type CatalogDataset = { catalog: OperatorCatalog; biographies: BiographiesDataset };
export type CatalogGeneratorOptions = Readonly<{
  hashes?: CatalogTableHashes;
  releaseManifest?: string;
  regionalManifest?: string;
  catalogLimits?: Readonly<{ fileBytes: number }>;
  biographiesLimits?: DatasetLimits;
}>;

export function buildCatalogDataset(records: CatalogRecords, limits: Readonly<{ fileBytes: number }> = catalogLimits): CatalogDataset {
  const operators = records.operators.map((record) => catalogOperator(record, records.sources));
  const catalog: OperatorCatalog = { contractVersion: catalogContractVersion, dataset: catalogDatasetName, sources: records.sources, limits: { ...limits }, operators };
  const errors = validateOperatorCatalog(catalog);
  if (errors.length) throw new Error(`Invalid catalog: ${errors.join("; ")}`);
  // Every operator has exactly one biography, from the snapshot of its catalog region.
  const regions = new Map<string, GameDataRegion[]>();
  for (const record of records.biographies) regions.set(record.operatorId, [...(regions.get(record.operatorId) ?? []), record.region]);
  const unmatched = operators.filter((operator) => regions.get(operator.id)?.join() !== operator.sourceLocale).map((operator) => operator.id);
  const orphans = [...regions.keys()].filter((id) => !operators.some((operator) => operator.id === id));
  if (unmatched.length || orphans.length) throw new Error(`Biographies do not match the catalog: ${[...unmatched, ...orphans].join(", ")}`);
  return { catalog, biographies: { sources: records.biographySources, records: records.biographies } };
}

export async function readCatalogDataset(root: string): Promise<CatalogDataset> {
  const catalog = await readJson(join(catalogDirectory(root), "index.json")) as OperatorCatalog;
  const catalogErrors = validateOperatorCatalog(catalog);
  if (catalogErrors.length) throw new Error(`Invalid catalog: ${catalogErrors.join("; ")}`);
  const directory = biographiesDirectory(root);
  const index = await readJson(join(directory, "index.json")) as DatasetIndex;
  const errors = validateDatasetIndex(index, biographiesDatasetContractVersion);
  if (errors.length) throw new Error(`Invalid dataset index: ${errors.join("; ")}`);
  const records: OperatorBiography[] = [];
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const text = await readFile(join(directory, entry.file), "utf8");
    if (sha256(text) !== entry.sha256) throw new Error(`Dataset file hash mismatch: ${entry.file}`);
    const result = validateBiography(JSON.parse(text));
    if (!result.ok || result.value.operatorId !== operatorId || result.value.region !== entry.region) throw new Error(`Invalid biography file: ${entry.file}`);
    records.push(result.value);
  }
  return { catalog, biographies: { sources: index.sources as Record<GameDataRegion, DatasetSource>, records } };
}

function comparableCatalog(catalog: OperatorCatalog): ComparableDataset {
  return { sources: catalog.sources, profiles: catalog.operators.map((operator) => ({ operatorId: operator.id, region: operator.sourceLocale, ...operator })), shared: {} };
}

function comparableBiographies(biographies: BiographiesDataset): ComparableDataset {
  return { sources: biographies.sources, profiles: biographies.records, shared: {} };
}

/** Compares the generated catalog and biographies with the versioned ones and fails, without writing, on any difference. */
export async function verifyCatalogAgainst(root: string, dataset: CatalogDataset, log: (line: string) => void = console.log): Promise<void> {
  const reference = await readCatalogDataset(root);
  const failed: string[] = [];
  for (const [label, verification] of [
    ["Catalog", compareDatasets(comparableCatalog(reference.catalog), comparableCatalog(dataset.catalog))],
    ["Biographies", compareDatasets(comparableBiographies(reference.biographies), comparableBiographies(dataset.biographies))],
  ] as const) {
    log(`${label}:`);
    try { reportVerification(verification, log); } catch { failed.push(label); }
  }
  if (failed.length) throw new Error(`Verification failed (${failed.join(", ")}); output not written`);
}

export async function writeCatalogDataset(root: string, dataset: CatalogDataset, options: Readonly<{ force: boolean; biographiesLimits?: DatasetLimits }>): Promise<{ catalogBytes: number; biographiesBytes: number; largestBiography: number; warnings: string[] }> {
  const catalogText = serializeDatasetJson(dataset.catalog);
  const catalogBytes = Buffer.byteLength(catalogText);
  const limit = dataset.catalog.limits.fileBytes;
  if (catalogBytes > limit) throw new Error(`Catalog is ${catalogBytes} bytes, above the ${limit}-byte limit; output not written`);
  const warnings = catalogBytes >= limit * datasetWarningRatio ? [`Catalog is ${catalogBytes} bytes, at least 90% of the ${limit}-byte limit`] : [];
  if (!options.force && (await exists(catalogDirectory(root)) || await exists(biographiesDirectory(root)))) throw new Error("Output exists; pass --force to overwrite");
  const files = dataset.biographies.records.map((record) => operatorDatasetFile(record.operatorId, record.region, record));
  const biographies = await writeDatasetDirectory(biographiesDirectory(root), biographiesDatasetName, dataset.biographies.sources, files, { force: options.force, limits: options.biographiesLimits ?? biographiesDatasetLimits, extras: { contractVersion: biographiesDatasetContractVersion } });
  await replaceDirectory(catalogDirectory(root), options.force, (partial) => writeFile(join(partial, "index.json"), catalogText, "utf8"));
  return { catalogBytes, biographiesBytes: biographies.totalBytes, largestBiography: Math.max(...files.map((file) => file.bytes)), warnings: [...warnings, ...biographies.warnings] };
}

export async function main(argv: readonly string[] = process.argv, options: CatalogGeneratorOptions = {}): Promise<void> {
  const root = arg("--out-dir", argv);
  const force = argv.includes("--force");
  if (!force && (await exists(catalogDirectory(root)) || await exists(biographiesDirectory(root)))) throw new Error("Output exists; pass --force to overwrite");
  const tables = await readCatalogTables(argv, options.hashes);
  const release = await readJson(options.releaseManifest ?? "data/operator-cn-release-manifest.json") as ReleaseManifest;
  const regional = await readJson(options.regionalManifest ?? "data/operator-regional-manifest.json") as RegionalManifest;
  const dataset = buildCatalogDataset(buildCatalogRecords(tables, release, regional, options.hashes), options.catalogLimits);
  if (argv.includes("--verify-against")) await verifyCatalogAgainst(arg("--verify-against", argv), dataset);
  const result = await writeCatalogDataset(root, dataset, { force, biographiesLimits: options.biographiesLimits });
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  console.log(`Generated a catalog of ${dataset.catalog.operators.length} operators (${result.catalogBytes} bytes) and ${dataset.biographies.records.length} biographies (${result.biographiesBytes} bytes in total, largest ${result.largestBiography}) under ${root}`);
}

if (process.argv[1]?.endsWith("generate-operator-catalog.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
