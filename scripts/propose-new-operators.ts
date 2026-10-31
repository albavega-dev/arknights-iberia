/**
 * Proposal for the operators new in CN: regional manifest entry (name and CN date), main faction, sub-power affiliations
 * and artist credits. The name is the CN appellation, the date comes from PRTS (Terra Wiki as fallback,
 * `community-listed`), factions from the character_table identifiers, and credits from the Terra Wiki page.
 *
 *   pnpm data:new-operators --cn-character=<CN character_table.json> (--from-report=<detection report> | --ids=char_a,char_b) [--write]
 *
 * The JSON proposal goes to stdout. With --write, the resolved entries are added to the manifests of data/ (run
 * `pnpm artists:normalize` afterwards). Exit code: 0 everything resolved, 2 something needs a person, 1 error.
 */
import { readFile, writeFile } from "node:fs/promises";
import { gameDataRepository, gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { prtsOrigin, proposeAffiliations, proposeFactions, proposeRegionalEntries, terraPageUrl, terraWikiOrigin, type Affiliation, type FactionManifest, type NewOperator, type PrtsOperator, type RegionalEntry, type TerraOperator, type Unresolved } from "../src/game-data/new-operator-proposal";
import { classify, extractArtists, fetchPage, fetchRevision, isExplicitVariant, wikitextValue } from "./extract-terra-artist-credits";
import { creditsFor, type ArtistCreditEntry } from "./normalize-operator-artist-credits";

const flag = (name: string, argv: readonly string[]) => argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const sqlList = (values: readonly string[]) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
const userAgent = "arknights-iberia-update-check";

type CharacterRow = { name?: unknown; appellation?: unknown; mainPower?: NewOperator["mainPower"]; subPower?: NewOperator["subPower"] | null };
type Fetchers = {
  prts: (ids: readonly string[]) => Promise<PrtsOperator[]>;
  terra: (ids: readonly string[]) => Promise<TerraOperator[]>;
  artists: (operator: NewOperator, page: string) => Promise<ArtistCreditEntry>;
};
export type NewOperatorProposal = {
  sources: { prts: string; terraWiki: string };
  regional: RegionalEntry[];
  factions: ReturnType<typeof proposeFactions>["entries"];
  affiliations: Affiliation[];
  artistCredits: ArtistCreditEntry[];
  unresolved: Unresolved[];
  notes: string[];
};

async function cargo(origin: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
  const url = new URL("/api.php", origin);
  url.search = new URLSearchParams({ action: "cargoquery", format: "json", limit: "500", ...params }).toString();
  const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url.hostname} ${response.status}`);
  const rows = ((await response.json()) as { cargoquery?: { title?: Record<string, unknown> }[] } | null)?.cargoquery;
  if (!Array.isArray(rows)) throw new Error(`Unexpected ${url.hostname} response`);
  return rows.map((row) => row.title ?? {});
}

const text = (row: Record<string, unknown>, key: string) => {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Unexpected row: ${key}`);
  return value;
};

export async function fetchPrts(ids: readonly string[]): Promise<PrtsOperator[]> {
  const rows = await cargo(prtsOrigin, { tables: "chara,char_obtain", join_on: "chara._pageName=char_obtain._pageName", fields: "chara.charId=charId,chara._pageName=page,char_obtain.cnOnlineTime=cnOnlineTime", where: `chara.charId IN (${sqlList(ids)})` });
  return rows.map((row) => ({ charId: text(row, "charId"), page: text(row, "page"), cnOnlineTime: typeof row.cnOnlineTime === "string" ? row.cnOnlineTime : "" }));
}

export async function fetchTerra(ids: readonly string[]): Promise<TerraOperator[]> {
  const where = `OperatorFiles.id IN (${sqlList(ids)})`;
  const files = await cargo(terraWikiOrigin, { tables: "OperatorFiles", fields: "OperatorFiles.id=id,OperatorFiles.name=name,OperatorFiles._pageName=page", where });
  const events = await cargo(terraWikiOrigin, {
    tables: "OperatorFiles,Operators,Events,EventServerDetails",
    join_on: "OperatorFiles._pageName=Operators._pageName,Operators.event=Events.event,Events.event=EventServerDetails.event",
    fields: "OperatorFiles.id=id,Operators.event=event,EventServerDetails.startTime=startTime",
    where: `${where} AND EventServerDetails.server='cn'`,
  });
  const operators = files.map((row): TerraOperator => ({ id: text(row, "id"), name: text(row, "name"), page: text(row, "page") }));
  return operators.flatMap((operator) => {
    const starts = events.filter((row) => row.id === operator.id).map((row) => ({ ...operator, event: text(row, "event"), startTime: text(row, "startTime") }));
    return starts.length ? starts : [operator];
  });
}

