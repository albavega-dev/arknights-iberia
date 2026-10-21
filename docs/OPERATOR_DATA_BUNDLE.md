# Bundle de datos de operadores

El contrato `operator-bundle` v1 representa operadores y biografías normalizados para las tablas actuales. No se incluyen snapshots ni bundles reales en este repositorio.

## Validación offline

```text
corepack pnpm run data:bundle:validate -- ruta/al/bundle.json
```

La validación comprueba la versión, estructura, IDs y slugs únicos, regiones, revisiones, hashes, orden determinista, relaciones de biografías y compatibilidad con el esquema. No conecta con PostgreSQL.

## Generación

El generador recibe cuatro snapshots locales fijados y escribe un bundle en una ruta explícita:

```text
corepack pnpm run data:bundle:generate -- --en-character ruta/en/character_table.json --cn-character ruta/cn/character_table.json --en-handbook ruta/en/handbook_info_table.json --cn-handbook ruta/cn/handbook_info_table.json --out ruta/operator-bundle.json
```

No descarga snapshots y verifica sus revisiones y SHA-256 esperados antes de generar la salida. Los registros y biografías se ordenan de forma determinista y el hash canónico excluye el bloque `integrity`.

## Procedencia

El bundle conserva las revisiones, rutas y hashes de los snapshots EN/CN utilizados. Las biografías regionales pueden faltar cuando no existen en la fuente; el generador no inventa contenido ni realiza traducciones automáticas.

La validación y generación son operaciones offline. La importación a PostgreSQL es un proceso administrativo separado y no forma parte del build ni del arranque de la aplicación.
