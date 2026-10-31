// Parts of docs/SOURCES.md that follow from the pinned revisions and the date manifests. Each part sits between
// `<!-- sources:<name> -->` and `<!-- /sources:<name> -->`; the text around them is written by hand.

export type SourcesInput = {
  gameDataRepository: string;
  gameDataRevisions: Readonly<Record<"en" | "cn", string>>;
  releaseRevision: string;
  imageRepository: string;
  imageRevision: string;
  portraitRepository: string;
  portraitRevision: string;
  regional: readonly { nameEnglish: string; cnReleaseDate: string | null; cnReleaseDateProvenance?: { status: string; source: string } }[];
  cnReleases: readonly { status: string; source: string }[];
  globalUpdates: readonly { name: string; opensAt: string; operatorIds: readonly string[]; sourceUrl: string; status: string }[];
};

const github = (repository: string) => `https://github.com/${repository}`;
const commit = (repository: string, revision: string) => `[\`${revision.slice(0, 7)}\`](${github(repository)}/tree/${revision})`;
const siteNames: Readonly<Record<string, string>> = { "prts.wiki": "PRTS", "arknights.wiki.gg": "Terra Wiki" };
const announcement = (url: string) => /^https:\/\/ak\.hypergryph\.com\/news\/\d+$/.test(url);

/** "A", "A y B", "A, B y C". */
export function spanishList(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

function revisionsBlock(input: SourcesInput): string {
  const data = input.gameDataRepository;
  return [
    "| Fuente | Uso | Revisión fijada |",
    "| --- | --- | --- |",
    `| [${data.split("/")[1]}](${github(data)}) | Datos del juego EN | ${commit(data, input.gameDataRevisions.en)} |`,
    `| [${data.split("/")[1]}](${github(data)}) | Datos del juego CN | ${commit(data, input.gameDataRevisions.cn)} |`,
    `| [${data.split("/")[1]}](${github(data)}) | Fechas CN calculadas (\`gacha_table\`, \`roguelike_topic_table\`) | ${commit(data, input.releaseRevision)} |`,
    `| [${input.imageRepository.split("/")[1]}](${github(input.imageRepository)}) | Ilustraciones e iconos | ${commit(input.imageRepository, input.imageRevision)} |`,
    `| [${input.portraitRepository.split("/")[1]}](${github(input.portraitRepository)}) | Índice de retratos | ${commit(input.portraitRepository, input.portraitRevision)} |`,
  ].join("\n");
}

/** Link text of each URL in the current block, so a hand-written title survives a regeneration. */
export function linkLabels(block: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const line of block.split("\n")) {
    if (!line.startsWith("- [")) continue;
    const middle = line.indexOf("](", 3);
    const end = middle === -1 ? -1 : line.indexOf(")", middle + 2);
    if (end !== -1) labels.set(line.slice(middle + 2, end), line.slice(3, middle));
  }
  return labels;
}

function regionalBlock(input: SourcesInput, labels: ReadonlyMap<string, string>): string {
  const bySource = new Map<string, { date: string; status: string; names: string[] }>();
  for (const entry of input.regional) {
    const provenance = entry.cnReleaseDateProvenance;
    if (!provenance || !entry.cnReleaseDate) continue;
    const group = bySource.get(provenance.source) ?? { date: entry.cnReleaseDate, status: provenance.status, names: [] };
    group.names.push(entry.nameEnglish);
    if (entry.cnReleaseDate < group.date) group.date = entry.cnReleaseDate;
    bySource.set(provenance.source, group);
  }
  const groups = [...bySource].sort(([sourceA, a], [sourceB, b]) => a.date.localeCompare(b.date) || sourceA.localeCompare(sourceB));
  const lines = groups.filter(([source]) => announcement(source)).map(([source, group]) => `- [${labels.get(source) ?? source.replace("https://ak.hypergryph.com/", "")}](${source}): ${group.date}, ${spanishList(group.names)}.`);
  const others = groups.filter(([source]) => !announcement(source)).map(([source, group]) => `- ${spanishList(group.names)} (${group.date}): [${siteNames[new URL(source).hostname] ?? new URL(source).hostname}](${source}), \`${group.status}\`, a falta de anuncio oficial localizado.`);
  return [...lines, ...others].join("\n");
}

