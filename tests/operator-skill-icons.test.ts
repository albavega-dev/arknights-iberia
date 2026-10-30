import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assetPath } from "../src/game-data/asset-paths";
import { baseSkillIconLocalName, getBaseSkillIconPath, getMasteryIconPath, getRoomIconPath, getSkillIconPath, resolveSkillIconSource, roomIconLocalName, roomIconSources, skillIconLocalName, type SkillIconsManifest } from "../src/game-data/operator-skill-icons";
import type { OperatorSkillsProfile } from "../src/game-data/operator-skills";
import { imageRevision } from "../src/game-data/asset-revisions";
import { buildSkillIconsManifest, pngInfo, resolveCatalogBaseIcons, resolveCatalogIcons, type BaseIconFiles } from "../scripts/sync-operator-skill-icons";

const revision = imageRevision;
const png = (width: number, height: number) => {
  const data = Buffer.alloc(32);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
};

test("assetPath builds a path under /assets/ and rejects unsafe segments", () => {
  assert.equal(assetPath("operator-skills", "skchr_amiya_1.png"), "/assets/operator-skills/skchr_amiya_1.png");
  assert.throws(() => assetPath("../etc", "a.png"));
  assert.throws(() => assetPath("operator-skills", "../a.png"));
  assert.throws(() => assetPath("operator-skills", "A.png"));
});

test("skill icon names are normalised without brackets or capitals", () => {
  assert.equal(skillIconLocalName("skill_icon_skcom_powerstrike[3].png"), "skcom_powerstrike-3.png");
  assert.equal(skillIconLocalName("skill_icon_skchr_Amiya_1.png"), "skchr_amiya_1.png");
  assert.throws(() => skillIconLocalName("icon_skchr_amiya_1.png"));
});

test("base skill and room icon names are normalised without capitals or ampersands", () => {
  assert.equal(baseSkillIconLocalName("bskill_man_spd&limit&cost1"), "bskill_man_spd-limit-cost1.png");
  assert.equal(baseSkillIconLocalName("bskill_tra_Lappland1"), "bskill_tra_lappland1.png");
  assert.throws(() => baseSkillIconLocalName("[style]halo"));
  assert.throws(() => baseSkillIconLocalName("../a"));
  assert.equal(roomIconLocalName("MANUFACTURE"), "manufacture.png");
});

test("the icon id wins when it is inventoried, otherwise the skill id, otherwise nothing", () => {
  const inventory = new Set(["skill_icon_skcom_powerstrike[3].png", "skill_icon_skchr_a_1.png", "skill_icon_skchr_b_1.png"]);
  assert.equal(resolveSkillIconSource("skchr_a_1", "skcom_powerstrike[3]", inventory), "skill_icon_skcom_powerstrike[3].png");
  assert.equal(resolveSkillIconSource("skchr_b_1", "skcom_unknown[1]", inventory), "skill_icon_skchr_b_1.png");
  assert.equal(resolveSkillIconSource("skchr_a_1", null, inventory), "skill_icon_skchr_a_1.png");
  assert.equal(resolveSkillIconSource("skchr_c_1", undefined, inventory), null);
});

const roomFiles = new Map(Object.values(roomIconSources).map((source) => [source, pngInfo(png(23, 23))]));
const noBase: BaseIconFiles = { resolved: { missing: { en: [], cn: [] }, sources: [] }, files: new Map(), roomFiles };

test("the sync lists base skill icons without file per region and fails when two ids share a local name", () => {
  const records = [{ region: "en", iconId: "bskill_a&b" }, { region: "en", iconId: "bskill_a&b" }, { region: "cn", iconId: "bskill_c" }, { region: "cn", iconId: "bskill_c" }] as const;
  assert.deepEqual(resolveCatalogBaseIcons(records, new Set(["bskill_a&b.png"])), { missing: { en: [], cn: ["bskill_c"] }, sources: ["bskill_a&b.png"] });
  assert.throws(() => resolveCatalogBaseIcons([{ region: "en", iconId: "bskill_a&b" }, { region: "cn", iconId: "bskill_a-b" }], new Set()), /share the local name/);
});

