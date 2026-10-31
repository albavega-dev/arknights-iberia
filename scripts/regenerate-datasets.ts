/**
 * Regenerates every dataset of the registry in update mode (--verify-against --update) from two snapshots.
 *
 *   pnpm data:regenerate --en-snapshot=<dir> --cn-snapshot=<dir> --out-root=<dir> --report-dir=<dir>
 *     [--approve-dir=<dir>] [--only=operator-skills,...,curated-provenance] [--snapshot-hashes] [--previous-snapshots=<dir>]
 *
 * --out-root is the repository root for a real update. --snapshot-hashes takes the expected table hashes from the
 * snapshot manifests instead of gamedata-revisions.ts, for a dry run before pinning; it requires an output root
 * outside the repository. A dataset with an approved report in --approve-dir is written with --approve.
 * First, the curated files that record a GameData revision are re-verified (curated-provenance): an identical backed
 * value moves the revision, a different one waits for review like a pending dataset. The generators then read the CN
 * release and regional manifests from --out-root when that step rewrote them there.
 * Exit code: 0 every dataset written, 2 some changes wait for approval, 1 a generator failed.
 */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { datasetRegistry, datasetTableFlag, type DatasetEntry, type DatasetId } from "../src/game-data/dataset-registry";
import { main as generateCatalog } from "./generate-operator-catalog";
import { main as generateModules } from "./generate-operator-modules";
import { main as generateSkills } from "./generate-operator-skills";
import { main as generateStats } from "./generate-operator-stats";
import { provenanceExitCode, reverifyCuratedProvenance, type FileOutcome } from "./reverify-curated-provenance";

type Region = "en" | "cn";
export type SnapshotHashes = Record<Region, Record<string, string>>;
type UpdateId = { [K in DatasetId]: (typeof datasetRegistry)[K]["generator"]["kind"] extends "update" ? K : never }[DatasetId];
export type Manifests = Readonly<{ releaseManifest: string; regionalManifest: string }>;
type Runner = (argv: string[], hashes: SnapshotHashes | undefined, manifests: Manifests) => Promise<void>;
export type ProvenanceStep = (argv: readonly string[], log: (line: string) => void) => Promise<readonly FileOutcome[]>;
const provenanceId = "curated-provenance";

const pick = (hashes: SnapshotHashes, tables: readonly string[]) => Object.fromEntries((["en", "cn"] as const).map((region) => [region, Object.fromEntries(tables.map((table) => [table, hashes[region][table]]))])) as never;

/** The generator of each dataset in update mode; the type requires one for every "update" entry of the registry. */
export const runners: Record<UpdateId, Runner> = {
  "operator-stats": (argv, hashes, manifests) => generateStats(argv, { ...manifests, ...(hashes ? { expectedHashes: pick(hashes, datasetRegistry["operator-stats"].tables) } : {}) }),
  "operator-skills": (argv, hashes, manifests) => generateSkills(argv, { ...manifests, ...(hashes ? { expectedHashes: pick(hashes, datasetRegistry["operator-skills"].tables) } : {}) }),
  "operator-modules": (argv, hashes, manifests) => generateModules(argv, { ...manifests, ...(hashes ? { expectedHashes: pick(hashes, datasetRegistry["operator-modules"].tables) } : {}) }),
  "operator-catalog": (argv, hashes, manifests) => generateCatalog(argv, { ...manifests, ...(hashes ? { hashes: { character: { en: hashes.en.character_table!, cn: hashes.cn.character_table! }, handbook: { en: hashes.en.handbook_info_table!, cn: hashes.cn.handbook_info_table! } } } : {}) }),
};

const flag = (name: string, argv: readonly string[]) => argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string, argv: readonly string[]) => { const value = flag(name, argv); if (!value) throw new Error(`Missing --${name}`); return value; };
const exists = (path: string) => stat(path).then(() => true, () => false);

/** Arguments of a generator in update mode, built from its registry entry. */
export function generatorArguments(id: DatasetId, options: Readonly<{ snapshots: Record<Region, string>; outRoot: string; reportDir: string; approve?: string }>): string[] {
  const entry: DatasetEntry = datasetRegistry[id];
  const { outDir, verifyAgainst } = entry.generator;
  if (entry.generator.kind !== "update" || !outDir || !verifyAgainst) throw new Error(`${id} has no update-mode generator`);
  const tables = (["en", "cn"] as const).flatMap((region) => entry.tables.flatMap((table) => [datasetTableFlag(entry, region, table), join(options.snapshots[region], `${table}.json`)]));
  return ["node", entry.generator.script, ...tables, "--out-dir", join(options.outRoot, outDir), "--force", "--verify-against", verifyAgainst, "--update", "--report", join(options.reportDir, `${id}.json`), ...(options.approve ? ["--approve", options.approve] : [])];
}

