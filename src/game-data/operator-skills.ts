import { baseSkillTextFixes, findSkillDataGap, fixBaseSkillText, skillDataGaps, type BaseSkillTextFix, type SkillDataGap } from "./skill-data-gaps";
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
export type SkillUnlock = { /** Elite phase (0-2) the operator needs for the skill. */ elite: 0 | 1 | 2; level: number };
export type OperatorSkill = {
  slot: number; skillId: string; name: string;
  /** From `character_table` `skills[].unlockCond`. */
  unlock: SkillUnlock;
  /** Present when every level shares the same description. */
  description?: string;
  /** Present when every level lists the same keys in the same order and none has a `valueStr`. */
  blackboardKeys?: string[];
  levels: SkillLevelData[];
};
export type ExpandedSkillLevel = { description: string; blackboard: SkillBlackboardEntry[] };

// Base (infrastructure) skills from building_data: each slot lists its stages in unlock order, and a later stage replaces
// the earlier one. Descriptions carry their values written in, so they have no blackboard.
export type BaseSkillStage = {
  buffId: string;
  name: string;
  /** building_data room type, such as TRADING or MANUFACTURE. */
  room: string;
  /** building_data `skillIcon` id. */
  icon: string;
  /** Source `buffColor` and `textColor`, as given. */
  color: string;
  textColor: string;
  unlock: SkillUnlock;
  description: string;
};
export type OperatorBaseSkill = { slot: number; stages: BaseSkillStage[] };

// Talents from character_table: each talent lists its visible stages in unlock order (elite, level, then potential), and a
// later stage replaces the earlier ones it covers. Descriptions carry their values written in, so they have no blackboard.
export type TalentStage = {
  /** Some talents rename a stage, such as "Support Spray 1" to "Support Spray 6". */
  name: string;
  unlock: SkillUnlock;
  /** Official potential (1-6) the stage needs; the source `requiredPotentialRank` plus one. */
  potential: number;
  description: string;
  rangeId?: string;
};
/** `index` is the talent's position in the source list (0-based), the one module talent changes reference. */
export type OperatorTalent = { index: number; stages: TalentStage[] };

export type OperatorSkillsProfile = {
  operatorId: string;
  region: string;
  skills: OperatorSkill[];
  ranges: Record<string, SkillRange>;
  baseSkills: OperatorBaseSkill[];
  talents: OperatorTalent[];
};

type SourceLevel = {
  name: string; rangeId: string | null; description: string; skillType: string; durationType: string; duration: number;
  spData: { spType: string | number; spCost: number; initSp: number };
  blackboard: { key: string; value: number; valueStr?: string | null }[];
};
type SourceUnlock = { unlockCond?: { phase?: string } };
type SourceCharacter = { phases?: unknown[]; skills?: { skillId: string; unlockCond?: { phase?: string; level?: number }; levelUpCostCond?: SourceUnlock[] }[] | Record<string, never> | null; allSkillLvlup?: SourceUnlock[] };
/** A hidden or locked candidate may lack its name and description; an empty blackboard can come as `{}`. */
type SourceTalentCandidate = {
  unlockCondition?: { phase?: string; level?: number }; requiredPotentialRank?: number; name?: string | null; description?: string | null;
  rangeId?: string | null; blackboard?: SkillBlackboardEntry[] | Record<string, never> | null; isHideTalent?: boolean;
};
/** `candidates` can be null for a talent with no data. */
type SourceTalentCharacter = { talents?: { candidates?: SourceTalentCandidate[] | null }[] | null };
type SourceSkillTable = Record<string, { levels?: SourceLevel[] } | undefined>;
type SourceRangeTable = Record<string, { direction: number; grids: { row: number; col: number }[] } | undefined>;
type SourceBaseStage = { buffId: string; cond?: { phase?: string; level?: number } };
/** An empty slot comes as `buffData: {}` instead of an empty list. */
type SourceBuildingCharacter = { buffChar?: { buffData?: SourceBaseStage[] | Record<string, never> }[] };
type SourceBuffTable = Record<string, { buffName: string; roomType: string; skillIcon: string; buffColor: string; textColor: string; description: string } | undefined>;

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

function skillUnlock(operatorId: string, skillId: string, cond: { phase?: string; level?: number } | undefined): SkillUnlock {
  const phase = /^PHASE_([0-2])$/.exec(cond?.phase ?? "");
  if (!phase || !Number.isInteger(cond?.level) || cond!.level! < 1) throw new Error(`${operatorId}: skill ${skillId} has no valid unlock condition`);
  return { elite: Number(phase[1]) as 0 | 1 | 2, level: cond!.level! };
}

function unknownMarkers(nodes: readonly SkillDescriptionNode[]): string[] {
  return nodes.flatMap((node) => node.type === "unknownMarker" ? [node.text] : node.type === "style" ? unknownMarkers(node.children) : []);
}

/** Collects `<$id>` glossary term ids used by a description (the id is whatever follows the dollar sign). */
export function termIdsOf(description: string): string[] {
  return [...description.matchAll(/<\$([^<>\s]+)>/g)].map((match) => match[1]);
}

export function buildOperatorSkills(operatorId: string, region: string, character: SourceCharacter, skillTable: SourceSkillTable, rangeTable: SourceRangeTable, gaps: readonly SkillDataGap[] = skillDataGaps): Omit<OperatorSkillsProfile, "baseSkills" | "talents"> {
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
    return compactSkill({ slot: skillIndex + 1, skillId: entry.skillId, name: source[0].name, unlock: skillUnlock(operatorId, entry.skillId, entry.unlockCond), levels });
  });
  return { operatorId, region, skills, ranges: Object.fromEntries(Object.entries(ranges).sort(([a], [b]) => a.localeCompare(b, "en"))) };
}

