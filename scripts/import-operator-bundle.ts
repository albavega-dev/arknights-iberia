import { readFile } from "node:fs/promises";
import { createPostgresLocalImportAdapter, importBundle, prepareBundleImport, readLocalImportConfig } from "../src/server/db/operator-bundle-import";

const path = process.argv.slice(2).find((value) => value !== "--");
if (!path) { console.error("Usage: corepack pnpm run data:bundle -- ruta/al/bundle.json"); process.exit(2); }
try {
  const bundle = JSON.parse(await readFile(path, "utf8")); const prepared = prepareBundleImport(bundle);
  if (!process.argv.includes("--execute") || !process.argv.includes("--confirm-local-import")) { console.log(JSON.stringify({ mode: "dry-run", operators: prepared.plan.operators, biographies: prepared.plan.biographies, databaseWrites: 0 }, null, 2)); process.exit(0); }
  const result = await importBundle(bundle, createPostgresLocalImportAdapter(readLocalImportConfig(process.env), prepared.bundle), true); console.log(JSON.stringify({ mode: "import", ...result }, null, 2));
} catch { console.error("Bundle import plan is invalid"); process.exit(1); }
