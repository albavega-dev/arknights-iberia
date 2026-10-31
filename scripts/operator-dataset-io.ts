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

/** Writes a new directory next to the old one and swaps them, restoring the old one if the swap fails. */
export async function replaceDirectory(directory: string, force: boolean, write: (partial: string) => Promise<void>): Promise<void> {
  if (await exists(directory) && !force) throw new Error("Output exists; pass --force to overwrite");
  const partial = `${directory}.${process.pid}.partial`;
  const previous = `${directory}.${process.pid}.previous`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try { await write(partial); } catch (error) { await rm(partial, { recursive: true, force: true }); throw error; }
  const hadPrevious = await exists(directory);
  if (hadPrevious) await rename(directory, previous);
  try { await rename(partial, directory); } catch (error) { if (hadPrevious) await rename(previous, directory); await rm(partial, { recursive: true, force: true }); throw error; }
  if (hadPrevious) await rm(previous, { recursive: true, force: true });
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
  await replaceDirectory(directory, options.force, async (partial) => {
    for (const file of files) await writeFile(join(partial, datasetFileName(file.operatorId)), file.text, "utf8");
    for (const file of options.extras?.shared ?? []) await writeFile(join(partial, sharedFileName(file.name)), file.text, "utf8");
    await writeFile(join(partial, "index.json"), indexText, "utf8");
  });
  const entries = [...Object.values(index.operators), ...Object.values(index.shared ?? {})];
  return { index, totalBytes: Buffer.byteLength(indexText) + entries.reduce((sum, entry) => sum + entry.bytes, 0), warnings };
}

export type DatasetDifference = { operatorId: string; keys: string[]; fields: string[] };
export type DatasetVerification = { identical: number; differences: DatasetDifference[]; missing: string[]; ignored: number; removed: string[]; sources: string[]; shared: string[] };
export type ComparableDataset = Readonly<{ sources: unknown; tables?: unknown; profiles: readonly { operatorId: string; region: string }[]; shared: Readonly<Record<string, unknown>> }>;

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Paths of the leaves that differ between two JSON values, such as `skills[2].levels[0].blackboard[1].value`. */
export function changedFields(expected: unknown, actual: unknown, path = ""): string[] {
  if (isDeepStrictEqual(expected, actual)) return [];
  if (isRecord(expected) && isRecord(actual)) return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].flatMap((key) => changedFields(expected[key], actual[key], path ? `${path}.${key}` : key));
  // Arrays of different length are reported as a whole, since their positions no longer line up.
  if (Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length) return expected.flatMap((item, index) => changedFields(item, actual[index], `${path}[${index}]`));
  return [path || "(root)"];
}

/**
 * Pairs every `revision` and `sha256` of the reference sources and tables with the generated value at the same place.
 * A value that would map to two different ones is left out (null), so it still shows up as a difference.
 */
export function revisionChanges(reference: unknown, generated: unknown, changes = new Map<string, string | null>(), key = ""): Map<string, string | null> {
  if (isRecord(reference) && isRecord(generated)) for (const name of Object.keys(reference)) revisionChanges(reference[name], generated[name], changes, name);
  else if ((key === "revision" || key === "sha256") && typeof reference === "string" && typeof generated === "string" && reference !== generated) changes.set(reference, changes.has(reference) && changes.get(reference) !== generated ? null : generated);
  return changes;
}

/** Applies the paired changes to every value; a full commit inside a longer string (a source URL) changes too. */
export function applyRevisionChanges(value: unknown, changes: ReadonlyMap<string, string | null>): unknown {
  if (typeof value === "string") return changes.get(value) ?? value.replace(/\b[0-9a-f]{40}\b/g, (commit) => changes.get(commit) ?? commit);
  if (Array.isArray(value)) return value.map((item) => applyRevisionChanges(item, changes));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, applyRevisionChanges(item, changes)]));
  return value;
}

/**
 * Compares a generated dataset with a versioned one: per operator, the top-level keys and the fields that change, plus
 * sources, tables and shared files. With `revisionChange`, the revisions and hashes that change in sources and tables are
 * expected inside every profile and shared file too, so only the content that changes is reported.
 */