export async function snapshotHashes(snapshots: Record<Region, string>): Promise<SnapshotHashes> {
  const read = async (region: Region) => {
    const manifest = JSON.parse(await readFile(join(snapshots[region], "manifest.json"), "utf8")) as { region?: string; files?: { table: string; sha256: string }[] };
    if (manifest.region !== region || !Array.isArray(manifest.files)) throw new Error(`${region} snapshot has no valid manifest`);
    return Object.fromEntries(manifest.files.map((file) => [file.table, file.sha256]));
  };
  return { en: await read("en"), cn: await read("cn") };
}

export type DatasetOutcome = { id: DatasetId | typeof provenanceId; status: "written" | "pending" | "failed"; message?: string };

export async function regenerate(argv: readonly string[], run: Record<UpdateId, Runner> = runners, log: (line: string) => void = console.log, provenance: ProvenanceStep = reverifyCuratedProvenance): Promise<DatasetOutcome[]> {
  const snapshots = { en: required("en-snapshot", argv), cn: required("cn-snapshot", argv) };
  const outRoot = required("out-root", argv);
  const reportDir = required("report-dir", argv);
  const approveDir = flag("approve-dir", argv);
  const only = flag("only", argv)?.split(",").filter(Boolean);
  const ids = (Object.keys(run) as UpdateId[]).filter((id) => !only || only.includes(id));
  const unknown = only?.filter((id) => !(id in run) && id !== provenanceId) ?? [];
  if (unknown.length) throw new Error(`Not an update-mode dataset: ${unknown.join(", ")}`);
  let hashes: SnapshotHashes | undefined;
  if (argv.includes("--snapshot-hashes")) {
    const rel = relative(process.cwd(), resolve(outRoot));
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("--snapshot-hashes needs an output root outside the repository");
    hashes = await snapshotHashes(snapshots);
  }
  const outcomes: DatasetOutcome[] = [];
  if (!only || only.includes(provenanceId)) {
    log(`=== ${provenanceId}`);
    try {
      const files = await provenance(argv, log);
      const code = provenanceExitCode(files);
      const waiting = files.filter((file) => file.status !== "current" && file.status !== "updated").map((file) => `${file.id} ${file.status}`);
      outcomes.push({ id: provenanceId, status: code === 1 ? "failed" : code === 2 ? "pending" : "written", ...(waiting.length ? { message: waiting.join(", ") } : {}) });
    } catch (error) {
      outcomes.push({ id: provenanceId, status: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  const manifest = async (path: string) => (await exists(join(outRoot, path)) ? join(outRoot, path) : path);
  const manifests = { releaseManifest: await manifest("data/operator-cn-release-manifest.json"), regionalManifest: await manifest("data/operator-regional-manifest.json") };
  for (const id of ids) {
    const approvedReport = approveDir ? join(approveDir, `${id}.json`) : undefined;
    const approve = approvedReport && await exists(approvedReport) ? approvedReport : undefined;
    log(`=== ${id}${approve ? " (approved report)" : ""}`);
    try {
      await run[id](generatorArguments(id, { snapshots, outRoot, reportDir, approve }), hashes, manifests);
      outcomes.push({ id, status: "written" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ id, status: message.startsWith("Changes pending approval") ? "pending" : "failed", message });
    }
  }
  for (const outcome of outcomes) log(`${outcome.id}: ${outcome.status}${outcome.message ? ` (${outcome.message})` : ""}`);
  for (const [id, entry] of Object.entries(datasetRegistry) as [DatasetId, DatasetEntry][]) {
    if (entry.generator.kind === "manual") log(`${id}: run ${entry.generator.script} by hand${entry.generator.rerunWhen?.length ? ` when ${entry.generator.rerunWhen.join(" or ")} change` : ""}`);
  }
  return outcomes;
}

export const exitCodeFor = (outcomes: readonly DatasetOutcome[]): number => (outcomes.some((item) => item.status === "failed") ? 1 : outcomes.some((item) => item.status === "pending") ? 2 : 0);

if (process.argv[1]?.endsWith("regenerate-datasets.ts")) regenerate(process.argv).then((outcomes) => { process.exitCode = exitCodeFor(outcomes); }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
