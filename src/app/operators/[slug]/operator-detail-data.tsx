"use client";

import { useEffect, useId, useState, type ComponentProps, type KeyboardEvent } from "react";
import NextImage from "next/image";
import { Brush, Star } from "lucide-react";
import { getOperatorDisplayName, type OperatorClass, type OperatorRecord } from "../../../game-data/operators";
import type { OperatorArtistCreditGroup } from "../../../game-data/operator-artist-credits";
import { formatNumber, formatPercent } from "../../../game-data/number-format";
import { getOperatorArchetypeName } from "../../../game-data/operator-archetypes";
import { getOperatorClassIconUrl, getOperatorIllustrationAssets, getOperatorSubclassIconUrl } from "../../../game-data/operator-assets";
import type { BiographyReadResult } from "../../../server/db/operator-biography-reader";
import { OperatorTacticalInfo } from "./operator-tactical-info";
import { OperatorSkillsPanel, OperatorTalentsPanel } from "./operator-skills-panel";
import { getConfirmedModuleRanges } from "../../../game-data/operator-tactical";
import { OperatorControlButton } from "../operator-control-button";
import type { OperatorTacticalEntry } from "../../../game-data/operator-tactical";
import type { OperatorSkillsView } from "../../../game-data/operator-skills-view";
import { calculateOperatorStats, displayStatLabels, formatModuleTypeLabel, getRelevantPotentialRanks, getRelevantStatsModules, moduleAttributeLabels, officialPotentialToAppliedRanks, potentialDisplayRows, type OperatorStatsProfile } from "../../../game-data/operator-stats";

function Image(props: ComponentProps<typeof NextImage>) {
  const source = typeof props.src === "string" ? props.src : "";
  const isSmallStaticAsset = source.startsWith("/assets/operator-");
  return (
    <NextImage
      {...props}
      quality={75}
      unoptimized={isSmallStaticAsset || source.includes("/classes/") || source.includes("/ui/subclass/")}
    />
  );
}
const classLabels: Record<OperatorClass, string> = { Guard: "Guard", Vanguard: "Vanguard", Defender: "Defender", Sniper: "Sniper", Caster: "Caster", Specialist: "Specialist", Supporter: "Supporter", Medic: "Medic" };
const tabs = ["Estadísticas", "Habilidades", "Talentos", "Módulos", "Expediente", "Voces"] as const;
type TabLabel = (typeof tabs)[number];

function hasSkills(view: OperatorSkillsView | null): boolean {
  return Boolean(view && (view.skills.length || view.baseSkills.length));
}

const basicBiographyLabels: Readonly<Record<string, string>> = {
  race: "Race",
  height: "Height",
  dateOfBirth: "Date of Birth",
  placeOfBirth: "Place of Birth",
  combatExperience: "Combat Experience",
  gender: "Gender",
  genderAssignment: "Gender Assignment",
  infectionStatus: "Infection Status",
};

