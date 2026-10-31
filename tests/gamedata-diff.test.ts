import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetChangesByDirectory, assetCoverage, baseSkillFingerprints, buildingEntries, diffBaseSkills, catalogModuleIds, changedAssetPaths, changedBlobs, compareRoster, diffKeyed, diffModules, diffOperators,
  diffSkills, exitCodeFor, fingerprint, handbookEntries, isPlayable, mayBeTruncated, missingLabels, newGlossaryTerms, playableOperatorIds, redact,
  resolvedSkillGaps, revisionStatus, skillIconNames, skillIdsOf, stableJson, subClassIdsOf, usedRangeIds,
} from "../src/game-data/gamedata-diff";
import { gitBlobSha } from "../src/game-data/git-blob";

const operator = (extra: Record<string, unknown> = {}) => ({ name: "A", isNotObtainable: false, profession: "CASTER", rarity: "TIER_5", subProfessionId: "corecaster", phases: [{ rangeId: "1-1" }], skills: [{ skillId: "s1" }], talents: null, trait: null, ...extra });

describe("hashes and fingerprints", () => {
  it("matches the Git blob hash of a known file", () => {
    assert.equal(gitBlobSha(Buffer.from("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
  });
  it("serializes objects independently of key order", () => {
    assert.equal(stableJson({ b: [1, { d: 1, c: undefined }], a: null }), stableJson({ a: null, b: [1, { c: undefined, d: 1 }] }));
    assert.equal(stableJson(undefined), "null");
    assert.equal(fingerprint({ a: 1 }), fingerprint({ a: 1 }));
    assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  });
});

describe("revisions level", () => {
  it("lists tables whose blob hash differs, appeared or disappeared", () => {
    const before = { a: "1", b: "2", c: "3" };
    const after = { a: "1", b: "9", d: "4" };
    assert.deepEqual(changedBlobs(before, after), ["b", "c", "d"]);
    assert.deepEqual(changedBlobs(before, before), []);
  });
  it("flags compares that reached the file limit of GitHub", () => {
    assert.equal(mayBeTruncated(Array.from({ length: 300 }, () => ({ filename: "x" }))), true);
    assert.equal(mayBeTruncated([{ filename: "x" }]), false);
  });
  it("counts image changes per directory and ignores the rest", () => {
    const files = [
      { filename: "skills/a.png", status: "added" }, { filename: "skills/b.png", status: "removed" }, { filename: "skills/c.png", status: "renamed" },
      { filename: "characters/d.png", status: "modified" }, { filename: "characters/e.png" }, { filename: "other/f.png", status: "added" },
    ];
    const counts = assetChangesByDirectory(files, ["characters", "skills", "equip"]);
    assert.deepEqual(counts.skills, { added: 1, modified: 0, removed: 1, renamed: 1 });
    assert.deepEqual(counts.characters, { added: 0, modified: 2, removed: 0, renamed: 0 });
    assert.deepEqual(counts.equip, { added: 0, modified: 0, removed: 0, renamed: 0 });
    assert.deepEqual(changedAssetPaths(files, ["skills"], 2), ["added skills/a.png", "removed skills/b.png"]);
    assert.deepEqual(changedAssetPaths(files, ["characters"]), ["modified characters/d.png", "modified characters/e.png"]);
  });
  it("compares a pinned revision with the latest one", () => {
    assert.deepEqual(revisionStatus("a", "a"), { pinned: "a", latest: "a", changed: false });
    assert.equal(revisionStatus("a", "b").changed, true);
  });
});

describe("roster", () => {
  it("accepts only obtainable, named, tiered operators of a known profession", () => {
    assert.equal(isPlayable(operator()), true);
    for (const bad of [operator({ isNotObtainable: true }), operator({ name: " " }), operator({ name: 3 }), operator({ profession: "TOKEN" }), operator({ profession: 1 }), operator({ phases: null }), operator({ rarity: "TIER_7" }), null, []]) assert.equal(isPlayable(bad), false);
  });
  it("lists playable char_ ids only", () => {
    assert.deepEqual(playableOperatorIds({ char_b: operator(), char_a: operator(), token_1: operator(), char_c: operator({ isNotObtainable: true }) }), ["char_a", "char_b"]);
    assert.deepEqual(playableOperatorIds(null), []);
  });
  it("finds new CN operators, Global arrivals and operators that stop being playable", () => {
    const catalog = { en: ["char_1", "char_2"], cnOnly: ["char_3", "char_4", "char_5"] };
    const report = compareRoster(catalog, ["char_1", "char_3"], ["char_1", "char_2", "char_4", "char_9", "char_8"]);
    assert.deepEqual(report.newInCn, ["char_8", "char_9"]);
    assert.deepEqual(report.arrivedInGlobal, ["char_3"]);
    assert.deepEqual(report.noLongerPlayable, { en: ["char_2"], cn: ["char_5"] });
  });
});

describe("existing operators", () => {
  const before = { char_1: operator(), char_2: operator(), char_3: operator() };
  it("reports the fields that changed and operators that disappeared", () => {
    const after = { char_1: operator({ name: "B", skills: [{ skillId: "s2" }], talents: [1] }), char_2: operator(), char_4: operator() };
    const result = diffOperators(before, after, ["char_3", "char_2", "char_1", "char_4"]);
    assert.deepEqual(result.changed, [{ id: "char_1", fields: ["name", "skillIds", "talents"] }]);
    assert.deepEqual(result.missing, ["char_3"]);
  });
  it("tolerates tables that are not objects and skills that are not lists", () => {
    assert.deepEqual(diffOperators(null, { char_1: operator({ skills: 1 }) }, ["char_1"]), { changed: [], missing: [] });
    assert.deepEqual(diffOperators({ char_1: operator() }, { char_1: operator({ skills: 1 }) }, ["char_1"]).changed, [{ id: "char_1", fields: ["skillIds"] }]);
  });
  it("collects skill ids and range ids of the given operators", () => {
    const table = { char_1: operator({ skills: [{ skillId: "s2" }, { skillId: 4 }, { skillId: "s1" }], phases: [{ rangeId: "2-1" }, { rangeId: "" }, {}] }), char_2: operator({ skills: null, phases: null }) };
    assert.deepEqual(skillIdsOf(table, ["char_1", "char_2", "char_x"]), ["s1", "s2"]);
    assert.deepEqual(subClassIdsOf({ char_1: { subProfessionId: "lord" }, char_2: { subProfessionId: "bard" }, char_3: { subProfessionId: "lord" }, char_4: {} }, ["char_1", "char_2", "char_3", "char_4", "char_x"]), ["bard", "lord"]);
    assert.deepEqual(usedRangeIds(table, ["char_1", "char_2", "char_x"]), ["2-1"]);
  });
});

describe("keyed collections", () => {
  it("separates added, modified and removed entries inside the scope", () => {
    const before = { a: 1, b: 2, c: 3, d: 4 };
    const after = { a: 1, b: 9, d: 4, e: 5 };
    assert.deepEqual(diffKeyed(before, after), { added: ["e"], modified: ["b"], removed: ["c"] });
    assert.deepEqual(diffKeyed(before, after, ["b", "z"]), { added: [], modified: ["b"], removed: [] });
  });
  it("fingerprints only the requested skills", () => {
    const before = { s1: { levels: [1] }, s2: { levels: [1] } };
    const after = { s1: { levels: [2] }, s2: { levels: [1] }, s3: {} };
    assert.deepEqual(diffSkills(before, after, ["s1", "s2", "s3", "s4"]), { added: ["s3"], modified: ["s1"], removed: [] });
  });
  it("names skill icons by iconId when present", () => {
    assert.deepEqual(skillIconNames({ s1: { iconId: "icon_a" }, s2: { iconId: "" }, s3: {} }, ["s1", "s2", "s3", "s4"]), ["icon_a", "s2", "s3", "s4"]);
  });
  it("reads handbook and base entries from their tables", () => {
    assert.deepEqual(handbookEntries({ handbookDict: { a: 1 } }), { a: 1 });
    assert.deepEqual(buildingEntries({ chars: { b: 2 } }), { b: 2 });
    assert.deepEqual(handbookEntries([]), {});
  });
  it("compares the base skills by assignment and by the name and description of every stage", () => {
    const stage = (buffId: string) => ({ buffId, cond: { phase: "PHASE_0", level: 1 } });
    const building = (description: string, name = "Alpha") => ({
      chars: { a: { buffChar: [{ buffData: [stage("t[000]")] }, { buffData: {} }] }, b: { buffChar: [{ buffData: [stage("t[010]")] }] }, c: { buffChar: "x" }, d: {} },
      buffs: { "t[000]": { buffName: name, description }, "t[010]": { buffName: "Beta", description: "Same" } },
    });
    const ids = ["a", "b", "c", "d", "e"];
    assert.deepEqual(diffBaseSkills(building("副产物"), building("副产物"), ids), { added: [], modified: [], removed: [] });
    assert.deepEqual(diffBaseSkills(building("副产物"), building("副产品"), ids), { added: [], modified: ["a"], removed: [] }, "a change of wording is a modification");
    assert.deepEqual(diffBaseSkills(building("x"), building("x", "Gamma"), ids).modified, ["a"], "so is a change of name");
    const moved = building("x"); moved.chars.b = { buffChar: [{ buffData: [stage("t[000]")] }] };
    assert.deepEqual(diffBaseSkills(building("x"), moved, ids).modified, ["b"], "and a change of assignment");
    const unknown = building("x"); unknown.chars.b = { buffChar: [{ buffData: [stage("t[999]")] }] };
    assert.deepEqual(diffBaseSkills(building("x"), unknown, ids).modified, ["b"], "a stage whose buff is missing still has a fingerprint");
    const { d, ...withoutD } = building("x").chars; void d;
    assert.deepEqual(diffBaseSkills(building("x"), { ...building("x"), chars: withoutD }, ids), { added: [], modified: [], removed: ["d"] });
    assert.deepEqual(Object.keys(baseSkillFingerprints(building("x"), ["a", "z"])), ["a"], "only catalog operators present in the table");
  });
  it("lists new glossary terms", () => {
    assert.deepEqual(newGlossaryTerms({ termDescriptionDict: { a: 1 } }, { termDescriptionDict: { b: 1, a: 1 } }), ["b"]);
    assert.deepEqual(newGlossaryTerms(null, null), []);
  });
});

describe("modules", () => {
  const uni = (extra: Record<string, unknown> = {}) => ({ equipDict: { m1: { charId: "char_1", type: "INITIAL" }, m2: { charId: "char_1", type: "ADVANCED", ...extra }, m3: { charId: "char_9", type: "ADVANCED" } } });
  it("limits the module list to the catalog and can leave out initial modules", () => {
    assert.deepEqual(catalogModuleIds(uni(), ["char_1"]), ["m1", "m2"]);
    assert.deepEqual(catalogModuleIds(uni(), ["char_1"], { withInitial: false }), ["m2"]);
    assert.deepEqual(catalogModuleIds(null, ["char_1"]), []);
  });
  it("reports new, modified and removed modules from both tables", () => {
    const before = { uniequip: uni(), battleEquip: { m1: { a: 1 }, m2: { a: 1 } } };
    const after = { uniequip: { equipDict: { m2: { charId: "char_1", type: "ADVANCED" }, m4: { charId: "char_1" }, m3: { charId: "char_9" } } }, battleEquip: { m2: { a: 2 }, m4: {} } };
    assert.deepEqual(diffModules(before, after, ["char_1"]), { added: ["m4"], modified: ["m2"], removed: ["m1"] });
  });
});

describe("labels and known defects", () => {
  const input = {
    characterTable: { char_1: operator({ subProfessionId: "newclass" }), char_2: operator({ subProfessionId: "corecaster" }), char_3: operator({ subProfessionId: "" }) },
    uniequipTable: { equipDict: { m1: { charId: "char_1", typeIcon: "NEW-X" }, m2: { charId: "char_1", typeIcon: "old-x" }, m3: { charId: "char_2", typeIcon: "original" }, m4: { charId: "char_2" } } },
    battleEquip: { m1: { phases: [{ parts: [{ validInGameTag: "sandbox", validInMapTag: "rogue_9" }, { validInGameTag: "newmode", validInMapTag: null }, {}] }, {}] }, m2: {}, m3: { phases: [{ parts: "x" }] } },
    ids: ["char_1", "char_2", "char_3", "char_x"],
    archetypeLabels: { corecaster: "Core Caster" },
    modeNames: { gameTags: { sandbox: {} }, mapTags: {} },
    moduleIcons: new Set(["old-x"]),
  };
  it("reports subclasses, icons and mode tags without a label", () => {
    assert.deepEqual(missingLabels(input), { subClassIds: ["newclass"], gameTags: ["newmode"], mapTags: ["rogue_9"], typeIcons: ["new-x"] });
  });
  it("reports nothing when everything is labelled", () => {
    assert.deepEqual(missingLabels({ ...input, ids: [] }), { subClassIds: [], gameTags: [], mapTags: [], typeIcons: [] });
  });
  it("detects when the source carries a key the correction supplies", () => {
    const table = {
      ok: { levels: [{ blackboard: [{ key: "Duration" }] }, { blackboard: [{ key: "duration" }] }] },
      partial: { levels: [{ blackboard: [{ key: "duration" }] }, { blackboard: [] }] },
      noBoard: { levels: [{}] }, noLevels: { levels: [] },
    };
    const gaps = ["ok", "partial", "noBoard", "noLevels", "missing"].map((skillId) => ({ skillId, key: "duration" }));
    assert.deepEqual(resolvedSkillGaps(table, gaps), ["ok/duration"]);
  });
});

describe("graphic resources", () => {
  it("lists what the image tree does not have", () => {
    const paths = new Set(["characters/char_1_1.png", "skills/skill_icon_s1.png", "equip/icon/m1.png"]);
    const checks = [
      { reportKey: "missingIllustrations", ids: ["char_2", "char_1"], path: (id: string) => `characters/${id}_1.png` },
      { reportKey: "missingSkillIcons", ids: ["s2", "s1"], path: (id: string) => `skills/skill_icon_${id}.png` },
      { reportKey: "missingModuleArt", ids: ["m2", "m1"], path: (id: string) => `equip/icon/${id}.png` },
    ];
    assert.deepEqual(assetCoverage(paths, checks), { missingIllustrations: ["char_2"], missingSkillIcons: ["s2"], missingModuleArt: ["m2"] });
    assert.deepEqual(assetCoverage(paths, []), {});
  });
});

describe("result and secrets", () => {
  it("exits 2 only when something was found", () => {
    assert.equal(exitCodeFor({ findings: { a: [], b: { pinned: "x", latest: "y", c: 0, d: false } } }), 0);
    assert.equal(exitCodeFor({ findings: { a: { list: ["x"] } } }), 2);
    assert.equal(exitCodeFor({ findings: { a: { changed: true } } }), 2);
    assert.equal(exitCodeFor({ findings: { a: { added: 3 } } }), 2);
    assert.equal(exitCodeFor({ findings: { a: "text", b: null } }), 0);
    assert.equal(exitCodeFor(null), 0);
  });
  it("removes secrets from messages", () => {
    assert.equal(redact("token abc in /home/me", ["abc", undefined, "", "/home/me"]), "token [redacted] in [redacted]");
  });
});
