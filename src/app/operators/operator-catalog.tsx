"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { ArrowDown, ArrowUp, ChevronDown, RotateCcw } from "lucide-react";
import {
  filterOperators,
  getOperatorDisplayName,
  sortOperators,
  type OperatorClass,
  type OperatorRecord,
  type OperatorSortDirection,
  type OperatorSortKey,
} from "../../game-data/operators";
import {
  getOperatorClassIconUrl,
  getOperatorFactionIconUrl,
  getOperatorPortraitAsset,
  getOperatorSubclassIconUrl,
} from "../../game-data/operator-assets";
import {
  getOperatorAdditionalFactionIds,
  getOperatorFactionName,
  getOperatorMainFactionId,
} from "../../game-data/operator-factions";
import { getNewOperatorIds } from "../../game-data/operator-global-updates";
import { getOperatorArchetypeName } from "../../game-data/operator-archetypes";
import { getOperatorPublicSlug } from "../../game-data/operator-slugs";
import { OperatorControlButton } from "./operator-control-button";

const classLabels: Record<OperatorClass, string> = {
  Guard: "Guard",
  Vanguard: "Vanguard",
  Defender: "Defender",
  Sniper: "Sniper",
  Caster: "Caster",
  Specialist: "Specialist",
  Supporter: "Supporter",
  Medic: "Medic",
};
const operatorClasses: OperatorClass[] = [
  "Guard",
  "Vanguard",
  "Defender",
  "Sniper",
  "Caster",
  "Medic",
  "Supporter",
  "Specialist",
];
const rarityOptions: Array<1 | 2 | 3 | 4 | 5 | 6> = [6, 5, 4, 3, 2, 1];

type CatalogFilterState = Readonly<{
  query: string;
  className: OperatorClass | null;
  subClassIds: string[];
  rarities: Array<1 | 2 | 3 | 4 | 5 | 6>;
  includeCnOnly: boolean;
  mainFactionId: string | "all";
  sortKey: OperatorSortKey;
  sortDirection: OperatorSortDirection;
}>;

const validSortKeys: readonly OperatorSortKey[] = ["name", "cnReleaseDate", "rarity"];
const validSortDirections: readonly OperatorSortDirection[] = ["asc", "desc"];

function readCatalogState(params: URLSearchParams, records: readonly OperatorRecord[]): CatalogFilterState {
  const classParam = params.get("class");
  const className = operatorClasses.includes(classParam as OperatorClass) ? (classParam as OperatorClass) : null;
  const validSubClasses = new Set(
    records
      .filter((operator) => !className || operator.class === className)
      .map((operator) => operator.subClassId)
      .filter((value): value is string => Boolean(value)),
  );
  const subClassIds = (params.get("subclass") ?? "")
    .split(",")
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index && validSubClasses.has(value));
  const rarities = (params.get("rarity") ?? "")
    .split(",")
    .map(Number)
    .filter(
      (value, index, values): value is 1 | 2 | 3 | 4 | 5 | 6 =>
        [1, 2, 3, 4, 5, 6].includes(value) && values.indexOf(value) === index,
    ) as Array<1 | 2 | 3 | 4 | 5 | 6>;
  const factionParam = params.get("faction");
  const validFactions = new Set(
    records.map((operator) => operator.mainFactionId).filter((value): value is string => Boolean(value)),
  );
  const mainFactionId =
    factionParam === "all" || !factionParam ? "all" : validFactions.has(factionParam) ? factionParam : "all";
  const sortKey = validSortKeys.includes(params.get("sort") as OperatorSortKey)
    ? (params.get("sort") as OperatorSortKey)
    : "cnReleaseDate";
  const sortDirection = validSortDirections.includes(params.get("dir") as OperatorSortDirection)
    ? (params.get("dir") as OperatorSortDirection)
    : "desc";
  return {
    query: params.get("q") ?? "",
    className,
    subClassIds,
    rarities,
    includeCnOnly: params.get("cn") === "1",
    mainFactionId,
    sortKey,
    sortDirection,
  };
}

function catalogStateToParams(state: CatalogFilterState): string {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.className) params.set("class", state.className);
  if (state.subClassIds.length) params.set("subclass", state.subClassIds.join(","));
  if (state.rarities.length) params.set("rarity", state.rarities.join(","));
  if (state.includeCnOnly) params.set("cn", "1");
  if (state.mainFactionId !== "all") params.set("faction", state.mainFactionId);
  if (state.sortKey !== "cnReleaseDate") params.set("sort", state.sortKey);
  if (state.sortDirection !== "desc") params.set("dir", state.sortDirection);
  return params.toString();
}

