import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { listOperators } from "../../../server/db/operator-repository";
import { readBiographyByOperatorIdFromDatabase } from "../../../server/db/operator-biography-database-reader";
import { getOperatorPageTitle, getOperatorPublicSlug, getOperatorPublicSlugs } from "../../../game-data/operator-slugs";
import { getOperatorTacticalEntry } from "../../../game-data/operator-tactical";
import { getOperatorArtistCredit } from "../../../game-data/operator-artist-credits";
import { loadStatsProfile } from "../../../game-data/operator-stats-data";
import { loadSkillsView } from "../../../game-data/operator-skills-data";
import { loadModulesView } from "../../../game-data/operator-modules-data";
import { OperatorDetailData } from "./operator-detail-data";
import { loadOperatorDetailBiography } from "./operator-detail-biography";

type OperatorPageProps = { params: Promise<{ slug: string }> };

const resolveOperator = cache(async (slug: string) => {
  const records = await listOperators();
  const publicSlugs = getOperatorPublicSlugs(records);
  const operator = records.find((record) => record.slug === slug || publicSlugs.get(record.id) === slug);
  return operator ? { operator, records, publicSlug: getOperatorPublicSlug(operator, records) } : null;
});

export async function generateMetadata({ params }: OperatorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveOperator(slug);
  return {
    title: resolved ? getOperatorPageTitle(resolved.operator) : "Operador - Arknights Iberia",
    description: "Ficha pública de operador a partir de datos importados.",
  };
}

export const dynamic = "force-dynamic";

export default async function OperatorPage({ params }: OperatorPageProps) {
  const { slug } = await params;
  await connection();
  const resolved = await resolveOperator(slug);
  if (!resolved) notFound();
  const { operator, records, publicSlug } = resolved;
  if (operator.slug === slug && publicSlug !== slug) permanentRedirect(`/operators/${publicSlug}`);
  const detailBiography = await loadOperatorDetailBiography(slug, records, readBiographyByOperatorIdFromDatabase);
  if (detailBiography.status === "operator-not-found") notFound();
  const region = operator.cnOnly ? "cn" : "en";
  const stats = await loadStatsProfile(operator.id, region);
  const skills = await loadSkillsView(operator.id, region);
  const modules = await loadModulesView(operator.id, region, stats?.trait ?? []);

  return (
    <main className="operators-page" id="contenido">
      <div className="operator-detail-content">
      <OperatorDetailData operator={operator} stats={stats} skills={skills} modules={modules} biography={detailBiography.biography} tactical={getOperatorTacticalEntry(operator.id)} artistCredit={getOperatorArtistCredit(operator.id)} />
      <footer className="operators-provenance">
        <p>Proyecto independiente de la comunidad, no afiliado oficialmente a Hypergryph, Yostar ni Gryphline. Arknights y sus elementos pertenecen a sus respectivos titulares.</p>
        <p className="operator-credit">Diseño y desarrollo web por <a href="https://albavega.vercel.app/" target="_blank" rel="noopener noreferrer">Alba Vega</a></p>
      </footer>
      </div>
    </main>
  );
}
