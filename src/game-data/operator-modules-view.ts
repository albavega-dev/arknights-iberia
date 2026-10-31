import { assetPath } from "./asset-paths";
import { isOperatorId, type DatasetIndex, type DatasetSource } from "./operator-dataset";
import type { GameDataRegion } from "./gamedata-revisions";
import { moduleDescriptions, traitDescriptions, type ModuleLevel, type ModuleRegion, type OperatorModulesProfile, type TraitStage } from "./operator-modules";
import type { SkillUnlock } from "./operator-skills";
import { termsOf, type OperatorSkillRangeView, type SkillIconView, type SkillTermView, type StoredSkillsGlossary } from "./operator-skills-view";
import { parseSkillDescription, type SkillDescriptionNode } from "./skill-description";

// What the interface receives for an operator's modules: built on the server from one modules file, serializable, with the
// descriptions already parsed and each module's glossary terms taken from the glossary of its own region. The trait comes from
// the stats file; its terms come from the modules glossary of the operator's region.
export type TraitStageView = { unlock: SkillUnlock; potential: number; description: SkillDescriptionNode[] };
export type ModuleTraitChangeView = { token: boolean; override: SkillDescriptionNode[] | null; addition: SkillDescriptionNode[] | null };
export type ModuleTalentChangeView = { index: number | null; potential: number; token: boolean; name: string; description: SkillDescriptionNode[]; rangeId: string | null };
export type ModuleLevelView = {
  level: number;
  trust: number | null;
  attributes: Record<string, number>;
  rangeId: string | null;
  tokenAttributes: Record<string, Record<string, number>>;
  traits: ModuleTraitChangeView[];
  talents: ModuleTalentChangeView[];
  /** Effects limited to a game mode or map, apart from the normal ones. */
  modes: ModuleModeEffectsView[];
};
export type ModuleModeEffectsView = { gameTag: string | null; mapTag: string | null; rangeId: string | null; traits: ModuleTraitChangeView[]; talents: ModuleTalentChangeView[] };
export type OperatorModuleView = {
  id: string;
  name: string;
  region: ModuleRegion;
  type: string;
  /** Type icon path; null when the dataset has no icon id. */
  icon: string | null;
  /** Module illustration; null when there is no local file. */
  art: SkillIconView | null;
  limitedModality: boolean;
  unlock: SkillUnlock;
  missions: string[];
  levels: ModuleLevelView[];
  terms: Record<string, SkillTermView>;
};
export type OperatorModulesView = {
  operatorId: string;
  region: GameDataRegion;
  source: DatasetSource;
  trait: TraitStageView[];
  traitTerms: Record<string, SkillTermView>;
  tokens: Record<string, string>;
  ranges: Record<string, OperatorSkillRangeView>;
  modules: OperatorModuleView[];
  /** A Global operator with modules only the CN data has: the interface offers a switch to show them. */
  hasCnModules: boolean;
};
export type StoredModulesProfile = Omit<OperatorModulesProfile, "region"> & { region: string };

const iconPath = (icon: string) => assetPath("operator-modules", `${icon}.png`);

function effectsView(effects: Pick<ModuleLevel, "traits" | "talents">): Pick<ModuleLevelView, "traits" | "talents"> {
  return {
    traits: effects.traits.map((change) => ({
      token: change.token,
      override: change.override ? parseSkillDescription(change.override, change.blackboard ?? []) : null,
      addition: change.addition ? parseSkillDescription(change.addition, change.blackboard ?? []) : null,
    })),
    talents: effects.talents.map((change) => ({ index: change.index, potential: change.potential, token: change.token, name: change.name, description: parseSkillDescription(change.description, []), rangeId: change.rangeId ?? null })),
  };
}

export function buildOperatorModulesView(profile: StoredModulesProfile, trait: readonly TraitStage[], region: GameDataRegion, source: DatasetSource, glossaries: Readonly<Partial<Record<GameDataRegion, StoredSkillsGlossary>>>, resolveArt: (moduleId: string) => SkillIconView | null = () => null): OperatorModulesView {
  const glossaryOf = (target: GameDataRegion) => {
    const glossary = glossaries[target];
    if (!glossary) throw new Error(`${profile.operatorId}: the ${target} glossary was not loaded`);
    return glossary;
  };
  const modules = profile.modules.map((module): OperatorModuleView => ({
    id: module.id, name: module.name, region: module.region, type: module.type, icon: module.icon ? iconPath(module.icon) : null, art: resolveArt(module.id), limitedModality: module.limitedModality === true,
    unlock: { ...module.unlock }, missions: [...module.missions],
    levels: module.levels.map((level): ModuleLevelView => ({
      level: level.level, trust: level.trust, attributes: { ...level.attributes }, rangeId: level.rangeId ?? null,
      tokenAttributes: Object.fromEntries(Object.entries(level.tokenAttributes ?? {}).map(([token, values]) => [token, { ...values }])),
      ...effectsView(level),
      modes: (level.modes ?? []).map((mode) => ({ gameTag: mode.gameTag ?? null, mapTag: mode.mapTag ?? null, rangeId: mode.rangeId ?? null, ...effectsView(mode) })),
    })),
    terms: termsOf(moduleDescriptions(module), glossaryOf(module.region)),
  }));
  return {
    operatorId: profile.operatorId, region, source,
    trait: trait.map((stage) => ({ unlock: { ...stage.unlock }, potential: stage.potential, description: parseSkillDescription(stage.description, stage.blackboard ?? []) })),
    traitTerms: termsOf(traitDescriptions(trait), glossaryOf(region)),
    tokens: { ...profile.tokens },
    ranges: Object.fromEntries(Object.entries(profile.ranges).map(([id, range]) => [id, { direction: range.direction, grids: range.grids.map((cell) => ({ row: cell.row, col: cell.col })) }])),
    modules,
    hasCnModules: region === "en" && modules.some((module) => module.region === "cn"),
  };
}