function BasicBiography({ biography }: { biography: BiographyReadResult }) {
  if (biography.status !== "found") return null;
  const fields = biography.biography.fields.filter((field) => field.state === "value");
  if (!fields.length) return null;
  return <dl className="operator-basic-biography">{fields.map((field, index) => <div className="operator-basic-biography-field" key={`${field.key}-${index}`}><dt>{basicBiographyLabels[field.key] ?? field.label}</dt><dd>{field.value}</dd></div>)}</dl>;
}
function ProfileIntro({ biography }: { biography: BiographyReadResult }) {
  if (biography.status !== "found" || !biography.biography.profile) return null;
  return <section className="operator-detail-profile" aria-label={biography.biography.profile.storyTitle}>{biography.biography.profile.text.split(/\r?\n+/).map((paragraph, index) => <p key={`${index}-${paragraph}`}>{paragraph}</p>)}</section>;
}
function BiographyPanel({ result, cnOnly }: { result: BiographyReadResult; cnOnly: boolean }) {
  if (result.status === "not-found") return <div className="operator-record-empty"><strong>Expediente no disponible</strong><p>El expediente biográfico todavía no está disponible para este operador.</p></div>;
  const { biography } = result;
  const additionalUnrecognizedLines = biography.unrecognizedLines.filter((line) => !biography.originalText.includes(line));
  return <div className="operator-record-content">{cnOnly ? <p className="operator-detail-status">Biografía procedente del snapshot CN revisado.</p> : null}<h3>{biography.storyTitle}</h3><div className="operator-record-fields">{biography.fields.map((field, index) => <div className="operator-record-field" key={`${field.key}-${index}`}><strong>{field.label}</strong><span>{field.value}</span></div>)}</div><details className="operator-record-original"><summary>Registro original</summary><p>{biography.originalText}</p></details>{additionalUnrecognizedLines.length ? <div className="operator-record-unrecognized"><h4>Líneas no clasificadas</h4>{additionalUnrecognizedLines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div> : null}</div>;
}

function LegacyStatsPanel({ stats }: { stats: OperatorStatsProfile | null }) {
  if (!stats) return <div className="operator-stat-placeholder">No hay estadísticas verificadas para este operador.</div>;
  const favorRows = stats.favorKeyframes.flatMap((frame) => Object.entries(frame.attributes).filter(([, value]) => value !== 0).map(([key, value]) => ({ level: frame.level, label: displayStatLabels[key] ?? key, value })));
  return <div className="operator-stats-content"><p className="operator-stats-source">Valores de keyframe verificados · {stats.region.toUpperCase()}</p>{stats.phases.map((phase) => <section className="operator-stats-phase" key={phase.phase}><h3>Élite {phase.phase} · nivel máximo {phase.maxLevel}</h3><div className="operator-stats-keyframes">{phase.keyframes.map((keyframe) => <div className="operator-stats-keyframe" key={`${phase.phase}-${keyframe.level}`}><strong>Nivel {keyframe.level}</strong><dl>{Object.entries(keyframe.attributes).filter(([key]) => key in displayStatLabels).map(([key, value]) => <div key={key}><dt>{displayStatLabels[key]}</dt><dd>{value}</dd></div>)}</dl></div>)}</div></section>)}<section className="operator-stats-bonuses"><h3>Bonificaciones de confianza</h3>{favorRows.length ? <dl>{favorRows.map((row) => <div key={`${row.level}-${row.label}`}><dt>Confianza {row.level} · {row.label}</dt><dd>+{row.value}</dd></div>)}</dl> : <p>No hay bonificaciones de confianza registradas.</p>}</section><section className="operator-stats-bonuses"><h3>Potenciales</h3>{stats.potentialRanks.some((rank) => rank.effects.length) ? stats.potentialRanks.map((rank) => <div className="operator-stats-potential" key={rank.rank}><strong>Rango {rank.rank + 1}</strong><ul>{potentialDisplayRows(rank.effects).map((row, index) => <li className={row.special ? "is-special" : undefined} key={`${rank.rank}-${index}`}>{row.label}: {row.value}</li>)}</ul></div>) : <p>No hay modificadores de potencial registrados.</p>}</section><section className="operator-stats-bonuses"><h3>Módulos</h3>{stats.modules.length ? stats.modules.map((module) => <div className="operator-stats-potential" key={module.uniEquipId}><strong>{module.name} · {module.uniEquipId}</strong>{module.levels.map((level) => <div key={level.level}><span>Nivel {level.level}: </span>{Object.entries(level.attributes).length ? Object.entries(level.attributes).map(([key, value]) => `${moduleAttributeLabels[key] ?? key} ${value > 0 ? "+" : ""}${value}`).join(" · ") : "Sin bonificaciones numéricas"}{level.specialEffects.length ? <ul>{level.specialEffects.map((effect) => <li className="is-special" key={effect}>Efecto especial disponible</li>)}</ul> : null}</div>)}</div>) : <p>No hay módulos con datos verificados.</p>}</section></div>;
}

void LegacyStatsPanel;

const simplifiedModuleIcons: Readonly<Record<string, string>> = new Proxy({}, {
  get: (_, key: string) => key ? `/assets/operator-modules/${key.toLowerCase()}.png` : undefined,
});


function StatsPanel({ stats }: { stats: OperatorStatsProfile | null }) {
  const initialElite = Math.max((stats?.phases.length ?? 1) - 1, 0);
  const initialPhase = stats?.phases[initialElite];
  const [elite, setElite] = useState(initialElite);
  const [level, setLevel] = useState(initialPhase?.maxLevel ?? 1);
  const [trust, setTrust] = useState(100);
  const [potentialIndex, setPotentialIndex] = useState(0);
  const [moduleId, setModuleId] = useState("none");
  const [moduleLevel, setModuleLevel] = useState<number | null>(null);
  const phase = stats?.phases[elite];
  const selectedModule = stats?.modules.find((module) => module.uniEquipId === moduleId);
  const result = stats && phase ? calculateOperatorStats(stats, { elite, level, trust, potential: potentialIndex, moduleId: moduleId === "none" ? null : moduleId, moduleLevel }) : null;
  if (!stats) return <div className="operator-stat-placeholder">No hay estadísticas verificadas para este operador.</div>;
  const calculatedStats = result ? ["maxHp", "atk", "def", "magicResistance", "cost", "blockCnt", "baseAttackTime", "respawnTime", "attackSpeed"].filter((key) => key in result.calculated) : [];
  const favorRows = stats.favorKeyframes.flatMap((frame) => Object.entries(frame.attributes).filter(([, value]) => value !== 0).map(([key, value]) => ({ level: frame.level, label: displayStatLabels[key] ?? key, value })));
  const potentialRows = stats.potentialRanks.flatMap((rank) => potentialDisplayRows(rank.effects).map((row, index) => ({ ...row, rank: rank.rank + 1, index })));
  return <div className="operator-stats-content"><p className="operator-stats-source">Perfil {stats.region.toUpperCase()} · valores calculados desde keyframes verificados</p><div className="operator-stats-calculator"><div className="operator-stats-attributes"><h3 className="operator-stats-heading">Élite {elite} nivel {result?.level}</h3><section className="operator-stats-card" aria-label="Estadísticas calculadas">{calculatedStats.length ? <dl>{calculatedStats.map((key) => <div key={key}><dt>{key === "attackSpeed" ? "Velocidad de ataque" : displayStatLabels[key] ?? key}</dt><dd>{formatNumber(result!.calculated[key])}</dd></div>)}</dl> : <p>No hay atributos calculables para esta fase.</p>}</section></div><section className="operator-stats-controls" aria-label="Configuración de estadísticas"><label htmlFor="stats-elite">Élite</label><select id="stats-elite" value={elite} onChange={(event) => { const nextElite = Number(event.target.value); const nextPhase = stats.phases[nextElite]; setElite(nextElite); setLevel((current) => Math.min(current, nextPhase.maxLevel)); }}><option value={0}>E0</option>{stats.phases.slice(1).map((item) => <option key={item.phase} value={item.phase}>E{item.phase}</option>)}</select><label htmlFor="stats-level">Nivel <output>{level} / {phase?.maxLevel ?? 1}</output></label><input id="stats-level" type="range" min={1} max={phase?.maxLevel ?? 1} value={level} onChange={(event) => setLevel(Number(event.target.value))} /><label htmlFor="stats-trust">Confianza <output>{trust}</output></label><input id="stats-trust" type="range" min={0} max={100} value={trust} onChange={(event) => setTrust(Number(event.target.value))} /><label htmlFor="stats-potential">Potencial</label><select id="stats-potential" value={potentialIndex} onChange={(event) => setPotentialIndex(Number(event.target.value))}>{Array.from({ length: stats.potentialRanks.length + 1 }, (_, index) => <option key={index} value={index}>Potencial {index + 1}</option>)}</select><label htmlFor="stats-module">Módulo</label><select id="stats-module" value={moduleId} onChange={(event) => { const nextId = event.target.value; const nextModule = stats.modules.find((item) => item.uniEquipId === nextId); setModuleId(nextId); setModuleLevel(nextModule?.levels[0]?.level ?? null); }}><option value="none">Sin módulo</option>{stats.modules.map((item) => <option key={item.uniEquipId} value={item.uniEquipId}>{item.name} · {item.uniEquipId}</option>)}</select>{selectedModule ? <><label htmlFor="stats-module-level">Nivel de módulo</label><select id="stats-module-level" value={moduleLevel ?? ""} onChange={(event) => setModuleLevel(Number(event.target.value))}>{selectedModule.levels.map((item) => <option key={item.level} value={item.level}>Nivel {item.level}</option>)}</select></> : null}</section></div><p className="operator-stats-approximate">Cálculo aproximado: los niveles intermedios usan interpolación provisional, el redondeo sigue pendiente de verificación y los efectos especiales no se convierten a estadísticas numéricas.</p><section className="operator-stats-bonuses"><h3>Bonificaciones de confianza</h3>{favorRows.length ? <dl>{favorRows.map((row) => <div key={`${row.level}-${row.label}`}><dt>Confianza {row.level} · {row.label}</dt><dd>+{row.value}</dd></div>)}</dl> : <p>No hay bonificaciones de confianza registradas.</p>}</section><section className="operator-stats-bonuses"><h3>Potenciales</h3>{potentialRows.length ? <dl>{potentialRows.map((row) => <div key={`${row.rank}-${row.index}`}><dt>Potencial {row.rank} · {row.label}</dt><dd className={row.special ? "is-special" : undefined}>{row.value}</dd></div>)}</dl> : <p>No hay modificadores de potencial registrados.</p>}</section><section className="operator-stats-bonuses"><h3>Módulos</h3>{stats.modules.length ? stats.modules.map((module) => <div className="operator-stats-potential" key={module.uniEquipId}><strong>{module.name} · {module.uniEquipId}</strong>{module.levels.map((item) => <div key={item.level}><span>Nivel {item.level}: </span>{Object.entries(item.attributes).length ? Object.entries(item.attributes).map(([key, value]) => `${moduleAttributeLabels[key] ?? key} ${value > 0 ? "+" : ""}${value}`).join(" · ") : "Sin bonificaciones numéricas"}{item.specialEffects.length ? <ul>{item.specialEffects.map((effect) => <li className="is-special" key={effect}>Efecto especial disponible</li>)}</ul> : null}</div>)}</div>) : <p>No hay módulos con datos verificados.</p>}</section></div>;
}

void StatsPanel;

function VisualStatsPanel({ stats }: { stats: OperatorStatsProfile | null }) {
  const initialElite = Math.max((stats?.phases.length ?? 1) - 1, 0);
  const initialPhase = stats?.phases[initialElite];
  const [elite, setElite] = useState(initialElite);
  const [level, setLevel] = useState(initialPhase?.maxLevel ?? 1);
  const [trust, setTrust] = useState(100);
  const [potential, setPotential] = useState(0);
  const [moduleId, setModuleId] = useState("none");
  const relevantModules = stats ? getRelevantStatsModules(stats) : [];
  const [moduleLevel, setModuleLevel] = useState<number | null>(null);
  const phase = stats?.phases[elite];
  const selectedModule = relevantModules.find((module) => module.uniEquipId === moduleId);
  const tacticalModules = stats ? getConfirmedModuleRanges(stats.operatorId) : [];
  const potentialOptions = stats ? getRelevantPotentialRanks(stats) : [1];
  const result = stats && phase ? calculateOperatorStats(stats, { elite, level, trust, potential: officialPotentialToAppliedRanks(potential), moduleId: selectedModule ? moduleId : null, moduleLevel }) : null;
  useEffect(() => {
    const levelInput = document.getElementById("stats-level");
    const trustInput = document.getElementById("stats-trust");
    const levelProgress = phase && phase.maxLevel > 1 ? ((level - 1) / (phase.maxLevel - 1)) * 100 : 0;
    levelInput?.style.setProperty("--range-progress", `${levelProgress}%`);
    trustInput?.style.setProperty("--range-progress", `${trust}%`);
  }, [level, phase, trust]);
  if (!stats) return <div className="operator-stat-placeholder">No hay estadísticas verificadas para este operador.</div>;
  const statKeys = result ? ["maxHp", "atk", "def", "magicResistance", "cost", "blockCnt", "baseAttackTime", "respawnTime"].filter((key) => key in result.calculated) : [];
  const chooseElite = (nextElite: number) => { if (nextElite === elite) return; setElite(nextElite); setLevel(1); };
  return <div className="operator-stats-content"><div className="operator-stats-calculator"><div className="operator-stats-attributes"><h3 className="operator-stats-heading">Élite {elite} nivel {result?.level}</h3><section className="operator-stats-card" aria-label="Estadísticas calculadas">{statKeys.length ? <dl>{statKeys.map((key) => <div key={key}><dt>{key === "attackSpeed" ? "Velocidad de ataque" : displayStatLabels[key] ?? key}</dt><dd>{formatNumber(result!.calculated[key])}</dd></div>)}</dl> : <p>No hay atributos calculables para esta fase.</p>}</section></div><section className="operator-stats-controls" aria-label="Configuración de estadísticas"><fieldset><div className="operator-stats-choice-list">{stats.phases.map((item) => <OperatorControlButton appearance="naval" type="button" key={item.phase} size="compact" className={`operator-filter-button${elite === item.phase ? " is-active" : ""}`} aria-label={`Élite ${item.phase}`} aria-pressed={elite === item.phase} onClick={() => chooseElite(item.phase)}><Image src={`/assets/operator-elite/elite-${item.phase}.png`} alt="" width={40} height={40} /></OperatorControlButton>)}</div></fieldset><label htmlFor="stats-level">Nivel <output>{level} / {phase?.maxLevel ?? 1}</output></label><input id="stats-level" type="range" min={1} max={phase?.maxLevel ?? 1} value={level} onChange={(event) => setLevel(Number(event.target.value))} /><label htmlFor="stats-trust">Confianza <output>{formatPercent(trust)}</output></label><input id="stats-trust" type="range" min={0} max={100} value={trust} onChange={(event) => setTrust(Number(event.target.value))} /><fieldset><legend className="sr-only">Potencial</legend><div className="operator-stats-choice-list operator-stats-potential-choices">{potentialOptions.map((value) => <OperatorControlButton appearance="naval" type="button" key={value} size="compact" className={`operator-filter-button is-text${potential === value ? " is-active" : ""}`} aria-label={`Potencial ${value}`} aria-pressed={potential === value} onClick={() => setPotential((current) => current === value ? 0 : value)}><Image src={`/assets/operator-potential/potential-${value}.png`} alt="" width={30} height={30} className="operator-potential-icon" /></OperatorControlButton>)}</div></fieldset>{relevantModules.length ? <fieldset><legend>Módulo</legend><div className="operator-stats-choice-list">{relevantModules.map((module) => { const tacticalModule = tacticalModules.find((item) => item.moduleId === module.uniEquipId); const label = module.moduleType || tacticalModule?.moduleName || module.uniEquipId; const icon = module.moduleType ? simplifiedModuleIcons[module.moduleType] : undefined; return <OperatorControlButton appearance="naval" type="button" key={module.uniEquipId} size="compact" className={`operator-filter-button operator-stats-module-button is-text${moduleId === module.uniEquipId ? " is-active" : ""}`} aria-label={`${label}: ${module.name}`} title={module.name} aria-pressed={moduleId === module.uniEquipId} onClick={() => { if (moduleId === module.uniEquipId) { setModuleId("none"); setModuleLevel(null); } else { setModuleId(module.uniEquipId); setModuleLevel(module.levels[0]?.level ?? null); } }}>{icon ? <Image src={icon} alt="" width={24} height={24} /> : null}<span>{formatModuleTypeLabel(label)}</span></OperatorControlButton>; })}</div></fieldset> : null}{selectedModule ? <fieldset><div className="operator-stats-choice-list">{selectedModule.levels.map((item) => <OperatorControlButton appearance="naval" type="button" key={item.level} size="compact" className={`operator-filter-button is-text${moduleLevel === item.level ? " is-active" : ""}`} aria-label={`Etapa de módulo ${item.level}`} aria-pressed={moduleLevel === item.level} onClick={() => setModuleLevel(item.level)}>{item.level}</OperatorControlButton>)}</div></fieldset> : null}</section></div><details className="operator-stats-approximate"><summary>Cálculo aproximado</summary><p>Los niveles intermedios usan interpolación provisional, el redondeo sigue pendiente de verificación y los efectos especiales no se convierten a estadísticas numéricas.</p></details></div>;
}

export function OperatorDetailData({ operator, stats = null, skills = null, biography, tactical, artistCredit }: { operator: OperatorRecord; stats?: OperatorStatsProfile | null; skills?: OperatorSkillsView | null; biography: BiographyReadResult; tactical: OperatorTacticalEntry | null; artistCredit: OperatorArtistCreditGroup[] | null }) {
  const displayName = getOperatorDisplayName(operator);
  const tabId = useId();
  const [selectedTab, setSelectedTab] = useState<TabLabel>("Estadísticas");
  // Skills only exists with combat or base skills and Talents with talents; a tab this operator lacks (state kept across operators) falls back to Stats.
  const visibleTabs = tabs.filter((label) => (label !== "Habilidades" || hasSkills(skills)) && (label !== "Talentos" || Boolean(skills?.talents.length)));
  const activeTab = visibleTabs.includes(selectedTab) ? selectedTab : "Estadísticas";
  const illustrationAssets = getOperatorIllustrationAssets(operator.id);
  const availableIllustrationCount = Number(Boolean(illustrationAssets?.base)) + Number(Boolean(illustrationAssets?.elite2));
  const [artVariant, setArtVariant] = useState<"base" | "elite2">(illustrationAssets?.base ? "base" : "elite2");
  const [illustrationFailed, setIllustrationFailed] = useState(false);
  const [loadedVariants, setLoadedVariants] = useState<{ base: boolean; elite2: boolean }>({ base: false, elite2: false });
  const [visibleVariants, setVisibleVariants] = useState<{ base: boolean; elite2: boolean }>({ base: false, elite2: false });
  const [classIconFailed, setClassIconFailed] = useState(false);
  const [subclassIconFailed, setSubclassIconFailed] = useState(false);
  const classIconUrl = getOperatorClassIconUrl(operator.class);
  const subclassIconUrl = getOperatorSubclassIconUrl(operator.subClassId);
  const displayedVariant = artVariant === "elite2" && !loadedVariants.elite2 ? "base" : artVariant;
  const illustrationUrl = illustrationAssets?.[displayedVariant];
  const pendingElite2Url = artVariant === "elite2" && !loadedVariants.elite2 ? illustrationAssets?.elite2 : undefined;
  const isElite2Transitioning = artVariant === "elite2" && !visibleVariants.elite2;
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = visibleTabs.indexOf(activeTab);
    const next = visibleTabs[event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length];
    setSelectedTab(next);
    document.getElementById(`${tabId}-tab-${tabs.indexOf(next)}`)?.focus();
  };
  const emptyPanel = (title: string, message: string) => <div className="operator-panel-empty"><strong>{title}</strong><p>{message}</p></div>;
  return <>
    <header className="operator-detail-header">
      <div className="operator-detail-identity"><h1>{displayName}</h1><div className="operator-detail-meta-frame"><div className="operator-detail-meta-rule" aria-hidden="true"><span className="operator-detail-meta-rule-start" /><svg viewBox="0 0 14 14"><path d="M0 0 L14 14" /></svg><span className="operator-detail-meta-rule-end" /></div><p className="operator-detail-meta"><span className="operator-detail-meta-group operator-detail-rarity" aria-label={`Rareza: ${operator.rarity} estrellas`}><span className="operator-detail-rarity-stars" aria-hidden="true">{Array.from({ length: operator.rarity }, (_, index) => <Star key={index} size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />)}</span></span><span className="operator-detail-meta-group operator-detail-class"><span className="operator-detail-meta-icon" aria-hidden="true">{!classIconFailed ? <Image src={classIconUrl} alt="" width={24} height={24} onError={() => setClassIconFailed(true)} /> : null}</span><span className="operator-detail-meta-text"><span className="operator-detail-meta-label">CLASE</span><strong>{classLabels[operator.class]}</strong></span></span>{operator.subClassId ? <span className="operator-detail-meta-group operator-detail-subclass"><span className="operator-detail-meta-icon" aria-hidden="true">{subclassIconUrl && !subclassIconFailed ? <Image src={subclassIconUrl} alt="" width={22} height={22} onError={() => setSubclassIconFailed(true)} /> : null}</span><span className="operator-detail-meta-text"><span className="operator-detail-meta-label">ARQUETIPO</span><strong className="operator-detail-archetype">{getOperatorArchetypeName(operator.subClassId)}</strong></span></span> : null}</p></div>{operator.cnOnly ? <aside className="operator-cn-availability" aria-label="Disponibilidad del operador"><strong>Operador disponible únicamente en CN</strong><p>Por el momento, la información de este operador solo está disponible en chino. La actualizaremos cuando llegue a la versión Global de Arknights.</p></aside> : null}</div>
      <div className="operator-detail-columns"><div className="operator-detail-left"><ProfileIntro biography={biography} /><div className="operator-detail-info-grid"><BasicBiography biography={biography} /><OperatorTacticalInfo entry={tactical} /></div></div><div className="operator-detail-art-column"><div className={`operator-detail-art${isElite2Transitioning ? " is-loading" : ""}`} role="img" aria-busy={isElite2Transitioning} aria-label={`Ilustración ${pendingElite2Url ? "E2 en carga" : displayedVariant === "base" ? "E0 / E1" : "E2"} de ${displayName}${illustrationUrl && !illustrationFailed ? "" : " no disponible"}`}>{pendingElite2Url ? <Image className="operator-detail-illustration-preload" src={pendingElite2Url} alt="" width={1} height={1} aria-hidden="true" onLoad={() => setLoadedVariants((current) => ({ ...current, elite2: true }))} onError={() => { setIllustrationFailed(true); setArtVariant("base"); }} /> : null}{illustrationUrl && !illustrationFailed ? <Image className={`operator-detail-illustration${displayedVariant === "elite2" ? " is-elite2" : ""}`} src={illustrationUrl} alt={`Ilustración ${displayedVariant === "base" ? "E0 / E1" : "E2"} de ${displayName}`} fill sizes="(max-width: 720px) calc(100vw - 2.5rem), min(42vw, 32rem)" priority={displayedVariant === "base"} onLoad={() => setVisibleVariants((current) => ({ ...current, [displayedVariant]: true }))} onError={() => setIllustrationFailed(true)} /> : <div className="operator-art-placeholder"><span aria-hidden="true">{displayName}</span><p>Ilustración {displayedVariant === "base" ? "E0 / E1" : "E2"} no disponible</p></div>}</div>{artistCredit ? <div className="operator-art-credit" aria-label="Crédito del ilustrador"><Brush size={16} strokeWidth={1.75} aria-hidden="true" /><strong className="operator-art-credit-groups">{artistCredit.map((group) => <span className="operator-art-credit-group" key={group.label ?? "primary"}>{group.label ? <span className="operator-art-credit-label">{group.label}:</span> : null}<span className="operator-art-credit-name">{group.artists.join(" & ")}</span></span>)}</strong></div> : null}{availableIllustrationCount > 1 ? <div className="operator-art-choices" role="group" aria-label="Variante de ilustración"><OperatorControlButton type="button" size="compact" className={`operator-art-choice${artVariant === "base" ? " is-active" : ""}`} aria-pressed={artVariant === "base"} onClick={() => { setIllustrationFailed(false); setArtVariant("base"); }}>E0 / E1</OperatorControlButton>{illustrationAssets?.elite2 ? <OperatorControlButton type="button" size="compact" className={`operator-art-choice${artVariant === "elite2" ? " is-active" : ""}`} aria-pressed={artVariant === "elite2"} onClick={() => { setIllustrationFailed(false); setArtVariant("elite2"); }}>E2</OperatorControlButton> : null}</div> : null}</div></div>
    </header>
    <div className="operator-profile-tabs"><div className="operator-tab-list" role="tablist" aria-label={`Secciones de ${displayName}`}>{visibleTabs.map((label) => <button key={label} id={`${tabId}-tab-${tabs.indexOf(label)}`} type="button" role="tab" className="operator-tab" aria-selected={activeTab === label} aria-controls={`${tabId}-panel-${tabs.indexOf(label)}`} tabIndex={activeTab === label ? 0 : -1} onClick={() => setSelectedTab(label)} onKeyDown={moveTab} onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`); event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`); }}><span className="operator-tab-label">{label}</span><span className="operator-tab-indicator" aria-hidden="true" /></button>)}<span className="operator-tab-extension" aria-hidden="true" /></div><section id={`${tabId}-panel-${tabs.indexOf(activeTab)}`} className="operator-tab-panel" role="tabpanel" aria-labelledby={`${tabId}-tab-${tabs.indexOf(activeTab)}`} tabIndex={0}>
      {activeTab === "Estadísticas" ? <div className="operator-panel-layout"><div><VisualStatsPanel stats={stats} /></div></div> : null}
      {activeTab === "Habilidades" ? <div className="operator-skills-tab" data-skills-status={skills?.status ?? "unavailable"}>{skills?.skills.length ? <h2>Habilidades de combate</h2> : null}<OperatorSkillsPanel view={skills} tactical={tactical} /></div> : null}
      {activeTab === "Talentos" && skills ? <div className="operator-skills-tab"><h2>Talentos</h2><OperatorTalentsPanel view={skills} /></div> : null}
      {activeTab === "Módulos" ? <div><h2>Módulos</h2><div className="operator-module-placeholder"><span>Selector de módulo y nivel</span><span>Comparación de niveles y efectos pendiente de importación</span></div></div> : null}
      {activeTab === "Expediente" ? <div><h2>Expediente</h2><BiographyPanel result={biography} cnOnly={operator.cnOnly} /></div> : null}
      {activeTab === "Voces" ? <div><h2>Voces</h2>{emptyPanel("Lista de líneas", "Las líneas, transcripciones y audios todavía no están importados.")}</div> : null}
    </section></div>
  </>;
}
