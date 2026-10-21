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

El bundle conserva las revisiones, rutas y hashes de los snapshots EN/CN utilizados. Para los operadores presentes únicamente en el snapshot CN, `name` usa el `nameEnglish` del manifiesto regional cuando existe, mientras `cnName` conserva literalmente el nombre chino del snapshot. Estos nombres están marcados como `community-listed`: no son traducciones oficiales y no se generan automáticamente. Las biografías regionales pueden faltar cuando no existen en la fuente; el generador no inventa contenido ni realiza traducciones automáticas.

La validación y generación son operaciones offline. La importación a PostgreSQL es un proceso administrativo separado y no forma parte del build ni del arranque de la aplicación.
## Sincronización de fechas CN

El diagnóstico conectado, siempre de solo lectura, se ejecuta con:

```text
corepack pnpm run data:cn-sync -- --connected-dry-run
```

La futura escritura local exigirá además `--apply --confirm-local-cn-sync` y las
variables `CN_SYNC_DB_*`. Antes de escribir se comprueba el conjunto exacto de
432 operadores, se rechazan IDs ausentes, inesperados o duplicados y se bloquean
fechas existentes diferentes. Las fechas desconocidas no borran valores
existentes.

El repositorio incluye `data:cn-sync` para preparar una sincronización limitada de
`cn_release_date`. El comando es dry-run por defecto y solo considera fechas con
procedencia conocida; las entradas sin fecha, como Clementia mientras no exista
evidencia individual suficiente, permanecen desconocidas.

La escritura futura requiere las variables locales `CN_SYNC_DB_HOST`,
`CN_SYNC_DB_PORT`, `CN_SYNC_DB_NAME`, `CN_SYNC_DB_USER` y
`CN_SYNC_DB_PASSWORD`, además de `--apply --confirm-local-cn-sync`. Solo se
aceptan destinos localhost, `127.0.0.1` o `::1`. El sincronizador no ejecuta
migraciones, no modifica `global_release_date`, nombres, facciones, relaciones ni
biografías, y usa una transacción con verificación posterior.

La herramienta no debe ejecutarse con el rol runtime ni contra Neon. La
integración remota requiere autorización y una revisión de privilegios separadas.
