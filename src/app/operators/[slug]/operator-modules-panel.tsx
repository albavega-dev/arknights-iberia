"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import { formatNumber } from "../../../game-data/number-format";
import { highlightChangedNumbers, modulePotentials, talentChangesAt, visibleModules, type ModuleLevelView, type ModuleModeEffectsView, type ModuleTalentChangeView, type ModuleTraitChangeView, type OperatorModulesView, type OperatorModuleView, type TraitStageView } from "../../../game-data/operator-modules-view";
import { formatModuleTypeLabel, moduleAttributeLabels } from "../../../game-data/operator-stats";
import { followPointer } from "../pointer-light";
import { RangeGrid } from "../range-grid";
import { SkillDescription, type GlossaryContext } from "./operator-skills-panel";

type Glossary = Omit<GlossaryContext, "terms">;

/** Switch shared by the Modules tab and the Stats module selector, styled as the one of the operator library. */
export function CnModulesToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" className={`operators-cn-toggle operator-modules-cn-toggle${checked ? " is-active" : ""}`} aria-pressed={checked} onClick={() => onChange(!checked)}><span>Incluir módulos CN</span><span className="operators-cn-switch" aria-hidden="true"><span className="operators-cn-switch-thumb" /></span></button>;
}

const attributeOrder = ["max_hp", "atk", "def", "magic_resistance", "cost", "block_cnt", "attack_speed", "respawn_time", "max_deploy_count", "max_deck_stack_cnt"];
const attributeLabels: Readonly<Record<string, string>> = { ...moduleAttributeLabels, max_deploy_count: "Despliegue máximo", max_deck_stack_cnt: "Unidades disponibles" };

const gameTagLabels: Readonly<Record<string, string>> = { roguelike: "Integrated Strategies", sandbox: "Reclamation Algorithm" };
const mapTagLabels: Readonly<Record<string, string>> = { rogue_yan: "Sui's Garden of Grotesqueries" };

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function attributeRank(key: string): number {
  const rank = attributeOrder.indexOf(key);
  return rank < 0 ? attributeOrder.length : rank;
}

/** Attributes as compact text, one per line, such as "ATK +76"; values that differ from the previous level are highlighted. */
function AttributeLine({ attributes, previous, label }: { attributes: Record<string, number>; previous?: Record<string, number>; label?: string }) {
  const keys = Object.keys(attributes).sort((a, b) => attributeRank(a) - attributeRank(b));
  if (!keys.length) return null;
  return <ul className="operator-module-attributes" aria-label={label}>{label ? <li className="operator-module-attributes-label" aria-hidden="true">{label}</li> : null}{keys.map((key) => <li key={key}>{attributeLabels[key] ?? key} <span className={`operator-skill-value${previous && previous[key] !== attributes[key] ? " is-changed" : ""}`}>{signed(attributes[key])}</span></li>)}</ul>;
}

function PotentialChoices({ potentials, selected, onSelect }: { potentials: number[]; selected: number; onSelect: (potential: number) => void }) {
  return <fieldset className="operator-module-potentials"><legend className="sr-only">Potencial</legend><div className="operator-stats-choice-list operator-stats-potential-choices">{potentials.map((value) => <button type="button" key={value} className={`operator-stats-light-choice operator-pointer-light${selected === value ? " is-active" : ""}`} aria-label={`Potencial ${value}`} aria-pressed={selected === value} onClick={() => onSelect(selected === value ? 1 : value)} onMouseMove={followPointer}><Image src={`/assets/operator-potential/potential-${value}.png`} alt="" width={36} height={34} unoptimized /></button>)}</div></fieldset>;
}

const sameTalent = (a: ModuleTalentChangeView, b: ModuleTalentChangeView) => a.token === b.token && a.index === b.index && (a.index !== null || a.name === b.name);

/** A talent change; numbers that differ from the same talent at the previous level are highlighted. */
function TalentChange({ change, previous, glossary, view }: { change: ModuleTalentChangeView; previous?: ModuleTalentChangeView; glossary: GlossaryContext; view: OperatorModulesView }) {
  const range = change.rangeId ? view.ranges[change.rangeId] : undefined;
  return <div className="operator-module-talent">
    <h5>{change.name}{change.index === null ? <span className="operator-skill-tag operator-module-tag">Nuevo talento</span> : null}</h5>
    <p className="operator-skill-description"><SkillDescription nodes={previous ? highlightChangedNumbers(change.description, previous.description) : change.description} glossary={glossary} /></p>
    {range ? <div className="operator-skill-range"><RangeGrid grids={range.grids} /></div> : null}
  </div>;
}

