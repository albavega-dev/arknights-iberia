import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { classIconFiles, factionLogoFiles, operatorImageConversions, operatorImageInventory, operatorImageSource, type OperatorImageManifest } from "../src/game-data/operator-images";
import { main, pool, rawUrl } from "../scripts/sync-operator-images";
import { loadSharp, type SyncDependencies } from "../scripts/sync-operator-module-art";
import { compareCodeUnits } from "../src/game-data/string-order";
import { gitBlobSha } from "../src/game-data/git-blob";

const sharp = loadSharp(operatorImageConversions.illustrations.tool);
/** A square RGBA PNG made with the same sharp, standing in for a source file. */
const png = (size: number, red: number) => (sharp as unknown as (input: { create: object }) => { png(): { toBuffer(): Promise<Buffer> } })({ create: { width: size, height: size, channels: 4, background: { r: red, g: 40, b: 90, alpha: 0.5 } } }).png().toBuffer();

const operators = [
  { id: "char_002_b", class: "Guard" as const, subClassId: "lord" },
  { id: "char_001_a", class: "Medic" as const, subClassId: "physician" },
];

test("the inventory lists E0 for every operator, E2 when the tree has it, every faction logo and class, and the subclasses of the catalog", () => {
  const inventory = operatorImageInventory(operators, new Set(["characters/char_001_a_2.png"]));
  assert.deepEqual(inventory.illustrations, [
    { source: "characters/char_001_a_1.png", local: "char_001_a_1.webp" },
    { source: "characters/char_001_a_2.png", local: "char_001_a_2.webp" },
    { source: "characters/char_002_b_1.png", local: "char_002_b_1.webp" },
  ]);
  assert.equal(inventory.factions.length, Object.keys(factionLogoFiles).length);
  assert.deepEqual(inventory.factions.find((item) => item.local === "rhodes-island.webp"), { source: "factions/logo_rhodes.png", local: "rhodes-island.webp" });
  assert.deepEqual(inventory.classes.map((item) => item.local), Object.keys(classIconFiles).map((name) => `${name.toLowerCase()}.png`).sort(compareCodeUnits));
  assert.deepEqual(inventory.subclasses, [{ source: "ui/subclass/sub_lord_icon.png", local: "lord.png" }, { source: "ui/subclass/sub_physician_icon.png", local: "physician.png" }]);
  assert.throws(() => operatorImageInventory([...operators, operators[0]!], new Set()), /Duplicate/);
  assert.throws(() => operatorImageInventory([{ ...operators[0]!, id: "../x" }], new Set()), /Invalid operator id/);
  assert.throws(() => operatorImageInventory([{ ...operators[0]!, subClassId: "a/b" }], new Set()), /Invalid subclass id/);
  assert.equal(rawUrl("factions/logo_rhodes.png"), `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${operatorImageSource.revision}/factions/logo_rhodes.png`);
});

test("the pool keeps the order of the results and never runs more tasks than the limit", async () => {
  let running = 0;
  let peak = 0;
  const results = await pool([30, 10, 20, 0], 2, async (delay) => { running++; peak = Math.max(peak, running); await new Promise((resolve) => setTimeout(resolve, delay)); running--; return delay * 2; });
  assert.deepEqual(results, [60, 20, 40, 0]);
  assert.equal(peak, 2);
});

/** Fake GitHub: the pinned tree, walked one directory at a time, and the raw files, recording every request. */
async function fakeSource(files: Record<string, Buffer>) {
  const requests: string[] = [];
  const api = `https://api.github.com/repos/${operatorImageSource.repository}/git/trees`;
  const directories = ["characters", "factions", "classes", "ui", "ui/subclass"];
  const sha = (directory: string) => gitBlobSha(Buffer.from(directory));
  const children = (directory: string) => [
    ...directories.filter((child) => path.posix.dirname(child) === (directory || ".")).map((child) => ({ path: path.posix.basename(child), type: "tree", sha: sha(child) })),
    ...Object.entries(files).filter(([file]) => path.posix.dirname(file) === directory).map(([file, data]) => ({ path: path.posix.basename(file), type: "blob", sha: gitBlobSha(data) })),
  ];
  const responses = new Map<string, () => Response>([
    [`${api}/${operatorImageSource.revision}`, () => Response.json({ tree: children("") })],
    ...directories.map((directory) => [`${api}/${sha(directory)}`, () => Response.json({ tree: children(directory) })] as const),
    ...Object.entries(files).map(([file, data]) => [rawUrl(file), () => new Response(new Uint8Array(data))] as const),
  ]);
  const dependencies: SyncDependencies = { sharp: () => sharp, fetch: async (url) => { requests.push(url); return responses.get(url)?.() ?? new Response(null, { status: 404 }); } };
  return { requests, dependencies };
}

