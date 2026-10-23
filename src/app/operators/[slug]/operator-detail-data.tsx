"use client";

import { useId, useState, type ComponentProps, type KeyboardEvent } from "react";
import NextImage from "next/image";
import { Brush, Star } from "lucide-react";
import { getOperatorDisplayName, type OperatorClass, type OperatorRecord } from "../../../game-data/operators";
import type { OperatorArtistCreditGroup } from "../../../game-data/operator-artist-credits";
import { getOperatorArchetypeName } from "../../../game-data/operator-archetypes";
import { getOperatorClassIconUrl, getOperatorIllustrationAssets, getOperatorSubclassIconUrl } from "../../../game-data/operator-assets";
import type { BiographyReadResult } from "../../../server/db/operator-biography-reader";
import { OperatorTacticalInfo } from "./operator-tactical-info";
import { OperatorControlButton } from "../operator-control-button";
import type { OperatorTacticalEntry } from "../../../game-data/operator-tactical";

function Image(props: ComponentProps<typeof NextImage>) {
  return <NextImage {...props} quality={75} unoptimized={typeof props.src === "string" && props.src.includes("/ui/subclass/")} />;
}
const classLabels: Record<OperatorClass, string> = { Guard: "Guard", Vanguard: "Vanguard", Defender: "Defender", Sniper: "Sniper", Caster: "Caster", Specialist: "Specialist", Supporter: "Supporter", Medic: "Medic" };
const tabs = ["Estadísticas", "Habilidades", "Talentos", "Módulos", "Expediente", "Voces"] as const;

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

