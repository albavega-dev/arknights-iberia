import "server-only";

import indexData from "../../data/operator-biographies/index.json";
import type { GameDataRegion } from "./gamedata-revisions";
import { fixedBiographyRevisions, validateBiography, type OperatorBiography } from "./operator-biography";
import { biographiesDatasetContractVersion, isOperatorId, validateDatasetIndex, type DatasetIndex } from "./operator-dataset";

const index = indexData as unknown as DatasetIndex;

// Reads one operator biography from the per-operator dataset. The bundler includes the JSON files
// (data/operator-biographies/*.json) in the server output.
// Returns null when the operator is not indexed for the requested region or its file is not a valid biography of the pinned revision.
export async function loadOperatorBiography(operatorId: string, region: GameDataRegion): Promise<OperatorBiography | null> {
  if (!isOperatorId(operatorId)) return null;
  const entry = index.operators[operatorId];
  if (!entry || entry.region !== region) return null;
  const imported = await import(`../../data/operator-biographies/${operatorId}.json`) as { default: unknown };
  const result = validateBiography(imported.default);
  if (!result.ok || result.value.operatorId !== operatorId || result.value.region !== region || result.value.source.revision !== fixedBiographyRevisions[region]) return null;
  return result.value;
}

export function biographiesIndexErrors(): string[] { return validateDatasetIndex(index, biographiesDatasetContractVersion); }