const OperatorCard = memo(function OperatorCard({
  operator,
  classLabel,
  isNew,
}: {
  operator: OperatorRecord;
  classLabel: string;
  isNew: boolean;
}) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  const portrait = getOperatorPortraitAsset(operator.id);
  const displayName = getOperatorDisplayName(operator);
  return (
    <Link
      className={`operator-card rarity-${operator.rarity}${operator.cnOnly ? " is-cn-only" : ""}`}
      href={`/operators/${operator.slug}`}
      aria-label={`${displayName}, ${classLabel}, ${operator.rarity} estrellas${operator.cnOnly ? ", exclusivo CN, pr\u00F3ximamente en Global" : ""}${isNew ? ", operador nuevo" : ""}. Ver ficha`}
    >
      <span className="operator-card-art" aria-hidden="true">
        {!portraitFailed && portrait ? (
          <Image
            className="operator-card-portrait"
            src={portrait.url}
            alt=""
            fill
            sizes="(max-width: 440px) 145px, (max-width: 900px) 170px, 170px"
            style={{ objectPosition: portrait.objectPosition, transform: `scale(${portrait.scale})` }}
            onError={() => setPortraitFailed(true)}
          />
        ) : null}
        <span className="operator-card-class-icon">
          <Image src={getOperatorClassIconUrl(operator.class)} alt="" fill sizes="29px" unoptimized />
        </span>
      </span>
      {operator.cnOnly ? (
        <span className="operator-card-upcoming" aria-hidden="true">
          <span className="operator-card-upcoming-text">{"PR\u00D3XIMAMENTE"}</span>
        </span>
      ) : isNew ? (
        <span className="operator-card-new" aria-label="operador nuevo">
          NUEVO
        </span>
      ) : null}
      <span className="operator-card-info">
        <strong>{displayName}</strong>
        <span className="operator-card-meta">
          <span className="sr-only">Clase: {classLabel}</span>
          <span className={`operator-card-rarity rarity-${operator.rarity}`}>
            <span aria-hidden="true">
              {operator.rarity}
              {String.fromCharCode(9733)}
            </span>
            <span className="sr-only">{operator.rarity} estrellas</span>
          </span>
        </span>
      </span>
    </Link>
  );
});

function FilterButton({
  active,
  label,
  onClick,
  iconUrl,
  rarity,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  iconUrl?: string | null;
  rarity?: number;
}) {
  return (
    <OperatorControlButton
      type="button"
      size="compact"
      appearance="naval"
      className={`operator-filter-button${!iconUrl ? " is-text" : ""}${rarity ? ` rarity-${rarity}` : ""}${active ? " is-active" : ""}`}
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {iconUrl ? (
        <Image src={iconUrl} alt="" width={22} height={22} unoptimized={iconUrl.includes("/ui/subclass/")} />
      ) : (
        <span aria-hidden="true">{rarity ? `${rarity}${String.fromCharCode(9733)}` : "Todas"}</span>
      )}
      {iconUrl ? <span className="sr-only">{label}</span> : null}
    </OperatorControlButton>
  );
}

function OptionIcon({ iconUrl }: { iconUrl?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!iconUrl || failed) return null;
  return <Image src={iconUrl} alt="" width={24} height={24} onError={() => setFailed(true)} />;
}

