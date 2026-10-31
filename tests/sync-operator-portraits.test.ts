import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { portraitChanges, portraitConversion, portraitSource, portraitUrl, type PortraitHead, type PortraitManifest } from "../src/game-data/operator-portraits";
import { contentMd5, main } from "../scripts/sync-operator-portraits";
import { loadSharp, type SyncDependencies } from "../scripts/sync-operator-module-art";

const sharp = loadSharp(portraitConversion.tool);
/** An RGBA PNG made with the same sharp, standing in for a portrait. */
const png = (red: number) => (sharp as unknown as (input: { create: object }) => { png(): { toBuffer(): Promise<Buffer> } })({ create: { width: 180, height: 360, channels: 4, background: { r: red, g: 40, b: 90, alpha: 0.5 } } }).png().toBuffer();

test("portrait URLs accept only operator ids on the CDN", () => {
  assert.equal(portraitUrl("char_002_amiya"), "https://web.hycdn.cn/arknights/game/assets/char/portrait/char_002_amiya.png");
  for (const value of ["../x", "char_002_amiya/../../x", "CHAR_002", "char_002_amiya.png", ""]) assert.throws(() => portraitUrl(value), /Invalid operator id/);
});

test("the update check reports changed, new, removed and failed portraits, and not the ones still missing", () => {
  const entry = (md5: string) => ({ source: "", contentMd5: md5, etag: "", original: { bytes: 1, sha256: "", width: 1, height: 1 }, converted: { bytes: 1, sha256: "", width: 1, height: 1 } });
  const manifest = { portraits: { "char_1.webp": entry("A"), "char_2.webp": entry("B"), "char_old.webp": entry("C") }, missing: ["char_4", "char_5"] };
  const heads = new Map<string, PortraitHead>([
    ["char_1", { status: 200, contentMd5: "A" }], ["char_2", { status: 200, contentMd5: "Z" }], ["char_3", { status: 200, contentMd5: "N" }],
    ["char_4", { status: 404, contentMd5: null }], ["char_5", { status: 200, contentMd5: "M" }], ["char_6", { status: 500, contentMd5: null }],
  ]);
  assert.deepEqual(portraitChanges(manifest, ["char_1", "char_2", "char_3", "char_4", "char_5", "char_6", "char_7"], heads), { changed: ["char_2"], added: ["char_3", "char_5"], unavailable: ["char_6", "char_7"], removed: ["char_old"] });
  assert.deepEqual(portraitChanges(manifest, ["char_1"], new Map([["char_1", { status: 404, contentMd5: null }]])).unavailable, ["char_1"], "a recorded portrait that disappears is reported");
});

/** Fake CDN: portraits by operator id with their Content-MD5, recording every request with its method. */
function fakeCdn(portraits: Record<string, Buffer>) {
  const requests: string[] = [];
  const response = (id: string, method: string) => {
    const data = portraits[id];
    if (!data) return new Response(null, { status: 404 });
    const headers = { "content-md5": contentMd5(data), etag: `"${id.toUpperCase()}"` };
    return method === "HEAD" ? new Response(null, { headers }) : new Response(new Uint8Array(data), { headers });
  };
  const dependencies: SyncDependencies = {
    sharp: () => sharp,
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url}`);
      const id = new URL(url).pathname.split("/").at(-1)!.replace(/\.png$/, "");
      return response(id, method);
    },
  };
  return { requests, dependencies };
}

test("the sync converts every catalog portrait, records its Content-MD5 and SHA-256 and reproduces its output", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "portraits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "catalog.json"), JSON.stringify({ operators: [{ id: "char_002_b" }, { id: "char_001_a" }, { id: "char_003_new" }] }));
  const portraits = { char_001_a: await png(10), char_002_b: await png(200) };
  const { requests, dependencies } = fakeCdn(portraits);
  const out = (name: string) => path.join(root, name);
  const argv = ["node", "sync", "--catalog", out("catalog.json"), "--out-manifest", out("manifest.json"), "--out-dir", out("portraits"), "--cache-dir", out("cache")];
  await writeFile(out("manifest.json"), JSON.stringify({ source: { repository: "old" }, portraits: { char_001_a: "charpor/char_001_a_1.png" } }));
  await assert.rejects(main(argv, dependencies), /Output exists/);
  await main([...argv, "--force"], dependencies);
  const manifest = JSON.parse(await readFile(out("manifest.json"), "utf8")) as PortraitManifest;
  assert.deepEqual([manifest.source, manifest.conversion], [portraitSource, portraitConversion]);
  assert.deepEqual(Object.keys(manifest.portraits), ["char_001_a.webp", "char_002_b.webp"]);
  assert.deepEqual(manifest.missing, ["char_003_new"]);
  const entry = manifest.portraits["char_001_a.webp"]!;
  assert.deepEqual([entry.source, entry.contentMd5, entry.etag], [portraitUrl("char_001_a"), contentMd5(portraits.char_001_a), '"CHAR_001_A"']);
  assert.deepEqual([entry.original.width, entry.original.height, entry.converted.width, entry.converted.height], [180, 360, 180, 360], "portraits keep their size");
  assert.deepEqual(await readdir(out("portraits")), ["char_001_a.webp", "char_002_b.webp"]);
  // A second run only sends HEAD requests and writes the same bytes.
  const written = ["manifest.json", "portraits/char_001_a.webp"];
  const before = await Promise.all(written.map((file) => readFile(out(file))));
  requests.length = 0;
  await main([...argv, "--force"], dependencies);
  assert.ok(requests.every((request) => request.startsWith("HEAD ")));
  assert.deepEqual(await Promise.all(written.map((file) => readFile(out(file)))), before);
  // While the CDN keeps the same Content-MD5, the recorded SHA-256 must match.
  manifest.portraits["char_002_b.webp"]!.original.sha256 = "0".repeat(64);
  await writeFile(out("manifest.json"), JSON.stringify(manifest));
  await assert.rejects(main([...argv, "--force"], dependencies), /SHA-256 differs from the manifest/);
  // A portrait the CDN changes is downloaded again and recorded with its new Content-MD5.
  await writeFile(out("manifest.json"), before[0]!);
  portraits.char_002_b = await png(90);
  await main([...argv, "--force"], dependencies);
  assert.equal((JSON.parse(await readFile(out("manifest.json"), "utf8")) as PortraitManifest).portraits["char_002_b.webp"]!.contentMd5, contentMd5(portraits.char_002_b));
});

test("the sync rejects downloads that do not match their Content-MD5 and failed requests", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "portraits-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "catalog.json"), JSON.stringify({ operators: [{ id: "char_001_a" }] }));
  const argv = ["node", "sync", "--catalog", path.join(root, "catalog.json"), "--out-manifest", path.join(root, "out.json"), "--out-dir", path.join(root, "portraits")];
  const good = await png(10);
  const tampered = fakeCdn({ char_001_a: good });
  tampered.dependencies.fetch = async (url, init) => init?.method === "HEAD" ? new Response(null, { headers: { "content-md5": contentMd5(good) } }) : new Response(new Uint8Array(await png(11)), { headers: { "content-md5": contentMd5(good) } });
  await assert.rejects(main(argv, tampered.dependencies), /does not match its Content-MD5/);
  const unsigned = fakeCdn({ char_001_a: good });
  unsigned.dependencies.fetch = async () => new Response(null, { status: 200 });
  await assert.rejects(main(argv, unsigned.dependencies), /no Content-MD5/);
  const failing = fakeCdn({});
  failing.dependencies.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(main(argv, failing.dependencies), /HTTP 403/);
});
