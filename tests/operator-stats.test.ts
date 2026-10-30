import { describe, expect, it } from "vitest";

import { attachModuleStats, calculateOperatorStats, extractOperatorStatsProfiles, formatModuleTypeLabel, getRelevantStatsModules, getStatsProfile, officialPotentialToAppliedRanks, potentialDisplayRows, type OperatorStatsProfile } from "../src/game-data/operator-stats";

const source = { repository: "test", revision: "a".repeat(40), path: "en/gamedata/excel/character_table.json", sha256: "b".repeat(64) };

describe("operator stats", () => {
it("formats only verified module suffixes for display", () => {
  expect(["PHY-X", "ISW-A", "SO-B", "LOR-D", "UNKNOWN-Z"].map(formatModuleTypeLabel)).toEqual(["PHY-X", "ISW-α", "SO-β", "LOR-Δ", "UNKNOWN-Z"]);
});

it("extracts phases, keyframes, trust and potential metadata without deriving levels", () => {
  const profiles = extractOperatorStatsProfiles({ char_test: { phases: [{ maxLevel: 50, attributesKeyFrames: [{ level: 1, data: { maxHp: 100, atk: 20, cost: 10 } }, { level: 50, data: { maxHp: 300, atk: 60, cost: 10 } }] }], favorKeyFrames: [{ level: 50, data: { atk: 6 } }], potentialRanks: [{ buff: { attributes: [{ type: "ATK", value: 5 }] } }] } }, "en", source);
  expect(profiles).toHaveLength(1);
  expect(profiles[0].phases[0].keyframes.map((frame) => frame.level)).toEqual([1, 50]);
  expect(profiles[0].phases[0].keyframes[0].attributes.maxHp).toBe(100);
  expect(profiles[0].favorKeyframes[0].attributes).toEqual({ atk: 6 });
  expect(profiles[0].potentialRanks).toHaveLength(1);
});

it("selects the requested regional profile and reports missing data", () => {
  const manifest = { contractVersion: "1" as const, profiles: extractOperatorStatsProfiles({ char_test: { phases: [{ maxLevel: 30, attributesKeyFrames: [] }] } }, "cn", source) };
  expect(getStatsProfile(manifest, "char_test", "cn")?.region).toBe("cn");
  expect(getStatsProfile(manifest, "char_test", "en")).toBeNull();
});

it("keeps each potential buff whole so display rows can read its modifiers", () => {
  const buff = { attributes: { abnormalFlags: null, attributeModifiers: [{ attributeType: "COST", formulaItem: "ADDITION", value: -1 }] } };
  const [profile] = extractOperatorStatsProfiles({ char_test: { phases: [{ maxLevel: 30, attributesKeyFrames: [] }], potentialRanks: [{ buff }, { buff: null }] } }, "en", source);
  expect(profile.potentialRanks).toEqual([{ rank: 0, effects: [buff] }, { rank: 1, effects: [] }]);
  expect(potentialDisplayRows(profile.potentialRanks[0].effects)).toEqual([{ label: "Coste DP", value: "-1", special: false }]);
});

it("records the profile region as the module source region", () => {
  const profiles = extractOperatorStatsProfiles({ char_test: { phases: [{ maxLevel: 30, attributesKeyFrames: [] }] } }, "cn", source);
  const [profile] = attachModuleStats(profiles, { charEquip: { char_test: ["uniequip_test"] }, equipDict: { uniequip_test: { charId: "char_test", uniEquipName: "Test Module", typeName1: "PHY", typeName2: "X" } } }, { uniequip_test: { phases: [{ equipLevel: 1, attributeBlackboard: [], parts: [] }] } }, "cn");
  expect(profile.modules[0]).toMatchObject({ region: "cn", moduleSourceRegion: "cn", moduleType: "PHY-X" });
});

it("separates numeric potential additions from special effects", () => {
  const rows = potentialDisplayRows([{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "ADDITION", value: 30 }] } }, { attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "CUSTOM", value: 1 }] } }]);
  expect(rows.map((row) => ({ label: row.label, value: row.value, special: row.special }))).toEqual([{ label: "ATK", value: "+30", special: false }, { label: "Efecto especial", value: "Disponible en los datos originales; no convertido a bonificación numérica", special: true }]);
});

