import { assetPath } from "./asset-paths";
import type { GameDataRegion } from "./gamedata-revisions";

export const skillIconsDirectory = "operator-skills";
export const skillIconsContractVersion = "1";
const sourcePrefix = "skill_icon_";

export type SkillIconEntry = Readonly<{ source: string; url: string; bytes: number; sha256: string; width: number; height: number }>;
export type SkillIconsManifest = Readonly<{
  contractVersion: typeof skillIconsContractVersion;
  source: Readonly<{ repository: string; revision: string; directory: string }>;
  /** Local file name -> provenance of that file. */
  icons: Readonly<Record<string, SkillIconEntry>>;
  /** Region -> skill id -> local file name. A skill that is not listed has no icon and uses the fallback. */
  skills: Readonly<Record<GameDataRegion, Readonly<Record<string, string>>>>;
  /** Skills of the catalog that have no icon, so the interface needs no file check. */
  missing: Readonly<Record<GameDataRegion, readonly string[]>>;
  /** Mastery rank icons (`ui/rank/m-1.png`..`m-3.png` of the same source), by local file name. */
  mastery: Readonly<Record<string, SkillIconEntry>>;
}>;

export const masteryIconsDirectory = "operator-skill-mastery";
export const masteryIconsSourceDirectory = "ui/rank";
export const masteryIconFiles = ["m-1.png", "m-2.png", "m-3.png"] as const;

/** `M1` -> `/assets/operator-skill-mastery/m-1.png` when the manifest lists it; null for any other label. */
export function getMasteryIconPath(manifest: SkillIconsManifest, label: string): string | null {
  const match = /^M([1-3])$/.exec(label);
  const file = match ? `m-${match[1]}.png` : null;
  return file && Object.hasOwn(manifest.mastery, file) ? assetPath(masteryIconsDirectory, file) : null;
}

/** `skill_icon_skcom_powerstrike[3].png` -> `skcom_powerstrike-3.png`. */
export function skillIconLocalName(sourceName: string): string {
  if (!sourceName.startsWith(sourcePrefix) || !sourceName.endsWith(".png")) throw new Error(`Unexpected skill icon name: ${sourceName}`);
  return sourceName.slice(sourcePrefix.length).replace(/\[(\d+)\]/g, "-$1").toLowerCase();
}

/** Order from the design: the icon id when it is set and inventoried, otherwise the skill id. Never builds a path outside the inventory. */
export function resolveSkillIconSource(skillId: string, iconId: string | null | undefined, inventory: ReadonlySet<string>): string | null {
  if (iconId && inventory.has(`${sourcePrefix}${iconId}.png`)) return `${sourcePrefix}${iconId}.png`;
  return inventory.has(`${sourcePrefix}${skillId}.png`) ? `${sourcePrefix}${skillId}.png` : null;
}

export function getSkillIconPath(manifest: SkillIconsManifest, region: GameDataRegion, skillId: string): string | null {
  const file = manifest.skills[region][skillId];
  return file && Object.hasOwn(manifest.icons, file) ? assetPath(skillIconsDirectory, file) : null;
}
