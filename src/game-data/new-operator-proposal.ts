// Pure proposal logic for the operators new in CN: regional manifest entry (English name and CN date), main faction and
// sub-power affiliations. The script that fetches PRTS and Terra Wiki and writes the manifests is
// scripts/propose-new-operators.ts.

export const prtsOrigin = "https://prts.wiki";
export const terraWikiOrigin = "https://arknights.wiki.gg";

type Power = { nationId: string | null; groupId: string | null; teamId: string | null };
/** What the CN character table says about a new operator. */
export type NewOperator = { id: string; cnName: string; mainPower: Power; subPower: readonly Power[] };
/** A PRTS row: `chara` joined with `char_obtain` by page; `cnOnlineTime` is CN server time ("2026-08-01 16:00:00"). */
export type PrtsOperator = { charId: string; page: string; en: string; cnOnlineTime: string };
/** A Terra Wiki row: `OperatorFiles` by id, with the CN start of the event that gives the operator when there is one. */
export type TerraOperator = { id: string; name: string; page: string; event?: string; startTime?: string };

export type RegionalEntry = {
  id: string;
  nameEnglish: string;
  nameStatus: "community-listed";
  cnReleaseDate: string;
  globalReleaseDate: null;
  cnReleaseDateProvenance: { status: "community-listed"; source: string };
};
export type Unresolved = { id: string; field: string; reason: string; evidence?: Record<string, unknown> };

const sameName = (a: string, b: string) => a.normalize("NFC").trim().toLowerCase() === b.normalize("NFC").trim().toLowerCase();
export const prtsPageUrl = (page: string) => `${prtsOrigin}/w/${encodeURIComponent(page)}`;
export const terraPageUrl = (page: string) => `${terraWikiOrigin}/wiki/${encodeURIComponent(page.replaceAll(" ", "_"))}`;

/**
 * CN date of a Terra Wiki event start. The wiki keeps CN starts on a UTC-6 clock: the 16:00 openings of Contingency
 * Contract read 02:00, and most other events read 20:00 of the day before. Only the date is reliable.
 */
export function terraCnStartToDate(startTime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(startTime);
  if (!match) throw new Error(`Unreadable Terra Wiki start time: ${startTime}`);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(utc).toISOString().slice(0, 19).replace("T", " ") !== startTime) throw new Error(`Unreadable Terra Wiki start time: ${startTime}`);
  return new Date(utc + 14 * 3_600_000).toISOString().slice(0, 10);
}

/** The earliest event start of each Terra Wiki operator. */
function terraById(rows: readonly TerraOperator[]): Map<string, TerraOperator> {
  const byId = new Map<string, TerraOperator>();
  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current || (row.startTime && (!current.startTime || row.startTime < current.startTime))) byId.set(row.id, row);
  }
  return byId;
}

/**
 * Regional manifest entries: English name from Terra Wiki (PRTS as fallback) and CN date from PRTS `cnOnlineTime`,
 * both `community-listed`. When PRTS did not answer (`prts` undefined) or lacks the operator, the date comes from the
 * Terra Wiki event, with a note. Only a missing name or date, or two names that really differ, are left to a person.
 */
