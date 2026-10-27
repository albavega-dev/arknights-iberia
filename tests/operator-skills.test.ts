import assert from "node:assert/strict";
import test from "node:test";
import { buildGlossary, buildOperatorSkills, expandSkillLevel, reachableSkillLevels, skillDescriptions, skillLevelLabel, termIdsOf } from "../src/game-data/operator-skills";
import { absentValueDisplay, findSkillDataGap, skillDataGaps } from "../src/game-data/skill-data-gaps";

const level = (description = "Deals <@ba.vup>{atk_scale:0%}</> damage", extra: Record<string, unknown> = {}) => ({
  name: "Skill", rangeId: null, description, skillType: "MANUAL", durationType: "NONE", duration: 10,
  spData: { spType: "INCREASE_WITH_TIME", spCost: 30, initSp: 10 }, blackboard: [{ key: "atk_scale", value: 1.5, valueStr: null }], ...extra,
});
const unlock = (phase: string) => ({ unlockCond: { phase } });
const allSkillLvlup = [0, 0, 0, 1, 1, 1].map((phase) => unlock(`PHASE_${phase}`));
const mastery = [2, 2, 2].map((phase) => unlock(`PHASE_${phase}`));
const rangeTable = { "x-1": { direction: 1, grids: [{ row: 0, col: 0 }, { row: 0, col: 1 }] } };

test("level labels run 1-7 then M1-M3", () => {
  assert.deepEqual([0, 6, 7, 9].map(skillLevelLabel), ["1", "7", "M1", "M3"]);
});

test("reachable levels follow the unlock phases the operator has", () => {
  const character = { phases: [{}, {}, {}], allSkillLvlup, skills: [{ skillId: "a", unlockCond: { phase: "PHASE_0", level: 1 }, levelUpCostCond: mastery }, { skillId: "b", unlockCond: { phase: "PHASE_0", level: 1 } }] };
  assert.equal(reachableSkillLevels(character, 0, 10), 10);
  assert.equal(reachableSkillLevels(character, 1, 7), 7);
  assert.equal(reachableSkillLevels(character, 1, 10), 7, "no mastery data hides M1-M3");
  assert.equal(reachableSkillLevels({ ...character, phases: [{}, {}] }, 0, 10), 7, "no elite 2 hides mastery");
  assert.equal(reachableSkillLevels({ ...character, phases: [{}] }, 0, 10), 4, "no elite 1 hides levels 5-7");
  assert.equal(reachableSkillLevels({ ...character, allSkillLvlup: undefined }, 0, 7), 1);
  assert.equal(reachableSkillLevels({ phases: [{}], skills: {} as never }, 0, 3), 1);
  assert.equal(reachableSkillLevels({ phases: [{}], allSkillLvlup: [{}] }, 0, 3), 1, "an unlock without a phase is unreachable");
});

test("builds operator skills in slot order with ranges and without null values", () => {
  const character = { phases: [{}, {}, {}], allSkillLvlup, skills: [{ skillId: "s1", unlockCond: { phase: "PHASE_0", level: 1 }, levelUpCostCond: mastery }, { skillId: "s2", unlockCond: { phase: "PHASE_0", level: 1 } }] };
  const skillTable = {
    s1: { levels: Array.from({ length: 10 }, (_, index) => level("Hit {atk_scale:0%}", { rangeId: "x-1", blackboard: [{ key: "atk_scale", value: 1 + index / 10, valueStr: index === 0 ? "x" : null }] })) },
    s2: { levels: Array.from({ length: 7 }, () => level()) },
  };
  const profile = buildOperatorSkills("char_a", "en", character, skillTable, rangeTable);
  assert.deepEqual(profile.skills.map((skill) => [skill.slot, skill.skillId, skill.levels.length]), [[1, "s1", 10], [2, "s2", 7]]);
  assert.equal(profile.skills[0].levels[9].level, "M3");
  assert.equal(profile.skills[0].blackboardKeys, undefined, "a valueStr keeps the blackboard per level");
  assert.deepEqual(profile.skills[0].levels[0].blackboard, [{ key: "atk_scale", value: 1, valueStr: "x" }]);
  assert.deepEqual(profile.skills[0].levels[1].blackboard, [{ key: "atk_scale", value: 1.1 }]);
  assert.equal(profile.skills[0].description, "Hit {atk_scale:0%}");
  assert.equal(profile.skills[0].levels[0].description, undefined);
  assert.deepEqual(profile.skills[1].blackboardKeys, ["atk_scale"]);
  assert.deepEqual(profile.skills[1].levels[0].values, [1.5]);
  assert.equal(profile.skills[1].levels[0].blackboard, undefined);
  assert.equal(profile.skills[1].levels[0].rangeId, undefined);
  assert.deepEqual(profile.ranges, { "x-1": { direction: 1, grids: [{ row: 0, col: 0 }, { row: 0, col: 1 }] } });
  assert.equal(profile.skills[0].levels[0].absentKeys, undefined);
});

