/**
 * Rebuild the external charpor index without downloading image files.
 *
 * Run manually with:
 *   corepack pnpm exec tsx scripts/generate-operator-portrait-manifest.ts
 *
 * The script reads the project's reviewed operator manifests, resolves the
 * charpor directory through its Git tree SHA at the pinned commit, and writes
 * only verified paths.
 */
import { portraitDirectory, portraitRepository, portraitRevision } from "../src/game-data/asset-revisions";
import { compareCodeUnits } from "../src/game-data/string-order";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type RegionalManifest = { operators: Array<{ id: string }> };
type ReleaseManifest = { operators: Array<{ id: string }> };
type GitTreeResponse = { tree: Array<{ path: string; type: string }> };

const root = resolve(import.meta.dirname, "..");
const repository = portraitRepository;
const sourcePath = portraitDirectory;
const headers = { "User-Agent": "arknights-iberia-portrait-manifest" };

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(root, file), "utf8")) as T;
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

const [regional, release] = await Promise.all([
  readJson<RegionalManifest>("data/operator-regional-manifest.json"),
  readJson<ReleaseManifest>("data/operator-cn-release-manifest.json"),
]);
const ids = [...new Set([...release.operators, ...regional.operators].map(({ id }) => id))].sort(compareCodeUnits);
const contents = await githubJson<Array<{ name: string; sha: string }>>(`https://api.github.com/repos/${repository}/contents?ref=${portraitRevision}`);
const directory = contents.find((entry) => entry.name === sourcePath);
if (!directory) throw new Error(`Source directory not found: ${sourcePath}`);
const tree = await githubJson<GitTreeResponse>(`https://api.github.com/repos/${repository}/git/trees/${directory.sha}?recursive=1`);
const available = new Set(tree.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path));
const portraits: Record<string, string> = {};
for (const id of ids) {
  const path = `${id}_1.png`;
  if (available.has(path)) portraits[id] = `${sourcePath}/${path}`;
}

const manifest = {
  manifestVersion: "2026-10-15.1",
  source: { repository: `https://github.com/${repository}`, branch: "main", directory: sourcePath, directoryTreeSha: directory.sha },
  input: { operatorCount: ids.length, regionalManifest: "data/operator-regional-manifest.json", releaseManifest: "data/operator-cn-release-manifest.json" },
  selection: "Only the base _1.png charpor variant is selected; missing paths remain fallback-only.",
  coverage: { verifiedPortraits: Object.keys(portraits).length, missingPortraits: ids.length - Object.keys(portraits).length },
  portraits,
};
await writeFile(resolve(root, "data/operator-portrait-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest.coverage));
