/**
 * Re-verifies the curated files of data/ that record the GameData revision they were checked against (registry:
 * curatedProvenance). For every recorded revision older than the pinned one, the value it backs is read from the
 * previous snapshot and from the new one. When every value of a file and region is identical, the revision (and the
 * table hash, when the file records one) moves to the pinned revision; otherwise that group is left as it is and its
 * differences are reported for review.
 *
 *   pnpm data:provenance:reverify --en-snapshot=<dir> --cn-snapshot=<dir> --out-root=<dir> --report-dir=<dir>
 *     [--previous-snapshots=<dir>] [--snapshot-hashes]
 *
 * Previous snapshots are <region>-<commit7> directories under --previous-snapshots (default: the parent of
 * --en-snapshot), checked against the manifest.json of that directory. --snapshot-hashes takes the new revision and
 * hashes from the manifest.json of each new snapshot instead of gamedata-revisions.ts. data:regenerate runs it after
 * the generators. Exit code: 0 every file current, 2 some differences wait for review, 1 a check failed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { curatedProvenance, type CuratedProvenanceId } from "../src/game-data/dataset-registry";
import { gameDataRevisions, pinnedGameDataTableHashes } from "../src/game-data/gamedata-revisions";
import { compareCodeUnits } from "../src/game-data/string-order";
import { playable } from "./verify-operator-regional-sets";

type Region = "en" | "cn";
type Json = Record<string, unknown>;
type Read = (table: string) => Promise<unknown>;

/** A revision recorded in a curated file and the value it backs, read from a table of that revision. */
export type Reference = Readonly<{ region: Region; revision: string; label: string; value: (read: Read) => Promise<unknown>; hashTable?: string }>;
type Reverifier = Readonly<{
  references: (json: Json) => Reference[];
  /** Fields recomputed once the revision of a region moves (informative counts). */
  after?: (text: string, region: Region, revision: string, read: Read) => Promise<string>;
}>;

