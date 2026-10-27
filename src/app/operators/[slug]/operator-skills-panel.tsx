"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Play, Timer, Zap, type LucideIcon } from "lucide-react";
import { formatNumber } from "../../../game-data/number-format";
import { getTacticalRangeDefinition, type OperatorTacticalEntry, type TacticalRangeDefinition } from "../../../game-data/operator-tactical";
import type { BaseSkillStageView, OperatorBaseSkillView, OperatorSkillsView, OperatorSkillView, SkillLevelView, SkillTermView } from "../../../game-data/operator-skills-view";
import type { SkillUnlock } from "../../../game-data/operator-skills";
import type { SkillDescriptionNode, SkillDescriptionTone } from "../../../game-data/skill-description";
import { OperatorControlButton } from "../operator-control-button";
import { RangeGrid } from "../range-grid";

const recoveryLabels: Record<OperatorSkillView["spRecovery"], string | null> = { time: "Automática", attack: "Ofensiva", defense: "Defensiva", none: null, unknown: null };
const activationLabels: Record<OperatorSkillView["activation"], string | null> = { manual: "Manual", auto: "Automática", passive: "Pasiva", unknown: null };

type ValueCell = { label: string; icon: LucideIcon; text: string };

/** Passive skills have no SP, and a missing value is shown as a dash. */
function spValue(skill: OperatorSkillView, value: number | null): string {
  return skill.spRecovery === "none" || value === null ? "—" : formatNumber(value);
}

function durationValue(level: SkillLevelView): string {
  switch (level.durationKind) {
    case "seconds": return `${formatNumber(level.duration!)} s`;
    case "instant": return "Instantánea";
    case "unlimited": return "Sin límite";
    case "ammo": return "Según munición";
    default: return "—";
  }
}

function levelValues(skill: OperatorSkillView, level: SkillLevelView): ValueCell[] {
  return [
    { label: "SP inicial", icon: Play, text: spValue(skill, level.initialSp) },
    { label: "Coste de SP", icon: Zap, text: spValue(skill, level.spCost) },
    { label: "Duración", icon: Timer, text: durationValue(level) },
  ];
}

/** Glossary of the description being rendered; without it (inside an explanation) terms keep their style but open nothing. */
type GlossaryContext = { terms: Record<string, SkillTermView>; openId: string | null; setOpenId: (id: string | null) => void; layer: HTMLElement | null };

function SkillDescription({ nodes, glossary }: { nodes: readonly SkillDescriptionNode[]; glossary?: GlossaryContext }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text": return node.text;
      case "lineBreak": return <br key={index} />;
      case "value": return <span key={index} className="operator-skill-value">{node.display}</span>;
      case "unknownMarker": return <span key={index} className="operator-skill-unknown">{node.text}</span>;
      default: {
        const term = node.termId ? glossary?.terms[node.termId] : undefined;
        if (glossary && term) return <GlossaryTerm key={index} termId={node.termId!} term={term} tone={node.tone} glossary={glossary}><SkillDescription nodes={node.children} /></GlossaryTerm>;
        return <span key={index} className={`operator-skill-tone is-${node.tone}${node.termId ? " is-term" : ""}`} data-term-id={node.termId}><SkillDescription nodes={node.children} glossary={glossary} /></span>;
      }
    }
  });
}

// Matches the 1rem side gutter of the panel width in CSS.
const viewportGutter = 16;
const panelGap = 6;

/** Below the term, or above it when it does not fit, always inside the viewport. */
function placePanel(trigger: HTMLElement, panel: HTMLElement) {
  const anchor = trigger.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  const below = anchor.bottom + panelGap;
  const above = anchor.top - panelGap - height;
  const top = below + height <= viewportHeight - viewportGutter || above < viewportGutter ? Math.max(viewportGutter, Math.min(below, viewportHeight - viewportGutter - height)) : above;
  panel.style.top = `${top}px`;
  panel.style.left = `${Math.max(viewportGutter, Math.min(anchor.left, viewportWidth - viewportGutter - width))}px`;
}