test("operators without a skill list, such as robots, produce an empty skill list", () => {
  assert.deepEqual(buildOperatorSkills("char_b", "cn", { phases: [{}], skills: {} as never }, {}, {}).skills, []);
});

test("rejects missing skills, renamed skills and unknown ranges", () => {
  const character = { phases: [{}, {}], allSkillLvlup, skills: [{ skillId: "s1", unlockCond: { phase: "PHASE_0", level: 1 } }] };
  assert.throws(() => buildOperatorSkills("char_a", "en", character, {}, {}), /skill s1 is missing/);
  assert.throws(() => buildOperatorSkills("char_a", "en", character, { s1: { levels: [level(), { ...level(), name: "Other" }] } }, {}), /changes its name/);
  assert.throws(() => buildOperatorSkills("char_a", "en", character, { s1: { levels: [level("x", { rangeId: "nope" })] } }, rangeTable), /unknown range nope/);
});

test("compact storage keeps per-level descriptions and blackboards when levels differ, and expands both forms", () => {
  const character = { phases: [{}, {}], allSkillLvlup, skills: [{ skillId: "s1", unlockCond: { phase: "PHASE_0", level: 1 } }, { skillId: "s2", unlockCond: { phase: "PHASE_0", level: 1 } }, { skillId: "s3", unlockCond: { phase: "PHASE_0", level: 1 } }] };
  const withKeys = (keys: string[], description: string) => level(description, { blackboard: keys.map((key, index) => ({ key, value: index + 1, valueStr: null })) });
  const skillTable = {
    s1: { levels: [withKeys(["a", "b"], "One {a}"), withKeys(["a", "b"], "Two {a}")] },
    s2: { levels: [withKeys(["a", "b"], "Same {a}"), withKeys(["b", "a"], "Same {a}")] },
    s3: { levels: [withKeys([], "Plain"), withKeys([], "Plain")] },
  };
  const [s1, s2, s3] = buildOperatorSkills("char_a", "en", character, skillTable, {}).skills;
  assert.equal(s1.description, undefined);
  assert.deepEqual(s1.levels.map((item) => item.description), ["One {a}", "Two {a}"]);
  assert.deepEqual(s1.blackboardKeys, ["a", "b"]);
  assert.equal(s2.blackboardKeys, undefined, "a different key order keeps the blackboard per level");
  assert.deepEqual(s2.levels[1].blackboard, [{ key: "b", value: 1 }, { key: "a", value: 2 }]);
  assert.equal(s3.blackboardKeys, undefined);
  assert.deepEqual(s3.levels[0].blackboard, []);
  assert.deepEqual(expandSkillLevel(s1, s1.levels[1]), { description: "Two {a}", blackboard: [{ key: "a", value: 1 }, { key: "b", value: 2 }] });
  assert.deepEqual(expandSkillLevel(s2, s2.levels[0]), { description: "Same {a}", blackboard: [{ key: "a", value: 1 }, { key: "b", value: 2 }] });
  assert.deepEqual(expandSkillLevel(s3, s3.levels[0]), { description: "Plain", blackboard: [] });
  assert.deepEqual(skillDescriptions(s1), ["One {a}", "Two {a}"]);
  assert.deepEqual(skillDescriptions(s3), ["Plain"]);
  assert.throws(() => expandSkillLevel({ ...s1, blackboardKeys: ["a"] }, s1.levels[0]), /values do not match/);
  assert.throws(() => expandSkillLevel({ ...s3, description: undefined }, s3.levels[0]), /has no description/);
});

test("a marker without a value fails unless the skill has a declared data gap", () => {
  const character = { phases: [{}, {}], allSkillLvlup, skills: [{ skillId: "skchr_zebra_1", unlockCond: { phase: "PHASE_0", level: 1 } }, { skillId: "other", unlockCond: { phase: "PHASE_0", level: 1 } }] };
  const levels = [level("Lasts {duration} seconds, {atk_scale:0%} and {duration}")];
  assert.throws(() => buildOperatorSkills("char_x", "en", { ...character, skills: [{ skillId: "other", unlockCond: { phase: "PHASE_0", level: 1 } }] }, { other: { levels } }, {}), /unresolved marker \{duration\}/);
  const profile = buildOperatorSkills("char_304_zebra", "en", { ...character, skills: [{ skillId: "skchr_zebra_1", unlockCond: { phase: "PHASE_0", level: 1 } }] }, { skchr_zebra_1: { levels } }, {});
  assert.deepEqual(profile.skills[0].levels[0].correctedKeys, ["duration"], "the documented correction completes the value");
  assert.equal(profile.skills[0].levels[0].absentKeys, undefined);
  assert.deepEqual(expandSkillLevel(profile.skills[0], profile.skills[0].levels[0]).blackboard, [{ key: "atk_scale", value: 1.5 }, { key: "duration", value: 10 }]);
  const unfixed = [{ skillId: "skchr_zebra_1", operatorId: "char_304_zebra", key: "duration", note: "no source" }];
  const absent = buildOperatorSkills("char_304_zebra", "en", { ...character, skills: [{ skillId: "skchr_zebra_1", unlockCond: { phase: "PHASE_0", level: 1 } }] }, { skchr_zebra_1: { levels } }, {}, unfixed);
  assert.deepEqual(absent.skills[0].levels[0].absentKeys, ["duration"], "without a fix the value stays absent");
  assert.equal(absent.skills[0].levels[0].correctedKeys, undefined);
  assert.deepEqual(expandSkillLevel(absent.skills[0], absent.skills[0].levels[0]).blackboard, [{ key: "atk_scale", value: 1.5 }]);
  assert.throws(() => buildOperatorSkills("char_x", "en", { ...character, skills: [{ skillId: "skchr_zebra_1", unlockCond: { phase: "PHASE_0", level: 1 } }] }, { skchr_zebra_1: { levels: [level("{other_key}")] } }, {}), /unresolved marker \{other_key\}/);
  assert.throws(() => buildOperatorSkills("char_x", "en", { ...character, skills: [{ skillId: "skchr_zebra_1", unlockCond: { phase: "PHASE_0", level: 1 } }] }, { skchr_zebra_1: { levels: [level("Stray </>")] } }, {}), /unresolved marker <\/>/);
});

