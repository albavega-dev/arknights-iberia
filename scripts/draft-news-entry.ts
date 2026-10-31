/**
 * Draft of the Novedades entry of the home page for a data update, from the detection report and the regenerated
 * catalog. It is a draft: the owner reviews it in the pull request.
 *
 *   pnpm docs:news-draft --from-report=<detection report> [--date=YYYY-MM-DD] [--write]
 *
 * The entry goes to stdout; with --write it is added as the first entry of src/app/page.tsx.
 */
import { readFile, writeFile } from "node:fs/promises";

type GlobalUpdate = { name: string; operatorIds: readonly string[] };
export type NewsInput = { date: string; newInCn: readonly string[]; arrivedInGlobal: readonly string[]; updates: readonly GlobalUpdate[] };

const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const flag = (name: string, argv: readonly string[]) => argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const entities: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "{": "&#123;", "}": "&#125;" };
const jsxText = (value: string) => value.replace(/[&<>{}]/g, (character) => entities[character]!);
const list = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`);

export function spanishDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? months[Number(match[2]) - 1] : undefined;
  if (!match || !month) throw new Error(`Unreadable date: ${date}`);
  return `${Number(match[3])} de ${month} de ${match[1]}`;
}

/** The JSX of the entry, indented like the entries of the page. Names are display names already. */
export function newsEntry(input: NewsInput): string {
  const items: string[] = [];
  if (input.newInCn.length) items.push(`Añadidos los operadores nuevos de CN: ${list(input.newInCn)}.`);
  for (const update of input.updates) items.push(`Llegan a Global con «${update.name}»: ${list(update.operatorIds)}.`);
  if (input.arrivedInGlobal.length && !input.updates.length) items.push(`Llegan a Global: ${list(input.arrivedInGlobal)}.`);
  items.push("Actualizados los datos de los operadores con la última versión del juego.");
  return [
    "            <article className=\"landing-news-entry\">",
    `              <h3>${spanishDate(input.date)} - Actualización de datos</h3>`,
    "              <ul>",
    ...items.map((item) => `                <li>${jsxText(item)}</li>`),
    "              </ul>",
    "            </article>",
  ].join("\n");
}

const heading = '<h2 id="news-title">Novedades</h2>\n';

/** The page with the entry as the first one of Novedades. */
export function insertEntry(page: string, entry: string): string {
  const index = page.indexOf(heading);
  if (index === -1 || page.indexOf(heading, index + 1) !== -1) throw new Error("The page needs exactly one Novedades heading");
  const at = index + heading.length;
  return `${page.slice(0, at)}${entry}\n${page.slice(at)}`;
}

export async function draft(argv: readonly string[], root = ".", today = () => new Date().toISOString().slice(0, 10)): Promise<string> {
  const reportPath = flag("from-report", argv);
  if (!reportPath) throw new Error("Missing --from-report");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { findings?: { roster?: { newInCn?: string[]; arrivedInGlobal?: string[] } } };
  const catalog = JSON.parse(await readFile(`${root}/data/operator-catalog/index.json`, "utf8")) as { operators: { id: string; name: string }[] };
  const updates = JSON.parse(await readFile(`${root}/data/operator-global-updates.json`, "utf8")) as { updates: GlobalUpdate[] };
  const names = new Map(catalog.operators.map((operator) => [operator.id, operator.name]));
  const name = (id: string) => {
    const value = names.get(id);
    if (!value) throw new Error(`${id} is not in the catalog: regenerate it first`);
    return value;
  };
  const arrived = report.findings?.roster?.arrivedInGlobal ?? [];
  const relevant = updates.updates.filter((update) => update.operatorIds.some((id) => arrived.includes(id)));
  return newsEntry({
    date: flag("date", argv) ?? today(),
    newInCn: (report.findings?.roster?.newInCn ?? []).map(name),
    arrivedInGlobal: arrived.map(name),
    updates: relevant.map((update) => ({ name: update.name, operatorIds: update.operatorIds.filter((id) => arrived.includes(id)).map(name) })),
  });
}

export async function main(argv: readonly string[] = process.argv, root = ".", log: (line: string) => void = console.log): Promise<void> {
  const entry = await draft(argv, root);
  if (argv.includes("--write")) {
    const path = `${root}/src/app/page.tsx`;
    await writeFile(path, insertEntry(await readFile(path, "utf8"), entry), "utf8");
  }
  log(entry);
}

if (process.argv[1]?.endsWith("draft-news-entry.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
