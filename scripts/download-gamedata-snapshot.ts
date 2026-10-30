/**
 * Downloads the tables of one ArknightsGamedata revision into a snapshot directory and records a manifest.
 *
 *   pnpm data:snapshot --region=en --commit=<40-character commit> --out-root=<directory outside the repository>
 *     [--tables=a,b | --from-report=<data:check-updates JSON report>] [--compare-with=<root of existing snapshots>] [--force]
 *
 * Writes <out-root>/<region>-<commit7>/<table>.json and manifest.json (revision, URL, bytes, SHA-256, git blob hash).
 * Every file is checked against its blob hash in the Git tree of the commit; for the pinned revision it must also match
 * the pinned SHA-256. Without --tables the tables pinned for the region are downloaded.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { redact } from "../src/game-data/gamedata-diff";
import {
  gameDataBuildingTableHashes, gameDataFavorTableHashes, gameDataHandbookTableHashes, gameDataRepository, gameDataRevisions, gameDataSkillTableHashes, gameDataTableHashes, type GameDataRegion,
} from "../src/game-data/gamedata-revisions";
import { isFullCommit, parseTableList, snapshotDirectoryName, snapshotFile, snapshotManifest, snapshotMismatches, tablesFromReport, type SnapshotFile } from "../src/game-data/gamedata-snapshot";
import { directoryBlobs, fetchBytes, token } from "./github-api";
import { gameDataDirectory, rawGameDataUrl } from "../src/game-data/github-requests";

const flag = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const exists = (path: string) => stat(path).then(() => true, () => false);

const pinned = (region: GameDataRegion): Record<string, string> => ({
  ...gameDataTableHashes[region], ...gameDataSkillTableHashes[region], ...gameDataBuildingTableHashes[region], ...gameDataFavorTableHashes[region], ...gameDataHandbookTableHashes[region],
});

function outsideRepository(path: string): string {
  const target = resolve(path);
  const rel = relative(process.cwd(), target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("--out-root must be outside the repository");
  return target;
}

async function main() {
  const region = flag("region");
  if (region !== "en" && region !== "cn") throw new Error("--region must be en or cn");
  const outRoot = outsideRepository(flag("out-root") ?? "");
  const reportPath = flag("from-report");
  const fromReport = reportPath ? tablesFromReport(JSON.parse(await readFile(reportPath, "utf8")), region) : undefined;
  const revision = flag("commit") ?? fromReport?.revision ?? "";
  if (!isFullCommit(revision)) throw new Error("--commit must be a full 40-character commit hash");
  if (fromReport && fromReport.revision !== revision) throw new Error("--commit differs from the revision in the report");
  const isPinned = revision === gameDataRevisions[region];
  const tables = flag("tables") ? parseTableList(flag("tables")!) : fromReport?.tables ?? Object.keys(pinned(region));

  const directory = join(outRoot, snapshotDirectoryName(region, revision));
  if (await exists(directory) && !process.argv.includes("--force")) throw new Error("The snapshot directory exists; pass --force to replace it");

  const blobs = await directoryBlobs(gameDataRepository, revision, gameDataDirectory(region));
  const partial = `${directory}.${process.pid}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    const files: SnapshotFile[] = [];
    for (const table of tables) {
      const blob = blobs[table];
      if (!blob) throw new Error(`${region}/${table} is not in ${revision.slice(0, 7)}`);
      const data = await fetchBytes(rawGameDataUrl(revision, region, table), blob);
      files.push(snapshotFile(region, revision, table, data, blob));
      await writeFile(join(partial, `${table}.json`), data);
    }
    const bad = isPinned ? snapshotMismatches(files, pinned(region)) : [];
    if (bad.length) throw new Error(`The pinned ${region} SHA-256 does not match: ${bad.join(", ")}`);
    await writeFile(join(partial, "manifest.json"), `${JSON.stringify(snapshotManifest(region, revision, files), null, 2)}\n`, "utf8");

    const compareRoot = flag("compare-with");
    const comparison: Record<string, string> = {};
    if (compareRoot) {
      for (const file of files) {
        const existing = join(compareRoot, snapshotDirectoryName(region, revision), `${file.table}.json`);
        comparison[file.table] = !(await exists(existing)) ? "not in the existing snapshot" : Buffer.compare(await readFile(existing), await readFile(join(partial, `${file.table}.json`))) === 0 ? "identical" : "DIFFERENT";
      }
    }
    if (await exists(directory)) await rm(directory, { recursive: true, force: true });
    await rename(partial, directory);
    process.stdout.write(`${JSON.stringify({ region, revision, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), pinnedChecked: isPinned, ...(compareRoot ? { comparison } : {}) }, null, 2)}\n`);
    if (Object.values(comparison).includes("DIFFERENT")) process.exitCode = 2;
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
}

main().catch((error: unknown) => {
  const message = redact(error instanceof Error ? error.message : String(error), [token, process.cwd(), process.env.HOME, process.env.USERPROFILE]);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
});
