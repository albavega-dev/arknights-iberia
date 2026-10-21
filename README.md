# Arknights Iberia

Arknights Iberia es un proyecto comunitario, independiente, gratuito y no oficial para reunir información y recursos de Arknights en español. No está afiliado a Hypergryph, Gryphline ni Yostar.

La beta actual incluye un catálogo consultable de operadores, búsqueda, filtros, ordenación, fichas individuales básicas, biografías disponibles y navegación responsive. La cobertura de datos y recursos sigue siendo provisional.

## Tecnologías y requisitos

- Node.js 20.9 o posterior.
- Next.js 16.4 con App Router.
- TypeScript estricto, ESLint y pnpm mediante Corepack.
- PostgreSQL para las rutas que consultan el catálogo.

## Inicio rápido

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
corepack pnpm dev
```

Configurar `.env` únicamente con valores locales. No publicar credenciales ni archivos `.env`. La aplicación queda disponible en `http://localhost:3000`.

Una base PostgreSQL vacía necesita las migraciones y un conjunto de datos compatible antes de mostrar el catálogo. No se incluyen snapshots ni bundles reales en este repositorio.

## Validación

```powershell
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm run format:css:check
corepack pnpm test:unit
corepack pnpm build
corepack pnpm check:encoding:all
```

## Documentación

- [Desarrollo local](docs/DEVELOPMENT.md)
- [Política de contenido fan](docs/FAN_CONTENT_POLICY.md)
- [Atribuciones](docs/ASSET_CREDITS.md)
- [Fuentes](docs/SOURCES.md)
- [Bundle de datos de operadores](docs/OPERATOR_DATA_BUNDLE.md)
- [Hoja de ruta](docs/ROADMAP.md)

## Derechos de terceros

Arknights, sus personajes, ilustraciones, marcas y demás materiales originales pertenecen a sus respectivos titulares. Las atribuciones y referencias de este repositorio no constituyen por sí mismas una licencia o autorización para redistribuir recursos de terceros.