/** Modules shown for the operator: those of its own region, plus the CN ones when the switch is on. */
export function visibleModules(view: OperatorModulesView, showCnModules: boolean): OperatorModuleView[] {
  return view.modules.filter((module) => module.region === view.region || showCnModules);
}

/** Official potentials (2–6) at which some talent change of the module differs. */
export function modulePotentials(module: OperatorModuleView): number[] {
  const changes = module.levels.flatMap((level) => [...level.talents, ...level.modes.flatMap((mode) => mode.talents)]);
  return [...new Set(changes.map((change) => change.potential).filter((potential) => potential > 1))].sort((a, b) => a - b);
}

/**
 * Talent changes in effect at an official potential (1–6): for each talent, the last change whose potential is met. Changes are
 * stored in ascending potential order; operator and summon changes of the same talent are kept apart.
 */
export function talentChangesAt(changes: readonly ModuleTalentChangeView[], potential: number): ModuleTalentChangeView[] {
  const byTalent = new Map<string, ModuleTalentChangeView>();
  for (const change of changes) if (change.potential <= potential) byTalent.set(`${change.token}:${change.index ?? `added:${change.name}`}`, change);
  return [...byTalent.values()];
}

export type ModulesDatasetReaders = {
  index: DatasetIndex;
  readProfile: (operatorId: string) => Promise<StoredModulesProfile>;
  readGlossary: (region: GameDataRegion) => Promise<StoredSkillsGlossary>;
  resolveArt?: (moduleId: string) => SkillIconView | null;
};

/** Same checks as the skills loader; the CN glossary is read only when the operator has CN modules. */
export async function loadOperatorModulesView(readers: ModulesDatasetReaders, operatorId: string, region: GameDataRegion, trait: readonly TraitStage[]): Promise<OperatorModulesView | null> {
  if (!isOperatorId(operatorId)) return null;
  const entry = readers.index.operators[operatorId];
  if (!entry || entry.region !== region) return null;
  const profile = await readers.readProfile(operatorId);
  if (profile.operatorId !== operatorId || profile.region !== region) return null;
  const needed = [...new Set<GameDataRegion>([region, ...profile.modules.map((module) => module.region)])];
  const glossaries = Object.fromEntries(await Promise.all(needed.map(async (target) => [target, await readers.readGlossary(target)] as const)));
  return buildOperatorModulesView(profile, trait, region, readers.index.sources[region], glossaries, readers.resolveArt);
}

const numberPattern = /\d+(?:\.\d+)?%?/g;

function numbersOf(nodes: readonly SkillDescriptionNode[]): string[] {
  return nodes.flatMap((node) => node.type === "text" ? node.text.match(numberPattern) ?? [] : node.type === "value" ? [node.display] : node.type === "style" ? numbersOf(node.children) : []);
}

/**
 * The description with the numbers that differ from `previous` marked as changed, matched by their order in the text. When the
 * two texts do not have the same count of numbers (the wording changed), nothing is marked.
 */
export function highlightChangedNumbers(nodes: readonly SkillDescriptionNode[], previous: readonly SkillDescriptionNode[]): SkillDescriptionNode[] {
  const current = numbersOf(nodes);
  const before = numbersOf(previous);
  if (current.length !== before.length) return [...nodes];
  let position = 0;
  const changed = () => current[position] !== before[position++];
  const mark = (list: readonly SkillDescriptionNode[]): SkillDescriptionNode[] => list.flatMap((node): SkillDescriptionNode[] => {
    if (node.type === "value") return changed() ? [{ ...node, changed: true }] : [node];
    if (node.type === "style") return [{ ...node, children: mark(node.children) }];
    if (node.type !== "text") return [node];
    const parts: SkillDescriptionNode[] = [];
    let last = 0;
    for (const match of node.text.matchAll(numberPattern)) {
      if (!changed()) continue;
      if (match.index > last) parts.push({ type: "text", text: node.text.slice(last, match.index) });
      parts.push({ type: "value", key: "", display: match[0], percent: false, changed: true });
      last = match.index + match[0].length;
    }
    if (last < node.text.length) parts.push({ type: "text", text: node.text.slice(last) });
    return parts;
  });
  return mark(nodes);
}