/** A term that toggles its explanation; the panel is portalled out of the card, whose container query would trap `position: fixed`. */
function GlossaryTerm({ termId, term, tone, glossary, children }: { termId: string; term: SkillTermView; tone: SkillDescriptionTone; glossary: GlossaryContext; children: ReactNode }) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { setOpenId, layer } = glossary;
  const open = glossary.openId === id && layer !== null;
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!open || !trigger || !panel) return;
    const place = () => placePanel(trigger, panel);
    place();
    panel.focus({ preventScroll: true });
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.contains(event.target) && !panel.contains(event.target)) setOpenId(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenId(null);
      trigger.focus();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpenId]);
  // Tabbing away closes it; a click elsewhere is handled by the pointer listener (relatedTarget is null then).
  const closeOnFocusAway = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next) && next !== triggerRef.current) setOpenId(null);
  };
  return <>
    <button ref={triggerRef} type="button" className={`operator-skill-tone is-${tone} is-term`} data-term-id={termId} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} onClick={() => setOpenId(open ? null : id)}>{children}</button>
    {open ? createPortal(<div ref={panelRef} id={`${id}-panel`} className="operator-glossary-panel" role="dialog" aria-labelledby={`${id}-name`} tabIndex={-1} onBlur={closeOnFocusAway}><strong className="operator-glossary-name" id={`${id}-name`}>{term.name}</strong><p className="operator-glossary-text"><SkillDescription nodes={term.description} /></p></div>, layer) : null}
  </>;
}

function SkillIcon({ skill }: { skill: OperatorSkillView }) {
  const [failed, setFailed] = useState(false);
  if (!skill.icon || failed) return <span className="operator-skill-icon is-fallback" aria-hidden="true" data-testid="skill-icon-fallback">S{skill.slot}</span>;
  return <Image className="operator-skill-icon" src={skill.icon.src} alt="" width={64} height={64} unoptimized onError={() => setFailed(true)} />;
}

function SkillLevelSelector({ skill, selected, onSelect }: { skill: OperatorSkillView; selected: number; onSelect: (index: number) => void }) {
  const id = useId();
  const groups = (["level", "mastery"] as const).map((group) => skill.levels.filter((level) => level.group === group)).filter((levels) => levels.length);
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = skill.levels.length - 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowRight" || event.key === "ArrowDown" ? (selected + 1) % (last + 1) : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (selected + last) % (last + 1) : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return <div className="operator-skill-levels"><span className="operator-skill-levels-label" aria-hidden="true">Nv.</span><div className="operator-skill-level-groups" role="radiogroup" aria-label={`Nivel de S${skill.slot}`}>{groups.map((levels) => <div className="operator-stats-choice-list operator-skill-level-group" key={levels[0].group}>{levels.map((level) => <OperatorControlButton appearance="naval" size="compact" type="button" key={level.index} id={`${id}-${level.index}`} role="radio" aria-checked={level.index === selected} aria-label={level.icon ? level.label : undefined} tabIndex={level.index === selected ? 0 : -1} className={`operator-filter-button${level.icon ? "" : " is-text"}${level.index === selected ? " is-active" : ""}`} onClick={() => onSelect(level.index)} onKeyDown={move}>{level.icon ? <Image src={level.icon.src} alt="" width={26} height={24} unoptimized /> : level.label}</OperatorControlButton>)}</div>)}</div></div>;
}

function SkillLevelsTable({ skill, id }: { skill: OperatorSkillView; id: string }) {
  return <div className="operator-skill-table-scroll" id={id} role="region" aria-label={`Valores por nivel de S${skill.slot}`} tabIndex={0}><table className="operator-skill-table"><caption className="sr-only">Valores por nivel de S{skill.slot}</caption><thead><tr><th scope="col">Nivel</th><th scope="col">SP inicial</th><th scope="col">Coste de SP</th><th scope="col">Duración</th></tr></thead><tbody>{skill.levels.map((level) => <tr key={level.index}><th scope="row">{level.label}</th>{levelValues(skill, level).map((value) => <td key={value.label}>{value.text}</td>)}</tr>)}</tbody></table></div>;
}

type OperatorRange = TacticalRangeDefinition | null;

/** The skill's own range, otherwise the operator range; neither has a heading. */
function SkillRange({ view, level, operatorRange }: { view: OperatorSkillsView; level: SkillLevelView; operatorRange: OperatorRange }) {
  const own = level.rangeId ? view.ranges[level.rangeId] : undefined;
  if (own) return <div className="operator-skill-range"><RangeGrid grids={own.grids} /></div>;
  return operatorRange ? <div className="operator-skill-range"><RangeGrid grids={operatorRange.grids} /></div> : null;
}