export function compareDatasets(reference: ComparableDataset, generated: ComparableDataset, options: Readonly<{ revisionChange?: boolean }> = {}): DatasetVerification {
  const result: DatasetVerification = { identical: 0, differences: [], missing: [], ignored: 0, removed: [], sources: [], shared: [] };
  const changes = options.revisionChange ? revisionChanges(plain({ sources: reference.sources, tables: reference.tables }), plain({ sources: generated.sources, tables: generated.tables })) : new Map<string, string | null>();
  const used = new Set<unknown>();
  for (const profile of generated.profiles) {
    const candidate = reference.profiles.find((item) => item.operatorId === profile.operatorId && item.region === profile.region);
    if (!candidate) { result.missing.push(`${profile.operatorId}/${profile.region}`); continue; }
    used.add(candidate);
    const expected = applyRevisionChanges(plain(candidate), changes) as Record<string, unknown>;
    const actual = plain(profile) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((key) => !isDeepStrictEqual(expected[key], actual[key]));
    if (keys.length) result.differences.push({ operatorId: profile.operatorId, keys, fields: changedFields(expected, actual) }); else result.identical += 1;
  }
  result.removed = reference.profiles.filter((item) => !used.has(item)).map((item) => `${item.operatorId}/${item.region}`);
  result.ignored = result.removed.length;
  if (!isDeepStrictEqual(plain(reference.sources), plain(generated.sources))) result.sources.push("sources");
  if (!isDeepStrictEqual(plain(reference.tables), plain(generated.tables))) result.sources.push("tables");
  for (const name of new Set([...Object.keys(reference.shared), ...Object.keys(generated.shared)])) if (!isDeepStrictEqual(applyRevisionChanges(plain(reference.shared[name]), changes), plain(generated.shared[name]))) result.shared.push(name);
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

export type VerificationMode = "strict" | "update";

/** Reads how --verify-against runs: strict by default, or in update mode with --update (optionally with --report and --approve). */
export function verificationMode(argv: readonly string[]): VerificationMode | undefined {
  const verify = argv.includes("--verify-against");
  const update = argv.includes("--update");
  const extras = argv.includes("--report") || argv.includes("--approve");
  if ((update || extras) && !verify) throw new Error("--update, --report and --approve need --verify-against");
  if (extras && !update) throw new Error("--report and --approve need --update");
  if (!verify) return undefined;
  return update ? "update" : "strict";
}

export type UpdateSection = Readonly<{ label: string; verification: DatasetVerification; sources: unknown }>;
export type UpdateChanges = { sources: unknown; revision: string[]; operators: { operatorId: string; fields: string[] }[]; added: string[]; removed: string[]; shared: string[] };
export type UpdateReport = { update: Record<string, UpdateChanges> };

const fieldsShown = 10;

export function updateReport(sections: readonly UpdateSection[]): UpdateReport {
  return { update: Object.fromEntries(sections.map(({ label, verification, sources }) => [label, {
    sources: plain(sources),
    revision: verification.sources,
    operators: verification.differences.map(({ operatorId, fields }) => ({ operatorId, fields })),
    added: verification.missing,
    removed: verification.removed,
    shared: verification.shared,
  }])) };
}

const pending = (changes: UpdateChanges) => changes.operators.length + changes.added.length + changes.removed.length + changes.shared.length > 0;

/**
 * Update mode of --verify-against, for a real GameData update. The change of revision in sources and tables is expected;
 * every other change (fields per operator, operators added or removed, shared files) is listed for approval. Nothing is
 * written until a run gets, with --approve, the report of an earlier run (saved with --report) with exactly the same changes.
 */
export async function verifyUpdate(sections: readonly UpdateSection[], argv: readonly string[], log: (line: string) => void = console.log): Promise<void> {
  const report = updateReport(sections);
  for (const { label, verification } of sections) {
    const changes = report.update[label]!;
    log(`${label} (update): ${verification.identical} identical, ${changes.operators.length} different, ${changes.added.length} added, ${changes.removed.length} removed`);
    log(changes.revision.length ? `  expected revision change in: ${changes.revision.join(", ")}` : "  no revision change");
    for (const { operatorId, fields } of changes.operators) log(`  ${operatorId}: ${fields.slice(0, fieldsShown).join(", ")}${fields.length > fieldsShown ? ` and ${fields.length - fieldsShown} more fields` : ""}`);
    if (changes.added.length) log(`  added (missing from the reference): ${changes.added.join(", ")}`);
    if (changes.removed.length) log(`  removed (only in the reference): ${changes.removed.join(", ")}`);
    if (changes.shared.length) log(`  shared files that change: ${changes.shared.join(", ")}`);
  }
  const approved = argv.includes("--approve") ? await readJson(arg("--approve", argv)) : undefined;
  if (argv.includes("--report")) await writeFile(arg("--report", argv), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!Object.values(report.update).some(pending)) return;
  if (approved === undefined) throw new Error("Changes pending approval; output not written (save them with --report and rerun with --approve <report>)");
  if (!isDeepStrictEqual(approved, plain(report))) throw new Error("The changes differ from the approved report; output not written");
  log("Changes match the approved report");
}
