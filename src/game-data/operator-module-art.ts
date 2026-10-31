import { assetPath } from "./asset-paths";
import { imageRepository, imageRevision } from "./asset-revisions";
import type { SkillIconView } from "./operator-skills-view";

// Module illustrations from Arknight-Images (equip/icon), converted to WebP, and the module level icons (equip/stage), copied as is.
type FileInfo = { bytes: number; sha256: string; width: number; height: number };
export type ModuleArtManifest = {
  contractVersion: "1";
  source: { repository: string; revision: string; directory: string };
  conversion: { format: "webp"; maxSize: number; quality: number; alphaQuality: number; effort: number; tool: string };
  /** Keyed by local file name (`<module id>.webp`). */
  art: Record<string, { source: string; url: string; original: FileInfo; converted: FileInfo }>;
  /** Keyed by local file name (`stage-<level>.png`). */
  stages: Record<string, { source: string; url: string } & FileInfo>;
};

export const moduleArtSource: ModuleArtManifest["source"] = { repository: imageRepository, revision: imageRevision, directory: "equip" };
/** Fixed so that a new sync reproduces the committed files byte for byte; the tool version is part of it. */
export const moduleArtConversion: ModuleArtManifest["conversion"] = { format: "webp", maxSize: 480, quality: 75, alphaQuality: 50, effort: 6, tool: "sharp 0.35.5" };
/** Level icons: source file under `equip/stage/` by local file name. */
export const moduleStageSources: Readonly<Record<string, string>> = { "stage-1.png": "img_stg1.png", "stage-2.png": "img_stg2.png", "stage-3.png": "img_stg3.png" };

export const moduleArtDirectory = "operator-modules-art";

/** Illustration of a module, or null when the manifest has none. */
export function moduleArtResolver(manifest: Pick<ModuleArtManifest, "art">): (moduleId: string) => SkillIconView | null {
  return (moduleId) => {
    const entry = manifest.art[`${moduleId}.webp`];
    return entry ? { src: assetPath(moduleArtDirectory, `${moduleId}.webp`), width: entry.converted.width, height: entry.converted.height } : null;
  };
}
