import globalUpdatesManifest from "../../data/operator-global-updates.json";
import type { OperatorRecord } from "./operators";

export type GlobalUpdate = { id: string; name: string; opensAt: string; operatorIds: string[]; sourceUrl: string; status: "verified" | "community-listed" };
export type GlobalUpdatesManifest = { schemaVersion: number; updates: GlobalUpdate[] };

export const globalUpdatesSchemaVersion = 2;

const defaultManifest = globalUpdatesManifest as unknown as GlobalUpdatesManifest;

export class GlobalUpdatesManifestError extends Error {
  constructor(message: string) { super(message); this.name = "GlobalUpdatesManifestError"; }
}

// A problem with an operatorId is an operator the web can ignore (CN-only, unknown or malformed id); any other problem voids the file.
type Problem = { message: string; operatorId?: string };

const openingTimePattern = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value;
}

/** Date, time and UTC offset of the opening, such as 2026-10-14T10:00:00-07:00 (Global server time). */
function isOpeningTime(value: string): boolean {
  const match = openingTimePattern.exec(value);
  return match !== null && isIsoDate(match[1]!);
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function inspect(records: readonly OperatorRecord[], manifest: GlobalUpdatesManifest): Problem[] {
  if (manifest.schemaVersion !== globalUpdatesSchemaVersion) return [{ message: `Unsupported Global updates schema: ${String(manifest.schemaVersion)}` }];
  if (!Array.isArray(manifest.updates)) return [{ message: "Global updates manifest has no updates" }];
  const problems: Problem[] = [];
  const catalogById = new Map(records.map((record) => [record.id, record]));
  const ids = new Set<string>();
  for (const update of manifest.updates) {
    if (ids.has(update.id)) problems.push({ message: `Duplicate Global update ID: ${update.id}` });
    ids.add(update.id);
    if (!isOpeningTime(update.opensAt)) problems.push({ message: `Invalid Global update opening time: ${update.id}` });
    if (update.status !== "verified" && update.status !== "community-listed") problems.push({ message: `Invalid Global update status: ${update.id}` });
    if (!isHttpsUrl(update.sourceUrl)) problems.push({ message: `Invalid Global update source: ${update.id}` });
    if (!Array.isArray(update.operatorIds)) { problems.push({ message: `Invalid operator list in Global update: ${update.id}` }); continue; }
    if (update.operatorIds.length !== new Set(update.operatorIds).size) problems.push({ message: `Duplicate operator ID in Global update: ${update.id}` });
    for (const id of update.operatorIds) {
      if (!/^char_/.test(id)) { problems.push({ message: `Invalid operator ID in Global update: ${update.id}`, operatorId: id }); continue; }
      const operator = catalogById.get(id);
      if (!operator) problems.push({ message: `Unknown operator ID in Global update: ${id}`, operatorId: id });
      else if (operator.cnOnly) problems.push({ message: `CN-only operator in Global update: ${id}`, operatorId: id });
    }
  }
  return problems;
}

/** The latest update that has already opened at `now`, whatever its status. Updates may be added before their opening. */
function openedUpdate(manifest: GlobalUpdatesManifest, now: Date): GlobalUpdate | undefined {
  let result: GlobalUpdate | undefined;
  for (const update of manifest.updates) {
    if (Date.parse(update.opensAt) > now.getTime()) continue;
    if (!result || Date.parse(update.opensAt) >= Date.parse(result.opensAt)) result = update;
  }
  return result;
}

/** Throws on any inconsistency, whatever the date. Used by the tests and the data verification. */
export function assertGlobalUpdates(records: readonly OperatorRecord[], manifest: GlobalUpdatesManifest = defaultManifest): void {
  const problems = inspect(records, manifest);
  if (problems.length) throw new GlobalUpdatesManifestError(problems.map((problem) => problem.message).join("; "));
}

/** Operators of the latest Global update that has opened at `now`. Strict: throws on any inconsistency. */
export function getNewOperatorIds(records: readonly OperatorRecord[], manifest: GlobalUpdatesManifest = defaultManifest, now = new Date()): ReadonlySet<string> {
  assertGlobalUpdates(records, manifest);
  return new Set(openedUpdate(manifest, now)?.operatorIds ?? []);
}

/**
 * Same result for the web, which must keep rendering: an inconsistent file gives no labels, and a CN-only or unknown
 * operator is left out on its own, each with a warning.
 */
export function getNewOperatorIdsLenient(records: readonly OperatorRecord[], manifest: GlobalUpdatesManifest = defaultManifest, now = new Date(), warn: (message: string) => void = console.warn): ReadonlySet<string> {
  try {
    const problems = inspect(records, manifest);
    for (const problem of problems) warn(`Global updates: ${problem.message}`);
    if (problems.some((problem) => problem.operatorId === undefined)) return new Set();
    const ignored = new Set(problems.map((problem) => problem.operatorId));
    return new Set((openedUpdate(manifest, now)?.operatorIds ?? []).filter((id) => !ignored.has(id)));
  } catch (error) {
    warn(`Global updates: ${error instanceof Error ? error.message : "unreadable manifest"}`);
    return new Set();
  }
}
