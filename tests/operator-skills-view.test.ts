import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GameDataRegion } from "../src/game-data/gamedata-revisions";
import type { DatasetIndex } from "../src/game-data/operator-dataset";
import { getBaseSkillIconPath, getMasteryIconPath, getRoomIconPath, getSkillIconPath, type SkillIconsManifest } from "../src/game-data/operator-skill-icons";
import { buildOperatorSkillsView, loadOperatorSkillsView, skillDurationKind, type OperatorSkillsView, type SkillsDatasetReaders, type StoredSkillsGlossary, type StoredSkillsProfile } from "../src/game-data/operator-skills-view";
import type { SkillDescriptionNode } from "../src/game-data/skill-description";

// The real dataset, read the way operator-skills-data.ts does but without the server-only import.
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(new URL(`../data/${file}`, import.meta.url), "utf8")) as T;
const index = await readJson<DatasetIndex>("operator-skills/index.json");
const icons = await readJson<SkillIconsManifest>("operator-skill-icons-manifest.json");
let reads = 0;
const readers: SkillsDatasetReaders = {
  index,
  readProfile: (operatorId) => { reads += 1; return readJson<StoredSkillsProfile>(`operator-skills/${operatorId}.json`); },
  readGlossary: (region) => readJson<StoredSkillsGlossary>(`operator-skills/glossary-${region}.json`),
  resolveIcon: (region, skillId) => {
    const src = getSkillIconPath(icons, region, skillId);
    const entry = src ? icons.icons[icons.skills[region][skillId]] : undefined;
    return src && entry ? { src, width: entry.width, height: entry.height } : null;
  },
  resolveMasteryIcon: (label) => {
    const src = getMasteryIconPath(icons, label);
    return src ? { src, width: 250, height: 230 } : null;
  },
  resolveBaseSkillIcon: (iconId) => { const src = getBaseSkillIconPath(icons, iconId); return src ? { src, width: 36, height: 36 } : null; },
  resolveRoomIcon: (room) => { const src = getRoomIconPath(icons, room); return src ? { src, width: 23, height: 23 } : null; },
};
const load = async (operatorId: string, region: GameDataRegion): Promise<OperatorSkillsView> => {
  const view = await loadOperatorSkillsView(readers, operatorId, region);
  assert.ok(view, `${operatorId} should have a view`);
  return view;
};
const textOf = (nodes: readonly SkillDescriptionNode[]): string => nodes.map((node) => node.type === "text" ? node.text : node.type === "value" ? node.display + (node.percent ? " %" : "") : node.type === "lineBreak" ? "\n" : node.type === "style" ? textOf(node.children) : node.text).join("");
const unknownMarkers = (nodes: readonly SkillDescriptionNode[]): string[] => nodes.flatMap((node) => node.type === "unknownMarker" ? [node.text] : node.type === "style" ? unknownMarkers(node.children) : []);

