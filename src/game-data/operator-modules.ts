import { buildOperatorTalents, type SkillRange, type SkillUnlock } from "./operator-skills";
import { parseSkillDescription, type SkillBlackboardEntry, type SkillDescriptionNode } from "./skill-description";

// Operator modules from uniequip_table and battle_equip_table. The base trait, built here from character_table, is stored in the
// stats files.
// ORIGINAL modules and the material costs are left out, and so are the texts of data-only trait parts, which the module page does
// not show. Parts limited to a game mode (Integrated Strategies, Reclamation Algorithm) are kept apart, tagged with their mode.
export type ModuleRegion = "en" | "cn";

/** Base trait stage: the description is a template whose `{key}` values come from the blackboard. */
export type TraitStage = { unlock: SkillUnlock; potential: number; description: string; blackboard?: SkillBlackboardEntry[] };
/** A trait change: `override` replaces the trait and `addition` is appended to it; a change can carry both. */
export type ModuleTraitChange = { token: boolean; override?: string; addition?: string; blackboard?: SkillBlackboardEntry[] };
/**
 * A talent change with its values written in. `index` is the talent's position in character_table, the same as the talents of
 * the skills dataset; null marks a talent the module adds.
 */
export type ModuleTalentChange = { index: number | null; potential: number; token: boolean; name: string; description: string; rangeId?: string };
/** Effects of a level limited to a game mode, tagged as the source tags them. */
export type ModuleModeEffects = {
  /** `validInGameTag`: roguelike (Integrated Strategies) or sandbox (Reclamation Algorithm). */
  gameTag?: string;
  /** `validInMapTag`: one Integrated Strategies theme, such as rogue_yan. */
  mapTag?: string;
  rangeId?: string;
  traits: ModuleTraitChange[];
  talents: ModuleTalentChange[];
};
export type ModuleLevel = {
  level: number;
  /** Trust percentage the level needs: the favor_table frame of its `unlockFavors` points; null when the source has none. */
  trust: number | null;
  attributes: Record<string, number>;
  /** Attack range of the operator with the module, when the module changes it (a trait part or a hidden talent whose range is displayed). */
  rangeId?: string;
  /** Attributes added to each summon, by token id. */
  tokenAttributes?: Record<string, Record<string, number>>;
  traits: ModuleTraitChange[];
  talents: ModuleTalentChange[];
  /** Effects that only apply in a game mode or map, never mixed with the normal ones above. */
  modes?: ModuleModeEffects[];
};
export type OperatorModule = {
  id: string;
  name: string;
  /** Region of the data the module comes from: a module not yet in Global keeps its CN texts. */
  region: ModuleRegion;
  /** Such as PHY-X. */
  type: string;
  /** Type icon id, a file under public/assets/operator-modules. */
  icon: string;
  limitedModality?: true;
  unlock: SkillUnlock;
  missions: string[];
  levels: ModuleLevel[];
};
export type OperatorModulesProfile = {
  operatorId: string;
  region: ModuleRegion;
  /** Names of the summons the modules mention, by token id. */
  tokens: Record<string, string>;
  ranges: Record<string, SkillRange>;
  modules: OperatorModule[];
};

