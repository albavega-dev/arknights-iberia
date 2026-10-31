import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { imageRevision } from "../src/game-data/asset-revisions";
import { gitBlobSha } from "../src/game-data/git-blob";
import { rawImageUrl } from "../src/game-data/github-requests";
import { roomIconSources, type SkillIconsManifest } from "../src/game-data/operator-skill-icons";
import type { OperatorSkillsProfile } from "../src/game-data/operator-skills";
import { collectSkillIcons, listImageDirectories, main, recordedHashes, type SyncDependencies } from "../scripts/sync-operator-skill-icons";

const png = (seed: number) => {
  const data = Buffer.alloc(32 + seed);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.writeUInt32BE(64 + seed, 16);
  data.writeUInt32BE(32, 20);
  data[31 + seed] = seed;
  return data;
};
const id = (digit: string) => digit.repeat(40);
const api = (tree: string) => `https://api.github.com/repos/PuppiizSunniiz/Arknight-Images/git/trees/${tree}`;
const raw = (file: string) => rawImageUrl(imageRevision, file).toString();

/** A pinned tree with the icons of one EN and one CN skill, the mastery and room icons and one base skill icon. */
function fixture() {
  const files = new Map<string, Buffer>();
  const add = (file: string, seed: number) => { files.set(file, png(seed)); return { path: file.split("/").at(-1)!, type: "blob", sha: gitBlobSha(files.get(file)!) }; };
  const trees = new Map<string, unknown>([
    [api(imageRevision), { tree: [{ path: "skills", type: "tree", sha: id("1") }, { path: "ui", type: "tree", sha: id("2") }, { path: "README.md", type: "blob", sha: id("9") }] }],
    [api(id("1")), { tree: [add("skills/skill_icon_skchr_a_1.png", 1), add("skills/skill_icon_skcom_b[1].png", 2), add("skills/skill_icon_unused.png", 3), { path: "notes.txt", type: "blob", sha: id("8") }] }],
    [api(id("2")), { tree: [{ path: "rank", type: "tree", sha: id("3") }, { path: "infrastructure", type: "tree", sha: id("4") }] }],
    [api(id("3")), { tree: ["m-1.png", "m-2.png", "m-3.png"].map((name, index) => add(`ui/rank/${name}`, 10 + index)) }],
    [api(id("4")), { tree: [{ path: "skill", type: "tree", sha: id("5") }, ...Object.values(roomIconSources).map((name, index) => add(`ui/infrastructure/${name}`, 20 + index))] }],
    [api(id("5")), { tree: [add("ui/infrastructure/skill/bskil_meet_team&char.png", 40)] }],
  ]);
  const requests: string[] = [];
  const dependencies: SyncDependencies = {
    fetch: async (url) => {
      requests.push(url);
      if (trees.has(url)) return new Response(JSON.stringify(trees.get(url)));
      const file = [...files.keys()].find((name) => raw(name) === url);
      return file ? new Response(new Uint8Array(files.get(file)!)) : new Response(null, { status: 404 });
    },
  };
  const profiles = [
    { operatorId: "char_a", region: "en", skills: [{ skillId: "skchr_a_1" }], baseSkills: [{ stages: [{ icon: "bskil_meet_team&char" }] }] },
    { operatorId: "char_b", region: "cn", skills: [{ skillId: "skchr_b_1" }, { skillId: "skchr_none" }], baseSkills: [] },
  ] as unknown as OperatorSkillsProfile[];
  const input = { profiles, skillTables: { en: { skchr_a_1: { iconId: null } }, cn: { skchr_b_1: { iconId: "skcom_b[1]" } } }, previous: null, cacheDir: null };
  return { files, trees, requests, dependencies, input };
}

test("image URLs keep the repository and revision fixed and encode each segment", () => {
  assert.equal(raw("ui/infrastructure/skill/bskil_meet_team&char.png"), `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${imageRevision}/ui/infrastructure/skill/bskil_meet_team%26char.png`);
  assert.equal(raw("skills/skill_icon_x[1].png").endsWith("skill_icon_x%5B1%5D.png"), true);
  for (const bad of ["../secret", "skills//x.png", "skills/./x.png", "skills\\x.png", "skills/x\u0000.png", ""]) assert.throws(() => rawImageUrl(imageRevision, bad), /Invalid image path/);
  assert.throws(() => rawImageUrl("main", "skills/x.png"), /Invalid git object id/);
});

