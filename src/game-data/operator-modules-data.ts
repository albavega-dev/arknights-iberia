import "server-only";

import indexData from "../../data/operator-modules/index.json";
import artManifest from "../../data/operator-module-art-manifest.json";
import type { GameDataRegion } from "./gamedata-revisions";
import { modulesDatasetContractVersion, validateDatasetIndex, type DatasetIndex } from "./operator-dataset";
import type { TraitStage } from "./operator-modules";
import { moduleArtResolver, type ModuleArtManifest } from "./operator-module-art";
import { loadOperatorModulesView, type ModulesDatasetReaders, type OperatorModulesView, type StoredModulesProfile } from "./operator-modules-view";
import type { StoredSkillsGlossary } from "./operator-skills-view";

const index = indexData as unknown as DatasetIndex;

// The bundler includes the JSON files (data/operator-modules/*.json) in the server output, as for skills.
// Operator ids are validated against the index before they reach the import path.
export const modulesDatasetReaders: ModulesDatasetReaders = {
  index,
  readProfile: async (operatorId) => (await import(`../../data/operator-modules/${operatorId}.json`) as { default: StoredModulesProfile }).default,
  readGlossary: async (region) => (await import(`../../data/operator-modules/glossary-${region}.json`) as { default: StoredSkillsGlossary }).default,
  resolveArt: moduleArtResolver(artManifest as ModuleArtManifest),
};

/** The trait comes from the operator's stats file. */
export function loadModulesView(operatorId: string, region: GameDataRegion, trait: readonly TraitStage[]): Promise<OperatorModulesView | null> { return loadOperatorModulesView(modulesDatasetReaders, operatorId, region, trait); }

export function modulesIndexErrors(): string[] { return validateDatasetIndex(index, modulesDatasetContractVersion); }
