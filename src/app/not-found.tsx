import type { Metadata } from "next";
import { buildNotFoundMetadata } from "../game-data/seo";

export const metadata: Metadata = buildNotFoundMetadata();

export default function NotFound() {
  return (
    <main className="not-found-main" id="contenido">
      <div className="not-found-content">
        <span className="not-found-beacon" aria-hidden="true" />
        <p className="not-found-code">Error 404</p>
        <h1>Esta ruta no llega a ningún puerto</h1>
        <p className="not-found-lead">
          La página que buscas no existe, ha cambiado de sitio o el enlace tiene un error. El faro de Iberia sigue encendido: utiliza el menú para navegar a una página válida.
        </p>
      </div>
    </main>
  );
}