it("links module levels to the operator and preserves special effects separately", () => {
  const profiles = extractOperatorStatsProfiles({ char_test: { phases: [{ maxLevel: 30, attributesKeyFrames: [] }] } }, "en", source);
  const result = attachModuleStats(profiles, { charEquip: { char_test: ["uniequip_test"] }, equipDict: { uniequip_test: { charId: "char_test", uniEquipName: "Test Module" } } }, { uniequip_test: { phases: [{ equipLevel: 1, attributeBlackboard: [{ key: "atk", value: 12 }], parts: [{ addOrOverrideTalentDataBundle: { candidates: [{ additionalDescription: "Range expands" }] } }] }, { equipLevel: 2, attributeBlackboard: [], parts: [] }] } }, "en");
  expect(result[0].modules[0].uniEquipId).toBe("uniequip_test");
  expect(result[0].modules[0].levels[0].attributes).toEqual({ atk: 12 });
  expect(result[0].modules[0].levels[0].specialEffects).toEqual(["Range expands"]);
  expect(result[0].modules[0].levels[1].attributes).toEqual({});
});

it("filters Stats modules by all verified numeric stages and interval-relevant ASPD", () => {
  const profile: OperatorStatsProfile = {
    trait: [],
    operatorId: "char_test",
    region: "en",
    source,
    phases: [{ phase: 0, maxLevel: 1, keyframes: [{ level: 1, attributes: { atk: 100, baseAttackTime: 1.6 } }] }],
    favorKeyframes: [],
    potentialRanks: [],
    modules: [
      { uniEquipId: "empty", operatorId: "char_test", region: "en", name: "Empty", levels: [{ level: 1, attributes: {}, specialEffects: ["Talent only"] }] },
      { uniEquipId: "late", operatorId: "char_test", region: "en", name: "Late", levels: [{ level: 1, attributes: {}, specialEffects: [] }, { level: 2, attributes: { atk: 5 }, specialEffects: [] }] },
      { uniEquipId: "aspd", operatorId: "char_test", region: "en", name: "ASPD", levels: [{ level: 1, attributes: { attack_speed: 5 }, specialEffects: [] }] },
    ],
  };
  expect(getRelevantStatsModules(profile).map((module) => module.uniEquipId)).toEqual(["late", "aspd"]);
});

it("interpolates continuous attributes, clamps the phase level and caps trust at 100", () => {
  const profile = extractOperatorStatsProfiles({ char_test: { phases: [{ maxLevel: 5, attributesKeyFrames: [{ level: 1, data: { maxHp: 100, atk: 20, cost: 10 } }, { level: 5, data: { maxHp: 300, atk: 60, cost: 12 } }] }], favorKeyFrames: [{ level: 0, data: { atk: 0 } }, { level: 100, data: { atk: 10 } }] } }, "en", source)[0];
  const result = calculateOperatorStats(profile, { elite: 0, level: 3, trust: 150, potential: 0 });
  expect(result.base.maxHp).toBe(200);
  expect(result.base.cost).toBe(10);
  expect(result.trustBonus.atk).toBe(10);
  expect(result.trust).toBe(100);
  expect(calculateOperatorStats(profile, { elite: 0, level: 999, trust: 0, potential: 0 }).level).toBe(5);
});

it("matches the independently observed Horn E2 progression at consecutive levels", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_4039_horn", region: "cn", source, phases: [{ phase: 2, maxLevel: 90, keyframes: [{ level: 1, attributes: { maxHp: 2200, atk: 776, def: 452, magicResistance: 0 } }, { level: 90, attributes: { maxHp: 3067, atk: 936, def: 620, magicResistance: 0 } }] }], favorKeyframes: [], potentialRanks: [], modules: [] };
  const values = [1, 2, 3, 4].map((level) => {
    const result = calculateOperatorStats(profile, { elite: 0, level, trust: 0, potential: 0 });
    return [result.calculated.maxHp, result.calculated.atk, result.calculated.def, result.calculated.magicResistance];
  });
  expect(values).toEqual([[2200, 776, 452, 0], [2210, 778, 454, 0], [2219, 780, 456, 0], [2229, 781, 458, 0]]);
});

