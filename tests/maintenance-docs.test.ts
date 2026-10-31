import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { linkLabels, renderSources, spanishList, utcOffset, type SourcesInput } from "../src/game-data/sources-doc.js";
import { main as sourcesMain } from "../scripts/generate-sources-doc.js";
import { draft, insertEntry, main as newsMain, newsEntry, spanishDate } from "../scripts/draft-news-entry.js";

const input = (overrides: Partial<SourcesInput> = {}): SourcesInput => ({
  gameDataRepository: "Owner/Data", gameDataRevisions: { en: "a".repeat(40), cn: "b".repeat(40) }, releaseRevision: "c".repeat(40),
  imageRepository: "Owner/Images", imageRevision: "d".repeat(40), portraitRepository: "Owner/Portraits", portraitRevision: "e".repeat(40),
  regional: [
    { nameEnglish: "Beta", cnReleaseDate: "2026-09-01", cnReleaseDateProvenance: { status: "verified", source: "https://ak.hypergryph.com/news/2" } },
    { nameEnglish: "Alpha", cnReleaseDate: "2026-08-01", cnReleaseDateProvenance: { status: "verified", source: "https://ak.hypergryph.com/news/1" } },
    { nameEnglish: "Gamma", cnReleaseDate: "2026-09-01", cnReleaseDateProvenance: { status: "verified", source: "https://ak.hypergryph.com/news/2" } },
    { nameEnglish: "Delta", cnReleaseDate: "2026-07-01", cnReleaseDateProvenance: { status: "community-listed", source: "https://prts.wiki/w/D" } },
    { nameEnglish: "Undated", cnReleaseDate: null },
  ],
  cnReleases: [
    { status: "verified", source: "https://github.com/Owner/Data/blob/c/cn/gamedata/excel/gacha_table.json#x" },
    { status: "verified", source: "https://ak.hypergryph.com/news/9" },
    { status: "verified", source: "https://ak.hypergryph.com/news/9" },
    { status: "community-listed", source: "https://prts.wiki/w/X" },
  ],
  globalUpdates: [{ name: "Event", opensAt: "2026-10-14T10:00:00-07:00", operatorIds: ["a", "b"], sourceUrl: "https://arknights.wiki.gg/wiki/Event", status: "community-listed" }],
  ...overrides,
});
const blocks = (names: string[], content = "") => names.map((name) => `<!-- sources:${name} -->\n${content}<!-- /sources:${name} -->`).join("\n\n");
const all = ["revisions", "cn-only-dates", "cn-dates", "global-updates"];

test("the generated blocks follow the revisions and the manifests, keeping hand-written titles", () => {
  const text = `# Fuentes\n\n${blocks(["revisions"])}\n\nTexto.\n\n<!-- sources:cn-only-dates -->\n- [SideStory «Título»](https://ak.hypergryph.com/news/2): viejo.\n<!-- /sources:cn-only-dates -->\n\n${blocks(["cn-dates", "global-updates"])}\n`;
  const rendered = renderSources(text, input());
  assert.match(rendered, /\| \[Data\]\(https:\/\/github\.com\/Owner\/Data\) \| Datos del juego EN \| \[`aaaaaaa`\]\(https:\/\/github\.com\/Owner\/Data\/tree\/a{40}\) \|/);
  assert.match(rendered, /\| \[Portraits\]\(https:\/\/github\.com\/Owner\/Portraits\) \| Índice de retratos \| \[`eeeeeee`\]/);
  assert.ok(rendered.includes("<!-- sources:cn-only-dates -->\n- [news/1](https://ak.hypergryph.com/news/1): 2026-08-01, Alpha.\n- [SideStory «Título»](https://ak.hypergryph.com/news/2): 2026-09-01, Beta y Gamma.\n- Delta (2026-07-01): [PRTS](https://prts.wiki/w/D), `community-listed`, a falta de anuncio oficial localizado.\n<!-- /sources:cn-only-dates -->"));
  assert.match(rendered, /Datos del juego \(`verified`, 1 operadores\)/);
  assert.match(rendered, /Anuncios oficiales de Hypergryph \(`verified`, 2 operadores\): \[news\/9\]\(https:\/\/ak\.hypergryph\.com\/news\/9\)\./);
  assert.match(rendered, /\[PRTS\]\(https:\/\/prts\.wiki\/\) \(`community-listed`, 1 operadores\)/);
  assert.match(rendered, /- \[Event\]\(https:\/\/arknights\.wiki\.gg\/wiki\/Event\): apertura 2026-10-14 10:00 \(UTC−7\), 2 operadores, `community-listed`\./);
  assert.ok(rendered.startsWith("# Fuentes\n\n<!-- sources:revisions -->\n| Fuente |") && rendered.includes("\n\nTexto.\n\n"), "the hand-written text stays");
  assert.equal(renderSources(rendered, input()), rendered, "a second run changes nothing");
});

test("a date source SOURCES.md does not describe, or a broken block, stops the generation", () => {
  const text = blocks(all);
  assert.throws(() => renderSources(text, input({ cnReleases: [{ status: "verified", source: "https://example.com/x" }] })), /1 CN release dates have a source SOURCES.md does not describe/);
  assert.throws(() => renderSources(blocks(["revisions", "cn-dates", "global-updates"]), input()), /exactly one cn-only-dates block/);
  assert.throws(() => renderSources(`${text}\n${blocks(["revisions"])}`, input()), /exactly one revisions block/);
  assert.throws(() => renderSources(text.replace("<!-- /sources:global-updates -->", ""), input()), /exactly one global-updates block/);
});