type SourceUnlock = { phase?: string; level?: number };
type SourceBlackboard = SkillBlackboardEntry[] | Record<string, never> | null | undefined;
type SourceTraitCandidate = { unlockCondition?: SourceUnlock; requiredPotentialRank?: number; blackboard?: SourceBlackboard; overrideDescripton?: string | null; additionalDescription?: string | null; rangeId?: string | null };
type SourceTalentCandidate = { talentIndex: number; displayRangeId?: boolean; unlockCondition?: SourceUnlock; requiredPotentialRank?: number; name?: string | null; upgradeDescription?: string | null; rangeId?: string | null; blackboard?: SourceBlackboard; isHideTalent?: boolean };
type SourcePart = { target: string; isToken: boolean; validInGameTag?: string | null; validInMapTag?: string | null; addOrOverrideTalentDataBundle?: { candidates?: SourceTalentCandidate[] | null }; overrideTraitDataBundle?: { candidates?: SourceTraitCandidate[] | null } };
type SourcePhase = { equipLevel: number; parts: SourcePart[]; attributeBlackboard: SkillBlackboardEntry[]; tokenAttributeBlackboard?: Record<string, SkillBlackboardEntry[]> };
type SourceEquip = {
  uniEquipId: string; uniEquipName: string; typeIcon: string; typeName1: string; typeName2: string | null; type: string; charId: string;
  unlockEvolvePhase: string; unlockLevel: number; unlockFavors?: Record<string, number> | null; missionList?: string[] | Record<string, never> | null; isSpecialEquip?: boolean;
};
export type SourceModuleTables = {
  character_table: Record<string, SourceCharacter | undefined>;
  uniequip_table: { equipDict: Record<string, SourceEquip | undefined>; charEquip: Record<string, string[] | undefined>; missionList: Record<string, { desc: string } | undefined> };
  battle_equip_table: Record<string, { phases: SourcePhase[] } | undefined>;
  range_table: Record<string, { direction: number; grids: { row: number; col: number }[] } | undefined>;
  favor_table: { favorFrames: { data: { favorPoint: number; percent: number } }[] };
};
type SourceCharacter = Parameters<typeof buildOperatorTalents>[1] & {
  name?: string; description?: string | null; trait?: { candidates?: SourceTraitCandidate[] | null } | null; displayTokenDict?: Record<string, boolean> | null;
};

const shownTraitTargets = new Set(["TRAIT", "DISPLAY"]);
const traitTargets = new Set([...shownTraitTargets, "TRAIT_DATA_ONLY"]);
const talentTargets = new Set(["TALENT", "TALENT_DATA_ONLY"]);
const knownTargets = new Set([...shownTraitTargets, ...talentTargets, "TRAIT_DATA_ONLY", "OVERWRITE_BATTLE_DATA"]);

function unlockOf(context: string, cond: SourceUnlock | undefined): SkillUnlock {
  const phase = /^PHASE_([0-2])$/.exec(cond?.phase ?? "");
  if (!phase || !Number.isInteger(cond?.level) || cond!.level! < 1) throw new Error(`${context} has no valid unlock condition`);
  return { elite: Number(phase[1]) as 0 | 1 | 2, level: cond!.level! };
}

function potentialOf(context: string, rank: number | undefined): number {
  const value = rank ?? 0;
  if (!Number.isInteger(value) || value < 0 || value > 5) throw new Error(`${context} needs an unknown potential rank ${value}`);
  return value + 1;
}

const blackboardOf = (source: SourceBlackboard): SkillBlackboardEntry[] => Array.isArray(source) ? source.map((item) => item.valueStr == null ? { key: item.key, value: item.value } : { key: item.key, value: item.value, valueStr: item.valueStr }) : [];

function unknownMarkers(nodes: readonly SkillDescriptionNode[]): string[] {
  return nodes.flatMap((node) => node.type === "unknownMarker" ? [node.text] : node.type === "style" ? unknownMarkers(node.children) : []);
}

function checkText(context: string, text: string, blackboard: readonly SkillBlackboardEntry[]) {
  const markers = unknownMarkers(parseSkillDescription(text, blackboard));
  if (markers.length) throw new Error(`${context} has an unresolved marker ${markers[0]}`);
}

function attributesOf(context: string, entries: readonly SkillBlackboardEntry[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.key in result) throw new Error(`${context} repeats the attribute ${entry.key}`);
    if (!Number.isFinite(entry.value)) throw new Error(`${context} has a non-numeric attribute ${entry.key}`);
    result[entry.key] = entry.value;
  }
  return result;
}

/** Trait stages of the operator; without candidates the trait is the plain description. */
export function buildOperatorTrait(operatorId: string, character: SourceCharacter): TraitStage[] {
  const candidates = character.trait?.candidates ?? [];
  if (!candidates.length) {
    if (!character.description) throw new Error(`${operatorId}: the trait has no description`);
    checkText(`${operatorId}: trait`, character.description, []);
    return [{ unlock: { elite: 0, level: 1 }, potential: 1, description: character.description }];
  }
  return candidates.map((candidate, index): TraitStage => {
    const context = `${operatorId}: trait stage ${index + 1}`;
    const description = candidate.overrideDescripton ?? character.description;
    if (!description) throw new Error(`${context} has no description`);
    const blackboard = blackboardOf(candidate.blackboard);
    checkText(context, description, blackboard);
    return { unlock: unlockOf(context, candidate.unlockCondition), potential: potentialOf(context, candidate.requiredPotentialRank), description, ...(blackboard.length ? { blackboard } : {}) };
  });
}

