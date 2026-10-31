import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { datasetRegistry, type DatasetId } from "../src/game-data/dataset-registry";
import { compareCodeUnits } from "../src/game-data/string-order";
import { sha256 } from "../scripts/operator-dataset-io";
import { derivedRunners, exitCodeFor, generatorArguments, regenerate, runners, snapshotHashes, snapshotRevisions, type DerivedContext, type SnapshotHashes } from "../scripts/regenerate-datasets";
import type { FileOutcome } from "../scripts/reverify-curated-provenance";

const snapshots = { en: "snap/en", cn: "snap/cn" };
const manifests = { releaseManifest: "data/operator-cn-release-manifest.json", regionalManifest: "data/operator-regional-manifest.json" };
const file = (status: FileOutcome["status"]): FileOutcome => ({ id: "regional", file: "data/operator-regional-manifest.json", status, moved: [], differences: [] });

test("there is a runner for every update-mode dataset of the registry and for nothing else", () => {
  const update = (Object.entries(datasetRegistry) as [DatasetId, { generator: { kind: string } }][]).filter(([, entry]) => entry.generator.kind === "update").map(([id]) => id);
  assert.deepEqual(Object.keys(runners).sort(compareCodeUnits), update.sort(compareCodeUnits));
});

test("there is a derived runner for every derived dataset of the registry", () => {
  const derived = (Object.entries(datasetRegistry) as [DatasetId, { generator: { kind: string } }][]).filter(([, entry]) => entry.generator.kind === "derived").map(([id]) => id);
  assert.deepEqual(Object.keys(derivedRunners).sort(compareCodeUnits), derived.sort(compareCodeUnits));
});

test("generator arguments come from the registry entry", () => {
  const skills = generatorArguments("operator-skills", { snapshots, outRoot: "out", reportDir: "reports" });
  assert.deepEqual(skills.slice(0, 4), ["node", "data:skills:generate", "--en-character", join("snap/en", "character_table.json")]);
  assert.ok(skills.includes("--cn-building-data"), "a table flag per region and table");
  assert.deepEqual(skills.slice(skills.indexOf("--out-dir")), ["--out-dir", join("out", "data/operator-skills"), "--force", "--verify-against", "data/operator-skills", "--update", "--report", join("reports", "operator-skills.json")]);
  const catalog = generatorArguments("operator-catalog", { snapshots, outRoot: ".", reportDir: "reports", approve: "approved.json" });
  assert.deepEqual(catalog.slice(2, catalog.indexOf("--out-dir")), ["--en-character", join("snap/en", "character_table.json"), "--en-handbook", join("snap/en", "handbook_info_table.json"), "--cn-character", join("snap/cn", "character_table.json"), "--cn-handbook", join("snap/cn", "handbook_info_table.json")]);
  assert.deepEqual(catalog.slice(-4), ["--report", join("reports", "operator-catalog.json"), "--approve", "approved.json"]);
  assert.throws(() => generatorArguments("operator-tactical-manifest", { snapshots, outRoot: ".", reportDir: "reports" }), /no update-mode generator/);
});

