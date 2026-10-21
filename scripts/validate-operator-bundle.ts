import { readFile } from "node:fs/promises";
import { validateOperatorBundle } from "../src/game-data/operator-bundle";

const path = process.argv.slice(2).find((value) => value !== "--");
if (!path) { console.error("Usage: validate-operator-bundle <bundle.json>"); process.exit(2); }
try {
  const result = validateOperatorBundle(JSON.parse(await readFile(path, "utf8")));
  if (!result.ok) { for (const entry of result.issues) console.error(`${entry.path || "bundle"}: ${entry.message}`); process.exit(1); }
  console.log(`Valid operator bundle (SHA-256 ${result.expectedSha256})`);
} catch (error) { console.error(error instanceof SyntaxError ? "Bundle is not valid JSON" : "Bundle could not be read"); process.exit(1); }