function SkillCard({ view, skill, operatorRange, glossary }: { view: OperatorSkillsView; skill: OperatorSkillView; operatorRange: OperatorRange; glossary: Omit<GlossaryContext, "terms"> }) {
  const id = useId();
  const [selected, setSelected] = useState(skill.defaultLevelIndex);
  const [expanded, setExpanded] = useState(false);
  const level = skill.levels[selected];
  const recovery = recoveryLabels[skill.spRecovery];
  const activation = activationLabels[skill.activation];
  const values = levelValues(skill, level);
  return <article className="operator-skill-card" aria-labelledby={`${id}-name`}>
    <header className="operator-skill-header"><SkillIcon skill={skill} /><div className="operator-skill-title"><h3 id={`${id}-name`}>{level.name}</h3><p className="operator-skill-tags">{recovery ? <span className={`operator-skill-tag is-recovery-${skill.spRecovery}`}>Recuperación {recovery.toLowerCase()}</span> : null}{activation ? <span className="operator-skill-tag is-activation"><span className="sr-only">Activación </span>{activation}</span> : null}</p></div><span className="operator-tactical-tag operator-skill-slot">S{skill.slot}</span></header>
    <SkillLevelSelector skill={skill} selected={selected} onSelect={setSelected} />
    <div className="operator-skill-data"><dl className="operator-skill-values">{values.map((value) => <div key={value.label}><dt><value.icon size={16} strokeWidth={2} aria-hidden="true" />{value.label}</dt><dd>{value.text}</dd></div>)}</dl><SkillRange view={view} level={level} operatorRange={operatorRange} /></div>
    <p className="operator-skill-description"><SkillDescription nodes={level.description} glossary={{ ...glossary, terms: skill.terms }} /></p>
    <div className="operator-skill-levels-toggle"><OperatorControlButton appearance="naval" size="compact" type="button" aria-expanded={expanded} aria-controls={`${id}-table`} onClick={() => setExpanded((current) => !current)}>{expanded ? "Ocultar niveles" : "Mostrar niveles"}</OperatorControlButton>{expanded ? <SkillLevelsTable skill={skill} id={`${id}-table`} /> : null}</div>
  </article>;
}

/** Operator range at the highest promotion that has one, from the same tactical data as the operator summary. */
function operatorRangeOf(tactical: OperatorTacticalEntry | null): OperatorRange {
  for (const phase of [...(tactical?.phases ?? [])].reverse()) {
    const definition = getTacticalRangeDefinition(phase.rangeKey);
    if (definition) return definition;
  }
  return null;
}

// Room names as in the region data, like S1/S2/S3; HIRE is "Office" in the data and "HR Office" in the descriptions.
const roomNames: Record<string, { name: string; lang?: string }> = {
  CONTROL: { name: "Control Center" }, POWER: { name: "Power Plant" }, MANUFACTURE: { name: "Factory" }, TRADING: { name: "Trading Post" }, WORKSHOP: { name: "Workshop" },
  TRAINING: { name: "Training Room" }, DORMITORY: { name: "Dormitory" }, HIRE: { name: "HR Office" }, MEETING: { name: "Reception Room" }, RECYCLE: { name: "回收站", lang: "zh-Hans" },
};

/** "E2", or "E0 · Nv. 30" when a level above 1 is also required. */
function unlockLabel(unlock: SkillUnlock): string {
  return unlock.level > 1 ? `E${unlock.elite} · Nv. ${unlock.level}` : `E${unlock.elite}`;
}

