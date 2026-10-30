# Fuentes

Este documento recoge las fuentes de datos, recursos gráficos y herramientas utilizadas en Arknights Iberia, junto con sus respectivas atribuciones.

## Datos del juego

- [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata): snapshots EN/CN utilizados por el pipeline. Las tablas CN `gacha_table` y `roguelike_topic_table` del commit `e4888c5` (fijadas en `src/game-data/gamedata-revisions.ts`) dan las fechas CN de lanzamiento que pueden calcularse desde los datos del juego (ver «Anuncios oficiales»).
- [Arknights CDN](https://web.hycdn.cn/arknights/game/assets/char/portrait/): retratos por identificador `char_*`.

## Anuncios oficiales

Fecha de lanzamiento: la fecha, en la hora oficial del servidor de cada región (CN UTC+8, Global UTC−7), del primer momento en que el operador puede obtenerse en el juego (banner, evento, tienda, reclutamiento o historia principal). Las fechas CN de los operadores solo CN se registran por operador (`cnReleaseDateProvenance`) en `data/operator-regional-manifest.json` con los anuncios oficiales de Hypergryph:

- [SideStory «昨日海»](https://ak.hypergryph.com/news/5101): 2026-10-09, Clementia, Homebound y De Toledo.
- [«泡影苍霆»](https://ak.hypergryph.com/news/0701): 2026-06-01, Violet Mizutsune Orchid, Zinogre S Catapult y Rhodes Island Recon.
- [«丛林症结» y búsqueda «确定性混沌»](https://ak.hypergryph.com/news/9686): 2026-07-10, Aphrissa y Pedro.
- [«夏日嘉年华» 2026](https://ak.hypergryph.com/news/8571): 2026-08-01, Angelina the Mellow Wish, Thumpy, Jacinta y Timeslot.
- [«月行水上»](https://ak.hypergryph.com/news/9681): 2026-09-04, Makoto Yuki, Aigis, Yukari Takeba y Koromaru.

Mechanist (2026-07-17) se registra con [PRTS](https://prts.wiki/w/%E6%9C%BA%E6%A2%B0%E5%B8%88) a falta de anuncio oficial localizado.

Las fechas CN de los operadores Global (`data/operator-cn-release-manifest.json`) llevan estado y fuente por operador:

- Datos del juego (`verified`, 108 operadores): primer banner de `gacha_table` cuya lista de operadores lo incluye (esas listas solo existen hasta julio de 2019; las aperturas anteriores al lanzamiento del servidor CN, el 30 de abril de 2019, cuentan como esa fecha), banners limitados (`limitedCharId`) y temas de Integrated Strategies de `roguelike_topic_table` para los operadores que se obtienen en ellos. La fuente enlaza la tabla en la revisión fijada, con el banner o el tema como ancla.
- Anuncios oficiales de Hypergryph (`verified`, 11 operadores): [news/9603](https://ak.hypergryph.com/news/9603), [news/4942](https://ak.hypergryph.com/news/4942), [news/1461](https://ak.hypergryph.com/news/1461) y [news/3046](https://ak.hypergryph.com/news/3046).
- [PRTS](https://prts.wiki/w/%E5%B9%B2%E5%91%98%E4%B8%8A%E7%BA%BF%E6%97%B6%E9%97%B4%E4%B8%80%E8%A7%88) (`community-listed`, 296 operadores): página de cada operador. Todas las fechas anteriores coinciden con PRTS.

La tabla de lanzamientos de Terra Wiki ya no se usa como fuente de fechas: daba la fecha CN un día antes que los anuncios oficiales y PRTS.

## Wikis y documentación comunitaria

- [Terra Wiki](https://arknights.wiki.gg/): contraste de nombres y relaciones.
  - Nombres oficiales en inglés de los modos y temas a los que se limitan algunos efectos de módulo, que los datos del juego no incluyen: [Integrated Strategies](https://arknights.wiki.gg/wiki/Integrated_Strategies) (también el tema Sui's Garden of Grotesqueries) y [Reclamation Algorithm](https://arknights.wiki.gg/wiki/Reclamation_Algorithm). Consultado el 29 de octubre de 2026; registrados con su fuente en `data/operator-module-modes.json`.
  - Iconos de atributos (categoría `Template icons`) y de potencial P2–P6 (`Potential_2.png` a `Potential_6.png`), copiados localmente en `public/assets/operator-stats/` y `public/assets/operator-potential/`.
- [PRTS Wiki](https://prts.wiki/): referencia comunitaria para información CN y fuente de las fechas CN que no pueden calcularse desde los datos del juego ni tienen anuncio oficial localizado (ver «Anuncios oficiales»).

## Recursos gráficos

- [Arknight-Images](https://github.com/PuppiizSunniiz/Arknight-Images): retratos, ilustraciones e iconos externos referenciados por los componentes. Los iconos de habilidades se copian localmente desde `skills/` en el commit `1a41341cc634461a5abe3456722801a39b9a9d32` (`data/operator-skill-icons-manifest.json`), y los de maestría M1–M3 desde `ui/rank/` en el mismo commit (`public/assets/operator-skill-mastery/`). Los iconos de habilidades de base y de salas se copian desde `ui/infrastructure/skill/` y `ui/infrastructure/` en el mismo commit (`public/assets/operator-base-skills/` y `public/assets/operator-base-rooms/`). Los iconos de promoción E0–E2 se copian desde `ui/elite/` en el mismo commit (`public/assets/operator-elite/`). Los iconos de tipo de módulo se copian desde `equip/type/` en el mismo commit (`public/assets/operator-modules/`). Las ilustraciones de módulos se copian desde `equip/icon/` en el mismo commit y se convierten a WebP (`public/assets/operator-modules-art/`, `data/operator-module-art-manifest.json`), y los iconos de nivel de módulo desde `equip/stage/` sin modificar (`public/assets/operator-module-stages/`). Ambos se regeneran con `corepack pnpm data:module-art:sync` (`scripts/sync-operator-module-art.ts`), que fija la revisión y los parámetros de conversión y verifica cada archivo.
- [PRTS Design](https://github.com/MooncellWiki/prts-design): procedencia del icono de Operadores.
- [Magnific](https://www.magnific.com/): atribución indicada para el recurso del faro.

## Bibliotecas y herramientas

- [Lucide](https://lucide.dev/): iconos de interfaz utilizados mediante `lucide-react`.
- [Simple Icons](https://simpleicons.org/): logotipos de Discord y X de la portada, versión `16.36.0` (CC0 1.0), copiados localmente en `public/assets/contact/`.

La presencia de una fuente en este documento no constituye por sí misma una licencia de redistribución. Las condiciones de uso de recursos de terceros deben revisarse individualmente.
