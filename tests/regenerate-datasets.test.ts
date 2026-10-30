import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { datasetRegistry, type DatasetId } from "../src/game-data/dataset-registry";
import { compareCodeUnits } from "../src/game-data/string-order";
import { exitCodeFor, generatorArguments, regenerate, runners, snapshotHashes, type SnapshotHashes } from "../scripts/regenerate-datasets";

const snapshots = { en: "snap/en", cn: "snap/cn" };

test("there is a runner for every update-mode dataset of the registry and for nothing else", () => {
  const update = (Object.entries(datasetRegistry) as [DatasetId, { generator: { kind: string } }][]).filter(([, entry]) => entry.generator.kind === "update").map(([id]) => id);
  assert.deepEqual(Object.keys(runners).sort(compareCodeUnits), update.sort(compareCodeUnits));
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
    const outcomes = await regenerate([`--en-snapshot=a`, `--cn-snapshot=b`, `--out-root=${directory}`, `--report-dir=r`, `--approve-dir=${approveDir}`], { "operator-stats": fake("ok"), "operator-skills": fake("ok"), "operator-modules": fake("pending"), "operator-catalog": fake("fail") }, (line) => lines.push(line));
    assert.deepEqual(outcomes.map((item) => [item.id, item.status]), [["operator-stats", "written"], ["operator-skills", "written"], ["operator-modules", "pending"], ["operator-catalog", "failed"]]);
    assert.ok(seen["data:skills:generate"]!.includes("--approve"), "an approved report is passed");
    assert.ok(!seen["data:stats:generate"]!.includes("--approve"), "and only when it exists");
    assert.ok(lines.includes("=== operator-skills (approved report)"));
    assert.ok(lines.some((line) => line.startsWith("operator-tactical-manifest: run scripts/generate-operator-tactical-manifest.ts by hand when modules or ranges change")));
    assert.ok(lines.includes("operator-global-updates: run data:global-update by hand"));
    assert.equal(exitCodeFor(outcomes), 1);
    assert.equal(exitCodeFor(outcomes.slice(0, 3)), 2);
    assert.equal(exitCodeFor(outcomes.slice(0, 2)), 0);
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
      await writeFile(join(directory, region, "manifest.json"), JSON.stringify({ region, files: [{ table: "character_table", sha256: `${region.toUpperCase()}1` }] }), "utf8");
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
    await assert.rejects(runners[id](["node", "x"], hashes), /Missing/, `${id} reaches its generator with the snapshot hashes`);
    await assert.rejects(runners[id](["node", "x"]), /Missing/, `${id} reaches its generator with the pinned hashes`);
  }
});
