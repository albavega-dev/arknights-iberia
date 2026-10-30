import { createHash } from "node:crypto";
import { gitBlobSha } from "./git-blob";
import { gameDataRepository, type GameDataRegion } from "./gamedata-revisions";

export type SnapshotFile = Readonly<{ table: string; sourcePath: string; url: string; bytes: number; sha256: string; blobSha: string }>;
export type SnapshotManifest = Readonly<{ repository: string; region: GameDataRegion; revision: string; files: readonly SnapshotFile[] }>;

export const snapshotDirectoryName = (region: GameDataRegion, revision: string) => `${region}-${revision.slice(0, 7)}`;
export const snapshotSourcePath = (region: GameDataRegion, table: string) => `${region}/gamedata/excel/${table}.json`;
export const snapshotUrl = (revision: string, region: GameDataRegion, table: string) => `https://raw.githubusercontent.com/${gameDataRepository}/${revision}/${snapshotSourcePath(region, table)}`;

const tableName = /^[a-z0-9_]+$/;
export const isFullCommit = (value: string) => /^[0-9a-f]{40}$/.test(value);

/** Validates a table list from the command line; names become file names, so only plain identifiers are accepted. */
export function parseTableList(value: string): string[] {
  const tables = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (!tables.length) throw new Error("The table list is empty");
  const invalid = tables.filter((table) => !tableName.test(table));
  if (invalid.length) throw new Error(`Invalid table names: ${invalid.join(", ")}`);
  return tables;
}

/** Revision and tables to download for a region, taken from the JSON report of data:check-updates. */
export function tablesFromReport(report: unknown, region: GameDataRegion): { revision: string; tables: string[] } {
  const status = (report as { findings?: { revisions?: { gamedata?: Record<string, { latest?: unknown; changed?: unknown; neededTables?: unknown; listMayBeIncomplete?: unknown }> } } })?.findings?.revisions?.gamedata?.[region];
  if (!status || typeof status.latest !== "string" || !isFullCommit(status.latest)) throw new Error(`The report has no latest ${region} revision`);
  if (status.changed !== true) throw new Error(`The report shows no new ${region} revision`);
  if (status.listMayBeIncomplete !== false || !Array.isArray(status.neededTables) || status.neededTables.some((item) => typeof item !== "string")) throw new Error(`The ${region} table list of the report is incomplete; pass --tables`);
  return { revision: status.latest, tables: parseTableList(status.neededTables.join(",")) };
}

/** Checks a downloaded file against its Git blob hash and returns its manifest entry. */
export function snapshotFile(region: GameDataRegion, revision: string, table: string, data: Buffer, expectedBlob: string): SnapshotFile {
  const blobSha = gitBlobSha(data);
  if (blobSha !== expectedBlob) throw new Error(`The ${region}/${table} download does not match its git blob hash`);
  return { table, sourcePath: snapshotSourcePath(region, table), url: snapshotUrl(revision, region, table), bytes: data.length, sha256: createHash("sha256").update(data).digest("hex").toUpperCase(), blobSha };
}

export const snapshotManifest = (region: GameDataRegion, revision: string, files: readonly SnapshotFile[]): SnapshotManifest => ({ repository: gameDataRepository, region, revision, files: [...files].sort((a, b) => a.table.localeCompare(b.table, "en")) });

/** Tables whose downloaded SHA-256 differs from the one recorded for the same revision. */
export function snapshotMismatches(files: readonly SnapshotFile[], recorded: Readonly<Record<string, string>>): string[] {
  return files.filter((file) => recorded[file.table] !== undefined && recorded[file.table] !== file.sha256).map((file) => file.table);
}