it("matches the independently observed Horn trust bonuses at E2 level 90", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_4039_horn", region: "cn", source, phases: [{ phase: 2, maxLevel: 90, keyframes: [{ level: 1, attributes: { maxHp: 2200, atk: 776, def: 452, magicResistance: 0 } }, { level: 90, attributes: { maxHp: 3067, atk: 936, def: 620, magicResistance: 0 } }] }], favorKeyframes: [{ level: 0, attributes: { maxHp: 0, atk: 0, def: 0, magicResistance: 0 } }, { level: 50, attributes: { maxHp: 300, atk: 70, def: 0, magicResistance: 0 } }], potentialRanks: [], modules: [] };
  expect([0, 50, 100].map((trust) => calculateOperatorStats(profile, { elite: 0, level: 90, trust, potential: 0 }).calculated)).toEqual([
    { maxHp: 3067, atk: 936, def: 620, magicResistance: 0 },
    { maxHp: 3217, atk: 971, def: 620, magicResistance: 0 },
    { maxHp: 3367, atk: 1006, def: 620, magicResistance: 0 },
  ]);
});

it("scales Horn trust across the full visible range and clamps outside it", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_4039_horn", region: "cn", source, phases: [{ phase: 2, maxLevel: 90, keyframes: [{ level: 1, attributes: { maxHp: 2200, atk: 776, def: 452, magicResistance: 0 } }, { level: 90, attributes: { maxHp: 3067, atk: 936, def: 620, magicResistance: 0 } }] }], favorKeyframes: [{ level: 0, attributes: { maxHp: 0, atk: 0 } }, { level: 50, attributes: { maxHp: 300, atk: 70 } }], potentialRanks: [], modules: [] };
  const value = (trust: number) => calculateOperatorStats(profile, { elite: 0, level: 90, trust, potential: 0 }).calculated;
  expect(value(-1)).toMatchObject({ maxHp: 3067, atk: 936 });
  expect(value(1)).toMatchObject({ maxHp: 3070, atk: 937 });
  expect(value(99)).toMatchObject({ maxHp: 3364, atk: 1005 });
  expect(value(101)).toMatchObject({ maxHp: 3367, atk: 1006 });
});

it("accumulates numeric potential additions and keeps custom effects separate", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_test", region: "en", source, phases: [{ phase: 0, maxLevel: 1, keyframes: [{ level: 1, attributes: { atk: 100 } }] }], favorKeyframes: [], potentialRanks: [{ rank: 0, effects: [{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "ADDITION", value: 5 }] } }] }, { rank: 1, effects: [{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "CUSTOM", value: 1 }] } }] }], modules: [] };
  const result = calculateOperatorStats(profile, { elite: 0, level: 1, trust: 0, potential: 2 });
  expect(result.potentialBonus).toEqual({ atk: 5 });
  expect(result.calculated.atk).toBe(105);
  expect(result.specialEffects).toEqual(["Efecto especial disponible"]);
});

it("uses one selected module stage without accumulating later stages", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_test", region: "en", source, phases: [{ phase: 0, maxLevel: 1, keyframes: [{ level: 1, attributes: { atk: 100 } }] }], favorKeyframes: [], potentialRanks: [], modules: [{ uniEquipId: "uniequip_test", operatorId: "char_test", region: "en", name: "Test", levels: [{ level: 1, attributes: { atk: 5 }, specialEffects: [] }, { level: 2, attributes: { atk: 12 }, specialEffects: ["Range expands"] }] }] };
  const result = calculateOperatorStats(profile, { elite: 0, level: 1, trust: 0, potential: 0, moduleId: "uniequip_test", moduleLevel: 2 });
  expect(result.moduleBonus).toEqual({ atk: 12 });
  expect(result.calculated.atk).toBe(112);
  expect(result.specialEffects).toEqual(["Range expands"]);
});