/** Artist manifest entry from the Terra Wiki page, in the shape that extract-terra-artist-credits.ts writes. */
export async function fetchArtists(operator: NewOperator, page: string): Promise<ArtistCreditEntry> {
  const payload = await fetchPage(page);
  const wikitext = wikitextValue(payload.response.parse?.wikitext);
  const revision = wikitext ? await fetchRevision(page) : null;
  const artists = wikitext ? extractArtists(wikitext) : [];
  return {
    operatorId: operator.id,
    operatorName: operator.cnName,
    source: { site: "Terra Wiki", pageUrl: terraPageUrl(page), apiUrl: payload.url, revision: revision?.revision ?? null, revisionTimestamp: revision?.timestamp ?? null, consultedAt: new Date().toISOString() },
    status: classify(artists, Boolean(wikitext)),
    general: artists,
    variants: { base: artists.filter((artist) => isExplicitVariant(artist, "base")), elite2: artists.filter((artist) => isExplicitVariant(artist, "elite2")) },
    outfits: [],
    error: payload.response.error ?? null,
  };
}

const defaultFetchers: Fetchers = { prts: fetchPrts, terra: fetchTerra, artists: fetchArtists };

async function newOperators(argv: readonly string[]): Promise<NewOperator[]> {
  const tablePath = flag("cn-character", argv);
  const reportPath = flag("from-report", argv);
  const listed = flag("ids", argv);
  if (!tablePath) throw new Error("Missing --cn-character");
  if (!listed && !reportPath) throw new Error("Missing --from-report or --ids");
  const table = JSON.parse(await readFile(tablePath, "utf8")) as Record<string, CharacterRow>;
  const report = reportPath && !listed ? JSON.parse(await readFile(reportPath, "utf8")) as { findings?: { roster?: { newInCn?: string[] } } } : undefined;
  const ids = listed ? listed.split(",").filter(Boolean) : report?.findings?.roster?.newInCn ?? [];
  return ids.map((id) => {
    const row = table[id];
    if (typeof row?.name !== "string" || !row.mainPower) throw new Error(`${id} is not an operator of the CN character table`);
    return { id, cnName: row.name, appellation: typeof row.appellation === "string" ? row.appellation : "", mainPower: row.mainPower, subPower: row.subPower ?? [] };
  });
}

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