test("directories are listed level by level at the pinned revision, and incomplete listings stop the sync", async () => {
  const { dependencies, trees, requests } = fixture();
  const listings = await listImageDirectories(dependencies.fetch, imageRevision, ["skills", "ui/rank", "ui/infrastructure/skill"]);
  assert.deepEqual([...listings.get("skills")!.keys()], ["skill_icon_skchr_a_1.png", "skill_icon_skcom_b[1].png", "skill_icon_unused.png", "notes.txt"]);
  assert.deepEqual([...listings.get("ui/rank")!.keys()], ["m-1.png", "m-2.png", "m-3.png"]);
  assert.equal(requests.filter((url) => url === api(id("2"))).length, 1, "each tree is listed once");
  await assert.rejects(listImageDirectories(dependencies.fetch, imageRevision, ["equip"]), /No equip directory/);
  trees.set(api(id("1")), { tree: [], truncated: true });
  await assert.rejects(listImageDirectories(dependencies.fetch, imageRevision, ["skills"]), /incomplete tree listing/);
  await assert.rejects(listImageDirectories(async () => new Response(null, { status: 403 }), imageRevision, ["skills"]), /HTTP 403/);
});

test("the sync downloads only what the catalog uses, checks it against the pinned tree and reproduces its manifest", async (t) => {
  const { dependencies, requests, input, files } = fixture();
  const cacheDir = await mkdtemp(path.join(tmpdir(), "skill-icons-"));
  t.after(() => rm(cacheDir, { recursive: true, force: true }));
  const output = await collectSkillIcons({ ...input, cacheDir }, dependencies);
  assert.deepEqual([...output.icons.keys()], ["skchr_a_1.png", "skcom_b-1.png"]);
  assert.deepEqual(output.manifest.missing, { en: [], cn: ["skchr_none"] });
  assert.deepEqual([...output.baseSkills.keys()], ["bskil_meet_team-char.png"]);
  assert.equal(output.rooms.size, Object.keys(roomIconSources).length);
  assert.equal(output.manifest.source.revision, imageRevision);
  assert.ok(!requests.some((url) => url.includes("unused")), "unused icons are not downloaded");
  assert.ok(requests.every((url) => url.startsWith("https://api.github.com/") || url.startsWith(`https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${imageRevision}/`)));
  assert.equal(output.icons.get("skchr_a_1.png")!.equals(files.get("skills/skill_icon_skchr_a_1.png")!), true);
  assert.ok((await readdir(path.join(cacheDir, "skills"))).includes("skill_icon_skchr_a_1.png"));

  const offline: SyncDependencies = { fetch: async (url) => (url.startsWith("https://raw.") ? new Response(null, { status: 500 }) : dependencies.fetch(url)) };
  const again = await collectSkillIcons({ ...input, cacheDir, previous: output.manifest }, offline);
  assert.deepEqual(again.manifest, output.manifest, "the cache serves verified files and the result is the same");
});

test("a download that differs from the tree or from the previous manifest stops the sync", async () => {
  const tampered = fixture();
  const fetchOriginal = tampered.dependencies.fetch;
  tampered.dependencies.fetch = async (url) => (url.startsWith("https://raw.") ? new Response(new Uint8Array(png(99))) : fetchOriginal(url));
  await assert.rejects(collectSkillIcons(tampered.input, tampered.dependencies), /does not match the git blob hash/);

  const recorded = fixture();
  const first = await collectSkillIcons(recorded.input, recorded.dependencies);
  const icons = { ...first.manifest.icons, "skchr_a_1.png": { ...first.manifest.icons["skchr_a_1.png"]!, sha256: "0".repeat(64) } };
  const changed = { ...first.manifest, icons } as SkillIconsManifest;
  assert.equal(recordedHashes(changed).get("skills/skill_icon_skchr_a_1.png"), "0".repeat(64));
  assert.deepEqual(recordedHashes(null), new Map());
  await assert.rejects(collectSkillIcons({ ...recorded.input, previous: changed }, recorded.dependencies), /skill_icon_skchr_a_1.png: SHA-256 differs from the manifest/);

  const missing = fixture();
  missing.trees.set(api(id("3")), { tree: [] });
  await assert.rejects(collectSkillIcons(missing.input, missing.dependencies), /ui\/rank\/m-1.png is not in the pinned tree/);

  const failing = fixture();
  const listOnly = failing.dependencies.fetch;
  failing.dependencies.fetch = async (url) => (url.startsWith("https://raw.") ? new Response(null, { status: 404 }) : listOnly(url));
  await assert.rejects(collectSkillIcons(failing.input, failing.dependencies), /HTTP 404/);
});

test("the revision cannot be overridden from the command line", async () => {
  await assert.rejects(main(["--revision", "1".repeat(40)]), /The source revision is fixed/);
});