test("Amiya (EN) has H1-H3 with ten levels each, parsed descriptions, icons, ranges and glossary terms", async () => {
  const view = await load("char_002_amiya", "en");
  assert.equal(view.status, "available");
  assert.equal(view.region, "en");
  assert.deepEqual(view.source, index.sources.en);
  assert.deepEqual(view.skills.map((skill) => skill.slot), [1, 2, 3]);
  for (const skill of view.skills) {
    assert.deepEqual(skill.levels.map((level) => level.label), ["1", "2", "3", "4", "5", "6", "7", "M1", "M2", "M3"]);
    assert.deepEqual(skill.levels.map((level) => level.group), [...Array(7).fill("level"), ...Array(3).fill("mastery")]);
    assert.deepEqual(skill.levels.map((level) => level.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(skill.defaultLevelIndex, 9);
    assert.ok(skill.icon && skill.icon.src.startsWith("/assets/operator-skills/") && skill.icon.width > 0 && skill.icon.height > 0);
    for (const level of skill.levels) assert.deepEqual(unknownMarkers(level.description), []);
  }
  const s3 = view.skills[2];
  assert.equal(s3.skillId, "skchr_amiya_3");
  assert.match(textOf(s3.levels[0].description), /100 %/);
  assert.match(textOf(s3.levels[1].description), /110 %/);
  assert.match(textOf(s3.levels[2].description), /120 %/);
  assert.equal(s3.activation, "manual");
  assert.equal(s3.spRecovery, "time");
  // Every <$term> the skill uses is in the skill's glossary, parsed to nodes.
  assert.ok(view.skills.flatMap((skill) => Object.keys(skill.terms)).length > 0);
  for (const skill of view.skills) for (const term of Object.values(skill.terms)) assert.ok(term.name && term.description.length > 0);
  // Ranges: only the ones the skills use, exactly as in range_table.
  const used = new Set(view.skills.flatMap((skill) => skill.levels.flatMap((level) => level.rangeId ? [level.rangeId] : [])));
  assert.deepEqual(Object.keys(view.ranges).sort(), [...used].sort());
  assert.ok(used.has("3-4"));
  assert.ok(view.ranges["3-4"].grids.length > 0);
  assert.equal(typeof view.ranges["3-4"].direction, "number");
});

test("a CN-only operator reads the CN file, glossary, source and icons", async () => {
  const view = await load("char_4218_aigis", "cn");
  assert.equal(view.region, "cn");
  assert.deepEqual(view.source, index.sources.cn);
  assert.equal(view.status, "available");
  assert.ok(view.skills.length > 0);
  for (const skill of view.skills) {
    assert.equal(skill.icon?.src, getSkillIconPath(icons, "cn", skill.skillId));
    for (const level of skill.levels) assert.deepEqual(unknownMarkers(level.description), []);
  }
  const glossary = await readJson<StoredSkillsGlossary>("operator-skills/glossary-cn.json");
  assert.equal(glossary.region, "cn");
  for (const skill of view.skills) for (const id of Object.keys(skill.terms)) assert.ok(glossary.terms[id], `${id} is a cn glossary term`);
});

test("Thorns keeps its larger file complete: every level has a parsed description and a stored range is never dropped", async () => {
  const view = await load("char_293_thorns", "en");
  const stored = await readJson<StoredSkillsProfile>("operator-skills/char_293_thorns.json");
  assert.equal(view.skills.length, stored.skills.length);
  stored.skills.forEach((skill, position) => {
    assert.equal(view.skills[position].levels.length, skill.levels.length);
    assert.equal(view.skills[position].skillId, skill.skillId);
    for (const level of view.skills[position].levels) assert.ok(level.description.length > 0 && unknownMarkers(level.description).length === 0);
  });
  // S2 uses `cooldown:0.0`: 0,75 s and 0,65 s are shown with their natural precision.
  const text = view.skills.flatMap((skill) => skill.levels.map((level) => textOf(level.description))).join("\n");
  assert.match(text, /0,75/);
  assert.match(text, /0,65/);
});

test("the largest file of the dataset builds a view", async () => {
  const largest = Object.entries(index.operators).sort(([, a], [, b]) => b.bytes - a.bytes)[0];
  const view = await load(largest[0], largest[1].region);
  assert.ok(view.skills.length > 0);
});

test("Heavyrain (H1) shows the documented 4 s duration at every level and no unknown marker", async () => {
  const view = await load("char_304_zebra", "en");
  const h1 = view.skills.find((skill) => skill.skillId === "skchr_zebra_1");
  assert.ok(h1);
  assert.equal(h1.levels.length, 10);
  for (const level of h1.levels) {
    assert.equal(level.duration, 4);
    assert.deepEqual(unknownMarkers(level.description), []);
    assert.match(textOf(level.description), /4/);
  }
});

test("a 1-star operator without skills gets an empty view the interface can tell apart from a missing one", async () => {
  const view = await load("char_285_medic2", "en");
  assert.equal(view.status, "empty");
  assert.deepEqual(view.skills, []);
  assert.deepEqual(view.ranges, {});
  assert.deepEqual(view.source, index.sources.en);
  assert.equal(await loadOperatorSkillsView(readers, "char_9999_missing", "en"), null);
});

test("the loader checks id and region against the index before reading any file", async () => {
  const before = reads;
  assert.equal(await loadOperatorSkillsView(readers, "../../etc/passwd", "en"), null);
  assert.equal(await loadOperatorSkillsView(readers, "char_002_amiya", "cn"), null);
  assert.equal(await loadOperatorSkillsView(readers, "char_4218_aigis", "en"), null);
  assert.equal(await loadOperatorSkillsView(readers, "char_9999_missing", "en"), null);
  assert.equal(reads, before);
  const wrongFile: SkillsDatasetReaders = { ...readers, readProfile: async () => ({ operatorId: "char_003_kalts", region: "en", skills: [], ranges: {}, baseSkills: [] }) };
  assert.equal(await loadOperatorSkillsView(wrongFile, "char_002_amiya", "en"), null);
  const wrongRegion: SkillsDatasetReaders = { ...readers, readProfile: async () => ({ operatorId: "char_002_amiya", region: "cn", skills: [], ranges: {}, baseSkills: [] }) };
  assert.equal(await loadOperatorSkillsView(wrongRegion, "char_002_amiya", "en"), null);
});

test("the view is plain serializable data and the whole catalog builds without errors", async () => {
  let withSkills = 0;
  let empty = 0;
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const view = await load(operatorId, entry.region);
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view, operatorId);
    assert.equal(view.status === "empty", view.skills.length === 0, operatorId);
    if (view.status === "empty") empty += 1; else withSkills += 1;
    for (const skill of view.skills) {
      assert.equal(skill.defaultLevelIndex, skill.levels.length - 1, operatorId);
      assert.ok(["manual", "auto", "passive"].includes(skill.activation), `${operatorId} ${skill.skillId}`);
      assert.ok(["time", "attack", "defense", "none"].includes(skill.spRecovery), `${operatorId} ${skill.skillId}`);
      for (const level of skill.levels) if (level.rangeId) assert.ok(view.ranges[level.rangeId], `${operatorId} ${level.rangeId}`);
    }
  }
  assert.equal(empty, 17);
  assert.equal(withSkills, Object.keys(index.operators).length - 17);
});

