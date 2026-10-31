import type { OperatorClass } from "./operators";
import { assetPath } from "./asset-paths";
import { classIconFile, factionLogoFile, factionLogoFiles, illustrationFile, isOperatorId, isSubclassId, operatorImageDirectories, subclassIconFile } from "./operator-images";
import { portraitDirectory } from "./operator-portraits";
import { avatarDirectory, avatarFile } from "./operator-avatars";

// Local copies under public/assets, written by data:illustrations:sync, data:avatars:sync and data:portraits:sync for the
// catalog operators.
export type OperatorPortraitAsset = Readonly<{
  url: string;
  objectPosition: string;
  scale: number;
}>;

export type OperatorIllustrationAssets = Readonly<{
  base: string;
  elite2?: string;
}>;

export function getOperatorPortraitAsset(operatorId: string): OperatorPortraitAsset | null {
  if (!isOperatorId(operatorId)) return null;
  return { url: assetPath(portraitDirectory, `${operatorId}.webp`), objectPosition: "50% 50%", scale: 1 };
}

export function getOperatorAvatarUrl(operatorId: string): string | null {
  return isOperatorId(operatorId) ? assetPath(avatarDirectory, avatarFile(operatorId)) : null;
}

/** Local E0 illustration of an operator and its E2 one when the manifest lists it; null without an E0 illustration. */
export function illustrationAssetsFrom(illustrations: Readonly<Record<string, unknown>>, operatorId: string): OperatorIllustrationAssets | null {
  if (!isOperatorId(operatorId)) return null;
  const file = (variant: "base" | "elite2") => { const name = illustrationFile(operatorId, variant); return name in illustrations ? assetPath(operatorImageDirectories.illustrations, name) : undefined; };
  const base = file("base");
  if (!base) return null;
  const elite2 = file("elite2");
  return elite2 ? { base, elite2 } : { base };
}

export function getOperatorClassIconUrl(operatorClass: OperatorClass): string {
  return assetPath(operatorImageDirectories.classes, classIconFile(operatorClass));
}

export function getOperatorFactionIconUrl(factionId: string | null): string | null {
  return factionId && factionId in factionLogoFiles ? assetPath(operatorImageDirectories.factions, factionLogoFile(factionId)) : null;
}

export function getOperatorSubclassIconUrl(subClassId: string | null): string | null {
  if (!subClassId || !isSubclassId(subClassId)) return null;
  return assetPath(operatorImageDirectories.subclasses, subclassIconFile(subClassId));
}