export async function propose(argv: readonly string[], fetchers: Fetchers = defaultFetchers, root = "."): Promise<NewOperatorProposal> {
  const operators = await newOperators(argv);
  const tablePath = flag("cn-character", argv)!;
  const empty: NewOperatorProposal = { sources: { prts: "not queried", terraWiki: "not queried" }, regional: [], factions: [], affiliations: [], artistCredits: [], unresolved: [], notes: [] };
  if (!operators.length) return empty;
  const ids = operators.map((operator) => operator.id);
  let prts: PrtsOperator[] | undefined;
  let prtsStatus = "ok";
  try {
    prts = await fetchers.prts(ids);
  } catch (error) {
    prtsStatus = `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  const terra = await fetchers.terra(ids);
  const regional = proposeRegionalEntries(operators, prts, terra);

  const factionManifest = await readJson<FactionManifest>(`${root}/data/operator-faction-manifest.json`);
  const factions = proposeFactions(operators, factionManifest);
  const table = await readJson<Record<string, CharacterRow>>(tablePath);
  const known = factionManifest.operators.filter((entry) => !entry.regional).map((entry) => ({ id: entry.id, subPower: table[entry.id]?.subPower ?? [] }));
  const affiliationManifest = await readJson<{ associations: Affiliation[] }>(`${root}/data/operator-affiliation-manifest.json`);
  const source = { repository: gameDataRepository, region: "cn", revision: gameDataRevisions.cn, path: "cn/gamedata/excel/character_table.json" };
  const mainFactions = new Map(factions.entries.map((entry) => [entry.id, entry.mainFactionId]));
  const affiliations = proposeAffiliations(operators.map((operator) => ({ ...operator, mainFactionId: mainFactions.get(operator.id) })), known, affiliationManifest.associations, source);

  const pages = new Map(terra.map((row) => [row.id, row.page]));
  const artistCredits: ArtistCreditEntry[] = [];
  const unresolved = [...regional.unresolved, ...factions.unresolved, ...affiliations.unresolved];
  for (const operator of operators) {
    const page = pages.get(operator.id);
    if (!page) {
      unresolved.push({ id: operator.id, field: "artistCredits", reason: "Terra Wiki has no page for the operator" });
      continue;
    }
    const entry = await fetchers.artists(operator, page);
    const odd = creditsFor(entry).filter((credit) => credit.role === "collaboration");
    if (entry.status === "pending") unresolved.push({ id: operator.id, field: "artistCredits", reason: "the Terra Wiki page has no illustrator", evidence: { page: terraPageUrl(page) } });
    else if (odd.length) unresolved.push({ id: operator.id, field: "artistCredits", reason: "credits with a role the normalization does not know", evidence: { credits: odd.map((credit) => credit.evidence) } });
    else artistCredits.push(entry);
  }
  return { sources: { prts: prtsStatus, terraWiki: "ok" }, regional: regional.entries, factions: factions.entries, affiliations: affiliations.entries, artistCredits, unresolved, notes: [...regional.notes, ...affiliations.notes] };
}

/** One-line JSON with spaces, the style of the regional and affiliation manifests. */
export function oneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(", ")}]`;
  if (value && typeof value === "object") return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${oneLine(item)}`).join(", ")} }`;
  return JSON.stringify(value);
}

const closing = "\n  ]\n}\n";

export type WriteSummary = { added: string[]; creditsFilled: string[]; affiliationsAdded: string[]; kept: string[] };

/**
 * Writes the resolved entries to the manifests of data/, keeping each file's layout. A new operator gets all its
 * entries; one already in the manifests keeps its regional and faction entries and only gains what is missing: artist
 * credits that are still pending and affiliations it does not have.
 */
export async function writeProposal(proposal: NewOperatorProposal, root = "."): Promise<WriteSummary> {
  const regionalPath = `${root}/data/operator-regional-manifest.json`;
  const regionalText = await readFile(regionalPath, "utf8");
  const regional = JSON.parse(regionalText) as { operators: RegionalEntry[] };
  const factionPath = `${root}/data/operator-faction-manifest.json`;
  const factions = await readJson<{ operators: { id: string }[] }>(factionPath);
  const creditsPath = `${root}/data/operator-artist-credits-manifest.json`;
  const credits = await readJson<{ entries: { operatorId: string; status?: string }[] }>(creditsPath);
  const affiliationPath = `${root}/data/operator-affiliation-manifest.json`;
  const affiliationText = await readFile(affiliationPath, "utf8");
  const affiliations = JSON.parse(affiliationText) as { associations: Affiliation[] };
  if (!regionalText.endsWith(closing) || !affiliationText.endsWith(closing)) throw new Error("Unexpected manifest layout");

  const known = new Set(regional.operators.map((entry) => entry.id));
  const newRegional = proposal.regional.filter((entry) => !known.has(entry.id));
  const knownFactions = new Set(factions.operators.map((entry) => entry.id));
  const newFactions = proposal.factions.filter((entry) => !knownFactions.has(entry.id));
  const creditIndex = new Map(credits.entries.map((entry, index) => [entry.operatorId, index]));
  const entries = [...credits.entries];
  const creditsFilled: string[] = [];
  for (const entry of proposal.artistCredits) {
    const index = creditIndex.get(entry.operatorId);
    if (index === undefined) entries.push(entry);
    else if (entries[index]!.status === "pending") {
      entries[index] = entry;
      creditsFilled.push(entry.operatorId);
    }
  }
  const pairs = new Set(affiliations.associations.map((entry) => `${entry.operatorId}|${entry.affiliationId}`));
  const newAffiliations = proposal.affiliations.filter((entry) => !pairs.has(`${entry.operatorId}|${entry.affiliationId}`));

  const operators = [...regional.operators, ...newRegional].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const head = regionalText.slice(0, regionalText.indexOf('"operators": [') + '"operators": ['.length);
  await writeFile(regionalPath, `${head}\n${operators.map((entry) => `    ${oneLine(entry)}`).join(",\n")}${closing}`, "utf8");
  await writeFile(factionPath, `${JSON.stringify({ ...factions, operators: [...factions.operators, ...newFactions] }, null, 2)}\n`, "utf8");
  await writeFile(creditsPath, `${JSON.stringify({ ...credits, entries }, null, 2)}\n`, "utf8");
  const added = newAffiliations.map((entry) => `,\n    ${oneLine(entry)}`).join("");
  await writeFile(affiliationPath, `${affiliationText.slice(0, -closing.length)}${added}${closing}`, "utf8");
  const ids = [...new Set([...proposal.regional.map((entry) => entry.id), ...proposal.factions.map((entry) => entry.id)])];
  return {
    added: newRegional.map((entry) => entry.id),
    creditsFilled,
    affiliationsAdded: newAffiliations.map((entry) => `${entry.operatorId} ${entry.affiliationId}`),
    kept: ids.filter((id) => known.has(id)),
  };
}

/** Prints the proposal (and writes it with --write) and returns the exit code: 0 all resolved, 2 something needs a person. */
export async function main(argv: readonly string[] = process.argv, fetchers: Fetchers = defaultFetchers, log: (line: string) => void = console.log, root = "."): Promise<number> {
  const proposal = await propose(argv, fetchers, root);
  const written = argv.includes("--write") ? await writeProposal(proposal, root) : undefined;
  log(JSON.stringify(written ? { ...proposal, written } : proposal, null, 2));
  return proposal.unresolved.length ? 2 : 0;
}

if (process.argv[1]?.endsWith("propose-new-operators.ts")) main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
