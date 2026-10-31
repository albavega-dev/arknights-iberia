import type { Metadata, MetadataRoute } from "next";

import { getOperatorPageTitle, getOperatorPublicSlugs } from "./operator-slugs";
import { getOperatorArchetypeName } from "./operator-archetypes";
import { compareCodeUnits } from "./string-order";
import { ogConversion, ogSiteImageUrl } from "./operator-og-images";
import { getOperatorDisplayName, type OperatorRecord } from "./operators";

export const siteName = "Arknights Iberia";
export const siteTitle = "Arknights en español: operadores, habilidades y módulos";
export const siteDescription = "Web comunitaria de Arknights en español: catálogo de operadores con habilidades, módulos, estadísticas y recursos gráficos.";

const developmentOrigin = "http://localhost:3000";

/** Origin of the site: the production domain of the Vercel project, or localhost outside Vercel. */
export function getSiteOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return host ? `https://${host}` : developmentOrigin;
}

/** `image` is the preview of the operator; without it, the site image. */
type PageMetadataInput = Readonly<{ title: string; description: string; path: string; image?: string }>;

export const previewImage = (url: string) => ({ url, width: ogConversion.width, height: ogConversion.height });

/**
 * Metadata of a page. Open Graph and Twitter replace the ones of the layout instead of merging with them, so each page
 * repeats them; their titles are final because the layout template only applies to the document title.
 */
export function buildPageMetadata({ title, description, path, image = ogSiteImageUrl() }: PageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName, locale: "es_ES", title: `${title} | ${siteName}`, description, url: path, images: [previewImage(image)] },
    twitter: { card: "summary_large_image", title: `${title} | ${siteName}`, description, images: [image] },
  };
}

const classLabels: Record<OperatorRecord["class"], string> = {
  Guard: "Guard", Vanguard: "Vanguard", Defender: "Defender", Sniper: "Sniper",
  Caster: "Caster", Specialist: "Specialist", Supporter: "Supporter", Medic: "Medic",
};

export function getOperatorPageDescription(operator: Pick<OperatorRecord, "name" | "cnName" | "globalName" | "class" | "subClassId" | "rarity" | "cnOnly">): string {
  const archetype = operator.subClassId ? ` y arquetipo ${getOperatorArchetypeName(operator.subClassId)}` : "";
  const availability = operator.cnOnly ? " Disponible por ahora solo en CN." : "";
  return `${getOperatorDisplayName(operator)} es un operador de ${operator.rarity} estrellas de la clase ${classLabels[operator.class]}${archetype} en Arknights. Consulta sus habilidades, módulos y estadísticas en español.${availability}`;
}

export function getCatalogPageDescription(operatorCount: number): string {
  return `Catálogo de ${operatorCount} operadores de Arknights en español: filtra por clase, arquetipo, rareza y facción y consulta sus habilidades, módulos y estadísticas.`;
}

/** Metadata of the root layout, inherited by every page that does not replace it. */
export function buildSiteMetadata(origin: string): Metadata {
  const title = `${siteTitle} | ${siteName}`;
  return {
    metadataBase: new URL(origin),
    title: { default: title, template: `%s | ${siteName}` },
    description: siteDescription,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName, locale: "es_ES", title, description: siteDescription, url: "/", images: [previewImage(ogSiteImageUrl())] },
    twitter: { card: "summary_large_image", title, description: siteDescription, images: [ogSiteImageUrl()] },
  };
}

export function buildCatalogMetadata(operatorCount: number): Metadata {
  return buildPageMetadata({ title: "Operadores de Arknights en español", description: getCatalogPageDescription(operatorCount), path: "/operators" });
}

export function buildCreditsMetadata(): Metadata {
  return buildPageMetadata({
    title: "Atribuciones",
    description: "Fuentes de datos, wikis, recursos gráficos y bibliotecas en los que se apoya Arknights Iberia, con su autoría y licencias.",
    path: "/credits",
  });
}

/** Metadata of an operator page; an unknown slug gets a plain title because the page answers 404. */
export function buildOperatorMetadata(resolved: Readonly<{ operator: OperatorRecord; publicSlug: string }> | null, imageUrlOf: (operatorId: string) => string): Metadata {
  if (!resolved) return { title: "Operador no encontrado" };
  return buildPageMetadata({
    title: getOperatorPageTitle(resolved.operator),
    description: getOperatorPageDescription(resolved.operator),
    path: `/operators/${resolved.publicSlug}`,
    image: imageUrlOf(resolved.operator.id),
  });
}

/** Crawlers that collect content to train AI models; answering assistants and search engines stay allowed. */
export const aiTrainingCrawlers = [
  "GPTBot", "CCBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Applebot-Extended", "meta-externalagent", "FacebookBot",
  "Bytespider", "Amazonbot", "cohere-ai", "cohere-training-data-crawler", "Diffbot", "ImagesiftBot", "omgili", "PanguBot", "Timpibot",
] as const;

export function buildRobots(origin: string): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: "/api/" },
      { userAgent: [...aiTrainingCrawlers], disallow: "/" },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}

export function buildSitemap(origin: string, records: readonly OperatorRecord[]): MetadataRoute.Sitemap {
  const paths = ["/", "/operators", "/credits", ...[...getOperatorPublicSlugs(records).values()].sort(compareCodeUnits).map((slug) => `/operators/${slug}`)];
  return paths.map((path) => ({ url: `${origin}${path === "/" ? "" : path}` }));
}
