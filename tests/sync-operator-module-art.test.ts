import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { moduleArtConversion, moduleArtSource, type ModuleArtManifest } from "../src/game-data/operator-module-art";
import { buildModuleArtManifest, gitBlobSha, loadSharp, main, moduleArtInventory, rawUrl, type SyncDependencies } from "../scripts/sync-operator-module-art";
import { compareCodeUnits } from "../src/game-data/string-order";

const sharp = loadSharp();
/** A square RGBA PNG made with the same sharp, standing in for a source file. */
const png = (size: number, red: number) => (sharp as unknown as (input: { create: object }) => { png(): { toBuffer(): Promise<Buffer> } })({ create: { width: size, height: size, channels: 4, background: { r: red, g: 40, b: 90, alpha: 0.5 } } }).png().toBuffer();

test("git blob hashes and the module inventory", () => {
  assert.equal(gitBlobSha(Buffer.alloc(0)), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  assert.deepEqual(moduleArtInventory([{ modules: [{ id: "uniequip_003_b" }] }, { modules: [{ id: "uniequip_002_a" }] }]), ["uniequip_002_a", "uniequip_003_b"]);
  assert.throws(() => moduleArtInventory([{ modules: [{ id: "uniequip_002_a" }] }, { modules: [{ id: "uniequip_002_a" }] }]), /Duplicate/);
  assert.equal(rawUrl("equip/stage/img_stg1.png"), `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${moduleArtSource.revision}/equip/stage/img_stg1.png`);
  const info = { bytes: 1, sha256: "A", width: 1, height: 1 };
  assert.throws(() => buildModuleArtManifest(new Map(), new Map([["stage-1.png", info]])), /Missing level icon img_stg2.png/);
});

/** Fake GitHub: the pinned tree and the raw files, recording every request. */
async function fakeSource(files: Record<string, Buffer>) {
  const requests: string[] = [];
  const equipSha = "e".repeat(40);
  const api = `https://api.github.com/repos/${moduleArtSource.repository}/git/trees`;
  const tree = Object.entries(files).map(([file, data]) => ({ path: file, type: "blob", sha: gitBlobSha(data) }));
  const responses = new Map<string, () => Response>([
    [`${api}/${moduleArtSource.revision}`, () => Response.json({ tree: [{ path: "equip", type: "tree", sha: equipSha }] })],
    [`${api}/${equipSha}?recursive=1`, () => Response.json({ tree: [...tree, { path: "icon/uniequip_002_unused.png", type: "blob", sha: "0".repeat(40) }] })],
    ...Object.entries(files).map(([file, data]) => [rawUrl(`equip/${file}`), () => new Response(new Uint8Array(data))] as const),
  ]);
  const dependencies: SyncDependencies = { sharp: () => sharp, fetch: async (url) => { requests.push(url); return responses.get(url)?.() ?? new Response(null, { status: 404 }); } };
  return { requests, dependencies };
}

test("the sync downloads only the inventory, converts with the fixed parameters and reproduces its output", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "module-art-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const modulesDir = path.join(root, "modules");
  await mkdir(modulesDir);
  await writeFile(path.join(modulesDir, "char_001_a.json"), JSON.stringify({ modules: [{ id: "uniequip_002_a" }, { id: "uniequip_003_a" }] }));
  await writeFile(path.join(modulesDir, "index.json"), "{}");
  const files: Record<string, Buffer> = {
    "icon/uniequip_002_a.png": await png(511, 200), "icon/uniequip_003_a.png": await png(400, 20),
    "stage/img_stg1.png": await png(20, 1), "stage/img_stg2.png": await png(20, 2), "stage/img_stg3.png": await png(20, 3),
  };
  const { requests, dependencies } = await fakeSource(files);
  const out = (name: string) => path.join(root, name);
  const argv = ["node", "sync", "--modules-dir", modulesDir, "--out-manifest", out("manifest.json"), "--out-art", out("art"), "--out-stages", out("stages"), "--cache-dir", out("cache")];
  await mkdir(out("art"));
  await writeFile(out("art/uniequip_002_removed.webp"), "old");
  await assert.rejects(main(argv, dependencies), /Output exists/);
  await main([...argv, "--force"], dependencies);
  assert.deepEqual(requests.filter((url) => url.startsWith("https://raw.")).sort(compareCodeUnits), Object.keys(files).map((file) => rawUrl(`equip/${file}`)).sort(compareCodeUnits), "nothing outside the inventory is downloaded");
  const manifest = JSON.parse(await readFile(out("manifest.json"), "utf8")) as ModuleArtManifest;
  assert.deepEqual(manifest.conversion, moduleArtConversion);
  assert.deepEqual(Object.keys(manifest.art), ["uniequip_002_a.webp", "uniequip_003_a.webp"]);
  assert.deepEqual([manifest.art["uniequip_002_a.webp"].original.width, manifest.art["uniequip_002_a.webp"].converted.width], [511, 480]);
  assert.equal(manifest.art["uniequip_003_a.webp"].converted.width, 400, "smaller files are not enlarged");
  assert.equal(manifest.art["uniequip_002_a.webp"].url, rawUrl("equip/icon/uniequip_002_a.png"));
  assert.deepEqual(Object.keys(manifest.stages), ["stage-1.png", "stage-2.png", "stage-3.png"]);
  assert.deepEqual((await readdir(out("art"))).sort(compareCodeUnits), ["uniequip_002_a.webp", "uniequip_003_a.webp"], "files of modules no longer in the dataset are removed");
  assert.deepEqual(await readFile(out("stages/stage-2.png")), files["stage/img_stg2.png"], "level icons are copied as is");
  // A second run uses the cache and writes the same bytes.
  const before = await Promise.all(["manifest.json", "art/uniequip_002_a.webp"].map((file) => readFile(out(file))));
  requests.length = 0;
  await main([...argv, "--force"], dependencies);
  assert.equal(requests.filter((url) => url.startsWith("https://raw.")).length, 0);
  assert.deepEqual(await Promise.all(["manifest.json", "art/uniequip_002_a.webp"].map((file) => readFile(out(file)))), before);
  // The recorded SHA-256 is checked against the source.
  manifest.art["uniequip_002_a.webp"].original.sha256 = "0".repeat(64);
  await writeFile(out("manifest.json"), JSON.stringify(manifest));
  await assert.rejects(main([...argv, "--force"], dependencies), /SHA-256 differs from the manifest/);
});

test("the sync rejects files outside the pinned tree and downloads that do not match it", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "module-art-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "char_001_a.json"), JSON.stringify({ modules: [{ id: "uniequip_002_a" }] }));
  const argv = ["node", "sync", "--modules-dir", root, "--out-manifest", path.join(root, "out.json"), "--out-art", path.join(root, "art"), "--out-stages", path.join(root, "stages")];
  const missing = await fakeSource({ "stage/img_stg1.png": await png(20, 1) });
  await assert.rejects(main(argv, missing.dependencies), /equip\/icon\/uniequip_002_a.png is not in the pinned tree/);
  const tampered = await fakeSource({ "icon/uniequip_002_a.png": await png(30, 1) });
  const original = tampered.dependencies.fetch;
  tampered.dependencies.fetch = async (url) => url.startsWith("https://raw.") ? new Response(new Uint8Array(await png(30, 9))) : original(url);
  await assert.rejects(main(argv, tampered.dependencies), /does not match the git blob hash/);
  const failing = await fakeSource({});
  failing.dependencies.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(main(argv, failing.dependencies), /HTTP 403/);
});