test("a glossary term missing from the glossary is an error, and an unknown icon is null", async () => {
  const profile = await readJson<StoredSkillsProfile>("operator-skills/char_002_amiya.json");
  const emptyGlossary: StoredSkillsGlossary = { region: "en", terms: {} };
  assert.throws(() => buildOperatorSkillsView(profile, "en", index.sources.en, emptyGlossary, () => null), /Glossary term/);
  const glossary = await readJson<StoredSkillsGlossary>("operator-skills/glossary-en.json");
  const view = buildOperatorSkillsView(profile, "en", index.sources.en, glossary, () => null);
  assert.ok(view.skills.every((skill) => skill.icon === null));
  const badSlot = { ...profile, skills: [{ ...profile.skills[0], slot: 4 }] };
  assert.throws(() => buildOperatorSkillsView(badSlot, "en", index.sources.en, glossary, () => null), /slot/);
});

test("unlock is carried from the dataset: a 3-star with one skill and a 6-star with three", async () => {
  const hibiscus = await load("char_120_hibisc", "en");
  assert.deepEqual(hibiscus.skills.map((skill) => [skill.slot, skill.unlock]), [[1, { elite: 0, level: 1 }]]);
  const kaltsit = await load("char_003_kalts", "en");
  assert.deepEqual(kaltsit.skills.map((skill) => [skill.slot, skill.unlock]), [[1, { elite: 0, level: 1 }], [2, { elite: 1, level: 1 }], [3, { elite: 2, level: 1 }]]);
  const stored = await readJson<StoredSkillsProfile>("operator-skills/char_003_kalts.json");
  stored.skills.forEach((skill, position) => assert.deepEqual(kaltsit.skills[position].unlock, skill.unlock));
  const aigis = await load("char_4218_aigis", "cn");
  for (const skill of aigis.skills) assert.ok([0, 1, 2].includes(skill.unlock.elite));
});