function TalentChanges({ changes, previous, glossary, view }: { changes: ModuleTalentChangeView[]; previous: ModuleTalentChangeView[]; glossary: GlossaryContext; view: OperatorModulesView }) {
  return changes.map((change) => <TalentChange key={`${change.token}-${change.index}-${change.name}`} change={change} previous={previous.find((item) => sameTalent(item, change))} glossary={glossary} view={view} />);
}

/** Trait changes as text: a replaced trait, then the parts the module appends. */
function TraitChanges({ changes, glossary, module }: { changes: ModuleTraitChangeView[]; glossary: GlossaryContext; module?: OperatorModuleView }) {
  return changes.flatMap((change, index) => [
    change.override ? <span key={`${index}-override`} className="operator-module-trait-override"><SkillDescription nodes={change.override} glossary={glossary} /></span> : null,
    change.addition ? <span key={`${index}-addition`} className="operator-module-trait-addition"><span className="sr-only">Añadido por el módulo{module ? ` ${formatModuleTypeLabel(module.type)}` : ""}: </span><SkillDescription nodes={change.addition} glossary={glossary} /></span> : null,
  ]);
}

/** Level icon from the game (modules always have levels 1–3), with the number for assistive technology. */
function LevelHeading({ level }: { level: number }) {
  return <h4 className="operator-module-level-heading"><Image src={`/assets/operator-module-stages/stage-${level}.png`} alt="" width={174} height={160} unoptimized /><span className="sr-only">Nivel {level}</span></h4>;
}

/** The three levels side by side, one below another in narrow cards; `render` gets the level and the one before it. */
function LevelColumns({ module, render }: { module: OperatorModuleView; render: (level: ModuleLevelView, previous: ModuleLevelView | undefined) => ReactNode }) {
  return <div className="operator-module-levels">{module.levels.map((level, index) => <section key={level.level} className="operator-module-level" aria-label={`Nivel ${level.level}`}><LevelHeading level={level.level} />{render(level, module.levels[index - 1]) ?? <p className="operator-module-note" aria-label="Sin cambios">—</p>}</section>)}</div>;
}