test("small formatting helpers", () => {
  assert.deepEqual([spanishList([]), spanishList(["A"]), spanishList(["A", "B"]), spanishList(["A", "B", "C"])], ["", "A", "A y B", "A, B y C"]);
  assert.deepEqual([utcOffset("-07:00"), utcOffset("+08:00"), utcOffset("+05:30")], ["UTC−7", "UTC+8", "UTC+5:30"]);
  assert.throws(() => utcOffset("Z"), /Unreadable UTC offset/);
  assert.deepEqual([...linkLabels("- [A](u1): x\n- [B](u2\n- C\n- [D](u3)")], [["u1", "A"], ["u3", "D"]]);
});

test("docs/SOURCES.md is up to date with the revisions and the manifests", async () => {
  const lines: string[] = [];
  assert.equal(await sourcesMain(["--check"], ".", (line) => lines.push(line)), 0, "run corepack pnpm docs:sources");
});

test("the script writes the blocks, or only reports under --check", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sources-doc-"));
  try {
    await cp("data", join(directory, "data"), { recursive: true, filter: (source) => !/operator-(stats|skills|modules|biographies|catalog)\b/.test(source) });
    await mkdir(join(directory, "docs"));
    await writeFile(join(directory, "docs/SOURCES.md"), `# Fuentes\n\n${blocks(all)}\n`);
    const lines: string[] = [];
    assert.equal(await sourcesMain(["--check"], directory, (line) => lines.push(line)), 1);
    assert.equal(await sourcesMain([], directory, (line) => lines.push(line)), 0);
    assert.equal(await sourcesMain(["--check"], directory, (line) => lines.push(line)), 0);
    assert.deepEqual(lines, ["SOURCES.md is out of date: run corepack pnpm docs:sources", "SOURCES.md updated", "SOURCES.md is up to date"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the Novedades draft names the new operators and the Global arrivals, escaped for JSX", () => {
  assert.equal(spanishDate("2026-11-05"), "5 de noviembre de 2026");
  for (const bad of ["2026-13-01", "5/11/2026"]) assert.throws(() => spanishDate(bad), /Unreadable date/);
  const entry = newsEntry({ date: "2026-11-05", newInCn: ["A", "B<{x}>&"], arrivedInGlobal: ["C"], updates: [{ name: "Event", operatorIds: ["C"] }] });
  assert.equal(entry, [
    "            <article className=\"landing-news-entry\">",
    "              <h3>5 de noviembre de 2026 - Actualización de datos</h3>",
    "              <ul>",
    "                <li>Añadidos los operadores nuevos de CN: A y B&lt;&#123;x&#125;&gt;&amp;.</li>",
    "                <li>Llegan a Global con «Event»: C.</li>",
    "                <li>Actualizados los datos de los operadores con la última versión del juego.</li>",
    "              </ul>",
    "            </article>",
  ].join("\n"));
  const plain = newsEntry({ date: "2026-11-05", newInCn: [], arrivedInGlobal: ["C", "D"], updates: [] });
  assert.match(plain, /<li>Llegan a Global: C y D\.<\/li>/);
  assert.doesNotMatch(plain, /nuevos de CN/);
  const page = '      <section>\n            <h2 id="news-title">Novedades</h2>\n            <article>old</article>\n';
  assert.equal(insertEntry(page, "NEW"), '      <section>\n            <h2 id="news-title">Novedades</h2>\nNEW\n            <article>old</article>\n');
  assert.throws(() => insertEntry("<main />", "NEW"), /exactly one Novedades heading/);
});

test("the draft script reads the report, the catalog and the Global updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "news-draft-"));
  try {
    await mkdir(join(directory, "data/operator-catalog"), { recursive: true });
    await mkdir(join(directory, "src/app"), { recursive: true });
    await writeFile(join(directory, "data/operator-catalog/index.json"), JSON.stringify({ operators: [{ id: "char_a", name: "Alpha" }, { id: "char_b", name: "Beta" }, { id: "char_c", name: "Gamma" }] }));
    await writeFile(join(directory, "data/operator-global-updates.json"), JSON.stringify({ updates: [{ name: "Old", operatorIds: ["char_x"] }, { name: "Event", operatorIds: ["char_b", "char_x"] }] }));
    const report = join(directory, "report.json");
    await writeFile(report, JSON.stringify({ findings: { roster: { newInCn: ["char_a"], arrivedInGlobal: ["char_b"] } } }));
    await writeFile(join(directory, "src/app/page.tsx"), `${await readFile("src/app/page.tsx", "utf8")}`);
    const entry = await draft([`--from-report=${report}`], directory, () => "2026-11-05");
    assert.match(entry, /5 de noviembre de 2026/);
    assert.match(entry, /nuevos de CN: Alpha\./);
    assert.match(entry, /«Event»: Beta\./);
    const lines: string[] = [];
    await newsMain([`--from-report=${report}`, "--date=2026-11-06", "--write"], directory, (line) => lines.push(line));
    const page = await readFile(join(directory, "src/app/page.tsx"), "utf8");
    assert.ok(page.includes(`<h2 id="news-title">Novedades</h2>\n${lines[0]}\n            <article className="landing-news-entry">`));
    await writeFile(report, JSON.stringify({ findings: { roster: { newInCn: ["char_z"] } } }));
    await assert.rejects(draft([`--from-report=${report}`], directory), /char_z is not in the catalog/);
    await assert.rejects(draft([], directory), /Missing --from-report/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