type ModuleSource = { id: string; region: ModuleRegion; tables: SourceModuleTables };

/**
 * Module ids of an operator in charEquip order. A Global operator also gets the modules only the CN data has, which keep
 * their CN region; a CN-only operator takes every module from CN.
 */
export function operatorModuleSources(operatorId: string, region: ModuleRegion, tables: Readonly<Record<ModuleRegion, SourceModuleTables>>): ModuleSource[] {
  const own = (tables[region].uniequip_table.charEquip[operatorId] ?? []).map((id): ModuleSource => ({ id, region, tables: tables[region] }));
  if (region === "cn") return own;
  const known = new Set(own.map((source) => source.id));
  const cnOnly = (tables.cn.uniequip_table.charEquip[operatorId] ?? []).filter((id) => !known.has(id) && !tables.en.uniequip_table.equipDict[id]).map((id): ModuleSource => ({ id, region: "cn", tables: tables.cn }));
  return [...own, ...cnOnly];
}

export function isOriginalModule(equip: Pick<SourceEquip, "type" | "typeName1">): boolean {
  return equip.type === "INITIAL" || equip.typeName1 === "ORIGINAL";
}

function addRange(context: string, rangeId: string | null | undefined, rangeTable: SourceModuleTables["range_table"], ranges: Record<string, SkillRange>): string | undefined {
  if (!rangeId) return undefined;
  const range = rangeTable[rangeId];
  if (!range) throw new Error(`${context} uses unknown range ${rangeId}`);
  ranges[rangeId] = { direction: range.direction, grids: range.grids.map((grid) => ({ row: grid.row, col: grid.col })) };
  return rangeId;
}

type EffectGroup = { gameTag?: string; mapTag?: string; rangeId?: string; traits: ModuleTraitChange[]; talents: Map<string, ModuleTalentChange> };

