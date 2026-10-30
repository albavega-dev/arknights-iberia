import type { GlobalUpdate } from "./operator-global-updates";

/** A row of the Terra Wiki event tables for the Global server; `startTime` is UTC ("2026-10-14 17:00:00"). */
export type TerraGlobalEvent = { name: string; event: string; page: string; startTime: string };
export type ProposalOperator = { id: string; name: string };
export type UnresolvedOperator = { id: string; name: string; reason: string };
export type GlobalUpdateProposal = { updates: GlobalUpdate[]; unresolved: UnresolvedOperator[] };

// Yostar announces Global openings in UTC-7 all year (10:00 there is 17:00 UTC), and the wiki stores them in UTC.
const globalOffset = "-07:00";
const globalOffsetMinutes = -7 * 60;
export const terraWikiOrigin = "https://arknights.wiki.gg";

/** Terra Wiki UTC time to the Global server time of the manifest: 2026-10-14 17:00:00 gives 2026-10-14T10:00:00-07:00. */
export function terraStartToOpensAt(startTime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(startTime);
  if (!match) throw new Error(`Unreadable Terra Wiki start time: ${startTime}`);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (new Date(utc).toISOString().slice(0, 19).replace("T", " ") !== startTime) throw new Error(`Unreadable Terra Wiki start time: ${startTime}`);
  return `${new Date(utc + globalOffsetMinutes * 60_000).toISOString().slice(0, 19)}${globalOffset}`;
}

/** Lowercase ASCII words joined by hyphens. Splitting on the separators keeps the cost linear for any input. */
export const eventSlug = (value: string) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join("-");
/** The event with the earliest start; undefined for an empty list. */
export function earliestEvent(events: readonly TerraGlobalEvent[]): TerraGlobalEvent | undefined {
  let best: TerraGlobalEvent | undefined;
  for (const event of events) if (!best || event.startTime < best.startTime) best = event;
  return best;
}
const sameName = (a: string, b: string) => a.normalize("NFC").trim().toLowerCase() === b.normalize("NFC").trim().toLowerCase();

/**
 * Groups the operators that arrived in Global by the event that gives them (the earliest one when the wiki lists
 * several), as `community-listed` entries of operator-global-updates.json. Operators the wiki does not know are
 * returned apart: they are the only case that needs a person.
 */
export function proposeGlobalUpdates(operators: readonly ProposalOperator[], events: readonly TerraGlobalEvent[]): GlobalUpdateProposal {
  const byEvent = new Map<string, { event: TerraGlobalEvent; operatorIds: string[] }>();
  const unresolved: UnresolvedOperator[] = [];
  for (const operator of operators) {
    const earliest = earliestEvent(events.filter((event) => sameName(event.name, operator.name)));
    if (!earliest) { unresolved.push({ ...operator, reason: "not in the Terra Wiki event tables for Global" }); continue; }
    const group = byEvent.get(earliest.event) ?? { event: earliest, operatorIds: [] };
    group.operatorIds.push(operator.id);
    byEvent.set(earliest.event, group);
  }
  const updates = [...byEvent.values()]
    .sort((a, b) => a.event.startTime.localeCompare(b.event.startTime) || a.event.event.localeCompare(b.event.event))
    .map(({ event, operatorIds }): GlobalUpdate => ({
      id: `global-${eventSlug(event.event)}`,
      name: event.event,
      opensAt: terraStartToOpensAt(event.startTime),
      operatorIds,
      sourceUrl: `${terraWikiOrigin}/wiki/${encodeURIComponent(event.page.replaceAll(" ", "_"))}`,
      status: "community-listed",
    }));
  return { updates, unresolved };
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Cargo query for the Global start of the events that give the operators, by their name. */
export function terraEventsQuery(names: readonly string[]): URLSearchParams {
  return new URLSearchParams({
    action: "cargoquery",
    format: "json",
    tables: "Operators,Events,EventServerDetails",
    join_on: "Operators.event=Events.event,Events.event=EventServerDetails.event",
    fields: "Operators.name=name,Operators.event=event,Events._pageName=page,startTime",
    where: `Operators.name IN (${names.map(sqlString).join(", ")}) AND server='global'`,
    limit: "500",
  });
}

export function parseTerraEvents(response: unknown): TerraGlobalEvent[] {
  const rows = (response as { cargoquery?: { title?: Record<string, unknown> }[] } | null)?.cargoquery;
  if (!Array.isArray(rows)) throw new Error("Unexpected Terra Wiki response");
  return rows.map((row) => {
    const { name, event, page, startTime } = row.title ?? {};
    if (typeof name !== "string" || typeof event !== "string" || typeof page !== "string" || typeof startTime !== "string") throw new Error("Unexpected Terra Wiki row");
    return { name, event, page, startTime };
  });
}
