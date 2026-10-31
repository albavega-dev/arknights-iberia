import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { listOperatorRecords, listPreviousSlugs } from "../../../game-data/operator-catalog-data";
import { readOperatorBiography } from "../../../game-data/operator-biographies-data";
import { getOperatorPageTitle, resolveOperatorSlug } from "../../../game-data/operator-slugs";
import { buildPageMetadata, getOperatorPageDescription } from "../../../game-data/seo";
import { getOperatorTacticalEntry } from "../../../game-data/operator-tactical";
import { getOperatorArtistCredit } from "../../../game-data/operator-artist-credits";
import { getOperatorIllustrationAssets } from "../../../game-data/operator-illustrations-data";
import { getOperatorOgImageUrl } from "../../../game-data/operator-og-images-data";
import { isOperatorLimited } from "../../../game-data/operator-limited-data";
import { loadStatsProfile } from "../../../game-data/operator-stats-data";
import { loadSkillsView } from "../../../game-data/operator-skills-data";
import { loadModulesView } from "../../../game-data/operator-modules-data";
import { OperatorDetailData } from "./operator-detail-data";
import { loadOperatorDetailBiography } from "./operator-detail-biography";

type OperatorPageProps = { params: Promise<{ slug: string }> };

const resolveOperator = cache((slug: string) => {
  const records = listOperatorRecords();
  const resolved = resolveOperatorSlug(slug, records, listPreviousSlugs());
  return resolved ? { ...resolved, records } : null;
});

export async function generateMetadata({ params }: OperatorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = resolveOperator(slug);
  if (!resolved) return { title: "Operador no encontrado" };
  return buildPageMetadata({
    title: getOperatorPageTitle(resolved.operator),
    description: getOperatorPageDescription(resolved.operator),
    path: `/operators/${resolved.publicSlug}`,
    image: getOperatorOgImageUrl(resolved.operator.id),
  });
}

export const dynamic = "force-dynamic";

export default async function OperatorPage({ params }: OperatorPageProps) {
  const { slug } = await params;
  const resolved = resolveOperator(slug);
  if (!resolved) notFound();
  const { operator, records, publicSlug, redirect } = resolved;
  if (redirect) permanentRedirect(`/operators/${publicSlug}`);
  const detailBiography = await loadOperatorDetailBiography(slug, records, readOperatorBiography);
  if (detailBiography.status === "operator-not-found") notFound();
  const region = operator.cnOnly ? "cn" : "en";
  const stats = await loadStatsProfile(operator.id, region);
  const skills = await loadSkillsView(operator.id, region);
  const modules = await loadModulesView(operator.id, region, stats?.trait ?? []);

  return (
    <main className="operators-page" id="contenido">
      <div className="operator-detail-content">
      <OperatorDetailData operator={operator} stats={stats} skills={skills} modules={modules} illustrations={getOperatorIllustrationAssets(operator.id)} limited={isOperatorLimited(operator.id)} biography={detailBiography.biography} tactical={getOperatorTacticalEntry(operator.id)} artistCredit={getOperatorArtistCredit(operator.id)} />
      <footer className="operators-provenance">
        <p>Proyecto independiente de la comunidad, no afiliado oficialmente a Hypergryph, Yostar ni Gryphline. Arknights y sus elementos pertenecen a sus respectivos titulares.</p>
        <p className="operator-credit">Diseño y desarrollo web por <a href="https://albavega.vercel.app/" target="_blank" rel="noopener noreferrer">Alba Vega</a></p>
      </footer>
      </div>
    </main>
  );
}
