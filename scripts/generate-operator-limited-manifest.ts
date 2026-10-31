import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gameDataReleaseTableHashes, gameDataRepository, gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import { limitedManifestErrors, limitedOperatorsFrom, limitedSourceField, limitedSourcePath, type LimitedManifest } from "../src/game-data/operator-limited";
import { arg, readJson, sha256 } from "./operator-dataset-io";

// Writes data/operator-limited-manifest.json from the pinned CN gacha table, keeping only the catalog operators.
//   pnpm data:limited:generate --cn-gacha <snapshot>/gacha_table.json --catalog data/operator-catalog/index.json --out <file>
// data:regenerate runs it after the other generators, with the hash and revision of the snapshot when they are not pinned yet.

export type LimitedGeneratorOptions = Readonly<{ expectedHash?: string; revision?: string }>;

export async function main(argv: readonly string[] = process.argv, options: LimitedGeneratorOptions = {}): Promise<LimitedManifest> {
  const expectedHash = options.expectedHash ?? gameDataReleaseTableHashes.cn.gacha_table;
  const bytes = await readFile(arg("--cn-gacha", argv));
  if (!expectedHash || sha256(bytes) !== expectedHash.toUpperCase()) throw new Error("The CN gacha table does not match the pinned SHA-256");
  const catalog = await readJson(arg("--catalog", argv)) as { operators: { id: string }[] };
  const catalogIds = new Set(catalog.operators.map((operator) => operator.id));
  const all = limitedOperatorsFrom(JSON.parse(bytes.toString("utf8")) as unknown);
  const skipped = all.filter((operator) => !catalogIds.has(operator.id)).map((operator) => operator.id);
  const manifest: LimitedManifest = {
    purpose: "Limited operators of the catalog: the limitedCharId of every LIMITED banner of the CN gacha table; collaboration operators are not included.",
    source: { region: "cn", repository: gameDataRepository, revision: options.revision ?? gameDataRevisions.cn, path: limitedSourcePath, field: limitedSourceField },
    operators: all.filter((operator) => catalogIds.has(operator.id)),
  };
  const errors = limitedManifestErrors(manifest, catalogIds);
  if (errors.length) throw new Error(errors.join("; "));
  await mkdir(dirname(arg("--out", argv)), { recursive: true });
  await writeFile(arg("--out", argv), serializeDatasetJson(manifest), "utf8");
  console.log(`Wrote ${manifest.operators.length} limited operators${skipped.length ? `; not in the catalog yet: ${skipped.join(", ")}` : ""}`);
  return manifest;
}

if (process.argv[1]?.endsWith("generate-operator-limited-manifest.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
