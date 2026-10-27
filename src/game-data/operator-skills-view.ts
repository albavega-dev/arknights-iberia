import { isOperatorId, type DatasetIndex, type DatasetSource } from "./operator-dataset";
import type { GameDataRegion } from "./gamedata-revisions";
import { expandSkillLevel, termIdsOf, type OperatorSkillsProfile, type SkillLevelData, type SkillUnlock } from "./operator-skills";
import { parseSkillDescription, type SkillDescriptionNode } from "./skill-description";

// What the Skills tab receives: built on the server from one operator's skills file, serializable, with descriptions already parsed.
export type SkillLevelLabel = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "M1" | "M2" | "M3";
/**
 * How to read `duration`, checked against the catalog: positive values are seconds; `durationType: "AMMO"` skills end with their
 * ammo (duration 0 or -1); otherwise 0 is an instant effect and -1 has no time limit ("Unlimited duration" in the descriptions).
 * Passive skills with 0 or -1 have no active duration. Any other value is kept as unknown instead of guessed.
 */
export type SkillDurationKind = "seconds" | "instant" | "unlimited" | "ammo" | "none" | "unknown";
export type SkillLevelView = {
  /** Position in the stored levels of the skill. */
  index: number;
  label: SkillLevelLabel;
  group: "level" | "mastery";
  name: string;
  spCost: number | null;
  initialSp: number | null;
  /** Source value; a value of 0 or less is presented according to `durationKind`. */
  duration: number | null;
  durationKind: SkillDurationKind;
  rangeId: string | null;
  /** Mastery rank icon for M1-M3; null for normal levels or when the icon is not inventoried. */
  icon: SkillIconView | null;
  description: SkillDescriptionNode[];
};
export type SkillTermView = { name: string; description: SkillDescriptionNode[] };
export type SkillIconView = { src: string; width: number; height: number };
export type OperatorSkillView = {
  slot: 1 | 2 | 3;
  skillId: string;
  activation: "manual" | "auto" | "passive" | "unknown";
  spRecovery: "time" | "attack" | "defense" | "none" | "unknown";
  /** Elite phase and operator level required to unlock the skill. */
  unlock: SkillUnlock;
  icon: SkillIconView | null;
  /** Only the levels the operator can reach. */
  levels: SkillLevelView[];
  /** Maximum available level. */
  defaultLevelIndex: number;
  /** Glossary terms used by any level of this skill, including terms nested inside other explanations. */
  terms: Record<string, SkillTermView>;
};
export type OperatorSkillRangeView = { direction: number; grids: { row: number; col: number }[] };
/**
 * `status: "empty"` means the operator has no skills (the dataset file exists with `skills: []`), which the interface
 * shows as a message. A missing view (`null` from the loader) means the dataset has no entry for that operator and region.
 */
export type OperatorSkillsView = {
  status: "available" | "empty";
  operatorId: string;
  region: GameDataRegion;
  source: DatasetSource;
  /** Only the ranges the skills use, as stored (range_table shape). */
  ranges: Record<string, OperatorSkillRangeView>;
  skills: OperatorSkillView[];
};
export type StoredSkillsProfile = Omit<OperatorSkillsProfile, "region"> & { region: string };
export type StoredSkillsGlossary = { region: string; terms: Record<string, { name: string; description: string }> };

const activations: Record<string, OperatorSkillView["activation"]> = { MANUAL: "manual", AUTO: "auto", PASSIVE: "passive" };
const recoveries: Record<string, OperatorSkillView["spRecovery"]> = { INCREASE_WITH_TIME: "time", INCREASE_WHEN_ATTACK: "attack", INCREASE_WHEN_TAKEN_DAMAGE: "defense" };

function activationOf(level: SkillLevelData): OperatorSkillView["activation"] { return activations[level.skillType] ?? "unknown"; }
// Passive skills store a number (8) instead of a recovery type: they have no SP.
function recoveryOf(level: SkillLevelData): OperatorSkillView["spRecovery"] { return typeof level.spType === "number" ? "none" : recoveries[level.spType] ?? "unknown"; }

