import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorRecord } from "../src/game-data/operators";
import { aiTrainingCrawlers, buildNotFoundMetadata, buildBreadcrumbJsonLd, buildCatalogBreadcrumbJsonLd, buildOperatorBreadcrumbJsonLd, buildWebSiteJsonLd, serializeJsonLd, buildCatalogMetadata, buildCreditsMetadata, buildOperatorMetadata, buildPageMetadata, buildRobots, buildSiteMetadata, buildSitemap, getCatalogPageDescription, getOperatorPageDescription, getSiteOrigin } from "../src/game-data/seo";

const operator = (id: string, name: string, extra: Partial<OperatorRecord> = {}): OperatorRecord => ({ id, name, class: "Caster", subClassId: "corecaster", rarity: 6, slug: `operator-${id}`, cnOnly: false, availabilityStatus: "global-snapshot", cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null, ...extra });

test("takes the origin from the Vercel production domain and falls back to localhost", () => {
  assert.equal(getSiteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "arknightsiberia.vercel.app" }), "https://arknightsiberia.vercel.app");
  assert.equal(getSiteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: " " }), "http://localhost:3000");
  assert.equal(getSiteOrigin({}), "http://localhost:3000");
});

test("repeats canonical, Open Graph and Twitter in each page, with the preview of the operator or the site image", () => {
  const withImage = buildPageMetadata({ title: "Amiya", description: "d", path: "/operators/amiya", image: "/assets/a.jpg" });
  assert.equal(withImage.alternates?.canonical, "/operators/amiya");
  assert.equal((withImage.openGraph as { title: string }).title, "Amiya | Arknights Iberia");
  assert.deepEqual((withImage.openGraph as { images: unknown[] }).images, [{ url: "/assets/a.jpg", width: 1200, height: 630 }]);
  assert.equal((withImage.twitter as { card: string }).card, "summary_large_image");
  const withoutImage = buildPageMetadata({ title: "Operadores", description: "d", path: "/operators" });
  assert.deepEqual((withoutImage.twitter as { images: string[] }).images, ["/assets/operator-og-images/site.jpg"]);
});

test("describes an operator with name, rarity, class and archetype", () => {
  const description = getOperatorPageDescription(operator("char_1", "Eyjafjalla"));
  assert.match(description, /^Eyjafjalla es un operador de 6 estrellas de la clase Caster y arquetipo Core Caster en Arknights\./);
  assert.doesNotMatch(description, /CN/);
  assert.match(getOperatorPageDescription(operator("char_2", "Nuevo", { cnOnly: true, subClassId: null })), /solo en CN\.$/);
  assert.notEqual(description, getOperatorPageDescription(operator("char_3", "Otro")));
});

test("takes the operator count of the catalog description from its argument", () => {
  assert.match(getCatalogPageDescription(415), /^Catálogo de 415 operadores/);
});

test("robots deny AI training crawlers, allow the rest except the API and point to the sitemap", () => {
  const robots = buildRobots("https://example.test");
  assert.equal(robots.sitemap, "https://example.test/sitemap.xml");
  const rules = robots.rules as { userAgent: string | string[]; allow?: string; disallow?: string }[];
  assert.deepEqual(rules[0], { userAgent: "*", allow: "/", disallow: "/api/" });
  assert.deepEqual(rules[1], { userAgent: [...aiTrainingCrawlers], disallow: "/" });
  for (const allowed of ["Googlebot", "Bingbot", "ChatGPT-User", "OAI-SearchBot", "PerplexityBot", "Claude-User", "Claude-SearchBot", "Discordbot", "Twitterbot"]) {
    assert.ok(!aiTrainingCrawlers.some((bot) => bot.toLowerCase() === allowed.toLowerCase()), `${allowed} stays allowed`);
  }
});

test("sitemap lists the pages and one entry per public operator slug without dates", () => {
  const records = [operator("char_1", "Amiya"), operator("char_2", "Amiya"), operator("char_3", "Ch'en")];
  const urls = buildSitemap("https://example.test", records).map((entry) => entry.url);
  assert.equal(urls.length, 3 + records.length);
  assert.deepEqual(urls.slice(0, 3), ["https://example.test", "https://example.test/operators", "https://example.test/credits"]);
  assert.ok(urls.includes("https://example.test/operators/ch-en"));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(buildSitemap("https://example.test", records).every((entry) => entry.lastModified === undefined));
});

