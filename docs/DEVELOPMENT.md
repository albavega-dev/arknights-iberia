# Desarrollo local

## Requisitos

- Node.js 20.9 o posterior.
- Corepack y pnpm.

No hace falta base de datos ni Docker: el contenido se sirve desde los archivos JSON versionados en `data/`.

## Instalación y arranque

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

## Variables de entorno

La aplicación no necesita ninguna. Los scripts de GameData (`data:check-updates`, `data:snapshot`) leen un `GITHUB_TOKEN` opcional desde `.env.local` para no agotar el límite de peticiones de la API de GitHub; `.env.example` sirve de plantilla. No guardar credenciales en Git.

## Comprobaciones

```powershell
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm run format:css:check
corepack pnpm test:unit
corepack pnpm test:components
corepack pnpm build
corepack pnpm check:encoding:all
```

Las pruebas de extremo a extremo (`corepack pnpm test:e2e`) necesitan los navegadores de Playwright (`corepack pnpm exec playwright install chromium`) y un build previo.

`/api/health` devuelve el estado del servicio; `/api/ready` comprueba que los índices de los conjuntos de datos de `data/` son válidos.