test("duration kinds follow the source values: seconds, instant, unlimited, ammo and passive without duration", async () => {
  const kindOf = async (operatorId: string, skillId: string) => (await load(operatorId, "en")).skills.find((skill) => skill.skillId === skillId)!.levels.map((level) => level.durationKind);
  assert.ok((await kindOf("char_002_amiya", "skchr_amiya_3")).every((kind) => kind === "seconds"));
  assert.ok((await kindOf("char_010_chen", "skchr_chen_2")).every((kind) => kind === "instant"));
  assert.ok((await kindOf("char_017_huang", "skchr_huang_2")).every((kind) => kind === "unlimited"));
  assert.ok((await kindOf("char_1013_chen2", "skchr_chen2_2")).every((kind) => kind === "ammo"));
  assert.ok((await kindOf("char_136_hsguma", "skchr_hsguma_2")).every((kind) => kind === "none"));
  assert.equal(skillDurationKind({ duration: 0, durationType: "AMMO", skillType: "MANUAL" }), "ammo");
  assert.equal(skillDurationKind({ duration: -1, durationType: "NONE", skillType: "PASSIVE" }), "none");
  assert.equal(skillDurationKind({ duration: 12, durationType: "NONE", skillType: "PASSIVE" }), "seconds");
  assert.equal(skillDurationKind({ duration: -2, durationType: "NONE", skillType: "AUTO" }), "unknown");
  assert.equal(skillDurationKind({ duration: 0, durationType: "OTHER", skillType: "AUTO" }), "unknown");
});

test("mastery levels carry their rank icon and normal levels none", async () => {
  const [h1] = (await load("char_002_amiya", "en")).skills;
  assert.deepEqual(h1.levels.map((level) => level.icon?.src ?? null), [null, null, null, null, null, null, null, "/assets/operator-skill-mastery/m-1.png", "/assets/operator-skill-mastery/m-2.png", "/assets/operator-skill-mastery/m-3.png"]);
});

const stagesOf = (view: OperatorSkillsView) => view.baseSkills.map((slot) => [slot.slot, slot.stages.map((stage) => [stage.buffId, stage.room, stage.unlock.elite, stage.unlock.level])]);

test("Amiya (EN) has two base skills: Control Center at E0 and Dormitory at E2, with parsed descriptions", async () => {
  const view = await load("char_002_amiya", "en");
  assert.deepEqual(stagesOf(view), [[1, [["control_tra_spd[000]", "CONTROL", 0, 1]]], [2, [["dorm_rec_all[010]", "DORMITORY", 2, 1]]]]);
  const [agreement] = view.baseSkills[0].stages;
  assert.equal(agreement.name, "Agreement");
  assert.deepEqual([agreement.icon?.src, agreement.roomIcon?.src], ["/assets/operator-base-skills/bskill_ctrl_t_spd.png", "/assets/operator-base-rooms/control.png"]);
  assert.deepEqual([agreement.color, agreement.textColor], ["#005752", "#ffffff"]);
  assert.match(textOf(agreement.description), /\+7%/);
  assert.ok(agreement.description.some((node) => node.type === "style" && node.tone === "increase"));
});

test("Exusiai (EN) replaces Penguin Logistics α with Logistics Expert at E2 in the same Trading Post slot", async () => {
  const view = await load("char_103_angel", "en");
  assert.deepEqual(stagesOf(view), [[1, [["trade_ord_spd[010]", "TRADING", 0, 1], ["trade_ord_spd[020]", "TRADING", 2, 1]]]]);
  assert.deepEqual(view.baseSkills[0].stages.map((stage) => stage.name), ["Penguin Logistics α", "Logistics Expert"]);
});

