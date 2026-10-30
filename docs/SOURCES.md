# Fuentes

Este documento recoge las fuentes de datos, recursos gráficos y herramientas utilizadas en Arknights Iberia, junto con sus respectivas atribuciones.

## Datos del juego

- [ArknightsGamedata](https://github.com/ArknightsAssets/ArknightsGamedata): snapshots EN/CN utilizados por el pipeline.
- [Arknights CDN](https://web.hycdn.cn/arknights/game/assets/char/portrait/): retratos por identificador `char_*`.

## Anuncios oficiales

- [Anuncio oficial de Hypergryph de la SideStory «昨日海»](https://ak.hypergryph.com/news/5101) (publicado el 3 de octubre de 2026): fecha CN 2026-10-09 de Clementia, Homebound y De Toledo, registrada como procedencia de cada operador (`cnReleaseDateProvenance`) en `data/operator-regional-manifest.json`.

## Wikis y documentación comunitaria

- [Terra Wiki](https://arknights.wiki.gg/): contraste de nombres, fechas y relaciones.
  - Nombres oficiales en inglés de los modos y temas a los que se limitan algunos efectos de módulo, que los datos del juego no incluyen: [Integrated Strategies](https://arknights.wiki.gg/wiki/Integrated_Strategies) (también el tema Sui's Garden of Grotesqueries) y [Reclamation Algorithm](https://arknights.wiki.gg/wiki/Reclamation_Algorithm). Consultado el 29 de octubre de 2026; registrados con su fuente en `data/operator-module-modes.json`.
  - Iconos de atributos (categoría `Template icons`) y de potencial P2–P6 (`Potential_2.png` a `Potential_6.png`), copiados localmente en `public/assets/operator-stats/` y `public/assets/operator-potential/`.
- [PRTS Wiki](https://prts.wiki/): referencia comunitaria para información CN.

## Recursos gráficos

- [Arknight-Images](https://github.com/PuppiizSunniiz/Arknight-Images): retratos, ilustraciones e iconos externos referenciados por los componentes. Los iconos de habilidades se copian localmente desde `skills/` en el commit `1a41341cc634461a5abe3456722801a39b9a9d32` (`data/operator-skill-icons-manifest.json`), y los de maestría M1–M3 desde `ui/rank/` en el mismo commit (`public/assets/operator-skill-mastery/`). Los iconos de habilidades de base y de salas se copian desde `ui/infrastructure/skill/` y `ui/infrastructure/` en el mismo commit (`public/assets/operator-base-skills/` y `public/assets/operator-base-rooms/`). Los iconos de promoción E0–E2 se copian desde `ui/elite/` en el mismo commit (`public/assets/operator-elite/`). Los iconos de tipo de módulo se copian desde `equip/type/` en el mismo commit (`public/assets/operator-modules/`). Las ilustraciones de módulos se copian desde `equip/icon/` en el mismo commit y se convierten a WebP (`public/assets/operator-modules-art/`, `data/operator-module-art-manifest.json`), y los iconos de nivel de módulo desde `equip/stage/` sin modificar (`public/assets/operator-module-stages/`). Ambos se regeneran con `corepack pnpm data:module-art:sync` (`scripts/sync-operator-module-art.ts`), que fija la revisión y los parámetros de conversión y verifica cada archivo.
- [PRTS Design](https://github.com/MooncellWiki/prts-design): procedencia del icono de Operadores.
- [Magnific](https://www.magnific.com/): atribución indicada para el recurso del faro.

## Bibliotecas y herramientas

- [Lucide](https://lucide.dev/): iconos de interfaz utilizados mediante `lucide-react`.
- [Simple Icons](https://simpleicons.org/): logotipos de Discord y X de la portada, versión `16.36.0` (CC0 1.0), copiados localmente en `public/assets/contact/`.

La presencia de una fuente en este documento no constituye por sí misma una licencia de redistribución. Las condiciones de uso de recursos de terceros deben revisarse individualmente.