const object = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(object) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const regionOf = (path: string): Region => (path.startsWith("cn/") ? "cn" : "en");
const tableOf = (path: string) => path.replace(/^.*\//, "").replace(/\.json$/, "");
const character = async (read: Read, id: string) => object(object(await read("character_table"))[id]);
const ranges = async (read: Read, ids: readonly unknown[]) => {
  const table = object(await read("range_table"));
  return ids.map((id) => (typeof id === "string" ? object(table[id]) : null)).map((range) => (range ? { direction: range.direction, grids: range.grids } : null));
};
const playableIds = async (read: Read) => Object.entries(object(await read("character_table"))).filter(([id, record]) => id.startsWith("char_") && playable(object(record))).map(([id]) => id).sort(compareCodeUnits);
const gameDataUrl = /ArknightsGamedata\/blob\/([0-9a-f]{40})\/((?:en|cn)\/gamedata\/excel\/(\w+)\.json)#(\w+)/;

/** The references of each registered curated file; the type requires one for every entry of the registry. */
export const reverifiers: Record<CuratedProvenanceId, Reverifier> = {
  affiliations: {
    references: (json) => list(json.associations).map((entry) => {
      const source = object(entry.source);
      const field = /subPower\[\]\.(\w+)/.exec(text(entry.sourceField))?.[1] ?? "nationId";
      return { region: source.region === "cn" ? "cn" : "en", revision: text(source.revision), label: `${text(entry.operatorId)} ${text(entry.affiliationId)}`, value: async (read) => list((await character(read, text(entry.operatorId))).subPower).map((power) => power[field] ?? null) };
    }),
  },
  "module-modes": {
    references: (json) => (["gameTags", "mapTags"] as const).flatMap((group) => Object.entries(object(json[group])).flatMap(([tag, entry]) => {
      const source = object(object(entry).source);
      if (source.kind !== "gamedata") return [];
      const path = text(source.path);
      return [{ region: regionOf(path), revision: text(source.revision), label: `${group}.${tag}`, hashTable: tableOf(path), value: async (read: Read) => text(source.field).split(".").reduce<unknown>((value, key) => object(value)[key], await read(tableOf(path))) }];
    })),
  },
  factions: {
    references: (json) => list(json.operators).map((operator) => ({
      region: "en", revision: text(object(json.generatedFrom).revision), label: text(operator.id),
      value: async (read) => { const power = object((await character(read, text(operator.id))).mainPower); return [power.nationId ?? null, power.groupId ?? null, power.teamId ?? null]; },
    })),
  },
  "cn-release": {
    references: (json) => {
      const snapshot = object(json.snapshot);
      const names = list(json.operators).map((operator): Reference => ({ region: "en", revision: text(snapshot.revision), label: `${text(operator.id)} name`, value: async (read) => (await character(read, text(operator.id))).name ?? null }));
      const cited = list(json.operators).flatMap((operator): Reference[] => {
        const match = gameDataUrl.exec(text(operator.source));
        if (!match) return [];
        const [, revision, path, table, anchor] = match as unknown as [string, string, string, string, string];
        const value = table === "gacha_table"
          ? async (read: Read) => { const pool = list(object(await read(table)).gachaPoolClient).find((item) => item.gachaPoolId === anchor); return pool ? { openTime: pool.openTime, detail: pool.gachaPoolDetail } : null; }
          : async (read: Read) => object(object(object(await read(table)).topics)[anchor]).startTime ?? null;
        return [{ region: regionOf(path), revision, label: `${text(operator.id)} ${table}#${anchor}`, value }];
      });
      return [...names, ...cited];
    },
  },
  regional: {
    references: (json) => (["en", "cn"] as const).map((region) => ({ region, revision: text(object(object(json.comparison)[region]).revision), label: `${region} playable operators`, value: playableIds })),
    after: async (current, _region, revision, read) => {
      const table = object(await read("character_table"));
      const playableCount = (await playableIds(read)).length;
      return current.replace(new RegExp(`("revision": "${revision}",\\s*"playableCount": )\\d+(,\\s*"skippedCount": )\\d+`), (_all, head: string, middle: string) => `${head}${playableCount}${middle}${Object.keys(table).length - playableCount}`);
    },
  },
  tactical: {
    references: (json) => {
      const source = object(json.source);
      const regionOfRevision = (revision: string): Region => (revision === text(object(source.cn).revision) && revision !== text(object(source.en).revision) ? "cn" : "en");
      const operators = list(json.operators).filter((operator) => operator.source).map((operator): Reference => {
        const revision = text(object(operator.source).revision);
        return { region: regionOfRevision(revision), revision, label: text(operator.id), value: async (read) => {
          const record = await character(read, text(operator.id));
          const phases = list(record.phases).map((phase) => phase.rangeId ?? null);
          return { position: record.position ?? null, tags: record.tagList ?? null, phases, ranges: await ranges(read, phases) };
        } };
      });
      const modules = list(json.moduleRanges).map((entry): Reference => {
        const revision = text(object(entry.source).revision);
        return { region: regionOfRevision(revision), revision, label: `${text(entry.operatorId)} ${text(entry.uniEquipId)}`, value: (read) => ranges(read, [entry.baseRangeId, entry.modifiedRangeId]) };
      });
      return [...operators, ...modules];
    },
  },
};

export type Difference = Readonly<{ region: Region; revision: string; label: string; previous: unknown; current: unknown }>;
export type FileOutcome = Readonly<{ id: CuratedProvenanceId; file: string; status: "current" | "updated" | "pending" | "failed"; moved: readonly string[]; differences: readonly Difference[]; message?: string }>;

/** Tables of one snapshot directory, each checked against its expected SHA-256 once. */
export function tableReader(directory: string, expected: (table: string) => string | undefined): Read {
  const cache = new Map<string, Promise<unknown>>();
  return (table) => {
    if (!cache.has(table)) cache.set(table, (async () => {
      const bytes = await readFile(join(directory, `${table}.json`));
      const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase();
      const wanted = expected(table);
      if (!wanted) throw new Error(`${directory}: ${table} has no expected SHA-256`);
      if (hash !== wanted) throw new Error(`${directory}: ${table} SHA-256 mismatch`);
      return JSON.parse(bytes.toString("utf8")) as unknown;
    })());
    return cache.get(table)!;
  };
}

export type Context = Readonly<{
  revisions: Record<Region, string>;
  current: Record<Region, Read>;
  currentHash: (region: Region, table: string) => string | undefined;
  previous: (region: Region, revision: string) => Read;
  previousHash: (region: Region, revision: string, table: string) => string | undefined;
}>;

/** Moves the revisions of one curated file whose backed values did not change; differences are left for review. */
export async function reverifyText(id: CuratedProvenanceId, source: string, context: Context): Promise<{ text: string; moved: string[]; differences: Difference[] }> {
  const reverifier = reverifiers[id];
  const groups = new Map<string, Reference[]>();
  for (const reference of reverifier.references(JSON.parse(source) as Json)) {
    if (!/^[0-9a-f]{40}$/.test(reference.revision)) throw new Error(`${id}: ${reference.label} has no full revision`);
    if (reference.revision === context.revisions[reference.region]) continue;
    const key = `${reference.region} ${reference.revision}`;
    groups.set(key, [...(groups.get(key) ?? []), reference]);
  }
  let result = source;
  const moved: string[] = [];
  const differences: Difference[] = [];
  for (const references of groups.values()) {
    const { region, revision } = references[0]!;
    const before = context.previous(region, revision);
    const found: Difference[] = [];
    for (const reference of references) {
      const [previous, current] = [await reference.value(before), await reference.value(context.current[region])];
      if (JSON.stringify(previous) !== JSON.stringify(current)) found.push({ region, revision, label: reference.label, previous, current });
    }
    if (found.length) { differences.push(...found); continue; }
    const next = context.revisions[region];
    result = result.split(revision).join(next);
    for (const table of new Set(references.flatMap((reference) => (reference.hashTable ? [reference.hashTable] : [])))) {
      const [old, fresh] = [context.previousHash(region, revision, table), context.currentHash(region, table)];
      if (!old || !fresh) throw new Error(`${id}: no SHA-256 of ${region} ${table}`);
      if (!result.includes(old)) throw new Error(`${id}: the recorded ${table} hash is not the one of ${revision.slice(0, 7)}`);
      result = result.split(old).join(fresh);
    }
    if (reverifier.after) result = await reverifier.after(result, region, next, context.current[region]);
    moved.push(`${region} ${revision.slice(0, 7)} -> ${next.slice(0, 7)} (${references.length} references)`);
  }
  return { text: result, moved, differences };
}

const flag = (name: string, argv: readonly string[]) => argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string, argv: readonly string[]) => { const value = flag(name, argv); if (!value) throw new Error(`Missing --${name}`); return value; };
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Json;

