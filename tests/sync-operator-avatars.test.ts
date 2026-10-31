import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { avatarConversion, avatarInventory, avatarSource, type OperatorAvatarManifest } from "../src/game-data/operator-avatars";
import { main } from "../scripts/sync-operator-avatars";
import { rawUrl } from "../scripts/sync-operator-images";
import { loadSharp, type SyncDependencies } from "../scripts/sync-operator-module-art";
import { gitBlobSha } from "../src/game-data/git-blob";
import { compareCodeUnits } from "../src/game-data/string-order";

const sharp = loadSharp(avatarConversion.tool);
const png = (size: number, red: number) => (sharp as unknown as (input: { create: object }) => { png(): { toBuffer(): Promise<Buffer> } })({ create: { width: size, height: size, channels: 4, background: { r: red, g: 40, b: 90, alpha: 0.5 } } }).png().toBuffer();
const operators = [{ id: "char_002_b" }, { id: "char_001_a" }];

test("the avatar inventory lists the base avatar of every operator and rejects bad ids", () => {
  assert.deepEqual(avatarInventory(operators), [
    { source: "avatars/char_001_a.png", local: "char_001_a.webp" },
    { source: "avatars/char_002_b.png", local: "char_002_b.webp" },
  ]);
  assert.throws(() => avatarInventory([...operators, operators[0]!]), /Duplicate/);
  assert.throws(() => avatarInventory([{ id: "../x" }]), /Invalid operator id/);
});

async function fakeSource(files: Record<string, Buffer>) {
  const requests: string[] = [];
  const api = `https://api.github.com/repos/${avatarSource.repository}/git/trees`;
  const treeSha = gitBlobSha(Buffer.from("avatars"));
  const responses = new Map<string, () => Response>([
    [`${api}/${avatarSource.revision}`, () => Response.json({ tree: [{ path: "avatars", type: "tree", sha: treeSha }] })],
    [`${api}/${treeSha}`, () => Response.json({ tree: Object.entries(files).map(([file, data]) => ({ path: path.posix.basename(file), type: "blob", sha: gitBlobSha(data) })) })],
    ...Object.entries(files).map(([file, data]) => [rawUrl(file), () => new Response(new Uint8Array(data))] as const),
  ]);
  const dependencies: SyncDependencies = { sharp: () => sharp, fetch: async (url) => { requests.push(url); return responses.get(url)?.() ?? new Response(null, { status: 404 }); } };
  return { requests, dependencies };
}

test("the avatar sync downloads only the base avatars, never enlarges them and reproduces its output", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "operator-avatars-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = (name: string) => path.join(root, name);
  await writeFile(out("catalog.json"), JSON.stringify({ operators }));
  const files = { "avatars/char_001_a.png": await png(200, 10), "avatars/char_002_b.png": await png(120, 20), "avatars/char_001_a_skin#1.png": await png(180, 30) };
  const { requests, dependencies } = await fakeSource(files);
  const argv = ["node", "sync", "--catalog", out("catalog.json"), "--out-manifest", out("manifest.json"), "--out-assets", out("assets"), "--cache-dir", out("cache")];
  await mkdir(out("assets/operator-avatars"), { recursive: true });
  await writeFile(out("assets/operator-avatars/char_000_removed.webp"), "old");
  await assert.rejects(main(argv, dependencies), /Output exists/);
  await main([...argv, "--force"], dependencies);
  assert.deepEqual(requests.filter((url) => url.startsWith("https://raw.")).sort(compareCodeUnits), [rawUrl("avatars/char_001_a.png"), rawUrl("avatars/char_002_b.png")].sort(compareCodeUnits), "skin avatars are not downloaded");
  const manifest = JSON.parse(await readFile(out("manifest.json"), "utf8")) as OperatorAvatarManifest;
  assert.deepEqual(manifest.conversion, avatarConversion);
  assert.deepEqual([manifest.avatars["char_001_a.webp"]!.original.width, manifest.avatars["char_001_a.webp"]!.converted.width], [200, 180]);
  assert.equal(manifest.avatars["char_002_b.webp"]!.converted.width, 120, "smaller files are not enlarged");
  assert.deepEqual((await readdir(out("assets/operator-avatars"))).sort(compareCodeUnits), ["char_001_a.webp", "char_002_b.webp"], "files no longer in the inventory are removed");
  const before = await readFile(out("assets/operator-avatars/char_001_a.webp"));
  requests.length = 0;
  await main([...argv, "--force"], dependencies);
  assert.equal(requests.filter((url) => url.startsWith("https://raw.")).length, 0, "the second run uses the cache");
  assert.deepEqual(await readFile(out("assets/operator-avatars/char_001_a.webp")), before);
  manifest.avatars["char_002_b.webp"]!.original.sha256 = "0".repeat(64);
  await writeFile(out("manifest.json"), JSON.stringify(manifest));
  await assert.rejects(main([...argv, "--force"], dependencies), /SHA-256 differs from the manifest/);
});

test("the avatar sync rejects files outside the pinned tree and tampered downloads", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "operator-avatars-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "catalog.json"), JSON.stringify({ operators }));
  const argv = ["node", "sync", "--catalog", path.join(root, "catalog.json"), "--out-manifest", path.join(root, "out.json"), "--out-assets", path.join(root, "assets")];
  await assert.rejects(main(argv, (await fakeSource({ "avatars/char_001_a.png": await png(20, 1) })).dependencies), /avatars\/char_002_b.png is not in the pinned tree/);
  const tampered = await fakeSource({ "avatars/char_001_a.png": await png(20, 1), "avatars/char_002_b.png": await png(20, 2) });
  const original = tampered.dependencies.fetch;
  tampered.dependencies.fetch = async (url) => url === rawUrl("avatars/char_002_b.png") ? new Response(new Uint8Array(await png(20, 9))) : original(url);
  await assert.rejects(main(argv, tampered.dependencies), /does not match the git blob hash/);
});
