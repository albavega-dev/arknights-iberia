import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { GameDataRegion } from "../src/game-data/gamedata-revisions";
import { buildDatasetIndex, checkDatasetLimits, datasetFileName, serializeDatasetJson, sharedFileName, type DatasetExtras, type DatasetLimits, type DatasetFile, type DatasetIndex, type DatasetSource } from "../src/game-data/operator-dataset";

// Helpers shared by the per-operator dataset generators (stats and skills).
export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex").toUpperCase();
export async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, "utf8")); }
export const exists = (path: string) => stat(path).then(() => true, () => false);
export function tableFlag(region: GameDataRegion, table: string): string { return `--${region}-${table.replace(/_table$/, "").replaceAll("_", "-")}`; }
export function arg(name: string, argv: readonly string[]): string { const index = argv.indexOf(name); const value = argv[index + 1]; if (index < 0 || !value || value.startsWith("--")) throw new Error(`Missing ${name}`); return value; }

export async function readCatalog(releasePath: string, regionalPath: string, expectedSize?: number): Promise<Map<string, GameDataRegion>> {
  const ids = (manifest: unknown, label: string) => { const operators = (manifest as { operators?: { id?: unknown }[] }).operators; if (!Array.isArray(operators)) throw new Error(`${label} has no operators`); return operators.map((item) => { if (typeof item.id !== "string") throw new Error(`${label} has an operator without id`); return item.id; }); };
  const catalog = new Map<string, GameDataRegion>();
  for (const [id, region] of [...ids(await readJson(releasePath), "Release manifest").map((id) => [id, "en"] as const), ...ids(await readJson(regionalPath), "Regional manifest").map((id) => [id, "cn"] as const)]) {
    if (catalog.has(id)) throw new Error(`Duplicate catalog operator: ${id}`);
    catalog.set(id, region);
  }
  if (catalog.size === 0) throw new Error("The catalog manifests list no operators");
  if (expectedSize !== undefined && catalog.size !== expectedSize) throw new Error(`Catalog has ${catalog.size} operators; expected ${expectedSize}`);
  return catalog;
}

export function operatorDatasetFile(operatorId: string, region: GameDataRegion, value: unknown): DatasetFile {
  const text = serializeDatasetJson(value);
  return { operatorId, region, text, bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

/**
 * Writes a dataset directory atomically: files go to a partial directory first, limits are checked before anything is
 * written, and the previous directory is only replaced (and restored on failure) once the new one is complete.
 */
export async function writeDatasetDirectory(directory: string, dataset: string, sources: Record<GameDataRegion, DatasetSource>, files: readonly DatasetFile[], options: Readonly<{ force: boolean; limits?: DatasetLimits; extras?: DatasetExtras }>): Promise<{ index: DatasetIndex; totalBytes: number; warnings: string[] }> {
  const index = buildDatasetIndex(dataset, sources, files, { ...options.extras, ...(options.limits ? { limits: options.limits } : {}) });
  const indexText = serializeDatasetJson(index);
  const { errors, warnings } = checkDatasetLimits(index, Buffer.byteLength(indexText));
  if (errors.length) throw new Error(`${errors.join("; ")}; output not written`);
  if (await exists(directory) && !options.force) throw new Error("Output exists; pass --force to overwrite");
  const partial = `${directory}.${process.pid}.partial`;
  const previous = `${directory}.${process.pid}.previous`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    for (const file of files) await writeFile(join(partial, datasetFileName(file.operatorId)), file.text, "utf8");
    for (const file of options.extras?.shared ?? []) await writeFile(join(partial, sharedFileName(file.name)), file.text, "utf8");
    await writeFile(join(partial, "index.json"), indexText, "utf8");
  } catch (error) { await rm(partial, { recursive: true, force: true }); throw error; }
  const hadPrevious = await exists(directory);
  if (hadPrevious) await rename(directory, previous);
  try { await rename(partial, directory); } catch (error) { if (hadPrevious) await rename(previous, directory); await rm(partial, { recursive: true, force: true }); throw error; }
  if (hadPrevious) await rm(previous, { recursive: true, force: true });
  const entries = [...Object.values(index.operators), ...Object.values(index.shared ?? {})];
  return { index, totalBytes: Buffer.byteLength(indexText) + entries.reduce((sum, entry) => sum + entry.bytes, 0), warnings };
}

export type DatasetVerification = { identical: number; differences: { operatorId: string; keys: string[] }[]; missing: string[]; ignored: number; sources: string[]; shared: string[] };
export type ComparableDataset = Readonly<{ sources: unknown; tables?: unknown; profiles: readonly { operatorId: string; region: string }[]; shared: Readonly<Record<string, unknown>> }>;

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

/** Compares a generated dataset with a versioned one: per operator, the top-level keys that change, plus sources, tables and shared files. */
export function compareDatasets(reference: ComparableDataset, generated: ComparableDataset): DatasetVerification {
  const result: DatasetVerification = { identical: 0, differences: [], missing: [], ignored: 0, sources: [], shared: [] };
  const used = new Set<unknown>();
  for (const profile of generated.profiles) {
    const candidate = reference.profiles.find((item) => item.operatorId === profile.operatorId && item.region === profile.region);
    if (!candidate) { result.missing.push(`${profile.operatorId}/${profile.region}`); continue; }
    used.add(candidate);
    const expected = plain(candidate) as Record<string, unknown>;
    const actual = plain(profile) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((key) => !isDeepStrictEqual(expected[key], actual[key]));
    if (keys.length) result.differences.push({ operatorId: profile.operatorId, keys }); else result.identical += 1;
  }
  result.ignored = reference.profiles.filter((item) => !used.has(item)).length;
  if (!isDeepStrictEqual(plain(reference.sources), plain(generated.sources))) result.sources.push("sources");
  if (!isDeepStrictEqual(plain(reference.tables), plain(generated.tables))) result.sources.push("tables");
  for (const name of new Set([...Object.keys(reference.shared), ...Object.keys(generated.shared)])) if (!isDeepStrictEqual(plain(reference.shared[name]), plain(generated.shared[name]))) result.shared.push(name);
  return result;
}

/** Prints the outcome of a verification and fails on any difference, so nothing is written for an undeclared change. */
export function reportVerification(verification: DatasetVerification, log: (line: string) => void = console.log): void {
  const failed = verification.differences.length + verification.missing.length + verification.sources.length + verification.shared.length > 0;
  log(`Verification: ${verification.identical} identical, ${verification.differences.length} different, ${verification.missing.length} missing, ${verification.ignored} reference profiles outside the catalog`);
  for (const difference of verification.differences.slice(0, 50)) log(`  ${difference.operatorId}: ${difference.keys.join(", ")}`);
  if (verification.differences.length > 50) log(`  and ${verification.differences.length - 50} more operators`);
  if (verification.missing.length) log(`  missing from the reference: ${verification.missing.slice(0, 50).join(", ")}`);
  if (verification.sources.length) log(`  differences in: ${verification.sources.join(", ")}`);
  if (verification.shared.length) log(`  shared files that change: ${verification.shared.join(", ")}`);
  if (failed) throw new Error("Verification failed; output not written");
}