test("the manifest lists base skill and room icons with encoded source URLs and paths under /assets/", () => {
  const resolved = resolveCatalogIcons([], { en: {}, cn: {} }, new Set());
  const mastery = new Map(["m-1.png", "m-2.png", "m-3.png"].map((file) => [file, pngInfo(png(250, 230))]));
  const base = resolveCatalogBaseIcons([{ region: "en", iconId: "bskill_a&b" }, { region: "cn", iconId: "bskill_c" }], new Set(["bskill_a&b.png"]));
  const manifest = buildSkillIconsManifest(revision, resolved, new Map(), mastery, { resolved: base, files: new Map([["bskill_a&b.png", pngInfo(png(36, 36))]]), roomFiles });
  assert.deepEqual(Object.keys(manifest.baseSkills), ["bskill_a-b.png"]);
  assert.equal(manifest.baseSkills["bskill_a-b.png"].url, `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${revision}/ui/infrastructure/skill/bskill_a%26b.png`);
  assert.deepEqual(manifest.baseSkillsMissing, { en: [], cn: ["bskill_c"] });
  assert.equal(manifest.rooms["manufacture.png"].url, `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${revision}/ui/infrastructure/manu.png`);
  assert.equal(getBaseSkillIconPath(manifest, "bskill_a&b"), "/assets/operator-base-skills/bskill_a-b.png");
  assert.equal(getBaseSkillIconPath(manifest, "bskill_c"), null);
  assert.equal(getBaseSkillIconPath(manifest, "[style]halo"), null);
  assert.equal(getRoomIconPath(manifest, "TRADING"), "/assets/operator-base-rooms/trading.png");
  assert.equal(getRoomIconPath(manifest, "ELEVATOR"), null);
  assert.equal(getRoomIconPath(manifest, "constructor"), null);
  assert.throws(() => buildSkillIconsManifest(revision, resolved, new Map(), mastery, { ...noBase, roomFiles: new Map() }), /ui\/infrastructure\/control\.png/);
  assert.throws(() => buildSkillIconsManifest(revision, resolved, new Map(), mastery, { ...noBase, resolved: base }), /ui\/infrastructure\/skill\/bskill_a&b\.png/);
});

test("the sync lists missing skills per region and builds a manifest with provenance", () => {
  const skills = [{ region: "en", skillId: "skchr_a_1" }, { region: "cn", skillId: "skchr_c_1" }, { region: "cn", skillId: "skchr_c_1" }] as const;
  const resolved = resolveCatalogIcons(skills, { en: { skchr_a_1: { iconId: null } }, cn: {} }, new Set(["skill_icon_skchr_a_1.png"]));
  assert.deepEqual(resolved.missing, { en: [], cn: ["skchr_c_1"] });
  const mastery = new Map(["m-1.png", "m-2.png", "m-3.png"].map((file) => [file, pngInfo(png(250, 230))]));
  const manifest = buildSkillIconsManifest(revision, resolved, new Map([["skill_icon_skchr_a_1.png", pngInfo(png(128, 128))]]), mastery, noBase);
  assert.equal(manifest.mastery["m-2.png"].url, `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${revision}/ui/rank/m-2.png`);
  assert.equal(getMasteryIconPath(manifest, "M2"), "/assets/operator-skill-mastery/m-2.png");
  assert.equal(getMasteryIconPath(manifest, "7"), null);
  assert.throws(() => buildSkillIconsManifest(revision, resolved, new Map([["skill_icon_skchr_a_1.png", pngInfo(png(128, 128))]]), new Map(), noBase));
  assert.deepEqual(manifest.skills, { en: { skchr_a_1: "skchr_a_1.png" }, cn: {} });
  assert.equal(manifest.icons["skchr_a_1.png"].url, `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${revision}/skills/skill_icon_skchr_a_1.png`);
  assert.equal(getSkillIconPath(manifest, "en", "skchr_a_1"), "/assets/operator-skills/skchr_a_1.png");
  assert.equal(getSkillIconPath(manifest, "cn", "skchr_c_1"), null);
  assert.throws(() => buildSkillIconsManifest("main", resolved, new Map(), mastery, noBase));
  assert.throws(() => buildSkillIconsManifest(revision, resolved, new Map(), mastery, noBase));
  assert.throws(() => pngInfo(Buffer.from("not a png file, long enough......")));
});