test("the layout metadata sets the origin, the title template and the site preview for every page", () => {
  const metadata = buildSiteMetadata("https://example.test");
  assert.equal(String(metadata.metadataBase), "https://example.test/");
  assert.deepEqual(metadata.title, { default: "Arknights en español: operadores, habilidades y módulos | Arknights Iberia", template: "%s | Arknights Iberia" });
  assert.equal(metadata.alternates?.canonical, "/");
  assert.equal((metadata.openGraph as { locale: string }).locale, "es_ES");
  assert.deepEqual((metadata.twitter as { images: string[] }).images, ["/assets/operator-og-images/site.jpg"]);
});

test("the catalog and attribution pages have their own titles, descriptions and canonical paths", () => {
  const catalog = buildCatalogMetadata(432);
  assert.equal(catalog.title, "Operadores de Arknights en español");
  assert.match(String(catalog.description), /432 operadores/);
  assert.equal(catalog.alternates?.canonical, "/operators");
  const credits = buildCreditsMetadata();
  assert.equal(credits.title, "Atribuciones");
  assert.equal(credits.alternates?.canonical, "/credits");
  assert.notEqual(credits.description, catalog.description);
});

test("an operator page uses the public slug and the preview of that operator, and an unknown slug only a title", () => {
  const amiya = operator("char_002_amiya", "Amiya");
  const metadata = buildOperatorMetadata({ operator: amiya, publicSlug: "amiya" }, (id) => `/assets/operator-og-images/${id}.jpg`);
  assert.equal(metadata.title, "Amiya: habilidades, módulos y estadísticas");
  assert.equal(metadata.alternates?.canonical, "/operators/amiya");
  assert.deepEqual((metadata.twitter as { images: string[] }).images, ["/assets/operator-og-images/char_002_amiya.jpg"]);
  assert.deepEqual(buildOperatorMetadata(null, () => assert.fail("no image without an operator")), buildNotFoundMetadata("Operador no encontrado"));
});

test("describes the site as a WebSite without a search action", () => {
  const data = buildWebSiteJsonLd("https://example.test");
  assert.equal(data["@context"], "https://schema.org");
  assert.equal(data["@type"], "WebSite");
  assert.equal(data.url, "https://example.test/");
  assert.equal(data.inLanguage, "es");
  assert.equal("potentialAction" in data, false);
});

test("builds breadcrumbs with consecutive positions and absolute URLs", () => {
  const data = buildBreadcrumbJsonLd("https://example.test", [{ name: "A", path: "/" }, { name: "B", path: "/b" }]);
  assert.equal(data["@type"], "BreadcrumbList");
  assert.deepEqual(data.itemListElement, [
    { "@type": "ListItem", position: 1, name: "A", item: "https://example.test/" },
    { "@type": "ListItem", position: 2, name: "B", item: "https://example.test/b" },
  ]);
  assert.deepEqual(buildCatalogBreadcrumbJsonLd("https://example.test").itemListElement.map((item) => item.name), ["Inicio", "Operadores"]);
  const trail = buildOperatorBreadcrumbJsonLd("https://example.test", operator("char_1", "Eyjafjalla"), "eyjafjalla").itemListElement;
  assert.deepEqual(trail.map((item) => [item.position, item.name, item.item]), [
    [1, "Inicio", "https://example.test/"],
    [2, "Operadores", "https://example.test/operators"],
    [3, "Eyjafjalla", "https://example.test/operators/eyjafjalla"],
  ]);
});

test("serialises JSON-LD as valid JSON that cannot close the script element", () => {
  const data = { "@context": "https://schema.org", name: "</script><b>x" };
  const text = serializeJsonLd(data);
  assert.doesNotMatch(text, /</);
  assert.deepEqual(JSON.parse(text), data);
});

test("the 404 metadata is not indexable and drops the canonical and the previews of the layout", () => {
  const metadata = buildNotFoundMetadata();
  assert.equal(metadata.title, "Página no encontrada");
  assert.equal(typeof metadata.description, "string");
  assert.equal(metadata.alternates, null);
  assert.equal(metadata.openGraph, null);
  assert.equal(metadata.twitter, null);
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.equal(buildNotFoundMetadata("Operador no encontrado").title, "Operador no encontrado");
});
