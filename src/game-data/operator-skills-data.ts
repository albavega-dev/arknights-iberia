import "server-only";

import indexData from "../../data/operator-skills/index.json";
import iconsManifest from "../../data/operator-skill-icons-manifest.json";
import type { GameDataRegion } from "./gamedata-revisions";
import { skillsDatasetContractVersion, validateDatasetIndex, type DatasetIndex } from "./operator-dataset";
import { loadOperatorSkillsView, type OperatorSkillsView, type SkillsDatasetReaders, type StoredSkillsGlossary, type StoredSkillsProfile } from "./operator-skills-view";
import { getBaseSkillIconPath, getMasteryIconPath, getRoomIconPath, getSkillIconPath, type SkillIconEntry, type SkillIconsManifest } from "./operator-skill-icons";

const index = indexData as unknown as DatasetIndex;
const icons = iconsManifest as unknown as SkillIconsManifest;
const iconView = (src: string | null, entries: Readonly<Record<string, SkillIconEntry>>) => {
  const entry = src ? entries[src.slice(src.lastIndexOf("/") + 1)] : undefined;
  return src && entry ? { src, width: entry.width, height: entry.height } : null;
};

// The bundler includes the JSON files (data/operator-skills/*.json) in the server output, as for stats.
// Operator ids are validated against the index before they reach the import path.
export const skillsDatasetReaders: SkillsDatasetReaders = {
  index,
  readProfile: async (operatorId) => (await import(`../../data/operator-skills/${operatorId}.json`) as { default: StoredSkillsProfile }).default,
  readGlossary: async (region) => (await import(`../../data/operator-skills/glossary-${region}.json`) as { default: StoredSkillsGlossary }).default,
  resolveIcon: (region, skillId) => {
    const src = getSkillIconPath(icons, region, skillId);
    const entry = src ? icons.icons[icons.skills[region][skillId]] : undefined;
    return src && entry ? { src, width: entry.width, height: entry.height } : null;
  },
  resolveMasteryIcon: (label) => iconView(getMasteryIconPath(icons, label), icons.mastery),
  resolveBaseSkillIcon: (iconId) => iconView(getBaseSkillIconPath(icons, iconId), icons.baseSkills),
  resolveRoomIcon: (room) => iconView(getRoomIconPath(icons, room), icons.rooms),
};

export function loadSkillsView(operatorId: string, region: GameDataRegion): Promise<OperatorSkillsView | null> { return loadOperatorSkillsView(skillsDatasetReaders, operatorId, region); }

export function skillsIndexErrors(): string[] { return validateDatasetIndex(index, skillsDatasetContractVersion); }
