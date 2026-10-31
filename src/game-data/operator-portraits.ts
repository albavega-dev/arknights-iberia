import { compareCodeUnits } from "./string-order";

// Operator portraits from the official web CDN, converted to WebP. The CDN has no revisions: each file is checked against the
// Content-MD5 the server sends, and the manifest records it with the ETag so the update check can compare them with HEAD requests.
type FileInfo = { bytes: number; sha256: string; width: number; height: number };
export type PortraitManifest = {
  contractVersion: "1";
  source: { url: string };
  conversion: { format: "webp"; quality: number; alphaQuality: number; effort: number; tool: string };
  /** Keyed by local file name (`<operator id>.webp`). */
  portraits: Record<string, { source: string; contentMd5: string; etag: string; original: FileInfo; converted: FileInfo }>;
  /** Catalog operators the CDN has no portrait for (HTTP 404). */
  missing: string[];
};

export const portraitHost = "web.hycdn.cn";
export const portraitSource: PortraitManifest["source"] = { url: `https://${portraitHost}/arknights/game/assets/char/portrait/` };
/** Fixed so that a new sync reproduces the committed files byte for byte; the tool version is part of it. */
export const portraitConversion: PortraitManifest["conversion"] = { format: "webp", quality: 85, alphaQuality: 80, effort: 6, tool: "sharp 0.35.5" };
export const portraitDirectory = "operator-portraits";

/** Portrait of an operator on the CDN; only operator ids are accepted. */
export function portraitUrl(operatorId: string): string {
  if (!/^char_[a-z0-9_]+$/.test(operatorId)) throw new Error(`Invalid operator id: ${JSON.stringify(operatorId)}`);
  const url = new URL(`${portraitSource.url}${operatorId}.png`);
  if (url.protocol !== "https:" || url.host !== portraitHost) throw new Error(`Unexpected URL host: ${url.host}`);
  return url.toString();
}

/** What a HEAD request says about a portrait: the status and, when it is there, its Content-MD5. */
export type PortraitHead = Readonly<{ status: number; contentMd5: string | null }>;
export type PortraitChanges = { changed: string[]; added: string[]; unavailable: string[]; removed: string[] };

/**
 * Portraits to sync again: recorded ones whose Content-MD5 changed, catalog operators the CDN now has and the manifest does not,
 * and failed requests. Operators still missing on the CDN are not reported again.
 */
export function portraitChanges(manifest: Pick<PortraitManifest, "portraits" | "missing">, catalogIds: readonly string[], heads: ReadonlyMap<string, PortraitHead>): PortraitChanges {
  const changes: PortraitChanges = { changed: [], added: [], unavailable: [], removed: [] };
  const missing = new Set(manifest.missing);
  for (const id of catalogIds) {
    const head = heads.get(id);
    const recorded = manifest.portraits[`${id}.webp`];
    if (!head || (head.status !== 200 && !(head.status === 404 && missing.has(id) && !recorded))) changes.unavailable.push(id);
    else if (head.status !== 200) continue;
    else if (!recorded) changes.added.push(id);
    else if (head.contentMd5 !== recorded.contentMd5) changes.changed.push(id);
  }
  const catalog = new Set(catalogIds);
  changes.removed = Object.keys(manifest.portraits).map((name) => name.slice(0, -".webp".length)).filter((id) => !catalog.has(id));
  for (const list of Object.values(changes)) list.sort(compareCodeUnits);
  return changes;
}
