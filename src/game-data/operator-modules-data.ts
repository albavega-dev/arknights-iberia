import "server-only";

import indexData from "../../data/operator-modules/index.json";
import type { GameDataRegion } from "./gamedata-revisions";
import type { DatasetIndex } from "./operator-dataset";
import { loadOperatorModulesView, type ModulesDatasetReaders, type OperatorModulesView, type StoredModulesProfile } from "./operator-modules-view";
import type { StoredSkillsGlossary } from "./operator-skills-view";

const index = indexData as unknown as DatasetIndex;

// The bundler includes the JSON files (data/operator-modules/*.json) in the server output, as for skills.
// Operator ids are validated against the index before they reach the import path.
export const modulesDatasetReaders: ModulesDatasetReaders = {
  index,
  readProfile: async (operatorId) => (await import(`../../data/operator-modules/${operatorId}.json`) as { default: StoredModulesProfile }).default,
  readGlossary: async (region) => (await import(`../../data/operator-modules/glossary-${region}.json`) as { default: StoredSkillsGlossary }).default,
};

export function loadModulesView(operatorId: string, region: GameDataRegion): Promise<OperatorModulesView | null> { return loadOperatorModulesView(modulesDatasetReaders, operatorId, region); }