/** WCAG relative luminance of a #rrggbb color; null for anything else. */
function luminance(color: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// --color-abyss, the dark text of the tags.
const darkTextLuminance = luminance("#080f18")!;

/** Dark text on the game's room color, or white when that color is too dark for it (Control Center, Training Room, Trading Post, HR Office). */
function roomTagStyle(color: string): { className: string; style?: CSSProperties } {
  const background = luminance(color);
  if (background === null) return { className: "is-dark-text" };
  const dark = (background + 0.05) / (darkTextLuminance + 0.05) >= 1.05 / (background + 0.05);
  return { className: dark ? "is-dark-text" : "is-light-text", style: { "--base-room-color": color } as CSSProperties };
}

function RoomTag({ stage }: { stage: BaseSkillStageView }) {
  const room = roomNames[stage.room] ?? { name: stage.room };
  const { className, style } = roomTagStyle(stage.color);
  return <span className={`operator-skill-tag operator-base-skill-room ${className}`} style={style}><span className="sr-only">Sala </span>{stage.roomIcon ? <Image src={stage.roomIcon.src} alt="" width={stage.roomIcon.width} height={stage.roomIcon.height} unoptimized /> : null}<span lang={room.lang}>{room.name}</span></span>;
}

function BaseSkillIcon({ stage, slot }: { stage: BaseSkillStageView; slot: number }) {
  const [failed, setFailed] = useState(false);
  if (!stage.icon || failed) return <span className="operator-skill-icon is-fallback" aria-hidden="true" data-testid="skill-icon-fallback">B{slot}</span>;
  return <Image className="operator-skill-icon" src={stage.icon.src} alt="" width={stage.icon.width} height={stage.icon.height} unoptimized onError={() => setFailed(true)} />;
}

/** Unlock of each stage as a radio group, with the same keys as the level selector; a single stage keeps a fixed tag. */
function BaseStageSelector({ slot, selected, onSelect }: { slot: OperatorBaseSkillView; selected: number; onSelect: (index: number) => void }) {
  const id = useId();
  if (slot.stages.length === 1) return <span className="operator-tactical-tag operator-skill-slot"><span className="sr-only">Desbloqueo </span>{unlockLabel(slot.stages[0].unlock)}</span>;
  const last = slot.stages.length - 1;
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === "Home" ? 0 : event.key === "End" ? last : event.key === "ArrowRight" || event.key === "ArrowDown" ? (selected + 1) % (last + 1) : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (selected + last) % (last + 1) : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return <div className="operator-base-skill-stage-selector" role="radiogroup" aria-label={`Promoción de la habilidad de base ${slot.slot}`}>{slot.stages.map((stage, index) => <button type="button" key={stage.buffId} id={`${id}-${index}`} role="radio" aria-checked={index === selected} tabIndex={index === selected ? 0 : -1} className={`operator-tactical-tag operator-skill-slot${index === selected ? " is-active" : ""}`} onClick={() => onSelect(index)} onKeyDown={move} onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`); event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`); }}>{unlockLabel(stage.unlock)}</button>)}</div>;
}

/** One slot showing one stage at a time, the highest by default; each stage replaces the previous one. */
function BaseSkillCard({ slot, glossary }: { slot: OperatorBaseSkillView; glossary: Omit<GlossaryContext, "terms"> }) {
  const id = useId();
  const [selected, setSelected] = useState(slot.stages.length - 1);
  const stage = slot.stages[selected];
  return <article className="operator-skill-card operator-base-skill-card" aria-labelledby={`${id}-name`}>
    <header className="operator-skill-header"><BaseSkillIcon key={stage.buffId} stage={stage} slot={slot.slot} /><div className="operator-skill-title"><h3 id={`${id}-name`}>{stage.name}</h3><p className="operator-skill-tags"><RoomTag stage={stage} /></p></div><BaseStageSelector slot={slot} selected={selected} onSelect={setSelected} /></header>
    <p className="operator-skill-description"><SkillDescription nodes={stage.description} glossary={{ ...glossary, terms: slot.terms }} /></p>
  </article>;
}

export function OperatorSkillsPanel({ view, tactical }: { view: OperatorSkillsView | null; tactical: OperatorTacticalEntry | null }) {
  // One open explanation across every card, combat and base; the panels are portalled into the skills container.
  const [openId, setOpenId] = useState<string | null>(null);
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const baseHeadingId = useId();
  if (!view) return <div className="operator-panel-empty"><strong>Habilidades no disponibles</strong><p>No hay datos de habilidades verificados para este operador.</p></div>;
  const glossary = { openId, setOpenId, layer };
  const operatorRange = operatorRangeOf(tactical);
  return <div className="operator-skills" ref={setLayer}>
    {view.status === "empty" || !view.skills.length
      ? <div className="operator-panel-empty"><p>Este operador no tiene habilidades.</p></div>
      : <div className="operator-skill-cards">{view.skills.map((skill) => <SkillCard key={skill.skillId} view={view} skill={skill} operatorRange={operatorRange} glossary={glossary} />)}</div>}
    {view.baseSkills.length ? <section className="operator-base-skills" aria-labelledby={baseHeadingId}>
      <h2 id={baseHeadingId}>Habilidades de base</h2>
      <div className="operator-skill-cards">{view.baseSkills.map((slot) => <BaseSkillCard key={slot.slot} slot={slot} glossary={glossary} />)}</div>
    </section> : null}
  </div>;
}