test("the only three-stage slot (char_188_helage) keeps E0, E1 and E2 in order, and its decrease values get the decrease tone", async () => {
  const view = await load("char_188_helage", "en");
  assert.deepEqual(stagesOf(view), [
    [1, [["dorm_rec_all&oneself[010]", "DORMITORY", 0, 1], ["dorm_rec_all&oneself[011]", "DORMITORY", 1, 1], ["dorm_rec_all&oneself[012]", "DORMITORY", 2, 1]]],
    [2, [["workshop_formula_probability[010]", "WORKSHOP", 0, 1]]],
  ]);
  const durin = await load("char_501_durin", "en");
  const tones = (nodes: readonly SkillDescriptionNode[]): string[] => nodes.flatMap((node) => node.type === "style" ? [node.tone, ...tones(node.children)] : []);
  assert.ok(tones(durin.baseSkills[0].stages[0].description).includes("decrease"));
});

test("a CN-only operator reads its CN base skills, including the CN-only recycling room", async () => {
  const view = await load("char_4232_hbound", "cn");
  assert.deepEqual(stagesOf(view), [[1, [["recycle_spd&cost[000]", "RECYCLE", 0, 1], ["recycle_spd&cost[010]", "RECYCLE", 2, 1]]], [2, [["workshop_formula_device[080]", "WORKSHOP", 2, 1]]]]);
  assert.equal(view.baseSkills[0].stages[0].name, "拾荒者");
  assert.equal(view.baseSkills[0].stages[0].roomIcon?.src, "/assets/operator-base-rooms/recycle.png");
  for (const slot of view.baseSkills) for (const stage of slot.stages) assert.deepEqual(unknownMarkers(stage.description), []);
});

test("a 1-star operator without combat skills still has base skills, one unlocked at E0 level 30", async () => {
  const view = await load("char_285_medic2", "en");
  assert.equal(view.status, "empty");
  assert.deepEqual(stagesOf(view), [[1, [["power_rec_spd[000]", "POWER", 0, 1]]], [2, [["dorm_rec_single[000]", "DORMITORY", 0, 30]]]]);
});

test("base skill terms come from the region glossary, and Mulberry's term is a real term after the fix", async () => {
  const view = await load("char_473_mberry", "en");
  const stage = view.baseSkills.flatMap((slot) => slot.stages).find((item) => item.buffId === "hire_spd_bd_n1_n1[200]");
  assert.ok(stage);
  assert.doesNotMatch(textOf(stage.description), /</);
  const term = stage.description.find((node) => node.type === "style" && node.termId === "cc.bd_b1");
  assert.ok(term, "the Worldly Plight term is parsed");
  const slot = view.baseSkills.find((item) => item.stages.includes(stage))!;
  assert.equal(slot.terms["cc.bd_b1"].name, "Worldly Plight");
  const profile = await readJson<StoredSkillsProfile>("operator-skills/char_473_mberry.json");
  assert.throws(() => buildOperatorSkillsView(profile, "en", index.sources.en, { region: "en", terms: {} }, () => null), /Glossary term/);
});

test("a base skill icon with an ampersand resolves to its normalised file, and the view builds without base icon resolvers", async () => {
  const view = await load("char_4114_harold", "en");
  const stage = view.baseSkills.flatMap((slot) => slot.stages).find((item) => item.icon?.src.includes("bskil_meet_team"));
  assert.equal(stage?.icon?.src, "/assets/operator-base-skills/bskil_meet_team-char.png");
  assert.equal(stage?.roomIcon?.src, "/assets/operator-base-rooms/meeting.png");
  const profile = await readJson<StoredSkillsProfile>("operator-skills/char_002_amiya.json");
  const glossary = await readJson<StoredSkillsGlossary>("operator-skills/glossary-en.json");
  const bare = buildOperatorSkillsView(profile, "en", index.sources.en, glossary, () => null);
  assert.ok(bare.baseSkills.flatMap((slot) => slot.stages).every((item) => item.icon === null && item.roomIcon === null));
});