async function sourceFiles(): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {
    "characters/char_001_a_1.png": await png(1400, 200), "characters/char_001_a_2.png": await png(900, 120), "characters/char_002_b_1.png": await png(300, 10),
    "characters/char_999_unused_1.png": await png(10, 1),
    "ui/subclass/sub_lord_icon.png": await png(60, 3), "ui/subclass/sub_physician_icon.png": await png(60, 4),
  };
  for (const [index, file] of Object.values(classIconFiles).entries()) files[`classes/${file}`] = await png(20, index);
  for (const [index, file] of Object.values(factionLogoFiles).entries()) files[`factions/${file}`] = await png(index === 0 ? 510 : 50, index);
  return files;
}

test("the sync downloads only the inventory, converts with the fixed parameters and reproduces its output", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "operator-images-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "catalog.json"), JSON.stringify({ operators }));
  const files = await sourceFiles();
  const { requests, dependencies } = await fakeSource(files);
  const out = (name: string) => path.join(root, name);
  const argv = ["node", "sync", "--catalog", out("catalog.json"), "--out-manifest", out("manifest.json"), "--out-assets", out("assets"), "--cache-dir", out("cache")];
  await mkdir(out("assets/operator-illustrations"), { recursive: true });
  await writeFile(out("assets/operator-illustrations/char_000_removed_1.webp"), "old");
  await assert.rejects(main(argv, dependencies), /Output exists/);
  await main([...argv, "--force"], dependencies);
  const downloaded = requests.filter((url) => url.startsWith("https://raw.")).sort(compareCodeUnits);
  assert.deepEqual(downloaded, Object.keys(files).filter((file) => !file.includes("unused")).map(rawUrl).sort(compareCodeUnits), "nothing outside the inventory is downloaded");
  const manifest = JSON.parse(await readFile(out("manifest.json"), "utf8")) as OperatorImageManifest;
  assert.deepEqual(manifest.conversions, operatorImageConversions);
  assert.deepEqual(Object.keys(manifest.illustrations), ["char_001_a_1.webp", "char_001_a_2.webp", "char_002_b_1.webp"]);
  assert.deepEqual([manifest.illustrations["char_001_a_1.webp"]!.original.width, manifest.illustrations["char_001_a_1.webp"]!.converted.width], [1400, 1280]);
  assert.equal(manifest.illustrations["char_002_b_1.webp"]!.converted.width, 300, "smaller files are not enlarged");
  assert.equal(manifest.factions["rhodes-island.webp"]!.converted.width, 50);
  assert.equal(manifest.factions["abyssal-hunters.webp"]!.converted.width, 96);
  assert.equal(manifest.illustrations["char_001_a_2.webp"]!.url, rawUrl("characters/char_001_a_2.png"));
  assert.deepEqual((await readdir(out("assets/operator-illustrations"))).sort(compareCodeUnits), ["char_001_a_1.webp", "char_001_a_2.webp", "char_002_b_1.webp"], "files no longer in the inventory are removed");
  assert.deepEqual(await readFile(out("assets/operator-classes/guard.png")), files["classes/class_guard.png"], "class icons are copied as is");
  assert.deepEqual(await readFile(out("assets/operator-subclasses/lord.png")), files["ui/subclass/sub_lord_icon.png"], "subclass icons are copied as is");
  assert.equal(manifest.subclasses["lord.png"]!.sha256, manifest.subclasses["lord.png"]!.sha256.toUpperCase());
  // A second run uses the cache and writes the same bytes.
  const written = ["manifest.json", "assets/operator-illustrations/char_001_a_1.webp", "assets/operator-factions/rhodes-island.webp"];
  const before = await Promise.all(written.map((file) => readFile(out(file))));
  requests.length = 0;
  await main([...argv, "--force"], dependencies);
  assert.equal(requests.filter((url) => url.startsWith("https://raw.")).length, 0);
  assert.deepEqual(await Promise.all(written.map((file) => readFile(out(file)))), before);
  // The recorded SHA-256 is checked against the source.
  manifest.subclasses["lord.png"]!.sha256 = "0".repeat(64);
  await writeFile(out("manifest.json"), JSON.stringify(manifest));
  await assert.rejects(main([...argv, "--force"], dependencies), /SHA-256 differs from the manifest/);
});

test("the sync rejects files outside the pinned tree and downloads that do not match it", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "operator-images-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "catalog.json"), JSON.stringify({ operators }));
  const argv = ["node", "sync", "--catalog", path.join(root, "catalog.json"), "--out-manifest", path.join(root, "out.json"), "--out-assets", path.join(root, "assets")];
  const files = await sourceFiles();
  const withoutLord = Object.fromEntries(Object.entries(files).filter(([file]) => !file.endsWith("sub_lord_icon.png")));
  await assert.rejects(main(argv, (await fakeSource(withoutLord)).dependencies), /ui\/subclass\/sub_lord_icon.png is not in the pinned tree/);
  const tampered = await fakeSource(files);
  const original = tampered.dependencies.fetch;
  tampered.dependencies.fetch = async (url) => url === rawUrl("characters/char_002_b_1.png") ? new Response(new Uint8Array(await png(30, 9))) : original(url);
  await assert.rejects(main(argv, tampered.dependencies), /does not match the git blob hash/);
  const failing = await fakeSource(files);
  failing.dependencies.fetch = async () => new Response(null, { status: 403 });
  await assert.rejects(main(argv, failing.dependencies), /HTTP 403/);
});
