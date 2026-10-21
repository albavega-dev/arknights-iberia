# Desarrollo local

## Requisitos

- Node.js 20.9 o posterior.
- Corepack y pnpm.
- Docker Desktop si se desea utilizar el PostgreSQL local definido en `compose.yaml`.

## Instalación

```powershell
corepack pnpm install --frozen-lockfile
Copy-Item .env.example .env
```

Completa las variables de `.env` con valores locales. No guardes credenciales en Git.

## PostgreSQL

`compose.yaml` proporciona PostgreSQL para desarrollo local. La aplicación usa `APP_DB_*`, `POSTGRES_DB`, `DB_HOST`, `DB_PORT`, `DB_CONNECTION_MODE` y `DB_TLS_MODE` según la configuración de ejemplo.

Una base vacía contiene únicamente el esquema después de aplicar las migraciones; el catálogo requiere cargar un bundle compatible por un procedimiento separado. Los datos reales no forman parte de este repositorio.

## Migraciones y aplicación

Las migraciones se revisan y aplican manualmente con Drizzle Kit:

```powershell
corepack pnpm exec drizzle-kit migrate
corepack pnpm dev
```

Las migraciones no se ejecutan durante `build` ni durante el arranque de Next.js. No uses credenciales remotas en desarrollo local.

## Comprobaciones

```powershell
corepack pnpm lint
corepack pnpm exec tsc --noEmit
corepack pnpm run format:css:check
corepack pnpm test:unit
corepack pnpm build
corepack pnpm check:encoding:all
```

La disponibilidad de `/api/health` no requiere base de datos; `/api/ready` comprueba la conexión configurada.
