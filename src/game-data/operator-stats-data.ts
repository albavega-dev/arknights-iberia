import "server-only";

import indexData from "../../data/operator-stats/index.json";
import type { GameDataRegion } from "./gamedata-revisions";
import { isOperatorId, validateDatasetIndex, type DatasetIndex } from "./operator-dataset";
import type { OperatorStatsProfile } from "./operator-stats";

const index = indexData as unknown as DatasetIndex;

type StoredProfile = Omit<OperatorStatsProfile, "source">;

// Reads one operator profile from the per-operator dataset. The bundler includes the JSON files
// (data/operator-stats/*.json) in the server output.
// Returns null when the operator is not indexed for the requested region.
export async function loadStatsProfile(operatorId: string, region: GameDataRegion): Promise<OperatorStatsProfile | null> {
  if (!isOperatorId(operatorId)) return null;
  const entry = index.operators[operatorId];
  if (!entry || entry.region !== region) return null;
  const imported = await import(`../../data/operator-stats/${operatorId}.json`) as { default: StoredProfile };
  const profile = imported.default;
  if (profile.operatorId !== operatorId || profile.region !== region) return null;
  return { ...profile, source: index.sources[region] };
}

export function statsIndexErrors(): string[] { return validateDatasetIndex(index); }
