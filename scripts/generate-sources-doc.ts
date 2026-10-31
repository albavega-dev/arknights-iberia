/**
 * Rewrites the generated parts of docs/SOURCES.md from the pinned revisions and the date manifests.
 *
 *   pnpm docs:sources [--check]
 *
 * With --check it writes nothing and exits with 1 when the document is out of date.
 */
import { readFile, writeFile } from "node:fs/promises";
import { imageRepository, imageRevision } from "../src/game-data/asset-revisions";
import { portraitSource } from "../src/game-data/operator-portraits";
import { gameDataRepository, gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { renderSources, type SourcesInput } from "../src/game-data/sources-doc";

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

export async function sourcesInput(root = "."): Promise<SourcesInput> {
  const regional = await readJson<{ operators: SourcesInput["regional"] }>(`${root}/data/operator-regional-manifest.json`);
  const releases = await readJson<{ source: { gameDataRevision: string }; operators: SourcesInput["cnReleases"] }>(`${root}/data/operator-cn-release-manifest.json`);
  const updates = await readJson<{ updates: SourcesInput["globalUpdates"] }>(`${root}/data/operator-global-updates.json`);
  return {
    gameDataRepository, gameDataRevisions, releaseRevision: releases.source.gameDataRevision,
    imageRepository, imageRevision, portraitCdn: portraitSource.url,
    regional: regional.operators, cnReleases: releases.operators, globalUpdates: updates.updates,
  };
}

/** Returns the exit code: 0 written or up to date, 1 out of date under --check. */
export async function main(argv: readonly string[] = process.argv, root = ".", log: (line: string) => void = console.log): Promise<number> {
  const path = `${root}/docs/SOURCES.md`;
  const text = await readFile(path, "utf8");
  const rendered = renderSources(text, await sourcesInput(root));
  if (rendered === text) {
    log("SOURCES.md is up to date");
    return 0;
  }
  if (argv.includes("--check")) {
    log("SOURCES.md is out of date: run corepack pnpm docs:sources");
    return 1;
  }
  await writeFile(path, rendered, "utf8");
  log("SOURCES.md updated");
  return 0;
}

if (process.argv[1]?.endsWith("generate-sources-doc.ts")) main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
