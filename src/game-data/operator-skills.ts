import { findSkillDataGap, skillDataGaps, type SkillDataGap } from "./skill-data-gaps";
import { parseSkillDescription, type SkillBlackboardEntry, type SkillDescriptionNode } from "./skill-description";

// Combat data of operator skills (H1-H3) extracted from skill_table, character_table and range_table.
// Tokens and traps are not operators: they live under other ids and their skills are never read here.
export type SkillRangeGrid = Readonly<{ row: number; col: number }>;
export type SkillRange = Readonly<{ direction: number; grids: readonly SkillRangeGrid[] }>;

export type SkillLevelData = {
  /** "1".."7", then "M1".."M3" when the skill has mastery levels. */
  level: string;
  skillType: string;
  durationType: string;
  duration: number;
  /** Source value as is: a string such as INCREASE_WITH_TIME, or a number for passive skills. */
  spType: string | number;
  spCost: number;
  initSp: number;
  rangeId?: string;
  /** Only when the description differs between levels; otherwise it lives in the skill. */
  description?: string;
  /** Only when the skill has no shared `blackboardKeys` (some level has a `valueStr` or the key order differs). */
  blackboard?: SkillBlackboardEntry[];
  /** Blackboard values in the order of the skill's `blackboardKeys`. */
  values?: number[];
  /** Blackboard keys the description uses but the source lacks and no correction covers (see skill-data-gaps.ts). */
  absentKeys?: string[];
  /** Blackboard keys completed from a documented correction (see skill-data-gaps.ts). */
  correctedKeys?: string[];
};
export type OperatorSkill = {
  slot: number; skillId: string; name: string;
  /** Present when every level shares the same description. */
  description?: string;
  /** Present when every level lists the same keys in the same order and none has a `valueStr`. */
  blackboardKeys?: string[];
  levels: SkillLevelData[];
};
export type ExpandedSkillLevel = { description: string; blackboard: SkillBlackboardEntry[] };
export type OperatorSkillsProfile = {
  operatorId: string;
  region: string;
  skills: OperatorSkill[];
  ranges: Record<string, SkillRange>;
};

type SourceLevel = {
  name: string; rangeId: string | null; description: string; skillType: string; durationType: string; duration: number;
  spData: { spType: string | number; spCost: number; initSp: number };
  blackboard: { key: string; value: number; valueStr?: string | null }[];
};
type SourceUnlock = { unlockCond?: { phase?: string } };
type SourceCharacter = { phases?: unknown[]; skills?: { skillId: string; levelUpCostCond?: SourceUnlock[] }[] | Record<string, never> | null; allSkillLvlup?: SourceUnlock[] };
type SourceSkillTable = Record<string, { levels?: SourceLevel[] } | undefined>;
type SourceRangeTable = Record<string, { direction: number; grids: { row: number; col: number }[] } | undefined>;

const maxLevels = 10;
const normalLevels = 7;

export function skillLevelLabel(index: number): string { return index < normalLevels ? String(index + 1) : `M${index - normalLevels + 1}`; }