export function proposeRegionalEntries(operators: readonly NewOperator[], prts: readonly PrtsOperator[] | undefined, terra: readonly TerraOperator[]): { entries: RegionalEntry[]; unresolved: Unresolved[]; notes: string[] } {
  const prtsById = new Map((prts ?? []).map((row) => [row.charId, row]));
  const terraRows = terraById(terra);
  const entries: RegionalEntry[] = [];
  const unresolved: Unresolved[] = [];
  const notes: string[] = prts ? [] : ["PRTS did not answer: CN dates come from the Terra Wiki event of each operator."];
  for (const operator of operators) {
    const fromPrts = prtsById.get(operator.id);
    const fromTerra = terraRows.get(operator.id);
    const terraDate = fromTerra?.startTime ? terraCnStartToDate(fromTerra.startTime) : undefined;
    const prtsDate = fromPrts?.cnOnlineTime ? fromPrts.cnOnlineTime.slice(0, 10) : undefined;
    let ok = true;
    if (fromTerra && fromPrts?.en && !sameName(fromTerra.name, fromPrts.en)) {
      unresolved.push({ id: operator.id, field: "nameEnglish", reason: "Terra Wiki and PRTS give different English names", evidence: { terraWiki: fromTerra.name, prts: fromPrts.en, recommendation: fromTerra.name } });
      ok = false;
    }
    const name = fromTerra?.name ?? (fromPrts?.en || undefined);
    if (!name) {
      unresolved.push({ id: operator.id, field: "nameEnglish", reason: "neither Terra Wiki nor PRTS lists an English name" });
      ok = false;
    }
    let date: { value: string; source: string } | undefined;
    if (prtsDate && fromPrts) date = { value: prtsDate, source: prtsPageUrl(fromPrts.page) };
    else if (terraDate && fromTerra) {
      date = { value: terraDate, source: terraPageUrl(fromTerra.page) };
      if (prts) notes.push(`${operator.id}: PRTS has no date; CN date from the Terra Wiki event ${fromTerra.event ?? ""}`.trim());
    }
    if (date && prtsDate && terraDate && prtsDate !== terraDate) notes.push(`${operator.id}: PRTS ${prtsDate}, Terra Wiki event ${terraDate}; PRTS kept (its date is the release, the wiki's is the event)`);
    if (!date) {
      unresolved.push({ id: operator.id, field: "cnReleaseDate", reason: "neither PRTS nor Terra Wiki gives a CN date" });
      ok = false;
    }
    if (ok && name && date) entries.push({ id: operator.id, nameEnglish: name, nameStatus: "community-listed", cnReleaseDate: date.value, globalReleaseDate: null, cnReleaseDateProvenance: { status: "community-listed", source: date.source } });
  }
  return { entries, unresolved, notes };
}

export type FactionEntry = {
  id: string;
  subPowerPresent?: boolean;
  name: string;
  factionId: string;
  nationId: string | null;
  groupId: string | null;
  teamId: string | null;
  status: string;
  source: string;
  regional: boolean;
  mainFactionId: string | null;
  factionName: string | null;
  factionStatus: string;
  factionSource: string | null;
};
export type FactionManifest = { policy?: { pendingManualReview?: readonly string[] }; operators: readonly FactionEntry[] };
export type Affiliation = { operatorId: string; affiliationId: string; relation: string; sourceField: string; sourceValue?: string; source: Record<string, unknown>; status: string };

const powerFields = ["nationId", "groupId", "teamId"] as const;
export const mainPowerKey = (power: Power) => `mainPower:${power.nationId}|${power.groupId}|${power.teamId}`;
const subPowerField = (field: (typeof powerFields)[number]) => `character_table.json → subPower[].${field}`;

/**
 * Main faction of each new operator, copied from the operators that share its `mainPower` identifiers (the ones under
 * manual review do not count). Identifiers with no correspondence, or with operators that disagree, are left to a person.
 */
export function proposeFactions(operators: readonly NewOperator[], manifest: FactionManifest): { entries: FactionEntry[]; unresolved: Unresolved[] } {
  const reviewed = new Set(manifest.policy?.pendingManualReview ?? []);
  const entries: FactionEntry[] = [];
  const unresolved: Unresolved[] = [];
  for (const operator of operators) {
    const factionId = mainPowerKey(operator.mainPower);
    const matches = manifest.operators.filter((entry) => entry.factionId === factionId && !reviewed.has(entry.id));
    const choices = new Map(matches.map((entry) => [JSON.stringify([entry.mainFactionId, entry.factionName, entry.factionStatus, entry.factionSource]), entry]));
    const match = matches[0];
    if (choices.size !== 1 || !match) {
      unresolved.push({ id: operator.id, field: "mainFactionId", reason: choices.size ? "operators with these identifiers have different factions" : "no operator has these identifiers", evidence: { factionId, factions: [...choices.values()].map((entry) => entry.mainFactionId) } });
      continue;
    }
    entries.push({
      id: operator.id,
      ...(operator.subPower.length ? { subPowerPresent: true } : {}),
      name: operator.cnName,
      factionId,
      ...operator.mainPower,
      status: match.status,
      source: match.source,
      regional: true,
      mainFactionId: match.mainFactionId,
      factionName: match.factionName,
      factionStatus: match.factionStatus,
      factionSource: match.factionSource,
    });
  }
  return { entries, unresolved };
}

