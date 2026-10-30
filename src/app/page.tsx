import type { Metadata } from "next";
import { LandingSeparator } from "./landing-separator";

export const metadata: Metadata = { title: "Arknights Iberia" };

const roadmap = [
  {
    title: "Operadores y personalización",
    items: [
      "Completar las fichas individuales con voces, skins y otros detalles.",
      "Recomendaciones de maestrías para habilidades.",
      "Calendario de cumpleaños de operadores.",
      "Galería de skins.",
      "Tier lists por modos de juego.",
      "Tier list de módulos.",
    ],
  },
  {
    title: "Herramientas y planificación",
    items: [
      "Optimizadores para las distintas tiendas de certificados.",
      "Optimizador de farmeo de materiales.",
      "Calculadora de reclutamiento.",
      "Planificadores de builds.",
      "Herramientas para modos de juego permanentes.",
      "Tablas para registrar clears de Nicheknights.",
    ],
  },
  {
    title: "Inventario y colecciones",
    items: [
      "Inventario personal de materiales, operadores y skins.",
      "Almacenamiento local inicialmente, con posibilidad de cuentas en el futuro.",
    ],
  },
  {
    title: "Traducciones al español (no es prioritario)",
    items: [
      "Traducciones no oficiales de perfiles de operadores, habilidades y módulos.",
      "Posible traducción de historias y eventos en el futuro.",
    ],
  },
] as const;