const descriptionTagPattern = /<[@$][^<>\s]*>|<\/>/g;

/**
 * Base skill slots in source order, without the empty ones. Stages keep their unlock order; a stage that unlocks earlier
 * than the previous one, an unknown buff or a stray `<` or `>` left after the declared fixes is an error.
 */
export function buildOperatorBaseSkills(operatorId: string, building: SourceBuildingCharacter, buffs: SourceBuffTable, fixes: readonly BaseSkillTextFix[] = baseSkillTextFixes): OperatorBaseSkill[] {
  const slots = (building.buffChar ?? []).map((slot) => {
    if (Array.isArray(slot.buffData)) return slot.buffData;
    if (slot.buffData && Object.keys(slot.buffData).length) throw new Error(`${operatorId}: unexpected base skill slot`);
    return [];
  }).filter((stages) => stages.length);
  return slots.map((stages, index): OperatorBaseSkill => {
    let previous = -1;
    return {
      slot: index + 1,
      stages: stages.map((stage): BaseSkillStage => {
        const buff = buffs[stage.buffId];
        if (!buff) throw new Error(`${operatorId}: base skill ${stage.buffId} is missing from the buff table`);
        const unlock = skillUnlock(operatorId, stage.buffId, stage.cond);
        const order = unlock.elite * 1000 + unlock.level;
        if (order < previous) throw new Error(`${operatorId}: base skill ${stage.buffId} unlocks before the stage it replaces`);
        previous = order;
        const description = fixBaseSkillText(stage.buffId, buff.description, fixes);
        if (/[<>]/.test(description.replace(descriptionTagPattern, ""))) throw new Error(`${operatorId}: base skill ${stage.buffId} has a stray < or > in its description`);
        return { buffId: stage.buffId, name: buff.buffName, room: buff.roomType, icon: buff.skillIcon, color: buff.buffColor, textColor: buff.textColor, unlock, description };
      }),
    };
  });
}

export function baseSkillDescriptions(baseSkills: readonly OperatorBaseSkill[]): string[] {
  return baseSkills.flatMap((slot) => slot.stages.map((stage) => stage.description));
}

/** "？？？" stands for a talent the operator has not unlocked yet; it is not a stage of its own. */
const lockedTalentName = "？？？";

function isVisibleTalentStage(candidate: SourceTalentCandidate): boolean {
  if (candidate.isHideTalent || candidate.name === lockedTalentName) return false;
  // A candidate with neither name nor description carries no text to show, even when it is not marked as hidden.
  return candidate.name != null || candidate.description != null;
}

/**
 * Talents with their visible stages; hidden, locked and empty candidates are dropped, and a talent left without stages is
 * omitted. A stage without name or description, out of unlock order, needing an unknown potential, using an unknown range or
 * with a marker the parser cannot resolve is an error.
 */
export function buildOperatorTalents(operatorId: string, character: SourceTalentCharacter, rangeTable: SourceRangeTable): { talents: OperatorTalent[]; ranges: Record<string, SkillRange> } {
  const ranges: Record<string, SkillRange> = {};
  const talents = (character.talents ?? []).flatMap((talent, index): OperatorTalent[] => {
    let previous = -1;
    const stages = (talent.candidates ?? []).filter(isVisibleTalentStage).map((candidate): TalentStage => {
      const id = `talent ${index + 1}`;
      if (!candidate.name || !candidate.description) throw new Error(`${operatorId}: ${id} has a stage without name or description`);
      const unlock = skillUnlock(operatorId, id, candidate.unlockCondition);
      const rank = candidate.requiredPotentialRank ?? 0;
      if (!Number.isInteger(rank) || rank < 0 || rank > 5) throw new Error(`${operatorId}: ${id} needs an unknown potential rank ${rank}`);
      const order = (unlock.elite * 1000 + unlock.level) * 10 + rank;
      if (order <= previous) throw new Error(`${operatorId}: ${id} has stages out of unlock order`);
      previous = order;
      const blackboard = Array.isArray(candidate.blackboard) ? candidate.blackboard : [];
      const markers = unknownMarkers(parseSkillDescription(candidate.description, blackboard));
      if (markers.length) throw new Error(`${operatorId}: ${id} has an unresolved marker ${markers[0]}`);
      if (candidate.rangeId) {
        const range = rangeTable[candidate.rangeId];
        if (!range) throw new Error(`${operatorId}: ${id} uses unknown range ${candidate.rangeId}`);
        ranges[candidate.rangeId] = { direction: range.direction, grids: range.grids.map((grid) => ({ row: grid.row, col: grid.col })) };
      }
      return { name: candidate.name, unlock, potential: rank + 1, description: candidate.description, ...(candidate.rangeId ? { rangeId: candidate.rangeId } : {}) };
    });
    return stages.length ? [{ index, stages }] : [];
  });
  return { talents, ranges };
}

export function talentDescriptions(talents: readonly OperatorTalent[]): string[] {
  return talents.flatMap((talent) => talent.stages.map((stage) => stage.description));
}

export type GlossaryTable =Record<string, { termId?: string; termName: string; description: string } | undefined>;
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
  const result: OperatorSkill = { slot: skill.slot, skillId: skill.skillId, name: skill.name, unlock: skill.unlock, levels: [] };
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
