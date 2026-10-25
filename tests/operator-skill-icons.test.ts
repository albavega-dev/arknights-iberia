import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assetPath } from "../src/game-data/asset-paths";
import { getSkillIconPath, resolveSkillIconSource, skillIconLocalName, type SkillIconsManifest } from "../src/game-data/operator-skill-icons";
import type { OperatorSkillsProfile } from "../src/game-data/operator-skills";
import { buildSkillIconsManifest, pngInfo, resolveCatalogIcons } from "../scripts/sync-operator-skill-icons";

const revision = "1a41341cc634461a5abe3456722801a39b9a9d32";
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

test("the icon id wins when it is inventoried, otherwise the skill id, otherwise nothing", () => {
  const inventory = new Set(["skill_icon_skcom_powerstrike[3].png", "skill_icon_skchr_a_1.png", "skill_icon_skchr_b_1.png"]);
  assert.equal(resolveSkillIconSource("skchr_a_1", "skcom_powerstrike[3]", inventory), "skill_icon_skcom_powerstrike[3].png");
  assert.equal(resolveSkillIconSource("skchr_b_1", "skcom_unknown[1]", inventory), "skill_icon_skchr_b_1.png");
  assert.equal(resolveSkillIconSource("skchr_a_1", null, inventory), "skill_icon_skchr_a_1.png");
  assert.equal(resolveSkillIconSource("skchr_c_1", undefined, inventory), null);
});

test("the sync lists missing skills per region and builds a manifest with provenance", () => {
  const skills = [{ region: "en", skillId: "skchr_a_1" }, { region: "cn", skillId: "skchr_c_1" }, { region: "cn", skillId: "skchr_c_1" }] as const;
  const resolved = resolveCatalogIcons(skills, { en: { skchr_a_1: { iconId: null } }, cn: {} }, new Set(["skill_icon_skchr_a_1.png"]));
  assert.deepEqual(resolved.missing, { en: [], cn: ["skchr_c_1"] });
  const manifest = buildSkillIconsManifest(revision, resolved, new Map([["skill_icon_skchr_a_1.png", pngInfo(png(128, 128))]]));
  assert.deepEqual(manifest.skills, { en: { skchr_a_1: "skchr_a_1.png" }, cn: {} });
  assert.equal(manifest.icons["skchr_a_1.png"].url, `https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/${revision}/skills/skill_icon_skchr_a_1.png`);
  assert.equal(getSkillIconPath(manifest, "en", "skchr_a_1"), "/assets/operator-skills/skchr_a_1.png");
  assert.equal(getSkillIconPath(manifest, "cn", "skchr_c_1"), null);
  assert.throws(() => buildSkillIconsManifest("main", resolved, new Map()));
  assert.throws(() => buildSkillIconsManifest(revision, resolved, new Map()));
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
  const listed = new Set(Object.values(manifest.skills).flatMap((map) => Object.values(map)));
  assert.deepEqual([...listed].sort(), files);
  const profiles = await Promise.all((await readdir("data/operator-skills")).filter((name) => name.startsWith("char_")).map(async (name) => JSON.parse(await readFile(path.join("data/operator-skills", name), "utf8")) as OperatorSkillsProfile));
  for (const profile of profiles) for (const skill of profile.skills) {
    const region = profile.region as "en" | "cn";
    assert.ok(manifest.skills[region][skill.skillId] !== undefined || manifest.missing[region].includes(skill.skillId), `${region}:${skill.skillId}`);
  }
});
