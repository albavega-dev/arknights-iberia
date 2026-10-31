import { imageRepository } from "./asset-revisions";
import { gameDataRepository, pinnedGameDataTableHashes, type GameDataRegion } from "./gamedata-revisions";
import { compareCodeUnits } from "./string-order";

// Every GitHub URL the scripts request is built here from validated values: repositories, tables and directories come from
// closed lists, commits and tree ids must be full object ids, each path segment is encoded and the final host is checked.

export const githubApiHost = "api.github.com";
export const githubRawHost = "raw.githubusercontent.com";

const repositories: ReadonlySet<string> = new Set([gameDataRepository, imageRepository]);
export const gameDataTables: readonly string[] = Object.keys({ ...pinnedGameDataTableHashes("en"), ...pinnedGameDataTableHashes("cn") }).sort(compareCodeUnits);

const objectIdPattern = /^[0-9a-f]{40}$/;
const segmentPattern = /^[A-Za-z0-9_.-]+$/;

export function gitObjectId(value: unknown): string {
  if (typeof value !== "string" || !objectIdPattern.test(value)) throw new Error("Invalid git object id: expected 40 lowercase hexadecimal characters");
  return value;
}

export function gameDataRegion(value: unknown): GameDataRegion {
  if (value !== "en" && value !== "cn") throw new Error("Invalid region: expected en or cn");
  return value;
}

export function gameDataTable(value: unknown): string {
  if (typeof value !== "string" || !gameDataTables.includes(value)) throw new Error(`Unknown GameData table: ${JSON.stringify(value)}`);
  return value;
}

/** The two parts of an allowed repository ("owner/name"). */
export function repositorySegments(value: unknown): [string, string] {
  if (typeof value !== "string" || !repositories.has(value)) throw new Error(`Repository not allowed: ${JSON.stringify(value)}`);
  const [owner, name] = value.split("/");
  return [owner!, name!];
}

/** The tables directory of a region, the only repository path the scripts list. */
export function gameDataDirectory(region: GameDataRegion): string {
  return `${gameDataRegion(region)}/gamedata/excel`;
}

export function gameDataDirectorySegments(value: unknown): string[] {
  if (value !== gameDataDirectory("en") && value !== gameDataDirectory("cn")) throw new Error(`Directory not allowed: ${JSON.stringify(value)}`);
  return value.split("/");
}

/** Only https URLs on the given host, with no credentials. */
export function assertGitHubUrl(value: URL | string, host: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.host !== host || url.username || url.password) throw new Error(`Unexpected URL host: ${url.host}`);
  return url;
}

function githubUrl(host: string, segments: readonly string[], query: Readonly<Record<string, string>> = {}): URL {
  for (const segment of segments) {
    if (!segmentPattern.test(segment) || segment === "." || segment === "..") throw new Error(`Invalid URL segment: ${JSON.stringify(segment)}`);
  }
  const url = new URL(`https://${host}/${segments.map(encodeURIComponent).join("/")}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return assertGitHubUrl(url, host);
}

export function latestCommitUrl(repository: string, directory?: string): URL {
  return githubUrl(githubApiHost, ["repos", ...repositorySegments(repository), "commits"], { per_page: "1", ...(directory === undefined ? {} : { path: gameDataDirectorySegments(directory).join("/") }) });
}

export function compareUrl(repository: string, base: string, head: string, page: number): URL {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Invalid page");
  return githubUrl(githubApiHost, ["repos", ...repositorySegments(repository), "compare", `${gitObjectId(base)}...${gitObjectId(head)}`], { per_page: "100", page: String(page) });
}

export function treeUrl(repository: string, tree: string, recursive = false): URL {
  return githubUrl(githubApiHost, ["repos", ...repositorySegments(repository), "git", "trees", gitObjectId(tree)], recursive ? { recursive: "1" } : {});
}

/** Repository listing at a commit. */
export function contentsUrl(repository: string, ref: string, directory?: string): URL {
  return githubUrl(githubApiHost, ["repos", ...repositorySegments(repository), "contents", ...(directory === undefined ? [] : gameDataDirectorySegments(directory))], { ref: gitObjectId(ref) });
}

/**
 * A file of the image repository at a commit. File names come from tree listings and may hold characters such as "&",
 * so each segment is only checked for separators, control characters and dot segments, then encoded.
 */
export function rawImageUrl(commit: string, path: string): URL {
  const segments = path.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || /[\\\u0000-\u001f\u007f]/u.test(segment)) throw new Error(`Invalid image path: ${JSON.stringify(path)}`);
  }
  const url = new URL(`https://${githubRawHost}/${[...repositorySegments(imageRepository), gitObjectId(commit), ...segments].map(encodeURIComponent).join("/")}`);
  return assertGitHubUrl(url, githubRawHost);
}

export function rawGameDataUrl(commit: string, region: GameDataRegion, table: string): URL {
  return githubUrl(githubRawHost, [...repositorySegments(gameDataRepository), gitObjectId(commit), ...gameDataDirectorySegments(gameDataDirectory(region)), `${gameDataTable(table)}.json`]);
}
