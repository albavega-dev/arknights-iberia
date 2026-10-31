import type { Metadata } from "next";
import { Suspense } from "react";

import { listOperatorRecords } from "../../game-data/operator-catalog-data";
import { buildPageMetadata, getCatalogPageDescription } from "../../game-data/seo";
import { OperatorsData } from "./operators-data";

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: "Operadores de Arknights en español", description: getCatalogPageDescription(listOperatorRecords().length), path: "/operators" });
}

export default async function OperatorsPage() {
  return (
    <main className="operators-page" id="contenido">
      <div className="operators-content">
        <header className="operators-heading">
          <h1>Operadores</h1>
        </header>
        <Suspense fallback={<p className="operators-empty" role="status">Cargando operadores…</p>}>
          <OperatorsData />
        </Suspense>
        <footer className="operators-provenance">
          <p>Proyecto independiente de la comunidad, no afiliado oficialmente a Hypergryph, Yostar ni Gryphline. Arknights y sus elementos pertenecen a sus respectivos titulares.</p>
          <p className="operator-credit">Diseño y desarrollo web por <a href="https://albavega.vercel.app/" target="_blank" rel="noopener noreferrer">Alba Vega</a></p>
        </footer>
      </div>
    </main>
  );
}
