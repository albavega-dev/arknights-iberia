import { assetPath } from "./asset-paths";
import type { GameDataRegion } from "./gamedata-revisions";

export const skillIconsDirectory = "operator-skills";
// Version 2 adds the base skill and room icons (`baseSkills`, `baseSkillsMissing`, `rooms`).
export const skillIconsContractVersion = "2";
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
  /** Base skill icons (`ui/infrastructure/skill/<skillIcon>.png`), by local file name. */
  baseSkills: Readonly<Record<string, SkillIconEntry>>;
  /** building_data `skillIcon` ids of the catalog that have no file, per region. */
  baseSkillsMissing: Readonly<Record<GameDataRegion, readonly string[]>>;
  /** Room icons (`ui/infrastructure/<file>.png`), by local file name. */
  rooms: Readonly<Record<string, SkillIconEntry>>;
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

/** The icon id when it is set and inventoried, otherwise the skill id. Never builds a path outside the inventory. */
export function resolveSkillIconSource(skillId: string, iconId: string | null | undefined, inventory: ReadonlySet<string>): string | null {
  if (iconId && inventory.has(`${sourcePrefix}${iconId}.png`)) return `${sourcePrefix}${iconId}.png`;
  return inventory.has(`${sourcePrefix}${skillId}.png`) ? `${sourcePrefix}${skillId}.png` : null;
}

export const baseSkillIconsDirectory = "operator-base-skills";
export const baseSkillIconsSourceDirectory = "ui/infrastructure/skill";
export const roomIconsDirectory = "operator-base-rooms";
export const roomIconsSourceDirectory = "ui/infrastructure";
/** building_data room type -> source file; `buffIcon` (`manufacture`, `trading`...) does not match the file names. */
export const roomIconSources: Readonly<Record<string, string>> = {
  CONTROL: "control.png", POWER: "power.png", MANUFACTURE: "manu.png", TRADING: "trade.png", WORKSHOP: "workshop.png",
  TRAINING: "train.png", DORMITORY: "dorm.png", MEETING: "meet.png", HIRE: "hire.png", RECYCLE: "recycle.png",
};

const baseSkillIconIdPattern = /^[A-Za-z0-9][A-Za-z0-9_&.-]*$/;

/** `bskill_man_spd&limit1` ->`bskill_man_spd-limit1.png`: lower case, any other character than a-z, 0-9, `_`, `.` or `-` becomes `-`. */
export function baseSkillIconLocalName(iconId: string): string {
  if (!baseSkillIconIdPattern.test(iconId)) throw new Error(`Unexpected base skill icon id: ${iconId}`);
  return `${iconId.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}.png`;
}

/** `TRADING` -> `trading.png`. */
export function roomIconLocalName(room: string): string { return `${room.toLowerCase()}.png`; }

export function getBaseSkillIconPath(manifest: SkillIconsManifest, iconId: string): string | null {
  const file = baseSkillIconIdPattern.test(iconId) ? baseSkillIconLocalName(iconId) : null;
  return file && Object.hasOwn(manifest.baseSkills, file) ? assetPath(baseSkillIconsDirectory, file) : null;
}

export function getRoomIconPath(manifest: SkillIconsManifest, room: string): string | null {
  if (!Object.hasOwn(roomIconSources, room)) return null;
  const file = roomIconLocalName(room);
  return Object.hasOwn(manifest.rooms, file) ? assetPath(roomIconsDirectory, file) : null;
}

export function getSkillIconPath(manifest: SkillIconsManifest, region: GameDataRegion, skillId: string): string | null {
  const file = manifest.skills[region][skillId];
  return file && Object.hasOwn(manifest.icons, file) ? assetPath(skillIconsDirectory, file) : null;
}
