import type { Metadata } from "next";
import { LandingSeparator } from "./landing-separator";

export const metadata: Metadata = { title: "Arknights Iberia" };

const roadmap = [
  {
    title: "Operadores y personalización",
    items: [
      "Completar las fichas individuales con habilidades, talentos, módulos, voces y otros detalles.",
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
    title: "Traducciones al español",
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
              desarrolladora web, pero haciendo algo diferente a los típicos proyectos de estética corporativa.
            </p>
            <p>
              Como jugadora de Arknights llevo años acumulando información en notas (anotaciones propias, enlaces a webs
              con herramientas útiles, archivos excel, etc) y echando en falta el poder tenerlo todo en el mismo lugar.
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
              hacer uso de lo que vaya publicando aquí.
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
              He decidido publicar esta primera versión aunque el proyecto esté literalmente en pañales, principalmente
              para tener una muestra visible y funcional de mi trabajo como desarrolladora web. Mi intención es seguir
              ampliando la página, incorporando nuevos recursos y desarrollando las herramientas que tengo en mente. Eso
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
                <img
                  className="landing-contact-logo"
                  src="https://cdn.simpleicons.org/discord"
                  alt=""
                  aria-hidden="true"
                />
                <span>Discord de la comunidad</span>
              </a>
              <a href="https://x.com/ArknightsIberia" target="_blank" rel="noopener noreferrer">
                <img className="landing-contact-logo" src="https://cdn.simpleicons.org/x" alt="" aria-hidden="true" />
                <span>X / Twitter de la comunidad</span>
              </a>
            </nav>
          </div>
        </section>
        <LandingSeparator />
        <section className="landing-section" aria-labelledby="news-title">
          <div className="landing-section-content">
            <h2 id="news-title">Novedades</h2>
            <article className="landing-news-entry">
              <h3>23 de octubre de 2026 - 0.1.1</h3>
              <ul>
                <li><strong>Mejorada la carga de ilustraciones E2</strong><br />Se ha añadido un indicador de carga al cambiar a la ilustración E2 de los operadores, con una transición más fluida y sin parpadeos.</li>
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