function globalReleasesBlock(input: SourcesInput): string {
  const fromData = input.cnReleases.filter((entry) => entry.status === "verified" && entry.source.startsWith(github(input.gameDataRepository)));
  const announced = input.cnReleases.filter((entry) => entry.status === "verified" && announcement(entry.source));
  const prts = input.cnReleases.filter((entry) => entry.status === "community-listed" && entry.source.startsWith("https://prts.wiki/"));
  const counted = fromData.length + announced.length + prts.length;
  if (counted !== input.cnReleases.length) throw new Error(`${input.cnReleases.length - counted} CN release dates have a source SOURCES.md does not describe`);
  const news = [...new Set(announced.map((entry) => entry.source))].sort((a, b) => a.localeCompare(b)).map((url) => `[${url.replace("https://ak.hypergryph.com/", "")}](${url})`);
  return [
    `- Datos del juego (\`verified\`, ${fromData.length} operadores): primer banner de \`gacha_table\` cuya lista de operadores lo incluye (esas listas solo existen hasta julio de 2019; las aperturas anteriores al lanzamiento del servidor CN, el 30 de abril de 2019, cuentan como esa fecha), banners limitados (\`limitedCharId\`) y temas de Integrated Strategies de \`roguelike_topic_table\` para los operadores que se obtienen en ellos. La fuente enlaza la tabla en la revisión fijada, con el banner o el tema como ancla.`,
    `- Anuncios oficiales de Hypergryph (\`verified\`, ${announced.length} operadores): ${spanishList(news)}.`,
    `- [PRTS](https://prts.wiki/) (\`community-listed\`, ${prts.length} operadores): página de cada operador.`,
  ].join("\n");
}

/** "-07:00" as "UTC−7", "+05:30" as "UTC+5:30". */
export function utcOffset(offset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) throw new Error(`Unreadable UTC offset: ${offset}`);
  const [, sign, hours, minutes] = match as unknown as [string, string, string, string];
  return `UTC${sign === "-" ? "−" : "+"}${Number(hours)}${minutes === "00" ? "" : `:${minutes}`}`;
}

function globalUpdatesBlock(input: SourcesInput): string {
  return [...input.globalUpdates]
    .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
    .map((update) => `- [${update.name}](${update.sourceUrl}): apertura ${update.opensAt.slice(0, 16).replace("T", " ")} (${utcOffset(update.opensAt.slice(19))}), ${update.operatorIds.length} operadores, \`${update.status}\`.`)
    .join("\n");
}

/** Bounds of the text between the markers of a block, line breaks included. */
function blockContent(text: string, name: string): { start: number; end: number } {
  const open = `<!-- sources:${name} -->`;
  const close = `<!-- /sources:${name} -->`;
  const start = text.indexOf(open);
  const end = start === -1 ? -1 : text.indexOf(close, start + open.length);
  if (start === -1 || end === -1 || text.indexOf(open, start + 1) !== -1) throw new Error(`SOURCES.md needs exactly one ${name} block`);
  return { start: start + open.length, end };
}

/** SOURCES.md with every generated block rewritten from the input. */
export function renderSources(text: string, input: SourcesInput): string {
  const current = (name: string) => {
    const { start, end } = blockContent(text, name);
    return text.slice(start, end).trim();
  };
  const blocks: Record<string, string> = {
    revisions: revisionsBlock(input),
    "cn-only-dates": regionalBlock(input, linkLabels(current("cn-only-dates"))),
    "cn-dates": globalReleasesBlock(input),
    "global-updates": globalUpdatesBlock(input),
  };
  let result = text;
  for (const [name, content] of Object.entries(blocks)) {
    const { start, end } = blockContent(result, name);
    result = `${result.slice(0, start)}\n${content}\n${result.slice(end)}`;
  }
  return result;
}
