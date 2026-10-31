import type { Metadata } from "next";

import { buildCreditsMetadata } from "../../game-data/seo";

export const metadata: Metadata = buildCreditsMetadata();

const sourceGroups = [
  {
    title: "Datos del juego",
    sources: [
      {
        name: "ArknightsGamedata",
        href: "https://github.com/ArknightsAssets/ArknightsGamedata",
      },
    ],
  },
  {
    title: "Wikis y documentación comunitaria",
    sources: [
      {
        name: "Terra Wiki",
        href: "https://arknights.wiki.gg/",
      },
      {
        name: "PRTS Wiki",
        href: "https://prts.wiki/",
      },
    ],
  },
  {
    title: "Recursos gráficos",
    sources: [
      {
        name: "Arknight-Images",
        href: "https://github.com/PuppiizSunniiz/Arknight-Images",
      },
      {
        name: "Arknights CDN",
        href: "https://web.hycdn.cn/arknights/game/assets/char/portrait/",
      },
      {
        name: "PRTS Design",
        href: "https://github.com/MooncellWiki/prts-design",
      },
      {
        name: "Magnific",
        href: "https://www.magnific.com/",
      },
    ],
  },
  {
    title: "Bibliotecas y herramientas",
    sources: [
      {
        name: "Lucide",
        href: "https://lucide.dev/",
      },
    ],
  },
] as const;

export default function CreditsPage() {
  return (
    <main className="credits-main" id="contenido">
      <header className="credits-hero">
        <div className="credits-content">
          <h1>Atribuciones</h1>
          <div className="credits-intro">
            <p>
              Arknights Iberia es un proyecto personal, independiente y no oficial, creado para reunir información y
              recursos de Arknights en español. No está afiliado a Hypergryph ni a Yostar.
            </p>
            <p>
              Arknights, sus personajes, ilustraciones, marcas y demás contenidos originales pertenecen a sus
              respectivos titulares.
            </p>
            <p>
              En esta página se recogen las principales fuentes de información, recursos gráficos y herramientas
              utilizadas para desarrollar el proyecto.
            </p>
          </div>
        </div>
      </header>
      <div className="credits-content credits-sections">
        {sourceGroups.map((group, index) => (
          <section className="credits-section" key={group.title} aria-labelledby={`credits-${index}`}>
            <h2 id={`credits-${index}`}>{group.title}</h2>
            {group.sources.length ? (
              <ul className="credits-source-list">
                {group.sources.map((source) => (
                  <li className="credits-source" key={source.name}>
                    <a href={source.href} target="_blank" rel="noopener noreferrer">
                      {source.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
      <footer className="credits-attribution">
        Diseño y desarrollo web por{" "}
        <a href="https://albavega.vercel.app/" target="_blank" rel="noopener noreferrer">
          Alba Vega
        </a>
      </footer>
    </main>
  );
}