export default function Home() {
  return (
    <main className="landing-main" id="contenido">
      <header className="landing-hero">
        <div>
          <h1>Arknights Iberia</h1>
          <div className="landing-profile">
            <p className="landing-lead">
              Un espacio en español para reunir información, recursos y herramientas del Arknights original.
            </p>
          </div>
        </div>
      </header>
      <div className="landing-sections">
        <section className="landing-section" aria-label="Arknights Iberia">
          <div className="landing-section-content">
            <p>
              Arknights Iberia es un proyecto personal que nació de mis ganas de ampliar mi portfolio como
              desarrolladora web, haciendo algo diferente a los típicos proyectos de estética corporativa.
            </p>
            <p>
              Como jugadora de Arknights llevo años acumulando información en notas (anotaciones propias, enlaces a webs
              con herramientas útiles, archivos excel, etc) y siempre he echado en falta el poder tenerlo todo en el mismo lugar.
              Así surgió la idea de crear mi propia página: un espacio donde organizar esos recursos y desarrollar las
              funcionalidades que siempre quise tener.
            </p>
            <p>
              Elegí Iberia como identidad del proyecto porque es una región muy inspirada en la Península Ibérica
              (España + Portugal) y creo que la identidad le venía al pelo a una página dedicada a albergar recursos en
              español. Además, siempre ha sido mi región favorita dentro del universo Arknights.
            </p>
            <p>
              Al final he decidido dejar este proyecto en abierto y en constante evolución para que cualquiera pueda
              hacer uso de lo que vaya publicando aquí. <strong>AVISO:</strong> esto NO es un proyecto de traducción. Es, ante todo, un proyecto de desarrollo web y la traducción al español de los contenidos del juego es algo opcional que contemplaré hacer poco a poco a largo plazo.
            </p>
          </div>
        </section>
        <LandingSeparator />
        <section className="landing-section" aria-labelledby="roadmap-title">
          <div className="landing-section-content">
            <h2 id="roadmap-title">Hoja de ruta</h2>
            <p>
              <strong>Arknights Iberia está en fase beta y todavía tiene mucho camino por delante.</strong>
            </p>
            <p>
              Mi intención es seguir ampliando la página y desarrollando las herramientas que tengo en mente. Eso
              sí, este es un proyecto personal que compagino con mi trabajo y otras responsabilidades, así que iré
              avanzando siempre que tenga tiempo y ganas de dedicarle (de momento, muchas ganas y no tanto tiempo).
            </p>
            <p>
              Las ideas que aparecen a continuación son simplemente cosas que me gustaría explorar en el futuro. No
              representan un calendario de desarrollo ni una promesa de que todas vayan a implementarse.
            </p>
            <div className="roadmap-list">
              {roadmap.map((entry, index) => (
                <details key={entry.title} open={index === 0}>
                  <summary>{entry.title}</summary>
                  <ul>
                    {entry.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>
        </section>
        <LandingSeparator />
        <section className="landing-section" aria-labelledby="contact-title">
          <div className="landing-section-content">
            <h2 id="contact-title">Contacto</h2>
            <nav className="landing-contact" aria-label="Contacto de la comunidad">
              <a href="https://discord.gg/stCK4AS8SM" target="_blank" rel="noopener noreferrer">
                <img className="landing-contact-logo" src="/assets/contact/discord.svg" alt="" aria-hidden="true" />
                <span>Discord de la comunidad</span>
              </a>
              <a href="https://x.com/ArknightsIberia" target="_blank" rel="noopener noreferrer">
                <img className="landing-contact-logo" src="/assets/contact/x.svg" alt="" aria-hidden="true" />
                <span>Twitter de la comunidad</span>
              </a>
            </nav>
          </div>
        </section>
        <LandingSeparator />
        <section className="landing-section" aria-labelledby="news-title">
          <div className="landing-section-content">
            <h2 id="news-title">Novedades</h2>
            <article className="landing-news-entry">
              <h3>30 de octubre de 2026 - 0.2.1</h3>
              <ul>
                <li>La web sirve ahora todo su contenido desde datos versionados, sin depender de una base de datos externa.</li>
              </ul>
              <h4 className="landing-news-category">Errores corregidos:</h4>
              <ul>
                <li>Corregido desplazamiento irregular de los elementos de la columna de alcance del operador cuando el nombre de la skill variaba mucho en longitud.</li>
                <li>Corregido aviso de ilustración no disponible, que ahora muestra correctamente qué ilustración (E0/E1 o E2) no ha podido cargarse.</li>
              </ul>
            </article>
            <article className="landing-news-entry">
              <h3>30 de octubre de 2026 - 0.2.0</h3>
              <ul>
                <li><strong>Pestaña de estadísticas rellena:</strong> muestra las estadísticas de cada operador según su nivel, promoción, confianza y potencial. También incluye el rasgo y los talentos.</li>
                <li><strong>Pestaña de habilidades rellena:</strong> incluye variaciones con niveles y maestrías y el rango.</li>
                <li><strong>Pestaña de módulos rellena</strong> con sus tres niveles e ilustraciones.</li>
              </ul>
              <h4 className="landing-news-category">Errores corregidos:</h4>
              <ul>
                <li>Corregido desplazamiento irregular de los elementos de la columna de alcance del operador cuando el nombre de la skill variaba mucho en longitud.</li>
                <li>Corregido aviso de ilustración no disponible, que ahora muestra correctamente qué ilustración (E0/E1 o E2) no ha podido cargarse.</li>
              </ul>
            </article>
            <article className="landing-news-entry">
              <h3>23 de octubre de 2026 - 0.1.1</h3>
              <ul>
                <li><strong>Mejorada la carga de ilustraciones E2</strong><br />Se ha añadido un indicador de carga al cambiar a la ilustración E2 de los operadores, con una transición más fluida y sin parpadeos.</li>
                <li>
                  <strong>Cabecera móvil renovada</strong>
                  <br />
                  Se ha unificado el título y el color de la cabecera para una identidad visual más coherente.
                </li>
              </ul>
              <h4 className="landing-news-category">Errores corregidos:</h4>
              <ul>
                <li>
                  <strong>Corregido el estado visual de los filtros móviles</strong>
                  <br />
                  Se ha corregido un problema que podía mostrar incorrectamente los botones seleccionados al utilizar los filtros en dispositivos táctiles.
                </li>
              </ul>
            </article>
            <article className="landing-news-entry">
              <h3>21 de octubre de 2026 - 0.1.0</h3>
              <ul>
                <li>Primera versión beta de Arknights Iberia.</li>
                <li>Catálogo de operadores con sus fichas individuales (incompletas).</li>
              </ul>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
