# Fuentes

Este documento recoge las fuentes de datos, recursos gráficos y herramientas utilizadas en Arknights Iberia, junto con sus respectivas atribuciones.

## Revisiones fijadas

Las secciones marcadas con `sources:` se generan con `corepack pnpm docs:sources` desde las revisiones fijadas (`src/game-data/gamedata-revisions.ts` y `src/game-data/asset-revisions.ts`) y los manifiestos de fechas de `data/`.

<!-- sources:revisions -->
| Fuente | Uso | Revisión fijada |
| --- | --- | --- |
| [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata) | Datos del juego EN | [`409bce7`](https://github.com/ArknightsAssets/ArknightsGamedata/tree/409bce70516f2420af61b1fc5680da60e448ab99) |
| [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata) | Datos del juego CN | [`84bbfbb`](https://github.com/ArknightsAssets/ArknightsGamedata/tree/84bbfbb4978f3545645264bf741356a64909439f) |
| [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata) | Fechas CN calculadas (`gacha_table`, `roguelike_topic_table`) | [`84bbfbb`](https://github.com/ArknightsAssets/ArknightsGamedata/tree/84bbfbb4978f3545645264bf741356a64909439f) |
| [Arknight-Images](https://github.com/PuppiizSunniiz/Arknight-Images) | Ilustraciones e iconos | [`1a41341`](https://github.com/PuppiizSunniiz/Arknight-Images/tree/1a41341cc634461a5abe3456722801a39b9a9d32) |
| [web.hycdn.cn](https://web.hycdn.cn/arknights/game/assets/char/portrait/) | Retratos | Sin revisiones: `Content-MD5` y ETag de cada archivo en `data/operator-portrait-manifest.json` |
<!-- /sources:revisions -->

## Datos del juego

- [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata): snapshots EN/CN utilizados por el pipeline, en las revisiones fijadas. Las tablas CN `gacha_table` y `roguelike_topic_table` dan las fechas CN de lanzamiento que pueden calcularse desde los datos del juego (ver «Anuncios oficiales»).
- [Arknights CDN](https://web.hycdn.cn/arknights/game/assets/char/portrait/): retratos por identificador `char_*`.

## Anuncios oficiales

Fecha de lanzamiento: la fecha, en la hora oficial del servidor de cada región (CN UTC+8, Global UTC−7), del primer momento en que el operador puede obtenerse en el juego (banner, evento, tienda, reclutamiento o historia principal). Las fechas CN de los operadores solo CN se registran por operador (`cnReleaseDateProvenance`) en `data/operator-regional-manifest.json`, con los anuncios oficiales de Hypergryph o, si no se localiza el anuncio, con PRTS:

<!-- sources:cn-only-dates -->
- [«泡影苍霆»](https://ak.hypergryph.com/news/0701): 2026-06-01, Violet Mizutsune Orchid, Zinogre S Catapult y Rhodes Island Recon.
- [«丛林症结» y búsqueda «确定性混沌»](https://ak.hypergryph.com/news/9686): 2026-07-10, Aphrissa y Pedro.
- [«夏日嘉年华» 2026](https://ak.hypergryph.com/news/8571): 2026-08-01, Angelina the Mellow Wish, Thumpy, Timeslot y Jacinta.
- [«月行水上»](https://ak.hypergryph.com/news/9681): 2026-09-04, Makoto Yuki, Aegis, Yukari Takeba y Koromaru.
- [SideStory «昨日海»](https://ak.hypergryph.com/news/5101): 2026-10-09, de Toledo, Clementia y Homebound.
- Mechanist (2026-07-17): [PRTS](https://prts.wiki/w/%E6%9C%BA%E6%A2%B0%E5%B8%88), `community-listed`, a falta de anuncio oficial localizado.
<!-- /sources:cn-only-dates -->

Las fechas CN de los operadores Global (`data/operator-cn-release-manifest.json`) llevan estado y fuente por operador:

<!-- sources:cn-dates -->
- Datos del juego (`verified`, 108 operadores): primer banner de `gacha_table` cuya lista de operadores lo incluye (esas listas solo existen hasta julio de 2019; las aperturas anteriores al lanzamiento del servidor CN, el 30 de abril de 2019, cuentan como esa fecha), banners limitados (`limitedCharId`) y temas de Integrated Strategies de `roguelike_topic_table` para los operadores que se obtienen en ellos. La fuente enlaza la tabla en la revisión fijada, con el banner o el tema como ancla.
- Anuncios oficiales de Hypergryph (`verified`, 11 operadores): [news/1461](https://ak.hypergryph.com/news/1461), [news/3046](https://ak.hypergryph.com/news/3046), [news/4942](https://ak.hypergryph.com/news/4942) y [news/9603](https://ak.hypergryph.com/news/9603).
- [PRTS](https://prts.wiki/) (`community-listed`, 296 operadores): página de cada operador.
<!-- /sources:cn-dates -->

Todas las fechas de los datos del juego y de los anuncios oficiales coinciden con PRTS. La tabla de lanzamientos de Terra Wiki ya no se usa como fuente de fechas: daba la fecha CN un día antes que los anuncios oficiales y PRTS.

Las aperturas de Global que marcan los operadores nuevos (`data/operator-global-updates.json`) se toman del anuncio de Yostar (`verified`) o de la página del evento en Terra Wiki (`community-listed`), en la hora del servidor Global:

<!-- sources:global-updates -->
- [Main Theme Episode 17: Critical Phase Transition](https://www.arknights.global/news/4814): apertura 2026-10-14 10:00 (UTC−7), 5 operadores, `verified`.
<!-- /sources:global-updates -->

## Wikis y documentación comunitaria

- [Terra Wiki](https://arknights.wiki.gg/): contraste de nombres y relaciones.
  - Nombres oficiales en inglés de los modos y temas a los que se limitan algunos efectos de módulo, que los datos del juego no incluyen: [Integrated Strategies](https://arknights.wiki.gg/wiki/Integrated_Strategies) (también el tema Sui's Garden of Grotesqueries) y [Reclamation Algorithm](https://arknights.wiki.gg/wiki/Reclamation_Algorithm). Consultado el 29 de octubre de 2026; registrados con su fuente en `data/operator-module-modes.json`.
  - Iconos de atributos (categoría `Template icons`) y de potencial P2–P6 (`Potential_2.png` a `Potential_6.png`), copiados localmente en `public/assets/operator-stats/` y `public/assets/operator-potential/`.
- [PRTS Wiki](https://prts.wiki/): referencia comunitaria para información CN y fuente de las fechas CN que no pueden calcularse desde los datos del juego ni tienen anuncio oficial localizado (ver «Anuncios oficiales»).

## Recursos gráficos

- [Arknight-Images](https://github.com/PuppiizSunniiz/Arknight-Images): retratos, ilustraciones e iconos externos referenciados por los componentes. Los iconos de habilidades se copian localmente desde `skills/` en la revisión fijada (ver «Revisiones fijadas»; `data/operator-skill-icons-manifest.json`), y los de maestría M1–M3 desde `ui/rank/` en el mismo commit (`public/assets/operator-skill-mastery/`). Los iconos de habilidades de base y de salas se copian desde `ui/infrastructure/skill/` y `ui/infrastructure/` en el mismo commit (`public/assets/operator-base-skills/` y `public/assets/operator-base-rooms/`). Los iconos de promoción E0–E2 se copian desde `ui/elite/` en el mismo commit (`public/assets/operator-elite/`). Los iconos de tipo de módulo se copian desde `equip/type/` en el mismo commit (`public/assets/operator-modules/`). Las ilustraciones de módulos se copian desde `equip/icon/` en el mismo commit y se convierten a WebP (`public/assets/operator-modules-art/`, `data/operator-module-art-manifest.json`), y los iconos de nivel de módulo desde `equip/stage/` sin modificar (`public/assets/operator-module-stages/`). Ambos se regeneran con `corepack pnpm data:module-art:sync` (`scripts/sync-operator-module-art.ts`), que fija la revisión y los parámetros de conversión y verifica cada archivo.
- [PRTS Design](https://github.com/MooncellWiki/prts-design): procedencia del icono de Operadores.
- [Magnific](https://www.magnific.com/): atribución indicada para el recurso del faro.

## Bibliotecas y herramientas

- [Lucide](https://lucide.dev/): iconos de interfaz utilizados mediante `lucide-react`.
- [Simple Icons](https://simpleicons.org/): logotipos de Discord y X de la portada, versión `16.36.0` (CC0 1.0), copiados localmente en `public/assets/contact/`.

La presencia de una fuente en este documento no constituye por sí misma una licencia de redistribución. Las condiciones de uso de recursos de terceros deben revisarse individualmente.