function AnimatedOperatorGrid({
  operators,
  allOperators,
  newOperatorIds,
}: {
  operators: readonly OperatorRecord[];
  allOperators: readonly OperatorRecord[];
  newOperatorIds: ReadonlySet<string>;
}) {
  const gridRef = useRef<HTMLUListElement>(null);
  const animationCycle = operators.map((operator) => operator.id).join(",");
  const initialAnimationCycle = useRef(animationCycle);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (animationCycle === initialAnimationCycle.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animations = Array.from(grid.children, (child, index) => {
      const element = child as HTMLElement;
      element.style.animation = "none";
      return element.animate(
        [
          { opacity: 0, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 240, delay: Math.min(index, 7) * 35, easing: "cubic-bezier(.22, .61, .36, 1)", fill: "both" },
      );
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [animationCycle]);

  return (
    <ul ref={gridRef} className="operators-gallery">
      {operators.map((operator, index) => (
        <li key={operator.id} style={{ "--operator-entry-index": Math.min(index, 7) } as CSSProperties}>
          <OperatorCard
            operator={{ ...operator, slug: getOperatorPublicSlug(operator, allOperators) }}
            classLabel={classLabels[operator.class]}
            isNew={newOperatorIds.has(operator.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/* Legacy Radix implementation retained in history while the local popover is validated.
function SortPopover({ value, direction, onValueChange, onDirectionChange }: { value: OperatorSortKey; direction: OperatorSortDirection; onValueChange: (value: OperatorSortKey) => void; onDirectionChange: () => void }) {
  const [open, setOpen] = useState(false);
  const options: Array<[OperatorSortKey, string]> = [["name", "Nombre"], ["cnReleaseDate", "Fecha de lanzamiento"], ["rarity", "Rareza"]];
  const selectedLabel = options.find(([option]) => option === value)?.[1] ?? "Nombre";
  return <Popover.Root modal={false} open={open} onOpenChange={setOpen}>
    <Popover.Anchor asChild><div className="operators-sort-control-anchor"><Popover.Trigger id="operator-sort" className="operators-sort-trigger" aria-labelledby="operator-sort-label"><span>{selectedLabel}</span><ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" /></Popover.Trigger>
      <button type="button" className="operators-sort-direction" onClick={onDirectionChange} aria-label={direction === "asc" ? "Cambiar a orden descendente" : "Cambiar a orden ascendente"} title={direction === "asc" ? "Orden ascendente. Cambiar a descendente" : "Orden descendente. Cambiar a ascendente"}>{direction === "asc" ? <ArrowUp size={16} strokeWidth={1.8} aria-hidden="true" /> : <ArrowDown size={16} strokeWidth={1.8} aria-hidden="true" />}<span className="sr-only">{direction === "asc" ? "Orden ascendente" : "Orden descendente"}</span></button>
    </div></Popover.Anchor>
    <Popover.Portal><Popover.Content className="operators-select-content" sideOffset={0} align="start" onPointerDownOutside={(event) => { if (event.target instanceof Element && event.target.closest(".operators-sort-direction")) event.preventDefault(); }} onFocusOutside={(event) => { if (event.target instanceof Element && event.target.closest(".operators-sort-direction")) event.preventDefault(); }}>
    <div className="operators-sort-options" role="radiogroup" aria-label={`Criterio de ordenaci${String.fromCharCode(243)}n`}>{options.map(([option, label]) => <button type="button" className="operators-select-item" key={option} role="radio" aria-checked={value === option} onClick={() => onValueChange(option)}>{label}<span className="operators-select-indicator" aria-hidden="true">{value === option ? String.fromCharCode(10003) : ""}</span></button>)}</div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

*/
function OperatorOptionPopover({
  id,
  labelId,
  value,
  options,
  onValueChange,
  widthReference,
  direction,
  onDirectionChange,
  searchable = false,
}: {
  id: string;
  labelId: string;
  value: string;
  options: Array<[string, string, (string | null)?]>;
  onValueChange: (value: string) => void;
  widthReference: string;
  direction?: OperatorSortDirection;
  onDirectionChange?: () => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [triggerWidth, setTriggerWidth] = useState(0);
  const [search, setSearch] = useState("");
  const selectedOption = options.find(([option]) => option === value) ?? options[0];
  const selectedLabel = selectedOption?.[1] ?? "";
  const normalizedSearch = search
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
  const visibleOptions =
    searchable && normalizedSearch
      ? options.filter(([, optionLabel]) =>
          optionLabel
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("es")
            .includes(normalizedSearch),
        )
      : options;
  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const measure = () => setTriggerWidth(trigger.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(trigger);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setSearch("");
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSearch("");
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);
  return (
    <div ref={rootRef} className="operators-sort-control-anchor">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="operators-sort-trigger operators-select-surface"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-state={open ? "open" : "closed"}
        onClick={() =>
          setOpen((current) => {
            if (current) setSearch("");
            return !current;
          })
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => rootRef.current?.querySelector<HTMLInputElement>("input")?.focus());
          }
        }}
      >
        <span className="operators-select-label">
          <OptionIcon iconUrl={selectedOption?.[2]} />
          <span>{selectedLabel}</span>
        </span>
        <span className="operators-select-width-reference" aria-hidden="true">
          {widthReference}
        </span>
        <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {direction && onDirectionChange ? (
        <button
          type="button"
          className="operators-sort-direction"
          onClick={onDirectionChange}
          aria-label={direction === "asc" ? "Cambiar a orden descendente" : "Cambiar a orden ascendente"}
          title={
            direction === "asc" ? "Orden ascendente. Cambiar a descendente" : "Orden descendente. Cambiar a ascendente"
          }
        >
          {direction === "asc" ? (
            <ArrowUp size={16} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ArrowDown size={16} strokeWidth={1.8} aria-hidden="true" />
          )}
          <span className="sr-only">{direction === "asc" ? "Orden ascendente" : "Orden descendente"}</span>
        </button>
      ) : null}
      <div
        className="operators-select-content"
        style={{ width: triggerWidth }}
        data-state={open ? "open" : "closed"}
        role="listbox"
        aria-labelledby={labelId}
        aria-hidden={!open}
      >
        {searchable ? (
          <div className="operators-option-search">
            <label className="sr-only" htmlFor={`${id}-search`}>
              Buscar facción
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={search}
              placeholder="Buscar facción…"
              autoComplete="off"
              tabIndex={open ? 0 : -1}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        ) : null}
        <div
          className="operators-sort-options"
          role="radiogroup"
          aria-label={
            labelId === "operator-sort-label"
              ? `Criterio de ordenaci${String.fromCharCode(243)}n`
              : `Facci${String.fromCharCode(243)}n`
          }
        >
          {visibleOptions.length ? (
            visibleOptions.map(([option, optionLabel, iconUrl]) => (
              <button
                type="button"
                className="operators-select-item"
                key={option}
                role="radio"
                aria-checked={value === option}
                tabIndex={open ? 0 : -1}
                onClick={() => onValueChange(option)}
              >
                <span className="operators-select-option-label">
                  <OptionIcon iconUrl={iconUrl} />
                  <span>{optionLabel}</span>
                </span>
                <span className="operators-select-indicator" aria-hidden="true">
                  {value === option ? String.fromCharCode(10003) : ""}
                </span>
              </button>
            ))
          ) : (
            <p className="operators-option-empty" role="status">
              No se encontraron facciones
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function OperatorCatalog({ records }: { records: readonly OperatorRecord[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsText = searchParams.toString();
  const catalogRecords = useMemo(
    () =>
      records.map((operator) => ({
        ...operator,
        mainFactionId: operator.mainFactionId ?? getOperatorMainFactionId(operator.id),
        additionalFactionIds: getOperatorAdditionalFactionIds(operator.id),
      })),
    [records],
  );
  const initialState = useMemo(
    () => readCatalogState(new URLSearchParams(searchParamsText), catalogRecords),
    [catalogRecords, searchParamsText],
  );
  const [query, setQuery] = useState(initialState.query);
  const [className, setClassName] = useState<OperatorClass | null>(initialState.className);
  const [subClassIds, setSubClassIds] = useState<string[]>(initialState.subClassIds);
  const [rarities, setRarities] = useState<Array<1 | 2 | 3 | 4 | 5 | 6>>(initialState.rarities);
  const [includeCnOnly, setIncludeCnOnly] = useState(initialState.includeCnOnly);
  const [mainFactionId, setMainFactionId] = useState<string | "all">(initialState.mainFactionId);
  const [sortKey, setSortKey] = useState<OperatorSortKey>(initialState.sortKey);
  const [sortDirection, setSortDirection] = useState<OperatorSortDirection>(initialState.sortDirection);
  const isDefaultCnReleaseOrder = !searchParamsText.includes("sort=") && !searchParamsText.includes("dir=");
  const lastUrlState = useRef(searchParamsText);
  const commitState = useCallback(
    (next: CatalogFilterState) => {
      setQuery(next.query);
      setClassName(next.className);
      setSubClassIds(next.subClassIds);
      setRarities(next.rarities);
      setIncludeCnOnly(next.includeCnOnly);
      setMainFactionId(next.mainFactionId);
      setSortKey(next.sortKey);
      setSortDirection(next.sortDirection);
      const nextParams = catalogStateToParams(next);
      const nextUrl = nextParams ? `?${nextParams}` : "/operators";
      lastUrlState.current = nextParams;
      router.replace(nextUrl, { scroll: false });
    },
    [router],
  );
  useEffect(() => {
    if (lastUrlState.current === searchParamsText) return;
    const next = readCatalogState(new URLSearchParams(searchParamsText), catalogRecords);
    setQuery(next.query);
    setClassName(next.className);
    setSubClassIds(next.subClassIds);
    setRarities(next.rarities);
    setIncludeCnOnly(next.includeCnOnly);
    setMainFactionId(next.mainFactionId);
    setSortKey(next.sortKey);
    setSortDirection(next.sortDirection);
    lastUrlState.current = searchParamsText;
  }, [catalogRecords, searchParamsText]);
  const visible = useMemo(
    () =>
      sortOperators(
        filterOperators(catalogRecords, { query, className, subClassIds, rarities, includeCnOnly, mainFactionId }),
        sortKey,
        sortDirection,
        includeCnOnly,
        isDefaultCnReleaseOrder,
      ),
    [
      catalogRecords,
      query,
      className,
      subClassIds,
      rarities,
      includeCnOnly,
      mainFactionId,
      sortKey,
      sortDirection,
      isDefaultCnReleaseOrder,
    ],
  );
  const newOperatorIds = useMemo(() => getNewOperatorIds(catalogRecords), [catalogRecords]);
  const factions = useMemo(
    () =>
      [
        ...new Map(
          catalogRecords
            .filter((operator) => operator.mainFactionId)
            .map((operator) => {
              const factionId = operator.mainFactionId as string;
              return [factionId, [getOperatorFactionName(factionId), getOperatorFactionIconUrl(factionId)] as const];
            }),
        ).entries(),
      ]
        .sort(([, [nameA]], [, [nameB]]) => nameA.localeCompare(nameB, "en"))
        .map(([factionId, [name, iconUrl]]) => [factionId, name, iconUrl] as [string, string, string | null]),
    [catalogRecords],
  );
  const subClasses = useMemo(
    () =>
      [
        ...new Set(
          catalogRecords
            .filter((operator) => (!className || operator.class === className) && operator.subClassId)
            .map((operator) => operator.subClassId as string),
        ),
      ].sort(),
    [catalogRecords, className],
  );
  const toggleClass = (nextClass: OperatorClass) => {
    const next = className === nextClass ? null : nextClass;
    commitState({
      query,
      className: next,
      subClassIds: next
        ? subClassIds.filter((id) =>
            catalogRecords.some((operator) => operator.class === next && operator.subClassId === id),
          )
        : [],
      rarities,
      includeCnOnly,
      mainFactionId,
      sortKey,
      sortDirection,
    });
  };
  const toggleRarity = (nextRarity: 1 | 2 | 3 | 4 | 5 | 6) =>
    commitState({
      query,
      className,
      subClassIds,
      rarities: rarities.includes(nextRarity)
        ? rarities.filter((value) => value !== nextRarity)
        : [...rarities, nextRarity],
      includeCnOnly,
      mainFactionId,
      sortKey,
      sortDirection,
    });
  const toggleSubClass = (nextSubClass: string) =>
    commitState({
      query,
      className,
      subClassIds: subClassIds.includes(nextSubClass)
        ? subClassIds.filter((value) => value !== nextSubClass)
        : [...subClassIds, nextSubClass],
      rarities,
      includeCnOnly,
      mainFactionId,
      sortKey,
      sortDirection,
    });
  const resetFilters = () =>
    commitState({
      query: "",
      className: null,
      subClassIds: [],
      rarities: [],
      includeCnOnly: false,
      mainFactionId: "all",
      sortKey: "cnReleaseDate",
      sortDirection: "desc",
    });

  return (
    <>
      <div className="operators-controls" role="search" aria-label="Buscar y filtrar operadores">
        <div className="operators-primary-controls">
          <div className="operators-search-field">
            <label htmlFor="operator-search">Buscar</label>
            <input
              id="operator-search"
              type="search"
              value={query}
              onChange={(event) =>
                commitState({
                  query: event.target.value,
                  className,
                  subClassIds,
                  rarities,
                  includeCnOnly,
                  mainFactionId,
                  sortKey,
                  sortDirection,
                })
              }
              placeholder="Nombre del operador"
            />
          </div>
          <div className="operators-sort-field">
            <label id="operator-sort-label" htmlFor="operator-sort">
              Ordenar por
            </label>
            <div className="operators-sort-control">
              <OperatorOptionPopover
                id="operator-sort"
                labelId="operator-sort-label"
                value={sortKey}
                widthReference="Fecha de lanzamiento"
                options={[
                  ["name", "Nombre"],
                  ["cnReleaseDate", "Fecha de lanzamiento"],
                  ["rarity", "Rareza"],
                ]}
                direction={sortDirection}
                onValueChange={(next) =>
                  commitState({
                    query,
                    className,
                    subClassIds,
                    rarities,
                    includeCnOnly,
                    mainFactionId,
                    sortKey: next as OperatorSortKey,
                    sortDirection,
                  })
                }
                onDirectionChange={() =>
                  commitState({
                    query,
                    className,
                    subClassIds,
                    rarities,
                    includeCnOnly,
                    mainFactionId,
                    sortKey,
                    sortDirection: sortDirection === "asc" ? "desc" : "asc",
                  })
                }
              />
            </div>
          </div>
          <div className="operators-faction-field">
            <label id="operator-faction-label" htmlFor="operator-faction">{`Facci${String.fromCharCode(243)}n`}</label>
            <OperatorOptionPopover
              id="operator-faction"
              labelId="operator-faction-label"
              value={mainFactionId}
              widthReference="Todas las facciones"
              options={[["all", "Todas las facciones"], ...factions]}
              onValueChange={(next) =>
                commitState({
                  query,
                  className,
                  subClassIds,
                  rarities,
                  includeCnOnly,
                  mainFactionId: next,
                  sortKey,
                  sortDirection,
                })
              }
              searchable
            />
          </div>
          <OperatorControlButton
            type="button"
            size="regular"
            appearance="naval"
            className="operators-reset"
            onClick={resetFilters}
          >
            <RotateCcw className="operators-reset-icon" size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>Restablecer filtros</span>
          </OperatorControlButton>
        </div>
        <fieldset className="operators-filter-group operators-filter-group-wide">
          <legend>Clase</legend>
          <div className="operators-filter-bar">
            {operatorClasses.map((value) => (
              <FilterButton
                key={value}
                active={className === value}
                label={classLabels[value]}
                iconUrl={getOperatorClassIconUrl(value)}
                onClick={() => toggleClass(value)}
              />
            ))}
          </div>
        </fieldset>
        {className ? (
          <fieldset className="operators-filter-group operators-filter-group-wide">
            <legend>{`Arquetipo · ${classLabels[className]}`}</legend>
            <div className="operators-filter-bar">
              {subClasses.map((value) => (
                <FilterButton
                  key={value}
                  active={subClassIds.includes(value)}
                  label={getOperatorArchetypeName(value)}
                  iconUrl={getOperatorSubclassIconUrl(value)}
                  onClick={() => toggleSubClass(value)}
                />
              ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="operators-filter-group operators-filter-group-wide operators-rarity-group">
          <legend>Rareza</legend>
          <div className="operators-rarity-line">
            <div className="operators-filter-bar operators-rarity-bar">
              {rarityOptions.map((value) => (
                <FilterButton
                  key={value}
                  active={rarities.includes(value)}
                  label={`${value} estrellas`}
                  rarity={value}
                  onClick={() => toggleRarity(value)}
                />
              ))}
            </div>
            <button
              type="button"
              className={`operators-cn-toggle${includeCnOnly ? " is-active" : ""}`}
              aria-pressed={includeCnOnly}
              onClick={() =>
                commitState({
                  query,
                  className,
                  subClassIds,
                  rarities,
                  includeCnOnly: !includeCnOnly,
                  mainFactionId,
                  sortKey,
                  sortDirection,
                })
              }
            >
              <span>Incluir exclusivos CN</span>
              <span className="operators-cn-switch" aria-hidden="true">
                <span className="operators-cn-switch-thumb" />
              </span>
            </button>
          </div>
        </fieldset>
      </div>
      <section className="operators-results" aria-label="Operadores filtrados">
        {visible.length ? (
          <AnimatedOperatorGrid operators={visible} allOperators={catalogRecords} newOperatorIds={newOperatorIds} />
        ) : (
          <p className="operators-empty" role="status">
            No se encontraron operadores que coincidan con la combinación de filtros seleccionada.
          </p>
        )}
      </section>
    </>
  );
}
