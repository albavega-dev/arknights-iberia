import { assetPath } from "./asset-paths";
import { illustrationFile, isOperatorId } from "./operator-images";

// JPEG previews for Open Graph and Twitter cards, derived from the local E0 illustrations: link previews of some clients
// do not render WebP. The site image is shared by the pages that are not an operator.
type FileInfo = { bytes: number; sha256: string };
type Conversion = { format: "jpeg"; width: number; height: number; quality: number; tool: string };
export type OperatorOgManifest = {
  contractVersion: "1";
  conversion: Conversion;
  /** Keyed by local file name (`<operator id>.jpg`); `source` is the local illustration it comes from. */
  images: Record<string, { source: string; sourceSha256: string; converted: FileInfo }>;
  site: { sources: Record<string, string>; converted: FileInfo };
};

export const ogImageDirectory = "operator-og-images";
export const ogSiteImageFile = "site.jpg";
export const ogIllustrationDirectory = "operator-illustrations";
/** Fixed so that the generator reproduces the committed files; the tool version is part of it. */
export const ogConversion: Conversion = { format: "jpeg", width: 1200, height: 630, quality: 78, tool: "sharp 0.35.5" };

export const ogImageFile = (operatorId: string) => `${operatorId}.jpg`;

/** Operator ids that have an E0 illustration in a file list, sorted. */
export function ogInventory(illustrationFiles: readonly string[]): string[] {
  const ids = illustrationFiles.flatMap((file) => {
    const id = file.endsWith("_1.webp") ? file.slice(0, -"_1.webp".length) : null;
    return id && isOperatorId(id) && illustrationFile(id, "base") === file ? [id] : [];
  });
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function ogSiteImageUrl(): string {
  return assetPath(ogImageDirectory, ogSiteImageFile);
}

/** Preview image of an operator, or the site image when it has no E0 illustration. */
export function ogImageUrlFrom(images: Readonly<Record<string, unknown>>, operatorId: string): string {
  const file = ogImageFile(operatorId);
  return isOperatorId(operatorId) && file in images ? assetPath(ogImageDirectory, file) : ogSiteImageUrl();
}