export function OperatorDetailData({ operator, biography, tactical, artistCredit }: { operator: OperatorRecord; biography: BiographyReadResult; tactical: OperatorTacticalEntry | null; artistCredit: OperatorArtistCreditGroup[] | null }) {
  const displayName = getOperatorDisplayName(operator);
  const tabId = useId();
  const [activeTab, setActiveTab] = useState(0);
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
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (activeTab + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setActiveTab(next);
    document.getElementById(`${tabId}-tab-${next}`)?.focus();
  };
  const emptyPanel = (title: string, message: string) => <div className="operator-panel-empty"><strong>{title}</strong><p>{message}</p></div>;
  return <>
    <header className="operator-detail-header">
      <div className="operator-detail-identity"><h1>{displayName}</h1><div className="operator-detail-meta-frame"><div className="operator-detail-meta-rule" aria-hidden="true"><span className="operator-detail-meta-rule-start" /><svg viewBox="0 0 14 14"><path d="M0 0 L14 14" /></svg><span className="operator-detail-meta-rule-end" /></div><p className="operator-detail-meta"><span className="operator-detail-meta-group operator-detail-rarity" aria-label={`Rareza: ${operator.rarity} estrellas`}><span className="operator-detail-rarity-stars" aria-hidden="true">{Array.from({ length: operator.rarity }, (_, index) => <Star key={index} size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />)}</span></span><span className="operator-detail-meta-group operator-detail-class"><span className="operator-detail-meta-icon" aria-hidden="true">{!classIconFailed ? <Image src={classIconUrl} alt="" width={24} height={24} onError={() => setClassIconFailed(true)} /> : null}</span><span className="operator-detail-meta-text"><span className="operator-detail-meta-label">CLASE</span><strong>{classLabels[operator.class]}</strong></span></span>{operator.subClassId ? <span className="operator-detail-meta-group operator-detail-subclass"><span className="operator-detail-meta-icon" aria-hidden="true">{subclassIconUrl && !subclassIconFailed ? <Image src={subclassIconUrl} alt="" width={22} height={22} onError={() => setSubclassIconFailed(true)} /> : null}</span><span className="operator-detail-meta-text"><span className="operator-detail-meta-label">ARQUETIPO</span><strong className="operator-detail-archetype">{getOperatorArchetypeName(operator.subClassId)}</strong></span></span> : null}</p></div>{operator.cnOnly ? <aside className="operator-cn-availability" aria-label="Disponibilidad del operador"><strong>Operador disponible únicamente en CN</strong><p>Por el momento, la información de este operador solo está disponible en chino. La actualizaremos cuando llegue a la versión Global de Arknights.</p></aside> : null}</div>
      <div className="operator-detail-columns"><div className="operator-detail-left"><ProfileIntro biography={biography} /><div className="operator-detail-info-grid"><BasicBiography biography={biography} /><OperatorTacticalInfo entry={tactical} /></div></div><div className="operator-detail-art-column"><div className={`operator-detail-art${isElite2Transitioning ? " is-loading" : ""}`} role="img" aria-busy={isElite2Transitioning} aria-label={`Ilustración ${pendingElite2Url ? "E2 en carga" : displayedVariant === "base" ? "E0 / E1" : "E2"} de ${displayName}${illustrationUrl && !illustrationFailed ? "" : " no disponible"}`}>{pendingElite2Url ? <Image className="operator-detail-illustration-preload" src={pendingElite2Url} alt="" width={1} height={1} aria-hidden="true" onLoad={() => setLoadedVariants((current) => ({ ...current, elite2: true }))} onError={() => { setIllustrationFailed(true); setArtVariant("base"); }} /> : null}{illustrationUrl && !illustrationFailed ? <Image className={`operator-detail-illustration${displayedVariant === "elite2" ? " is-elite2" : ""}`} src={illustrationUrl} alt={`Ilustración ${displayedVariant === "base" ? "E0 / E1" : "E2"} de ${displayName}`} fill sizes="(max-width: 720px) calc(100vw - 2.5rem), min(42vw, 32rem)" priority={displayedVariant === "base"} onLoad={() => setVisibleVariants((current) => ({ ...current, [displayedVariant]: true }))} onError={() => setIllustrationFailed(true)} /> : <div className="operator-art-placeholder"><span aria-hidden="true">{displayName}</span><p>Ilustración {displayedVariant === "base" ? "E0 / E1" : "E2"} no disponible</p></div>}</div>{artistCredit ? <div className="operator-art-credit" aria-label="Crédito del ilustrador"><Brush size={16} strokeWidth={1.75} aria-hidden="true" /><strong className="operator-art-credit-groups">{artistCredit.map((group) => <span className="operator-art-credit-group" key={group.label ?? "primary"}>{group.label ? <span className="operator-art-credit-label">{group.label}:</span> : null}<span className="operator-art-credit-name">{group.artists.join(" & ")}</span></span>)}</strong></div> : null}{availableIllustrationCount > 1 ? <div className="operator-art-choices" role="group" aria-label="Variante de ilustración"><OperatorControlButton type="button" size="compact" className={`operator-art-choice${artVariant === "base" ? " is-active" : ""}`} aria-pressed={artVariant === "base"} onClick={() => { setIllustrationFailed(false); setArtVariant("base"); }}>E0 / E1</OperatorControlButton>{illustrationAssets?.elite2 ? <OperatorControlButton type="button" size="compact" className={`operator-art-choice${artVariant === "elite2" ? " is-active" : ""}`} aria-pressed={artVariant === "elite2"} onClick={() => { setIllustrationFailed(false); setArtVariant("elite2"); }}>E2</OperatorControlButton> : null}</div> : null}</div></div>
    </header>
    <div className="operator-profile-tabs"><div className="operator-tab-list" role="tablist" aria-label={`Secciones de ${displayName}`}>{tabs.map((label, index) => <button key={label} id={`${tabId}-tab-${index}`} type="button" role="tab" className="operator-tab" aria-selected={activeTab === index} aria-controls={`${tabId}-panel-${index}`} tabIndex={activeTab === index ? 0 : -1} onClick={() => setActiveTab(index)} onKeyDown={moveTab}>{label}</button>)}</div><section id={`${tabId}-panel-${activeTab}`} className="operator-tab-panel" role="tabpanel" aria-labelledby={`${tabId}-tab-${activeTab}`} tabIndex={0}>
      {activeTab === 0 ? <div className="operator-panel-layout"><div><h2>Estadísticas</h2><div className="operator-stat-placeholder">Tabla uniforme de atributos pendiente de importación</div></div><div><h2>Configuración</h2><div className="operator-config-placeholder">Controles de élite, nivel, confianza, potencial y módulo pendientes de datos</div></div></div> : null}
      {activeTab === 1 ? <div><h2>Habilidades</h2>{emptyPanel("Tarjetas de habilidades", "Las habilidades y sus niveles todavía no están importados.")}</div> : null}
      {activeTab === 2 ? <div><h2>Talentos</h2>{emptyPanel("Tarjetas de talentos", "Los talentos todavía no están importados.")}</div> : null}
      {activeTab === 3 ? <div><h2>Módulos</h2><div className="operator-module-placeholder"><span>Selector de módulo y nivel</span><span>Comparación de niveles y efectos pendiente de importación</span></div></div> : null}
      {activeTab === 4 ? <div><h2>Expediente</h2><BiographyPanel result={biography} cnOnly={operator.cnOnly} /></div> : null}
      {activeTab === 5 ? <div><h2>Voces</h2>{emptyPanel("Lista de líneas", "Las líneas, transcripciones y audios todavía no están importados.")}</div> : null}
    </section></div>
  </>;
}