/** Context from the snapshots: pinned revisions and hashes, or those of the snapshot manifests with --snapshot-hashes. */
export async function snapshotContext(argv: readonly string[]): Promise<Context> {
  const snapshots = { en: required("en-snapshot", argv), cn: required("cn-snapshot", argv) };
  const previousRoot = flag("previous-snapshots", argv) ?? dirname(snapshots.en);
  const fromManifests = argv.includes("--snapshot-hashes");
  const own = fromManifests ? { en: await readJson(join(snapshots.en, "manifest.json")), cn: await readJson(join(snapshots.cn, "manifest.json")) } : undefined;
  const revisions = own ? { en: text(own.en.revision), cn: text(own.cn.revision) } : { ...gameDataRevisions };
  const currentHash = (region: Region, table: string) => (own ? text(list(own[region].files).find((file) => file.table === table)?.sha256) || undefined : pinnedGameDataTableHashes(region)[table]);
  const archive = list((await readJson(join(previousRoot, "manifest.json"))).files);
  const previousDirectory = (region: Region, revision: string) => join(previousRoot, `${region}-${revision.slice(0, 7)}`);
  const previousHash = (region: Region, revision: string, table: string) => text(archive.find((file) => file.region === region && file.revision === revision && text(file.localPath).endsWith(`/${region}-${revision.slice(0, 7)}/${table}.json`))?.sha256) || undefined;
  const readers = new Map<string, Read>();
  const previous = (region: Region, revision: string) => {
    const key = `${region} ${revision}`;
    if (!readers.has(key)) readers.set(key, tableReader(previousDirectory(region, revision), (table) => previousHash(region, revision, table)));
    return readers.get(key)!;
  };
  return { revisions, current: { en: tableReader(snapshots.en, (table) => currentHash("en", table)), cn: tableReader(snapshots.cn, (table) => currentHash("cn", table)) }, currentHash, previous, previousHash };
}

/** Re-verifies every registered curated file, writing the moved revisions under --out-root and a report under --report-dir. */
export async function reverifyCuratedProvenance(argv: readonly string[], log: (line: string) => void = console.log, context?: Context): Promise<FileOutcome[]> {
  const outRoot = required("out-root", argv);
  const reportDir = required("report-dir", argv);
  const resolved = context ?? await snapshotContext(argv);
  const outcomes: FileOutcome[] = [];
  for (const [id, entry] of Object.entries(curatedProvenance) as [CuratedProvenanceId, (typeof curatedProvenance)[CuratedProvenanceId]][]) {
    try {
      const source = await readFile(entry.file, "utf8");
      const { text: result, moved, differences } = await reverifyText(id, source, resolved);
      if (result !== source) { await mkdir(dirname(join(outRoot, entry.file)), { recursive: true }); await writeFile(join(outRoot, entry.file), result, "utf8"); }
      outcomes.push({ id, file: entry.file, status: differences.length ? "pending" : moved.length ? "updated" : "current", moved, differences });
    } catch (error) {
      outcomes.push({ id, file: entry.file, status: "failed", moved: [], differences: [], message: error instanceof Error ? error.message : String(error) });
    }
  }
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "curated-provenance.json"), `${JSON.stringify({ revisions: resolved.revisions, files: outcomes }, null, 2)}\n`, "utf8");
  for (const outcome of outcomes) {
    log(`curated ${outcome.id}: ${outcome.status}${outcome.moved.length ? ` (${outcome.moved.join("; ")})` : ""}${outcome.message ? ` (${outcome.message})` : ""}`);
    for (const difference of outcome.differences) log(`  ${difference.region} ${difference.label}: ${JSON.stringify(difference.previous)} -> ${JSON.stringify(difference.current)}`);
  }
  return outcomes;
}

export const provenanceExitCode = (outcomes: readonly FileOutcome[]): number => (outcomes.some((item) => item.status === "failed") ? 1 : outcomes.some((item) => item.status === "pending") ? 2 : 0);

if (process.argv[1]?.endsWith("reverify-curated-provenance.ts")) reverifyCuratedProvenance(process.argv).then((outcomes) => { process.exitCode = provenanceExitCode(outcomes); }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
