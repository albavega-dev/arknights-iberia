import globalUpdatesManifest from "../../data/operator-global-updates.json";
import type { OperatorRecord } from "./operators";

export type GlobalUpdate = { id: string; name: string; startDate: string; operatorIds: string[]; sourceUrl: string; status: "verified" | "unverified" };
export type GlobalUpdatesManifest = { schemaVersion: number; selectedUpdateId: string; updates: GlobalUpdate[] };

const defaultManifest = globalUpdatesManifest as unknown as GlobalUpdatesManifest;

export class GlobalUpdatesManifestError extends Error {
  constructor(message: string) { super(message); this.name = "GlobalUpdatesManifestError"; }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value;
}

export function getNewOperatorIds(records: readonly OperatorRecord[], manifest: GlobalUpdatesManifest = defaultManifest, asOfDate = new Date()): ReadonlySet<string> {
  const catalogById = new Map(records.map((record) => [record.id, record]));
  const updatesById = new Map<string, GlobalUpdate>();
  for (const update of manifest.updates) {
    if (updatesById.has(update.id)) throw new GlobalUpdatesManifestError(`Duplicate Global update ID: ${update.id}`);
    if (!isIsoDate(update.startDate)) throw new GlobalUpdatesManifestError(`Invalid Global update date: ${update.id}`);
    if (update.operatorIds.length !== new Set(update.operatorIds).size) throw new GlobalUpdatesManifestError(`Duplicate operator ID in Global update: ${update.id}`);
    for (const id of update.operatorIds) {
      if (!/^char_/.test(id)) throw new GlobalUpdatesManifestError(`Invalid operator ID in Global update: ${update.id}`);
      const operator = catalogById.get(id);
      if (!operator) throw new GlobalUpdatesManifestError(`Unknown operator ID in Global update: ${id}`);
      if (operator.cnOnly) throw new GlobalUpdatesManifestError(`CN-only operator in Global update: ${id}`);
    }
    updatesById.set(update.id, update);
  }
  const selected = updatesById.get(manifest.selectedUpdateId);
  if (!selected) throw new GlobalUpdatesManifestError(`Selected Global update does not exist: ${manifest.selectedUpdateId}`);
  if (selected.status !== "verified") throw new GlobalUpdatesManifestError(`Selected Global update is not verified: ${selected.id}`);
  if (new Date(`${selected.startDate}T00:00:00.000Z`) > asOfDate) throw new GlobalUpdatesManifestError(`Selected Global update is in the future: ${selected.id}`);
  return new Set(selected.operatorIds);
}
