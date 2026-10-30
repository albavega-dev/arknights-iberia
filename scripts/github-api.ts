import { gitBlobSha } from "../src/game-data/git-blob";
import { assertGitHubUrl, gameDataDirectorySegments, githubApiHost, githubRawHost, gitObjectId, treeUrl } from "../src/game-data/github-requests";

export const token = process.env.GITHUB_TOKEN || undefined;

/** GitHub REST request; the URL must come from the builders of github-requests.ts. */
export async function github<T>(url: URL): Promise<T> {
  const target = assertGitHubUrl(url, githubApiHost);
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "arknights-iberia-update-check" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(target, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${target.pathname}`);
  return (await response.json()) as T;
}

type TreeEntry = { path: string; type: string; sha: string };

/** Blob hash of every table (name without extension) in a GameData tables directory at a commit. */
export async function directoryBlobs(repository: string, commit: string, directory: string): Promise<Record<string, string>> {
  let sha = gitObjectId(commit);
  for (const part of [...gameDataDirectorySegments(directory), ""]) {
    const tree = await github<{ tree: TreeEntry[]; truncated: boolean }>(treeUrl(repository, sha));
    if (tree.truncated) throw new Error("Git tree truncated");
    if (part === "") return Object.fromEntries(tree.tree.filter((entry) => entry.type === "blob" && entry.path.endsWith(".json")).map((entry) => [entry.path.slice(0, -".json".length), entry.sha]));
    const next = tree.tree.find((entry) => entry.type === "tree" && entry.path === part);
    if (!next) throw new Error(`${directory} is not in ${commit.slice(0, 7)}`);
    sha = gitObjectId(next.sha);
  }
  throw new Error("unreachable");
}

/** Downloads a raw GitHub file, optionally checking it against a Git blob hash. */
export async function fetchBytes(url: URL, blob?: string): Promise<Buffer> {
  const target = assertGitHubUrl(url, githubRawHost);
  const name = target.pathname.split("/").at(-1);
  const response = await fetch(target, { headers: { "User-Agent": "arknights-iberia-update-check" } });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status} for ${name}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (blob && gitBlobSha(data) !== blob) throw new Error(`The download of ${name} does not match the git blob hash`);
  return data;
}
