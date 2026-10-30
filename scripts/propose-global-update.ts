/**
 * Read-only proposal of the operator-global-updates.json entries for the operators that arrived in Global. The date comes
 * from the Terra Wiki event tables (`community-listed`); it writes nothing.
 *
 *   pnpm data:global-update --en-character=<EN character_table.json> (--from-report=<detection report> | --ids=char_a,char_b)
 *
 * The JSON proposal goes to stdout. Exit code: 0 every operator resolved, 2 some operators need a person, 1 error.
 */
import { readFile } from "node:fs/promises";
import { parseTerraEvents, proposeGlobalUpdates, terraEventsQuery, terraWikiOrigin, type GlobalUpdateProposal, type ProposalOperator, type TerraGlobalEvent } from "../src/game-data/global-update-proposal";

const flag = (name: string, argv: readonly string[]) => argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

export async function fetchTerraEvents(names: readonly string[]): Promise<TerraGlobalEvent[]> {
  const url = new URL("/api.php", terraWikiOrigin);
  url.search = terraEventsQuery(names).toString();
  const response = await fetch(url, { headers: { "User-Agent": "arknights-iberia-update-check" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Terra Wiki ${response.status}`);
  return parseTerraEvents(await response.json());
}

async function operatorsToResolve(argv: readonly string[]): Promise<ProposalOperator[]> {
  const tablePath = flag("en-character", argv);
  const reportPath = flag("from-report", argv);
  const listed = flag("ids", argv);
  if (!tablePath) throw new Error("Missing --en-character");
  if (!listed && !reportPath) throw new Error("Missing --from-report or --ids");
  const table = JSON.parse(await readFile(tablePath, "utf8")) as Record<string, { name?: unknown }>;
  const report = reportPath && !listed ? JSON.parse(await readFile(reportPath, "utf8")) as { findings?: { roster?: { arrivedInGlobal?: string[] } } } : undefined;
  const ids = listed ? listed.split(",").filter(Boolean) : report?.findings?.roster?.arrivedInGlobal ?? [];
  return ids.map((id) => {
    const name = table[id]?.name;
    if (typeof name !== "string" || !name) throw new Error(`${id} has no name in the EN character table`);
    return { id, name };
  });
}

export async function proposeFor(argv: readonly string[], fetchEvents: (names: readonly string[]) => Promise<TerraGlobalEvent[]> = fetchTerraEvents): Promise<GlobalUpdateProposal> {
  const operators = await operatorsToResolve(argv);
  return proposeGlobalUpdates(operators, operators.length ? await fetchEvents(operators.map((operator) => operator.name)) : []);
}

/** Prints the proposal and returns the exit code: 0 all resolved, 2 some operators need a person. */
export async function main(argv: readonly string[] = process.argv, fetchEvents: (names: readonly string[]) => Promise<TerraGlobalEvent[]> = fetchTerraEvents, log: (line: string) => void = console.log): Promise<number> {
  const proposal = await proposeFor(argv, fetchEvents);
  log(JSON.stringify(proposal, null, 2));
  return proposal.unresolved.length ? 2 : 0;
}

if (process.argv[1]?.endsWith("propose-global-update.ts")) main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