it("adjusts the displayed attack interval from direct module ASPD while preserving the base value", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_test", region: "en", source, phases: [{ phase: 0, maxLevel: 1, keyframes: [{ level: 1, attributes: { baseAttackTime: 1.6, attackSpeed: 100 } }] }], favorKeyframes: [], potentialRanks: [], modules: [{ uniEquipId: "uniequip_aspd", operatorId: "char_test", region: "en", name: "ASPD", levels: [{ level: 1, attributes: { attack_speed: 5 }, specialEffects: [] }, { level: 2, attributes: { attack_speed: 10 }, specialEffects: [] }] }] };
  const base = calculateOperatorStats(profile, { elite: 0, level: 1, trust: 0, potential: 0 });
  const stage1 = calculateOperatorStats(profile, { elite: 0, level: 1, trust: 0, potential: 0, moduleId: "uniequip_aspd", moduleLevel: 1 });
  const stage2 = calculateOperatorStats(profile, { elite: 0, level: 1, trust: 0, potential: 0, moduleId: "uniequip_aspd", moduleLevel: 2 });
  expect(base.base.baseAttackTime).toBe(1.6);
  expect(base.calculated.baseAttackTime).toBe(1.6);
  expect(stage1.base.baseAttackTime).toBe(1.6);
  expect(stage1.calculated).toMatchObject({ attackSpeed: 105, baseAttackTime: 1.6 * 100 / 105 });
  expect(stage2.calculated).toMatchObject({ attackSpeed: 110, baseAttackTime: 1.6 * 100 / 110 });
});

it("matches Horn FOR-X module bonuses by selected stage", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_4039_horn", region: "cn", source, phases: [{ phase: 2, maxLevel: 90, keyframes: [{ level: 1, attributes: { maxHp: 2200, atk: 776, def: 452, magicResistance: 0 } }, { level: 90, attributes: { maxHp: 3067, atk: 936, def: 620, magicResistance: 0 } }] }], favorKeyframes: [], potentialRanks: [], modules: [{ uniEquipId: "uniequip_002_horn", operatorId: "char_4039_horn", region: "cn", name: "FOR-X", levels: [{ level: 1, attributes: { atk: 65, def: 52 }, specialEffects: [] }, { level: 2, attributes: { atk: 85, def: 62 }, specialEffects: [] }, { level: 3, attributes: { atk: 100, def: 70 }, specialEffects: [] }] }] };
  expect([1, 2].map((moduleLevel) => calculateOperatorStats(profile, { elite: 0, level: 90, trust: 0, potential: 0, moduleId: "uniequip_002_horn", moduleLevel }).moduleBonus)).toEqual([{ atk: 65, def: 52 }, { atk: 85, def: 62 }]);
});

it("applies Horn potential improvements cumulatively from P1 through P6", () => {
  const profile: OperatorStatsProfile = { trait: [], operatorId: "char_4039_horn", region: "cn", source, phases: [{ phase: 2, maxLevel: 90, keyframes: [{ level: 1, attributes: { maxHp: 2200, atk: 776, def: 452, cost: 28, magicResistance: 0 } }] }], favorKeyframes: [], potentialRanks: [
    { rank: 0, effects: [{ attributes: { attributeModifiers: [{ attributeType: "COST", formulaItem: "ADDITION", value: -1 }] } }] },
    { rank: 1, effects: [] },
    { rank: 2, effects: [{ attributes: { attributeModifiers: [{ attributeType: "ATK", formulaItem: "ADDITION", value: 30 }] } }] },
    { rank: 3, effects: [] },
    { rank: 4, effects: [{ attributes: { attributeModifiers: [{ attributeType: "COST", formulaItem: "ADDITION", value: -1 }] } }] },
  ], modules: [] };
  expect([1, 2, 3, 4, 5, 6].map((potential) => calculateOperatorStats(profile, { elite: 0, level: 1, trust: 0, potential: officialPotentialToAppliedRanks(potential) }).calculated)).toEqual([
    { maxHp: 2200, atk: 776, def: 452, cost: 28, magicResistance: 0 },
    { maxHp: 2200, atk: 776, def: 452, cost: 27, magicResistance: 0 },
    { maxHp: 2200, atk: 776, def: 452, cost: 27, magicResistance: 0 },
    { maxHp: 2200, atk: 806, def: 452, cost: 27, magicResistance: 0 },
    { maxHp: 2200, atk: 806, def: 452, cost: 27, magicResistance: 0 },
    { maxHp: 2200, atk: 806, def: 452, cost: 26, magicResistance: 0 },
  ]);
});

it("maps official potential levels to applied upgrade counts", () => {
  expect([1, 2, 6].map(officialPotentialToAppliedRanks)).toEqual([0, 1, 5]);
});
});
