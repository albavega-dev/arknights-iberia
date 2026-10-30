import { gitBlobSha } from "../src/game-data/gamedata-diff";

export const token = process.env.GITHUB_TOKEN || undefined;

export async function github<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "arknights-iberia-update-check" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path.split("?")[0]}`);
  return (await response.json()) as T;
}

type TreeEntry = { path: string; type: string; sha: string };

/** Blob hash of every table (name without extension) in a directory of the repository at a commit. */
export async function directoryBlobs(repository: string, commit: string, path: string): Promise<Record<string, string>> {
  let sha = commit;
  for (const part of [...path.split("/"), ""]) {
    const tree = await github<{ tree: TreeEntry[]; truncated: boolean }>(`repos/${repository}/git/trees/${sha}`);
    if (tree.truncated) throw new Error("Git tree truncated");
    if (part === "") return Object.fromEntries(tree.tree.filter((entry) => entry.type === "blob" && entry.path.endsWith(".json")).map((entry) => [entry.path.slice(0, -".json".length), entry.sha]));
    const next = tree.tree.find((entry) => entry.type === "tree" && entry.path === part);
    if (!next) throw new Error(`${path} is not in ${commit.slice(0, 7)}`);
    sha = next.sha;
  }
  throw new Error("unreachable");
}

/** Downloads a URL, optionally checking it against a Git blob hash. */
export async function fetchBytes(url: string, blob?: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": "arknights-iberia-update-check" } });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status} for ${url.split("/").slice(-1)[0]}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (blob && gitBlobSha(data) !== blob) throw new Error(`The download of ${url.split("/").slice(-1)[0]} does not match the git blob hash`);
  return data;
}