function phaseIndex(unlock: SourceUnlock | undefined): number {
  const match = /^PHASE_(\d)$/.exec(unlock?.unlockCond?.phase ?? "");
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Number of levels an operator can actually reach: level n (2-7) needs `allSkillLvlup[n-2]` and mastery M1-M3 needs
 * `levelUpCostCond[0-2]`, each unlocked at an elite phase the operator has. Unreachable levels are hidden.
 */
export function reachableSkillLevels(character: SourceCharacter, skillIndex: number, available: number): number {
  const phases = Array.isArray(character.phases) ? character.phases.length : 0;
  const mastery = (Array.isArray(character.skills) ? character.skills[skillIndex]?.levelUpCostCond : undefined) ?? [];
  let count = Math.min(available, maxLevels);
  for (let index = 1; index < count; index += 1) {
    const unlock = index < normalLevels ? character.allSkillLvlup?.[index - 1] : mastery[index - normalLevels];
    if (!unlock || phaseIndex(unlock) >= phases) { count = index; break; }
  }
  return count;
}

function unknownMarkers(nodes: readonly SkillDescriptionNode[]): string[] {
  return nodes.flatMap((node) => node.type === "unknownMarker" ? [node.text] : node.type === "style" ? unknownMarkers(node.children) : []);
}

/** Collects `<$id>` glossary term ids used by a description (the id is whatever follows the dollar sign). */
export function termIdsOf(description: string): string[] {
  return [...description.matchAll(/<\$([^<>\s]+)>/g)].map((match) => match[1]);
}

export function buildOperatorSkills(operatorId: string, region: string, character: SourceCharacter, skillTable: SourceSkillTable, rangeTable: SourceRangeTable, gaps: readonly SkillDataGap[] = skillDataGaps): OperatorSkillsProfile {
  const ranges: Record<string, SkillRange> = {};
  const skills = (Array.isArray(character.skills) ? character.skills : []).map((entry, skillIndex): OperatorSkill => {
    const source = skillTable[entry.skillId]?.levels;
    if (!source?.length) throw new Error(`${operatorId}: skill ${entry.skillId} is missing from the skill table`);
    const names = new Set(source.map((level) => level.name));
    if (names.size !== 1) throw new Error(`${operatorId}: skill ${entry.skillId} changes its name between levels`);
    const levels = source.slice(0, reachableSkillLevels(character, skillIndex, source.length)).map((level, index): SkillLevelData => {
      const label = skillLevelLabel(index);
      const blackboard = level.blackboard.map((item) => item.valueStr == null ? { key: item.key, value: item.value } : { key: item.key, value: item.value, valueStr: item.valueStr });
      const absentKeys: string[] = [];
      const correctedKeys: string[] = [];
      for (const marker of unknownMarkers(parseSkillDescription(level.description, blackboard))) {
        const key = /^\{-?([^{}:\s]+)/.exec(marker)?.[1];
        const gap = key ? findSkillDataGap(entry.skillId, key, gaps) : undefined;
        if (!key || !gap) throw new Error(`${operatorId}: skill ${entry.skillId} level ${label} has an unresolved marker ${marker}`);
        if (gap.fix) {
          if (!correctedKeys.includes(key)) { blackboard.push({ key, value: level[gap.fix.from] }); correctedKeys.push(key); }
        } else if (!absentKeys.includes(key)) absentKeys.push(key);
      }
      if (level.rangeId) {
        const range = rangeTable[level.rangeId];
        if (!range) throw new Error(`${operatorId}: skill ${entry.skillId} uses unknown range ${level.rangeId}`);
        ranges[level.rangeId] = { direction: range.direction, grids: range.grids.map((grid) => ({ row: grid.row, col: grid.col })) };
      }
      return {
        level: label, skillType: level.skillType, durationType: level.durationType, duration: level.duration,
        spType: level.spData.spType, spCost: level.spData.spCost, initSp: level.spData.initSp,
        ...(level.rangeId ? { rangeId: level.rangeId } : {}), description: level.description, blackboard,
        ...(absentKeys.length ? { absentKeys } : {}),
        ...(correctedKeys.length ? { correctedKeys } : {}),
      };
    });
    return compactSkill({ slot: skillIndex + 1, skillId: entry.skillId, name: source[0].name, levels });
  });
  return { operatorId, region, skills, ranges: Object.fromEntries(Object.entries(ranges).sort(([a], [b]) => a.localeCompare(b, "en"))) };
}

export type GlossaryTable = Record<string, { termId?: string; termName: string; description: string } | undefined>;
export type GlossaryEntry = { name: string; description: string };

/** Glossary of the terms used by the given descriptions, including terms nested inside other explanations. */
export function buildGlossary(descriptions: Iterable<string>, dictionary: GlossaryTable): Record<string, GlossaryEntry> {
  const result: Record<string, GlossaryEntry> = {};
  const pending = [...descriptions].flatMap(termIdsOf);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (result[id]) continue;
    const term = dictionary[id];
    if (!term) throw new Error(`Glossary term ${id} is missing from the term dictionary`);
    result[id] = { name: term.termName, description: term.description };
    pending.push(...termIdsOf(term.description));
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, "en")));
}

/**
 * Compact storage: the description is kept once per skill when all levels share it, and the blackboard keys once per skill
 * (with a plain `values` array per level) when all levels list the same keys in the same order and none has a `valueStr`.
 */
function compactSkill(skill: OperatorSkill): OperatorSkill {
  const levels = skill.levels;
  const sameDescription = levels.every((level) => level.description === levels[0].description);
  const keys = levels[0].blackboard!.map((item) => item.key);
  const sameKeys = keys.length > 0 && levels.every((level) => level.blackboard!.length === keys.length && level.blackboard!.every((item, index) => item.key === keys[index] && item.valueStr === undefined));
  const result: OperatorSkill = { slot: skill.slot, skillId: skill.skillId, name: skill.name, levels: [] };
  if (sameDescription) result.description = levels[0].description;
  if (sameKeys) result.blackboardKeys = keys;
  result.levels = levels.map((level) => {
    const { description, blackboard, ...rest } = level;
    return { ...rest, ...(sameDescription ? {} : { description }), ...(sameKeys ? { values: blackboard!.map((item) => item.value) } : { blackboard }) };
  });
  return result;
}

/** Description and blackboard of one level, whichever way the skill stores them. */
export function expandSkillLevel(skill: OperatorSkill, level: SkillLevelData): ExpandedSkillLevel {
  const description = level.description ?? skill.description;
  if (description === undefined) throw new Error(`${skill.skillId} level ${level.level} has no description`);
  if (level.values) {
    if (!skill.blackboardKeys || skill.blackboardKeys.length !== level.values.length) throw new Error(`${skill.skillId} level ${level.level} values do not match the skill keys`);
    return { description, blackboard: skill.blackboardKeys.map((key, index) => ({ key, value: level.values![index] })) };
  }
  return { description, blackboard: level.blackboard ?? [] };
}

/** Every distinct description a skill uses, for glossary collection. */
export function skillDescriptions(skill: OperatorSkill): string[] {
  return [...new Set(skill.levels.map((level) => expandSkillLevel(skill, level).description))];
}
