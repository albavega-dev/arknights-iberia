import { operatorImageSource, isOperatorId, type ImageItem } from "./operator-images";

// Operator face avatars (avatars, converted to WebP) from Arknight-Images at the pinned revision, one per catalog operator.
// Skin avatars live in the same directory and are left out.
type FileInfo = { bytes: number; sha256: string; width: number; height: number };
type Conversion = { format: "webp"; maxSize: number; quality: number; alphaQuality: number; effort: number; tool: string };
export type OperatorAvatarManifest = {
  contractVersion: "1";
  source: { repository: string; revision: string };
  conversion: Conversion;
  /** Keyed by local file name (`<operator id>.webp`). */
  avatars: Record<string, { source: string; url: string; original: FileInfo; converted: FileInfo }>;
};

export const avatarSourceDirectory = "avatars";
export const avatarDirectory = "operator-avatars";
/** Fixed so that a new sync reproduces the committed files byte for byte; the tool version is part of it. */
export const avatarConversion: Conversion = { format: "webp", maxSize: 180, quality: 85, alphaQuality: 85, effort: 6, tool: "sharp 0.35.5" };
export const avatarSource: OperatorAvatarManifest["source"] = operatorImageSource;

export const avatarFile = (operatorId: string) => `${operatorId}.webp`;

/** Base avatar of every catalog operator, ordered by local file name. */
export function avatarInventory(operators: readonly { id: string }[]): ImageItem[] {
  const ids = operators.map((operator) => operator.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate operator ids in the catalog");
  for (const id of ids) if (!isOperatorId(id)) throw new Error(`Invalid operator id: ${JSON.stringify(id)}`);
  return ids.map((id) => ({ source: `${avatarSourceDirectory}/${id}.png`, local: avatarFile(id) })).sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0));
}