/** Levels grouped by identical trait changes; levels without any are left out. */
function traitGroups(module: OperatorModuleView): { levels: number[]; changes: ModuleTraitChangeView[] }[] {
  const groups = new Map<string, { levels: number[]; changes: ModuleTraitChangeView[] }>();
  for (const level of module.levels) {
    const changes = level.traits.filter((change) => !change.token);
    if (!changes.length) continue;
    const key = JSON.stringify(changes);
    const group = groups.get(key) ?? { levels: [], changes };
    group.levels.push(level.level);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function levelsLabel(levels: number[]): string {
  return levels.length === 1 ? `Nivel ${levels[0]}` : `Niveles ${levels.slice(0, -1).join(", ")} y ${levels.at(-1)}`;
}

/** Trait at E2 for the potential; the trait has a stage for every operator. */
function baseTraitAt(trait: TraitStageView[], potential: number): TraitStageView | undefined {
  return trait.findLast((stage) => stage.potential <= potential) ?? trait.at(-1);
}

function ModuleTrait({ view, module, potential, glossary }: { view: OperatorModulesView; module: OperatorModuleView; potential: number; glossary: Glossary }) {
  const groups = traitGroups(module);
  if (!groups.length) return null;
  const base = baseTraitAt(view.trait, potential);
  const moduleGlossary = { ...glossary, terms: module.terms };
  return <section className="operator-module-section"><h4>Rasgo</h4>{groups.map((group) => {
    const replaced = group.changes.some((change) => change.override);
    return <div key={group.levels.join("-")} className="operator-module-trait">
      {groups.length > 1 || replaced ? <p className="operator-skill-tags">{groups.length > 1 ? <span className="operator-module-trait-levels">{levelsLabel(group.levels)}</span> : null}{replaced ? <span className="operator-skill-tag operator-module-tag">Rasgo sustituido</span> : null}</p> : null}
      <p className="operator-skill-description">{!replaced && base ? <span className="operator-module-trait-base"><SkillDescription nodes={base.description} glossary={{ ...glossary, terms: view.traitTerms }} /></span> : null}<TraitChanges changes={group.changes} glossary={moduleGlossary} module={module} /></p>
    </div>;
  })}</section>;
}

function ModuleRange({ view, module }: { view: OperatorModulesView; module: OperatorModuleView }) {
  const ranges = [...new Set(module.levels.flatMap((level) => level.rangeId ? [level.rangeId] : []))].flatMap((id) => view.ranges[id] ? [view.ranges[id]] : []);
  if (!ranges.length) return null;
  return <section className="operator-module-section"><h4>Alcance</h4><div className="operator-module-ranges">{ranges.map((range, index) => <div className="operator-skill-range" key={index}><RangeGrid grids={range.grids} /></div>)}</div></section>;
}

/** Summon changes at the potential, leaving out talent changes whose text is the operator's. */
function tokenEffects(level: ModuleLevelView, potential: number) {
  const operatorTalents = talentChangesAt(level.talents.filter((change) => !change.token), potential);
  return {
    attributes: Object.entries(level.tokenAttributes),
    traits: level.traits.filter((change) => change.token),
    talents: talentChangesAt(level.talents.filter((change) => change.token), potential).filter((change) => !operatorTalents.some((item) => item.index === change.index && JSON.stringify(item.description) === JSON.stringify(change.description))),
  };
}

function ModuleToken({ view, module, potential, glossary }: { view: OperatorModulesView; module: OperatorModuleView; potential: number; glossary: GlossaryContext }) {
  const effects = module.levels.map((level) => tokenEffects(level, potential));
  if (!effects.some((item) => item.attributes.length || item.traits.length || item.talents.length)) return null;
  const tokenIds = [...new Set(effects.flatMap((item) => item.attributes.map(([id]) => id)))];
  const names = (tokenIds.length ? tokenIds : Object.keys(view.tokens)).map((id) => view.tokens[id] ?? id);
  return <section className="operator-module-section operator-module-token"><p className="operator-module-section-label">Invocación</p><h4>{names.length ? names.join(" / ") : "Invocación"}</h4><LevelColumns module={module} render={(level, previousLevel) => {
    const current = effects[module.levels.indexOf(level)];
    const previous = previousLevel ? effects[module.levels.indexOf(previousLevel)] : undefined;
    if (!current.attributes.length && !current.traits.length && !current.talents.length) return null;
    return <>
      {current.attributes.map(([id, values]) => <AttributeLine key={id} attributes={values} previous={previous ? previousLevel!.tokenAttributes[id] ?? {} : undefined} label={current.attributes.length > 1 ? view.tokens[id] ?? id : undefined} />)}
      {current.traits.length ? <p className="operator-skill-description"><TraitChanges changes={current.traits} glossary={glossary} /></p> : null}
      <TalentChanges changes={current.talents} previous={previous?.talents ?? []} glossary={glossary} view={view} />
    </>;
  }} /></section>;
}

function modeKey(mode: { gameTag: string | null; mapTag: string | null }): string {
  return `${mode.gameTag ?? ""}|${mode.mapTag ?? ""}`;
}

function modeLabel(mode: { gameTag: string | null; mapTag: string | null }): string {
  return [mode.gameTag ? gameTagLabels[mode.gameTag] ?? mode.gameTag : null, mode.mapTag ? mapTagLabels[mode.mapTag] ?? mode.mapTag : null].filter(Boolean).join(" · ");
}

/** Mode effects of a level at the potential, without those whose text repeats a normal effect of the level; null when none is left. */
function modeEffects(level: ModuleLevelView, key: string, potential: number) {
  const mode = level.modes.find((item) => modeKey(item) === key);
  if (!mode) return null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const normalTalents = talentChangesAt(level.talents, potential);
  const effects = {
    traits: mode.traits.filter((change) => !level.traits.some((item) => same(item, change))),
    talents: talentChangesAt(mode.talents, potential).filter((change) => !normalTalents.some((item) => sameTalent(item, change) && same(item.description, change.description))),
    range: mode.rangeId,
  };
  return effects.traits.length || effects.talents.length || effects.range ? effects : null;
}

/** Effects limited to a game mode, one block per mode, apart from the normal ones. */
function ModuleModes({ view, module, potential, glossary }: { view: OperatorModulesView; module: OperatorModuleView; potential: number; glossary: GlossaryContext }) {
  const modes = [...new Map(module.levels.flatMap((level) => level.modes.filter((mode) => modeEffects(level, modeKey(mode), potential)).map((mode): [string, ModuleModeEffectsView] => [modeKey(mode), mode]))).values()];
  return modes.map((mode) => <section key={modeKey(mode)} className="operator-module-section operator-module-mode"><p className="operator-skill-tags"><span className="operator-skill-tag operator-module-tag">{modeLabel(mode)}</span></p><LevelColumns module={module} render={(level, previousLevel) => {
    const effects = modeEffects(level, modeKey(mode), potential);
    if (!effects) return null;
    const range = effects.range ? view.ranges[effects.range] : undefined;
    return <>
      {effects.traits.length ? <p className="operator-skill-description"><TraitChanges changes={effects.traits} glossary={glossary} /></p> : null}
      <TalentChanges changes={effects.talents} previous={previousLevel ? modeEffects(previousLevel, modeKey(mode), potential)?.talents ?? [] : []} glossary={glossary} view={view} />
      {range ? <div className="operator-skill-range"><RangeGrid grids={range.grids} /></div> : null}
    </>;
  }} /></section>);
}

function ModuleCard({ view, module, glossary }: { view: OperatorModulesView; module: OperatorModuleView; glossary: Glossary }) {
  const potentials = modulePotentials(module);
  const [potential, setPotential] = useState(1);
  const moduleGlossary = { ...glossary, terms: module.terms };
  const code = formatModuleTypeLabel(module.type);
  const nameId = `module-${module.id}-name`;
  return <article className="operator-skill-card operator-module-card" aria-labelledby={nameId}>
    <header className="operator-module-band">
      {module.icon ? <Image className="operator-module-icon" src={module.icon} alt="" width={48} height={48} unoptimized /> : null}
      <div className="operator-skill-title"><p className="operator-module-code">{code}</p><h3 id={nameId}>{module.name}</h3>{module.limitedModality || module.region !== view.region ? <p className="operator-skill-tags">{module.limitedModality ? <span className="operator-skill-tag operator-module-tag">Limited Modality</span> : null}{module.region !== view.region ? <span className="operator-skill-tag operator-module-tag">CN</span> : null}</p> : null}</div>
      {potentials.length ? <PotentialChoices potentials={potentials} selected={potential} onSelect={setPotential} /> : null}
    </header>
    <div className={`operator-module-body${module.art ? " has-art" : ""}`}>
      {module.art ? <Image className="operator-module-art" src={module.art.src} alt={`Ilustración del módulo ${module.name}`} width={module.art.width} height={module.art.height} unoptimized /> : null}
      <LevelColumns module={module} render={(level, previous) => {
        const talents = talentChangesAt(level.talents.filter((change) => !change.token), potential);
        if (!Object.keys(level.attributes).length && !talents.length) return null;
        return <><AttributeLine attributes={level.attributes} previous={previous?.attributes} /><TalentChanges changes={talents} previous={previous ? talentChangesAt(previous.talents.filter((change) => !change.token), potential) : []} glossary={moduleGlossary} view={view} /></>;
      }} />
    </div>
    <ModuleTrait view={view} module={module} potential={potential} glossary={glossary} />
    <ModuleRange view={view} module={module} />
    <ModuleToken view={view} module={module} potential={potential} glossary={moduleGlossary} />
    <ModuleModes view={view} module={module} potential={potential} glossary={moduleGlossary} />
  </article>;
}

/** Every module of the operator, one below another, with the CN switch next to the section title. */
export function OperatorModulesPanel({ view, showCnModules, onShowCnModulesChange }: { view: OperatorModulesView; showCnModules: boolean; onShowCnModulesChange: (show: boolean) => void }) {
  // One open explanation across the cards; the panels are portalled into the modules container.
  const [openId, setOpenId] = useState<string | null>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const modules = visibleModules(view, showCnModules);
  const glossary = { openId, setOpenId, layer };
  return <div className="operator-skills operator-modules" ref={setLayer}>
    <div className="operator-modules-heading"><h2>Módulos</h2>{view.hasCnModules ? <CnModulesToggle checked={showCnModules} onChange={onShowCnModulesChange} /> : null}</div>
    {modules.length ? <div className="operator-skill-cards">{modules.map((module) => <ModuleCard key={module.id} view={view} module={module} glossary={glossary} />)}</div> : <div className="operator-panel-empty"><p>Este operador todavía no tiene módulos en Global.</p></div>}
  </div>;
}