type Usage = { mapped: Map<string, number>; unmapped: number };

/** How often each sub-power identifier of the known operators gave each affiliation, or none. */
function affiliationUsage(known: readonly { id: string; subPower: readonly Power[] }[], affiliations: readonly Affiliation[]): Map<string, Usage> {
  const usage = new Map<string, Usage>();
  for (const operator of known) {
    for (const field of powerFields) {
      const values = operator.subPower.map((power) => power[field]).filter((value): value is string => Boolean(value));
      const ofField = affiliations.filter((entry) => entry.operatorId === operator.id && entry.sourceField === subPowerField(field));
      // An entry without sourceValue cannot be attributed when the operator has several values for the field.
      if (values.length > 1 && ofField.some((entry) => entry.sourceValue === undefined)) continue;
      for (const value of values) {
        const key = `${field}:${value}`;
        const current = usage.get(key) ?? { mapped: new Map<string, number>(), unmapped: 0 };
        const mapped = ofField.filter((entry) => entry.sourceValue === undefined || entry.sourceValue === value);
        for (const entry of mapped) current.mapped.set(entry.affiliationId, (current.mapped.get(entry.affiliationId) ?? 0) + 1);
        if (!mapped.length) current.unmapped += 1;
        usage.set(key, current);
      }
    }
  }
  return usage;
}

/**
 * Sub-power affiliations of each new operator, by the correspondence the known operators already have: an identifier
 * that mostly gives one affiliation gives it, one that mostly gives none (Babel, Kjerag) gives none, and one never seen,
 * tied or giving several affiliations is left to a person. An affiliation equal to the main faction is not repeated.
 */
export function proposeAffiliations(operators: readonly (NewOperator & { mainFactionId?: string | null })[], known: readonly { id: string; subPower: readonly Power[] }[], affiliations: readonly Affiliation[], source: Record<string, unknown>): { entries: Affiliation[]; unresolved: Unresolved[]; notes: string[] } {
  const usage = affiliationUsage(known, affiliations);
  const entries: Affiliation[] = [];
  const unresolved: Unresolved[] = [];
  const notes: string[] = [];
  for (const operator of operators) {
    for (const power of operator.subPower) {
      for (const field of powerFields) {
        const value = power[field];
        if (!value) continue;
        const seen = usage.get(`${field}:${value}`);
        const counts = Object.fromEntries([...(seen?.mapped ?? [])].concat(seen?.unmapped ? [["none", seen.unmapped]] : []));
        const mapped = [...(seen?.mapped.values() ?? [])].reduce((total, count) => total + count, 0);
        if (seen && seen.unmapped > mapped) {
          if (mapped) notes.push(`${operator.id}: ${field} ${value} gives no affiliation (${JSON.stringify(counts)})`);
          continue;
        }
        const [affiliationId] = seen?.mapped.keys() ?? [];
        if (!seen || seen.mapped.size !== 1 || seen.unmapped === mapped || !affiliationId) {
          unresolved.push({ id: operator.id, field: `subPower.${field}`, reason: seen ? "known operators with this identifier are affiliated in different ways" : "no known operator has this identifier", evidence: { value, ...(seen ? { counts } : {}) } });
          continue;
        }
        if (seen.unmapped) notes.push(`${operator.id}: ${field} ${value} gives ${affiliationId} (${JSON.stringify(counts)})`);
        if (affiliationId === operator.mainFactionId || entries.some((entry) => entry.operatorId === operator.id && entry.affiliationId === affiliationId)) continue;
        entries.push({ operatorId: operator.id, affiliationId, relation: "sub-power", sourceField: subPowerField(field), sourceValue: value, source, status: "verified" });
      }
    }
  }
  return { entries, unresolved, notes };
}