test("the committed manifest matches the files and covers every skill of the dataset", async () => {
  const manifest = JSON.parse(await readFile("data/operator-skill-icons-manifest.json", "utf8")) as SkillIconsManifest;
  assert.equal(manifest.source.revision, revision);
  const files = (await readdir("public/assets/operator-skills")).sort();
  assert.deepEqual(files, Object.keys(manifest.icons).sort());
  for (const [file, entry] of Object.entries(manifest.icons)) {
    const data = await readFile(path.join("public/assets/operator-skills", file));
    assert.equal(createHash("sha256").update(data).digest("hex").toUpperCase(), entry.sha256, file);
    assert.equal(data.byteLength, entry.bytes, file);
    assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [entry.width, entry.height], file);
    assert.ok(entry.url.startsWith(`https://raw.githubusercontent.com/${manifest.source.repository}/${revision}/skills/`), file);
  }
  assert.deepEqual((await readdir("public/assets/operator-skill-mastery")).sort(), Object.keys(manifest.mastery).sort());
  for (const [file, entry] of Object.entries(manifest.mastery)) {
    const data = await readFile(path.join("public/assets/operator-skill-mastery", file));
    assert.equal(createHash("sha256").update(data).digest("hex").toUpperCase(), entry.sha256, file);
    assert.equal(data.byteLength, entry.bytes, file);
    assert.equal(entry.url, `https://raw.githubusercontent.com/${manifest.source.repository}/${revision}/ui/rank/${file}`);
  }
  const listed = new Set(Object.values(manifest.skills).flatMap((map) => Object.values(map)));
  assert.deepEqual([...listed].sort(), files);
  const profiles = await Promise.all((await readdir("data/operator-skills")).filter((name) => name.startsWith("char_")).map(async (name) => JSON.parse(await readFile(path.join("data/operator-skills", name), "utf8")) as OperatorSkillsProfile));
  for (const profile of profiles) for (const skill of profile.skills) {
    const region = profile.region as "en" | "cn";
    assert.ok(manifest.skills[region][skill.skillId] !== undefined || manifest.missing[region].includes(skill.skillId), `${region}:${skill.skillId}`);
  }
  const sections = [["operator-base-skills", manifest.baseSkills, "ui/infrastructure/skill/"], ["operator-base-rooms", manifest.rooms, "ui/infrastructure/"]] as const;
  for (const [directory, entries, prefix] of sections) {
    assert.deepEqual((await readdir(path.join("public/assets", directory))).sort(), Object.keys(entries).sort(), directory);
    for (const [file, entry] of Object.entries(entries)) {
      const data = await readFile(path.join("public/assets", directory, file));
      assert.equal(createHash("sha256").update(data).digest("hex").toUpperCase(), entry.sha256, file);
      assert.equal(data.byteLength, entry.bytes, file);
      assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], [entry.width, entry.height], file);
      assert.equal(entry.url, `https://raw.githubusercontent.com/${manifest.source.repository}/${revision}/${prefix}${encodeURIComponent(entry.source.slice(prefix.length))}`, file);
    }
  }
  assert.deepEqual(manifest.baseSkillsMissing, { en: [], cn: [] });
  for (const profile of profiles) for (const stage of profile.baseSkills.flatMap((slot) => slot.stages)) {
    assert.ok(getBaseSkillIconPath(manifest, stage.icon), `${profile.region}:${stage.icon}`);
    assert.ok(getRoomIconPath(manifest, stage.room), `${profile.region}:${stage.room}`);
  }
});
