import type { OperatorClass } from "./operators";
import illustrationManifest from "../../data/operator-illustration-manifest.json";
import { classIconFiles, factionLogoFiles } from "./operator-images";

const portraitBase = "https://web.hycdn.cn/arknights/game/assets/char/portrait";
const classIconBase = "https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/main";
const factionIconBase = `${classIconBase}/factions`;

// External references only. These assets are not downloaded or redistributed by this repository.
// The source repository does not provide a project license for the game assets; usage remains
// subject to rights-holder approval and may be replaced by an approved provider later.
export type OperatorPortraitAsset = Readonly<{
  url: string;
  objectPosition: string;
  scale: number;
}>;

export type OperatorIllustrationAssets = Readonly<{
  base: string;
  elite2?: string;
}>;

const classPaths: Readonly<Record<OperatorClass, string>> = Object.fromEntries(Object.entries(classIconFiles).map(([name, file]) => [name, `classes/${file}`])) as Record<OperatorClass, string>;
const factionPaths = factionLogoFiles;

export function getOperatorPortraitAsset(operatorId: string): OperatorPortraitAsset | null {
  if (!/^char_[a-z0-9_]+$/.test(operatorId)) return null;
  return { url: `${portraitBase}/${operatorId}.png`, objectPosition: "50% 50%", scale: 1 };
}

export function getOperatorIllustrationAssets(operatorId: string): OperatorIllustrationAssets | null {
  const entry = illustrationManifest.operators[operatorId as keyof typeof illustrationManifest.operators] as { base: { url: string }; elite2?: { url: string } } | undefined;
  return entry ? { base: entry.base.url, ...(entry.elite2 ? { elite2: entry.elite2.url } : {}) } : null;
}

export function getOperatorClassIconUrl(operatorClass: OperatorClass): string {
  return `${classIconBase}/${classPaths[operatorClass]}`;
}

export function getOperatorFactionIconUrl(factionId: string | null): string | null {
  const path = factionId ? factionPaths[factionId] : undefined;
  return path ? `${factionIconBase}/${path}` : null;
}

export function getOperatorSubclassIconUrl(subClassId: string | null): string | null {
  if (!subClassId || !/^[a-z0-9]+$/.test(subClassId)) return null;
  return `${classIconBase}/ui/subclass/sub_${subClassId}_icon.png`;
}

export const operatorAssetSource = "https://web.hycdn.cn/arknights/game/assets/char/portrait/";