const talentOrder = (change: ModuleTalentChange) => [change.index ?? Number.MAX_SAFE_INTEGER, Number(change.token), change.potential];
function sortedTalents(talents: Iterable<ModuleTalentChange>): ModuleTalentChange[] {
  return [...talents].sort((a, b) => { const [x, y] = [talentOrder(a), talentOrder(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
}

/** Trust percentage of a favor frame; points that match no frame exactly are an error, never interpolated. */
export function trustPercent(context: string, points: number, favorTable: SourceModuleTables["favor_table"]): number {
  const frame = favorTable.favorFrames.find((item) => item.data.favorPoint === points);
  if (!frame) throw new Error(`${context} needs ${points} trust points, which match no favor frame`);
  return frame.data.percent;
}

function buildLevel(context: string, phase: SourcePhase, equip: SourceEquip, talentIndices: ReadonlySet<number>, rangeTable: SourceModuleTables["range_table"], favorTable: SourceModuleTables["favor_table"], ranges: Record<string, SkillRange>): ModuleLevel {
  const levelContext = `${context} level ${phase.equipLevel}`;
  // Effects tagged with a game mode or a map are kept apart from the normal ones, one group per tag pair.
  const groups = new Map<string, EffectGroup>();
  const groupOf = (part: SourcePart): EffectGroup => {
    const key = `${part.validInGameTag ?? ""}|${part.validInMapTag ?? ""}`;
    let group = groups.get(key);
    if (!group) {
      group = { ...(part.validInGameTag ? { gameTag: part.validInGameTag } : {}), ...(part.validInMapTag ? { mapTag: part.validInMapTag } : {}), traits: [], talents: new Map() };
      groups.set(key, group);
    }
    return group;
  };
  const setRange = (group: EffectGroup, id: string) => {
    if (group.rangeId && id !== group.rangeId) throw new Error(`${levelContext} changes the range twice`);
    group.rangeId = addRange(levelContext, id, rangeTable, ranges);
  };
  for (const part of phase.parts) {
    if (!knownTargets.has(part.target)) throw new Error(`${levelContext} has an unknown part target ${part.target}`);
    const group = groupOf(part);
    if (traitTargets.has(part.target)) for (const candidate of part.overrideTraitDataBundle?.candidates ?? []) if (candidate.rangeId) setRange(group, candidate.rangeId);
    if (shownTraitTargets.has(part.target)) {
      for (const candidate of part.overrideTraitDataBundle?.candidates ?? []) {
        if (!candidate.overrideDescripton && !candidate.additionalDescription) continue;
        const blackboard = blackboardOf(candidate.blackboard);
        for (const text of [candidate.overrideDescripton, candidate.additionalDescription]) if (text) checkText(`${levelContext} trait`, text, blackboard);
        group.traits.push({ token: part.isToken, ...(candidate.overrideDescripton ? { override: candidate.overrideDescripton } : {}), ...(candidate.additionalDescription ? { addition: candidate.additionalDescription } : {}), ...(blackboard.length ? { blackboard } : {}) });
      }
    }
    if (talentTargets.has(part.target)) {
      for (const candidate of part.addOrOverrideTalentDataBundle?.candidates ?? []) {
        // A hidden candidate whose range is displayed changes the operator's attack range.
        if (candidate.isHideTalent && candidate.displayRangeId && candidate.rangeId) setRange(group, candidate.rangeId);
        // Hidden candidates and placeholders without text only carry battle data.
        if (candidate.isHideTalent || !candidate.name || !candidate.upgradeDescription) continue;
        const talentContext = `${levelContext} talent ${candidate.talentIndex}`;
        if (candidate.talentIndex < -1 || !Number.isInteger(candidate.talentIndex)) throw new Error(`${talentContext} has an unknown talent index`);
        const index = candidate.talentIndex === -1 ? null : candidate.talentIndex;
        if (index !== null && !talentIndices.has(index)) throw new Error(`${talentContext} changes a talent the operator does not show`);
        // Values come written in: the stored text must read without a blackboard.
        checkText(talentContext, candidate.upgradeDescription, []);
        const unlock = unlockOf(talentContext, candidate.unlockCondition);
        if (unlock.elite !== 2) throw new Error(`${talentContext} unlocks before Elite 2`);
        // Only a range the game displays: other talent ranges only drive battle data.
        const rangeId = candidate.displayRangeId ? addRange(talentContext, candidate.rangeId, rangeTable, ranges) : undefined;
        const change: ModuleTalentChange = { index, potential: potentialOf(talentContext, candidate.requiredPotentialRank), token: part.isToken, name: candidate.name, description: candidate.upgradeDescription, ...(rangeId ? { rangeId } : {}) };
        // The same change can be repeated in a data part and a shown part; a repeat that differs is an error.
        const key = `${change.index}|${change.potential}|${change.token}|${change.name}`;
        const previous = group.talents.get(key);
        if (previous && JSON.stringify(previous) !== JSON.stringify(change)) throw new Error(`${talentContext} has two different texts for potential ${change.potential}`);
        group.talents.set(key, change);
      }
    }
  }
  const normal = groups.get("|");
  const modes = [...groups.entries()].filter(([key, group]) => key !== "|" && (group.rangeId || group.traits.length || group.talents.size)).sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([, group]): ModuleModeEffects => ({ ...(group.gameTag ? { gameTag: group.gameTag } : {}), ...(group.mapTag ? { mapTag: group.mapTag } : {}), ...(group.rangeId ? { rangeId: group.rangeId } : {}), traits: group.traits, talents: sortedTalents(group.talents.values()) }));
  const tokenAttributes = Object.fromEntries(Object.entries(phase.tokenAttributeBlackboard ?? {}).map(([token, entries]) => [token, attributesOf(`${levelContext} ${token}`, entries)]));
  const favor = equip.unlockFavors?.[String(phase.equipLevel)];
  return {
    level: phase.equipLevel, trust: favor === undefined || favor === null ? null : trustPercent(levelContext, favor, favorTable), attributes: attributesOf(levelContext, phase.attributeBlackboard),
    ...(normal?.rangeId ? { rangeId: normal.rangeId } : {}),
    ...(Object.keys(tokenAttributes).length ? { tokenAttributes } : {}),
    traits: normal?.traits ?? [],
    talents: sortedTalents(normal?.talents.values() ?? []),
    ...(modes.length ? { modes } : {}),
  };
}

/** The operator's modules and the names of the summons they mention. */
export function buildOperatorModules(operatorId: string, region: ModuleRegion, tables: Readonly<Record<ModuleRegion, SourceModuleTables>>): OperatorModulesProfile {
  const character = tables[region].character_table[operatorId];
  if (!character) throw new Error(`Catalog operator ${operatorId} is missing from the ${region} character table`);
  const talentIndices = new Set(buildOperatorTalents(operatorId, character, tables[region].range_table).talents.map((talent) => talent.index));
  const ranges: Record<string, SkillRange> = {};
  const tokens: Record<string, string> = {};
  const nameToken = (token: string, source: SourceModuleTables) => {
    const name = tables[region].character_table[token]?.name ?? source.character_table[token]?.name;
    if (!name) throw new Error(`${operatorId}: summon ${token} has no name`);
    tokens[token] = name;
  };
  for (const token of Object.keys(character.displayTokenDict ?? {})) if (tables[region].character_table[token]?.name) nameToken(token, tables[region]);
  const modules = operatorModuleSources(operatorId, region, tables).flatMap(({ id, region: moduleRegion, tables: source }): OperatorModule[] => {
    const context = `${operatorId}: module ${id}`;
    const equip = source.uniequip_table.equipDict[id];
    if (!equip) throw new Error(`${context} is missing from the ${moduleRegion} module table`);
    if (equip.charId !== operatorId) throw new Error(`${context} belongs to ${equip.charId}`);
    if (isOriginalModule(equip)) return [];
    const battle = source.battle_equip_table[id];
    if (!battle?.phases.length) throw new Error(`${context} is missing from the ${moduleRegion} battle table`);
    if (equip.unlockEvolvePhase !== "PHASE_2") throw new Error(`${context} does not unlock at Elite 2`);
    // A module without missions comes with `missionList: {}`.
    const missions = (Array.isArray(equip.missionList) ? equip.missionList : []).map((missionId) => {
      const mission = source.uniequip_table.missionList[missionId];
      if (!mission?.desc) throw new Error(`${context} is missing mission ${missionId}`);
      return mission.desc;
    });
    const phases = [...battle.phases].sort((a, b) => a.equipLevel - b.equipLevel);
    const levels = phases.map((phase) => buildLevel(context, phase, equip, talentIndices, source.range_table, source.favor_table, ranges));
    for (const level of levels) for (const token of Object.keys(level.tokenAttributes ?? {})) nameToken(token, source);
    return [{
      id, name: equip.uniEquipName, region: moduleRegion, type: equip.typeName2 ? `${equip.typeName1}-${equip.typeName2}` : equip.typeName1, icon: equip.typeIcon.toLowerCase(),
      ...(equip.isSpecialEquip ? { limitedModality: true as const } : {}),
      unlock: { elite: 2, level: equip.unlockLevel }, missions, levels,
    }];
  });
  return {
    operatorId, region,
    tokens: Object.fromEntries(Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b, "en"))),
    ranges: Object.fromEntries(Object.entries(ranges).sort(([a], [b]) => a.localeCompare(b, "en"))),
    modules,
  };
}

/** Descriptions of one module, for the glossary of its region. */
export function moduleDescriptions(module: OperatorModule): string[] {
  const texts = (effects: Pick<ModuleLevel, "traits" | "talents">) => [...effects.traits.flatMap((change) => [change.override, change.addition].filter((text): text is string => Boolean(text))), ...effects.talents.map((change) => change.description)];
  return module.levels.flatMap((level) => [...texts(level), ...(level.modes ?? []).flatMap(texts)]);
}

export function traitDescriptions(trait: readonly TraitStage[]): string[] {
  return trait.map((stage) => stage.description);
}