export function skillDurationKind(level: Pick<SkillLevelData, "duration" | "durationType" | "skillType">): SkillDurationKind {
  if (level.duration > 0) return "seconds";
  if (level.durationType === "AMMO") return "ammo";
  if (level.durationType !== "NONE" || (level.duration !== 0 && level.duration !== -1)) return "unknown";
  if (level.skillType === "PASSIVE") return "none";
  return level.duration === 0 ? "instant" : "unlimited";
}

function termsOf(descriptions: readonly string[], glossary: StoredSkillsGlossary): Record<string, SkillTermView> {
  const result: Record<string, SkillTermView> = {};
  const pending = descriptions.flatMap(termIdsOf);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (result[id]) continue;
    const term = glossary.terms[id];
    if (!term) throw new Error(`Glossary term ${id} is missing from the ${glossary.region} glossary`);
    result[id] = { name: term.name, description: parseSkillDescription(term.description, []) };
    pending.push(...termIdsOf(term.description));
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, "en")));
}

export function buildOperatorSkillsView(profile: StoredSkillsProfile, region: GameDataRegion, source: DatasetSource, glossary: StoredSkillsGlossary, resolveIcon: (skillId: string) => SkillIconView | null, resolveMasteryIcon: (label: SkillLevelLabel) => SkillIconView | null = () => null): OperatorSkillsView {
  const ranges: Record<string, OperatorSkillRangeView> = {};
  const skills = profile.skills.map((skill): OperatorSkillView => {
    if (skill.slot < 1 || skill.slot > 3) throw new Error(`${profile.operatorId}: unexpected skill slot ${skill.slot}`);
    const expanded = skill.levels.map((level) => expandSkillLevel(skill, level));
    const levels = skill.levels.map((level, index): SkillLevelView => {
      const rangeId = level.rangeId && profile.ranges[level.rangeId] ? level.rangeId : null;
      if (rangeId) ranges[rangeId] = { direction: profile.ranges[rangeId].direction, grids: profile.ranges[rangeId].grids.map((cell) => ({ row: cell.row, col: cell.col })) };
      return {
        index, label: level.level as SkillLevelLabel, group: level.level.startsWith("M") ? "mastery" : "level", name: skill.name, icon: level.level.startsWith("M") ? resolveMasteryIcon(level.level as SkillLevelLabel) : null,
        spCost: level.spCost, initialSp: level.initSp, duration: level.duration, durationKind: skillDurationKind(level), rangeId,
        description: parseSkillDescription(expanded[index].description, expanded[index].blackboard),
      };
    });
    return {
      slot: skill.slot as 1 | 2 | 3, skillId: skill.skillId, activation: activationOf(skill.levels[0]), spRecovery: recoveryOf(skill.levels[0]), unlock: { ...skill.unlock },
      icon: resolveIcon(skill.skillId), levels, defaultLevelIndex: levels.length - 1,
      terms: termsOf(expanded.map((level) => level.description), glossary),
    };
  });
  return { status: skills.length ? "available" : "empty", operatorId: profile.operatorId, region, source, ranges: Object.fromEntries(Object.entries(ranges).sort(([a], [b]) => a.localeCompare(b, "en"))), skills };
}

export type SkillsDatasetReaders = {
  index: DatasetIndex;
  readProfile: (operatorId: string) => Promise<StoredSkillsProfile>;
  readGlossary: (region: GameDataRegion) => Promise<StoredSkillsGlossary>;
  resolveIcon: (region: GameDataRegion, skillId: string) => SkillIconView | null;
  resolveMasteryIcon: (label: SkillLevelLabel) => SkillIconView | null;
};

/** Same checks as `loadStatsProfile`: the id must be well formed and indexed for the requested region, and the file must agree. */
export async function loadOperatorSkillsView(readers: SkillsDatasetReaders, operatorId: string, region: GameDataRegion): Promise<OperatorSkillsView | null> {
  if (!isOperatorId(operatorId)) return null;
  const entry = readers.index.operators[operatorId];
  if (!entry || entry.region !== region) return null;
  const profile = await readers.readProfile(operatorId);
  if (profile.operatorId !== operatorId || profile.region !== region) return null;
  const glossary = await readers.readGlossary(region);
  return buildOperatorSkillsView(profile, region, readers.index.sources[region], glossary, (skillId) => readers.resolveIcon(region, skillId), readers.resolveMasteryIcon);
}