test("regeneration runs every dataset, uses approved reports and sorts the outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "regenerate-datasets-"));
  try {
    const approveDir = join(directory, "approved");
    await mkdir(approveDir);
    await writeFile(join(approveDir, "operator-skills.json"), "{}", "utf8");
    const seen: Record<string, string[]> = {};
    const fake = (outcome: "ok" | "pending" | "fail") => async (argv: string[], hashes?: SnapshotHashes) => {
      seen[argv[1]!] = argv; assert.equal(hashes, undefined);
      if (outcome === "pending") throw new Error("Changes pending approval; output not written");
      if (outcome === "fail") throw new Error("Snapshot SHA-256 mismatch");
    };
    const lines: string[] = [];
    const derived: DerivedContext[] = [];
    const outcomes = await regenerate([`--en-snapshot=a`, `--cn-snapshot=b`, `--out-root=${directory}`, `--report-dir=r`, `--approve-dir=${approveDir}`], { "operator-stats": fake("ok"), "operator-skills": fake("ok"), "operator-modules": fake("pending"), "operator-catalog": fake("fail") }, (line) => lines.push(line), async () => [file("current"), file("updated")], { "operator-limited-manifest": async (context) => { derived.push(context); } });
    assert.deepEqual(outcomes.map((item) => [item.id, item.status]), [["curated-provenance", "written"], ["operator-stats", "written"], ["operator-skills", "written"], ["operator-modules", "pending"], ["operator-catalog", "failed"], ["operator-limited-manifest", "written"]]);
    assert.equal(derived.length, 1, "derived datasets run after the update-mode ones");
    assert.deepEqual([derived[0]!.snapshots, derived[0]!.outRoot, derived[0]!.hashes], [{ en: "a", cn: "b" }, directory, undefined]);
    assert.equal(await derived[0]!.input("data/operator-catalog/index.json"), "data/operator-catalog/index.json", "the versioned catalog when none was generated");
    assert.ok(!lines.some((line) => line.startsWith("operator-limited-manifest: run")), "a derived dataset is not listed as manual");
    assert.ok(seen["data:skills:generate"]!.includes("--approve"), "an approved report is passed");
    assert.ok(!seen["data:stats:generate"]!.includes("--approve"), "and only when it exists");
    assert.ok(lines.includes("=== operator-skills (approved report)"));
    assert.ok(lines.some((line) => line.startsWith("operator-tactical-manifest: run scripts/generate-operator-tactical-manifest.ts by hand when modules or ranges change")));
    assert.ok(lines.includes("operator-global-updates: run data:global-update by hand"));
    assert.equal(exitCodeFor(outcomes), 1);
    const failing = await regenerate(["--en-snapshot=a", "--cn-snapshot=b", `--out-root=${directory}`, "--report-dir=r", "--only=operator-limited-manifest"], runners, () => undefined, async () => [], { "operator-limited-manifest": async () => { throw new Error("The CN gacha table does not match the pinned SHA-256"); } });
    assert.deepEqual(failing, [{ id: "operator-limited-manifest", status: "failed", message: "The CN gacha table does not match the pinned SHA-256" }]);
    assert.equal(exitCodeFor(outcomes.slice(0, 4)), 2);
    assert.equal(exitCodeFor(outcomes.slice(0, 3)), 0);
    const curated = async (status: FileOutcome["status"]) => (await regenerate(["--en-snapshot=a", "--cn-snapshot=b", `--out-root=${directory}`, "--report-dir=r", "--only=curated-provenance"], runners, () => undefined, async () => [file("current"), file(status)]));
    assert.deepEqual(await curated("pending"), [{ id: "curated-provenance", status: "pending", message: "regional pending" }], "a changed value waits for review");
    assert.deepEqual((await curated("failed")).map((item) => item.status), ["failed"]);
    assert.deepEqual(await regenerate(["--en-snapshot=a", "--cn-snapshot=b", `--out-root=${directory}`, "--report-dir=r", "--only=curated-provenance"], runners, () => undefined, async () => { throw new Error("no snapshot"); }), [{ id: "curated-provenance", status: "failed", message: "no snapshot" }]);
    const received: string[] = [];
    await mkdir(join(directory, "data"), { recursive: true });
    await writeFile(join(directory, "data/operator-cn-release-manifest.json"), "{}", "utf8");
    await regenerate(["--en-snapshot=a", "--cn-snapshot=b", `--out-root=${directory}`, "--report-dir=r", "--only=operator-stats"], { ...runners, "operator-stats": async (_argv, _hashes, paths) => { received.push(paths.releaseManifest, paths.regionalManifest); } }, () => undefined);
    assert.deepEqual(received, [join(directory, "data/operator-cn-release-manifest.json"), "data/operator-regional-manifest.json"], "generators read the manifests the provenance step rewrote under --out-root");
    const odd = await regenerate(["--en-snapshot=a", "--cn-snapshot=b", `--out-root=${directory}`, "--report-dir=r", "--only=operator-stats"], { ...runners, "operator-stats": async () => { throw "broken"; } }, () => undefined);
    assert.deepEqual(odd, [{ id: "operator-stats", status: "failed", message: "broken" }]);
    const only = await regenerate(["--en-snapshot=a", "--cn-snapshot=b", `--out-root=${directory}`, "--report-dir=r", "--only=operator-stats"], { ...runners, "operator-stats": fake("ok") }, () => undefined);
    assert.deepEqual(only.map((item) => item.id), ["operator-stats"]);
    await assert.rejects(regenerate(["--en-snapshot=a", "--cn-snapshot=b", "--out-root=x", "--report-dir=r", "--only=operator-tactical-manifest"], runners, () => undefined), /Not an update-mode dataset: operator-tactical-manifest/);
    await assert.rejects(regenerate(["--en-snapshot=a", "--cn-snapshot=b", "--report-dir=r"], runners, () => undefined), /Missing --out-root/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("snapshot hashes come from the snapshot manifests, and only for an output outside the repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "regenerate-hashes-"));
  try {
    for (const region of ["en", "cn"]) {
      await mkdir(join(directory, region));
      await writeFile(join(directory, region, "manifest.json"), JSON.stringify({ region, revision: region[0]!.repeat(40), files: [{ table: "character_table", sha256: `${region.toUpperCase()}1` }] }), "utf8");
    }
    const regionsOf = { en: join(directory, "en"), cn: join(directory, "cn") };
    assert.deepEqual(await snapshotHashes(regionsOf), { en: { character_table: "EN1" }, cn: { character_table: "CN1" } });
    let received: SnapshotHashes | undefined;
    await regenerate([`--en-snapshot=${regionsOf.en}`, `--cn-snapshot=${regionsOf.cn}`, `--out-root=${join(directory, "out")}`, "--report-dir=r", "--only=operator-stats", "--snapshot-hashes"], { ...runners, "operator-stats": async (_argv, hashes) => { received = hashes; } }, () => undefined);
    assert.equal(received?.cn.character_table, "CN1");
    await assert.rejects(regenerate([`--en-snapshot=${regionsOf.en}`, `--cn-snapshot=${regionsOf.cn}`, "--out-root=.", "--report-dir=r", "--snapshot-hashes"], runners, () => undefined), /outside the repository/);
    await writeFile(join(directory, "cn", "manifest.json"), JSON.stringify({ region: "en", files: [] }), "utf8");
    await assert.rejects(snapshotHashes(regionsOf), /cn snapshot has no valid manifest/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("each runner passes the snapshot hashes its generator expects", async () => {
  const hashes: SnapshotHashes = { en: { character_table: "E", handbook_info_table: "EH" }, cn: { character_table: "C", handbook_info_table: "CH" } };
  for (const id of Object.keys(runners) as (keyof typeof runners)[]) {
    await assert.rejects(runners[id](["node", "x"], hashes, manifests), /Missing/, `${id} reaches its generator with the snapshot hashes`);
    await assert.rejects(runners[id](["node", "x"], undefined, manifests), /Missing/, `${id} reaches its generator with the pinned hashes`);
  }
});

test("the limited manifest is derived from the CN snapshot and the generated catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "regenerate-derived-"));
  try {
    const gacha = JSON.stringify({ gachaPoolClient: [{ gachaPoolId: "LIMITED_1", gachaRuleType: "LIMITED", limitParam: { limitedCharId: "char_1_a" } }] });
    const snapshotsOf = { en: join(directory, "en"), cn: join(directory, "cn") };
    for (const region of ["en", "cn"] as const) {
      await mkdir(snapshotsOf[region]);
      await writeFile(join(snapshotsOf[region], "manifest.json"), JSON.stringify({ region, revision: region[0]!.repeat(40), files: [] }), "utf8");
    }
    await writeFile(join(snapshotsOf.cn, "gacha_table.json"), gacha, "utf8");
    const outRoot = join(directory, "out");
    await mkdir(join(outRoot, "data/operator-catalog"), { recursive: true });
    await writeFile(join(outRoot, "data/operator-catalog/index.json"), JSON.stringify({ operators: [{ id: "char_1_a" }] }), "utf8");
    const revisions = await snapshotRevisions(snapshotsOf);
    assert.deepEqual(revisions, { en: "e".repeat(40), cn: "c".repeat(40) });
    const hashes: SnapshotHashes = { en: {}, cn: { gacha_table: sha256(gacha) } };
    const input = async (path: string) => join(outRoot, path);
    await assert.rejects(derivedRunners["operator-limited-manifest"]({ snapshots: snapshotsOf, outRoot, revisions, input }), /pinned SHA-256/, "without snapshot hashes the pinned hash applies");
    await derivedRunners["operator-limited-manifest"]({ snapshots: snapshotsOf, outRoot, hashes, revisions, input });
    const written = JSON.parse(await readFile(join(outRoot, "data/operator-limited-manifest.json"), "utf8")) as { source: { revision: string }; operators: unknown[] };
    assert.deepEqual([written.source.revision, written.operators], ["c".repeat(40), [{ id: "char_1_a", pool: "LIMITED_1" }]]);
    await writeFile(join(snapshotsOf.en, "manifest.json"), JSON.stringify({ region: "en", files: [] }), "utf8");
    await assert.rejects(snapshotRevisions(snapshotsOf), /en snapshot manifest has no revision/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