test("known data gaps live in one list and are looked up by skill and key", () => {
  assert.deepEqual(skillDataGaps.map((gap) => `${gap.skillId}:${gap.key}`), ["skchr_zebra_1:duration"]);
  assert.equal(findSkillDataGap("skchr_zebra_1", "DURATION")?.operatorId, "char_304_zebra");
  const fix = findSkillDataGap("skchr_zebra_1", "duration")?.fix;
  assert.equal(fix?.from, "duration");
  assert.match(fix?.source ?? "", /^https:\/\/arknights\.wiki\.gg\/wiki\/Heavyrain/, "a correction cites its source");
  assert.match(fix?.checked ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(findSkillDataGap("skchr_zebra_1", "atk"), undefined);
  assert.equal(findSkillDataGap("skchr_other", "duration"), undefined);
  assert.equal(absentValueDisplay, "—");
});

test("glossary collects used terms and the terms nested in their explanations", () => {
  const dictionary = {
    "ba.stun": { termName: "Stun", description: "Unable to act" },
    "ba.camou": { termName: "Camouflage", description: "Cannot be targeted, see <$cc.weak>Weak</>" },
    "cc.weak": { termName: "Weak", description: "Loses <$ba.stun>stun</> resistance; <$cc.weak>self</>" },
    "ba.unused": { termName: "Unused", description: "x" },
  };
  assert.deepEqual(termIdsOf("A <$ba.stun>x</> and <@ba.kw>y</> <$cc.weak>z</>"), ["ba.stun", "cc.weak"]);
  assert.deepEqual(buildGlossary(["<$ba.camou>Camouflage</>"], dictionary), {
    "ba.camou": { name: "Camouflage", description: "Cannot be targeted, see <$cc.weak>Weak</>" },
    "ba.stun": { name: "Stun", description: "Unable to act" },
    "cc.weak": { name: "Weak", description: "Loses <$ba.stun>stun</> resistance; <$cc.weak>self</>" },
  });
  assert.deepEqual(buildGlossary(["no terms"], dictionary), {});
  assert.throws(() => buildGlossary(["<$ba.missing>x</>"], dictionary), /term ba.missing is missing/);
});

test("the unlock of each skill comes from character_table and a missing or invalid one fails instead of being guessed", () => {
  const levels = [{ name: "S", rangeId: null, description: "x", skillType: "MANUAL", durationType: "NONE", duration: 1, spData: { spType: "INCREASE_WITH_TIME", spCost: 1, initSp: 0 }, blackboard: [] }];
  const build = (skills: { skillId: string; unlockCond?: { phase?: string; level?: number } }[]) => buildOperatorSkills("char_x", "en", { phases: [{}, {}, {}], allSkillLvlup: [], skills }, { s1: { levels }, s2: { levels }, s3: { levels } }, {});
  const profile = build([
    { skillId: "s1", unlockCond: { phase: "PHASE_0", level: 1 } },
    { skillId: "s2", unlockCond: { phase: "PHASE_1", level: 1 } },
    { skillId: "s3", unlockCond: { phase: "PHASE_2", level: 30 } },
  ]);
  assert.deepEqual(profile.skills.map((skill) => skill.unlock), [{ elite: 0, level: 1 }, { elite: 1, level: 1 }, { elite: 2, level: 30 }]);
  assert.throws(() => build([{ skillId: "s1" }]), /no valid unlock condition/);
  assert.throws(() => build([{ skillId: "s1", unlockCond: { phase: "PHASE_3", level: 1 } }]), /no valid unlock condition/);
  assert.throws(() => build([{ skillId: "s1", unlockCond: { phase: "PHASE_1" } }]), /no valid unlock condition/);
  assert.throws(() => build([{ skillId: "s1", unlockCond: { phase: "PHASE_1", level: 0 } }]), /no valid unlock condition/);
});
