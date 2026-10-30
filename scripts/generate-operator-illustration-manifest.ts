import { compareCodeUnits } from "../src/game-data/string-order";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repository = "PuppiizSunniiz/Arknight-Images";
const defaultCommit = "1a41341cc634461a5abe3456722801a39b9a9d32";
const outputPath = path.resolve("data/operator-illustration-manifest.json");
const idManifestPath = path.resolve("data/operator-regional-manifest.json");
const releaseManifestPath = path.resolve("data/operator-cn-release-manifest.json");

type TreeEntry = { path?: string; type?: string };
type IllustrationManifest = {
  source: { repository: string; commit: string; directory: string };
  operators: Record<string, { base: { url: string }; elite2?: { url: string } }>;
};

const commit = process.argv.find((arg) => arg.startsWith("--commit="))?.slice("--commit=".length) ?? defaultCommit;
const treeFile = process.argv.find((arg) => arg.startsWith("--tree-file="))?.slice("--tree-file=".length);
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Invalid commit SHA");

const headers = { Accept: "application/vnd.github+json", "User-Agent": "arknights-iberia-manifest-generator" };
const tree = treeFile
  ? (JSON.parse(await readFile(path.resolve(treeFile), "utf8")) as { tree?: TreeEntry[]; truncated?: boolean })
  : await (async () => {
      const treeResponse = await fetch(`https://api.github.com/repos/${repository}/git/trees/${commit}?recursive=1`, { headers });
      if (!treeResponse.ok) throw new Error(`GitHub tree request failed: ${treeResponse.status}`);
      return (await treeResponse.json()) as { tree?: TreeEntry[]; truncated?: boolean };
    })();
if (tree.truncated) throw new Error("GitHub tree was truncated");

const idManifestRoot = JSON.parse(await readFile(idManifestPath, "utf8")) as { operators?: Array<{ id?: string }> };
const releaseManifestRoot = JSON.parse(await readFile(releaseManifestPath, "utf8")) as { operators?: Array<{ id?: string }> };
const operatorIds = [...new Set([
  ...(idManifestRoot.operators ?? []).map((operator) => operator.id),
  ...(releaseManifestRoot.operators ?? []).map((operator) => operator.id),
].filter((id): id is string => Boolean(id)))];
const files = new Set((tree.tree ?? []).filter((entry) => entry.type === "blob" && entry.path?.startsWith("characters/")).map((entry) => entry.path!.slice("characters/".length)));
const operators: IllustrationManifest["operators"] = {};
const rawBase = `https://raw.githubusercontent.com/${repository}/${commit}/characters`;

for (const operatorId of operatorIds.sort(compareCodeUnits)) {
  const baseFile = `${operatorId}_1.png`;
  const elite2File = `${operatorId}_2.png`;
  if (!files.has(baseFile)) throw new Error(`Missing base illustration for ${operatorId}`);
  operators[operatorId] = { base: { url: `${rawBase}/${baseFile}` } };
  if (files.has(elite2File)) operators[operatorId].elite2 = { url: `${rawBase}/${elite2File}` };
}

const manifest: IllustrationManifest = { source: { repository, commit, directory: "characters" }, operators };
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", output: outputPath, operators: Object.keys(operators).length, elite2: Object.values(operators).filter((entry) => entry.elite2).length, commit }));
